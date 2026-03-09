# 语音消息接入实现指南（方案二：R2 + Worker 代理短效链接）

> 适用平台：飞书、Telegram（可扩展）
> 基础设施：Cloudflare Workers + Cloudflare R2

---

## 架构总览

```
[飞书 / Telegram] → Worker 接收事件
  → 立即响应 HTTP 200 OK (防止 Webhook 重试风暴)
  → 将后续任务丢入 waitUntil 异步上下文
  → 渠道适配层：统一下载音频 → ArrayBuffer
  → 上传 R2（Bucket 保持私有，使用不可预测的 UUID 作为文件名）
  → Worker 拼装代理下载 URL（/api/proxy/audio/...）
  → 提交火山引擎 ASR 任务（传入代理 URL）
  → 轮询获取转录文本
  → 拼装 prompt → aiHandlers.request
  → finally：删除 R2 临时文件
```

---

## 一、基础设施配置（一次性）

**步骤：**

1. 通过 Wrangler 创建私有 R2 Bucket（`feishu-audio-tmp`），**不开启公开访问**，**不绑定自定义域名**
2. 在 `wrangler.toml` 中绑定 R2 Bucket（`binding = "AUDIO_BUCKET"`）
3. 通过 `wrangler secret put` 注入敏感配置：
   - `VOLC_API_KEY`（用于调用火山引擎 ASR 接口，只需配置这一个 Key 即可）

**要点：**
- R2 Bucket **必须保持私有**，外部无法直接访问。
- 无需配置复杂的 S3 凭证，也无需引入任何生成预签名 URL 的第三方依赖库。全部依赖 Cloudflare Worker 原生 API。

---

## 二、渠道适配层（统一音频下载接口）

**步骤：**

1. 定义统一的音频元数据结构，包含：`audioBuffer`、`fileKey`、`mimeType`、`sourceChannel`
2. 为每个渠道实现各自的下载函数：
   - **飞书**：携带 Tenant Access Token，调用 `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=audio`，返回 ArrayBuffer
   - **Telegram**：先调用 `getFile` API 获取 `file_path`，再拼接 `https://api.telegram.org/file/bot<token>/<file_path>` 直接下载，无需额外鉴权 Header
3. 在各渠道的消息处理器（`handlers/feishu.ts`、`handlers/telegram.ts`）中，捕获音频类型消息后，调用对应下载函数，将结果传入统一的后续处理流程

**要点：**
- 飞书音频为 `ogg/opus`，Telegram 语音（`message.voice`）同样为 `ogg/opus`，火山引擎 ASR 原生支持该格式，**全链路无需转码**
- Telegram 的文件下载 URL 含有 bot token，需视为敏感信息：Worker 内部直接下载后丢弃该 URL，不要将其记录到日志或传递给第三方

---

## 三、R2 上传与代理 URL 构造

**步骤：**

1. 为每条音频生成高度不可预测且具备幂等性的对象键。例如，结合来源、消息 ID 和随机散列：`audio/{channel}-{message_id}-{sha256_hash}.ogg`。确保外部无法通过穷举获取到有效 URL。
2. 通过 `c.env.AUDIO_BUCKET.put()` 将 ArrayBuffer 上传到 R2，附加 `contentType: audio/ogg` 和来源渠道等自定义元数据。
3. 构造 Worker 本身的公开代理路由 URL，例如 `https://<你的Worker域名>/api/proxy/audio/{channel}/{message_id}/{sha256_hash}.ogg`。
4. 将这个拼装好的代理 URL 传给火山引擎 ASR 接口。

**要点：**
- **不可预测性（Security by Obscurity）**：由于 Bucket 是私有的，URL 中包含强随机特征（如散列值），使得该文件链接具有与预签名 URL 同级别的防遍历安全性。
- **Worker 代理路由**：需要在 Worker 代码中新增对应的 GET 路由 `/api/proxy/audio/...`，当火山引擎请求该 URL 时，Worker 读取 URL 参数，通过 `c.env.AUDIO_BUCKET.get()` 拉取文件，并返回文件流（需要设置对应的 `Content-Type` Header）。
- **极简原生**：完全利用 Cloudflare 原生 Binding，没有繁琐的 S3 凭证生成和签名计算。

---

## 四、火山引擎 ASR 调用

**步骤：**

1. 调用大模型录音版提交接口（`/api/v3/auc/bigmodel/submit`），传入上述生成的 Worker 代理 URL，格式参数设置为 `format: ogg, codec: opus`
2. 轮询查询接口（`/api/v3/auc/bigmodel/query`），每 1.5 秒轮询一次，建议最多 40 次（约 60 秒上限）
3. 任务状态变为 `Success` 后，提取所有 `utterances` 的 `text` 字段拼接为完整文本

**要点：**
- 轮询总时长（40 × 1.5s = 60s）需控制在 `waitUntil` 的最大执行时间内
- 拼装给 AI 的 prompt 加上渠道标注，如 `[飞书语音转译]: ...` / `[Telegram 语音转译]: ...`，便于 AI 侧感知消息来源

**注意事项：**
- 火山引擎 ASR 任务状态为 `Running` 时不代表失败，需继续轮询；仅 `Failed` 才触发错误处理
- 若轮询超时，应视为失败进入 catch 流程，不能挂起协程永久等待

---

## 五、清理与兜底

**步骤：**

1. 在 `finally` 块中，无论流程成功或失败，始终调用 `c.env.AUDIO_BUCKET.delete(objectKey)` 立即物理删除 R2 临时文件（实现阅后即焚）。
2. 在 Cloudflare Dashboard → R2 → 该 Bucket → Object Lifecycle Rules 中，为 `audio/` 前缀设置 **1 天后自动过期**的生命周期规则。

**要点：**
- **阅后即焚是安全核心**：配合不可预测的短效 URL，这能在文件被消费后立刻关闭公网暴露的可能，大幅提升 Worker 代理方案的安全性。
- 生命周期规则是 `finally` 清理的兜底机制：当 Worker 意外崩溃导致 `finally` 未执行时，文件仍会在 1 天内自动清理，不会永久留存和长期暴露。

---

## 六、错误处理与用户反馈

**步骤：**

1. `catch` 块捕获任意环节异常后，通过对应渠道的消息发送 API 回复用户（如「语音识别暂时失败，请发送文字」）
2. 记录结构化错误日志，包含：渠道、`fileKey`、失败阶段（下载/上传/ASR/AI）、错误信息

**注意事项：**
- Telegram 的错误回复需要 `chat_id`，应在进入 `waitUntil` 前从事件中提取并传入异步上下文
- 飞书的错误回复需要 `open_id` 或 `chat_id`，同上

---

## 关键配置速查

| 配置项 | 存放位置 | 说明 |
|--------|----------|------|
| `AUDIO_BUCKET` | wrangler.toml binding | R2 Bucket 原生绑定，用于 Worker 内部的快速读写 |
| `VOLC_API_KEY` | wrangler secret | 火山引擎 ASR API Key |

---

*文档版本：2026-03-09*

---

## 更新记录
- **2026-03-09**:
  - 架构升级：废弃冗余的 S3 预签名机制，全面拥抱“Worker 代理 + UUID 短效链接 + 阅后即焚”架构。
  - 删除指南中 `aws4fetch` 和 S3 凭证相关配置，大幅降低维护成本。
  - 明确 R2 存储桶不绑定自定义域名的私有属性。
  - 修复基础设施配置中的鉴权配置前后矛盾，统一为 `VOLC_API_KEY`，不需要复杂的 AWS V4 AK/SK 签名。
  - 修复火山引擎 ASR 调用的 API 路径笔误，将 `/api/v3/sauc/bigmodel/...` 更正为 `/api/v3/auc/bigmodel/...`。
  - 优化 R2 对象键命名策略为 `audio/{channel}-{message_id}.ogg`，利用消息 ID 的唯一性实现幂等覆盖，减少重复文件。
  - 在架构总览中强调在 `waitUntil` 前必须立即响应 HTTP 200 OK，防止产生重试风暴。
  - 将火山引擎 ASR 轮询时长的宽容度上限从 20 次 (30秒) 延长至 40 次 (60秒)，以适应长语音或资源排队情况。
