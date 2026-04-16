# Claw Owner Task

**AI 优先的任务管理系统** —— 专为个人用户与 AI Agent (ClaudeCode / GeminiCLI / OpenCode / OpenCLaw / NanoClaw 等) 设计。  
依托 Cloudflare 生态提供全球加速的 API 服务，通过高性能 Rust CLI 和 Telegram/飞书 机器人实现无缝的任务管控。

---

## 核心特性

*   **高性能 CLI**：基于 Rust 编写，支持全平台（macOS/Linux/Windows），极速启动，内置自动升级。
*   **AI 友好架构**：全局支持 `--json` 输出结构化数据；提供 `/api/info` 自发现接口，避免 Agent 产生参数幻觉。
*   **AI 语义解析**：集成 Cloudflare Workers AI，支持自然语言创建任务（例如：“帮我记录明天下午三点的会议”），支持云端定时推送 AI 任务总结。
*   **多重提醒机制**：支持云端主动推送（Bark / Telegram / 飞书）。
*   **Telegram/飞书深度交互**：支持对话式智能任务管理，以及精准斜杠命令。
*   **精准时区管理**：采用“后端 UTC 存储 + 动态时区渲染”方案，彻底解决跨时区偏差。
*   **极致 Serverless**：基于 Cloudflare Workers + D1 数据库，零成本部署。

---

## 安装指南 (CLI)

### 1. 下载与安装
前往 [Releases](https://github.com/gray0128/claw-owner-task/releases) 下载对应系统的二进制文件。

```bash
# 以 macOS (ARM64) 为例
chmod +x claw-task-macos-arm64
sudo mv claw-task-macos-arm64 /usr/local/bin/claw-task

# 验证安装
claw-task --version
```

### 2. 设置别名 (可选)
为了提高效率，建议在 Shell 配置文件（如 `~/.zshrc` 或 `~/.bashrc`）中设置快捷命令：
```bash
# 添加到配置文件末尾
alias ct='claw-task'

# 生效配置
source ~/.zshrc
```
之后即可使用 `ct` 代替 `claw-task`。

### 3. 版本升级
CLI 内置自动检查更新功能，发现新版本后请执行：
```bash
sudo claw-task upgrade
```
> 注意：升级必须使用 `sudo` 且必须输入原名 `claw-task upgrade`（不能使用别名），否则会导致路径识别失败。

---

## 后端部署与云端配置 (Cloudflare)

### 1. 资源绑定配置 (Bindings)
在 `wrangler.toml` 中，系统需要绑定以下 Cloudflare 资源：
- **D1 Database** (`DB`): 存储所有任务、标签、配置及推送日志。需创建数据库 `claw-owner-task-db`，并将生成的 `database_id` 填入 `wrangler.toml` 对应的 `[[d1_databases]]` 块中。
- **Workers AI** (`AI`): 核心 AI 语义解析引擎（基于 `@cf/zai-org/glm-4.7-flash` 等模型）。
- **R2 Bucket** (`AUDIO_BUCKET`): 暂存飞书、Telegram 等渠道发来的语音消息，并供火山引擎 ASR 引擎下载转译。需创建一个名为 `volcengine-asr` 的 R2 存储桶。

1. **创建 D1 数据库并填入配置**：
   ```bash
   npx wrangler d1 create claw-owner-task-db
   ```
   *将终端输出的 `database_id` 复制并替换到 `wrangler.toml` 文件中的相应位置。*
2. **初始化表结构**：
   ```bash
   npm run db:migrate:remote
   ```
3. **创建 R2 存储桶**：
   ```bash
   npx wrangler r2 bucket create volcengine-asr
   ```
4. **部署 Worker**：
   ```bash
   npx wrangler deploy
   ```

### 2. 机密变量配置 (Secrets)
敏感凭证需通过命令行设置，**严禁写入配置文件**：
```bash
# 核心系统配置
npx wrangler secret put TASK_API_KEY        # 必填：API 访问授权码

# 云端推送 (可选)
npx wrangler secret put BARK_URL            # Bark 推送网关 (格式: https://api.day.app/your_key/)

# Chatbots 与语音支持 (可选，按需配置)
npx wrangler secret put TELEGRAM_BOT_TOKEN  # Telegram 机器人 API Token
npx wrangler secret put TELEGRAM_CHAT_ID    # 唯一允许访问的 Telegram Chat ID
npx wrangler secret put FEISHU_APP_ID       # 飞书自建应用 App ID
npx wrangler secret put FEISHU_APP_SECRET   # 飞书自建应用 App Secret
npx wrangler secret put FEISHU_VERIFY_TOKEN # 飞书事件订阅 Verification Token (用于 Webhook 握手校验)
npx wrangler secret put FEISHU_ENCRYPT_KEY  # 飞书事件订阅 Encrypt Key (用于推送消息的安全解密)
npx wrangler secret put FEISHU_ALLOWED_CHAT_ID # 允许访问的飞书 Chat/Open ID（逗号分隔，安全白名单）
npx wrangler secret put VOLC_API_KEY        # 火山引擎 API Key (用于处理语音消息)
```

### 3. 环境参数 (Vars)
在 `wrangler.toml` 的 `[vars]` 块中定义，用于控制环境状态：

| 参数名 | 是否必填 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `USER_TIMEZONE` | **是** | `Asia/Shanghai` | 服务端基准时区。所有与时间相关的处理都依赖此配置，强烈建议根据所在地正确设置（例如：`America/New_York`, `Europe/London`, `Asia/Tokyo` 等）。 |
| `ENABLE_AI` | 否 | `true` | 是否启用 AI 语义解析。如果关闭，所有的文本将原样作为标题创建任务，不消耗 AI 额度。 |
| `AI_MODEL` | 否 | `@cf/zai-org/glm-4.7-flash` | 使用的 Cloudflare Workers AI 模型。 |
| `VOLC_ASR_MODEL` | 否 | `bigmodel` | 火山引擎 ASR 所使用的模型名称。 |
| `VOLC_ASR_RESOURCE_ID` | 否 | `volc.seedasr.auc` | 火山引擎 ASR 资源 ID。 |
| `CRON_SUMMARY_TIME` | 否 | `09:00,21:00` | 自动推送 AI 总结的时间点 (格式 `HH:mm`，支持逗号分隔多个)。若不需定时总结可置空。 |
| `BASE_URL` | 否 | `https://...` | 你的 Worker 自定义域名，用于生成各类 Web 网页卡片分享链接。**强烈建议配置**，否则分享的链接可能无法在公网被正常访问。 |
| `VOLC_API_HOST` | 否 | `openspeech.volcengineapi.com` | 火山引擎语音识别接口 Host。默认即可，除非官方 API 域名变更。 |

### 4. 自定义域名绑定 (可选)
为了提供专业且固定的对外服务地址（用于 Webhook 配置和分享链接），你可以在 `wrangler.toml` 中配置自定义域名：
```toml
# 自定义域名绑定
[[routes]]
pattern = "claw-task.你的域名.com"
custom_domain = true
```
**配置说明**：
- 此配置会让 Cloudflare 自动为你创建 DNS 记录并配置 HTTPS 证书。
- **前提条件**：你配置的主域名（如 `你的域名.com`）必须已经托管在你当前执行部署操作的 Cloudflare 账号下。
- 绑定成功后，请同步将 `[vars]` 中的 `BASE_URL` 变量更新为 `https://claw-task.你的域名.com`。

---

## Telegram 机器人配置与使用

集成 Telegram 机器人后，您可以直接通过聊天窗口管理任务，这是最便捷的移动端交互方式。

### 1. 配置流程
1. **申请机器人**：在 Telegram 中私聊 [@BotFather](https://t.me/BotFather)，创建新机器人并获取 `API Token`。
2. **获取个人 Chat ID**：私聊 [@userinfobot](https://t.me/userinfobot) 获取您的唯一数字 ID。这是为了确保机器人仅响应您一个人的指令（安全锁定）。
3. **写入机密变量**：
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN # 输入获取的 Token
   npx wrangler secret put TELEGRAM_CHAT_ID   # 输入获取的个人 ID
   ```
4. **激活 Webhook**：将以下 URL 中的占位符替换为您的实际数据并执行（一次性操作）：
   ```bash
   curl -F "url=https://<你的Worker域名>/api/webhook/telegram" https://api.telegram.org/bot<你的BOT_TOKEN>/setWebhook
   ```

### 2. 交互指令与用法
机器人支持显式指令（Command）和自然语言（NLP）双重交互模式：

*   **自然语言对话**：直接发送“帮我创建明天下午三点的会议”、“买牛奶，下周一提醒我”。AI 将自动解析标题、日期并入库。
*   **任务总结 (`/summary` 或 `/总结`)**：手动触发 AI 生成任务摘要（含昨日回顾、今日计划及待办统计），并推送到所有配置渠道。
*   **获取列表 (`/list` 或 `/列表`)**：快速拉取所有任务的列表，并返回包含所有任务的 Web 网页卡片链接，便于多任务查看。
*   **查询单条任务 (`/#id`，如 `/#71`)**：直接输入带 `#` 的数字 ID 查询单条任务的详细信息（等价于 `ct list -i <id>`）。
*   **精确添加 (`/add <内容>` 或 `/添加 <内容>`)**：**绕过 AI 语义解析**，直接将输入文本作为标题创建任务。适用于需要 100% 精确录入的场景。
*   **其他指令**：任何未定义的 `/` 指令或普通文本均会尝试通过 AI 进行语义理解（支持查询、删除、完成任务等复杂操作）。

### 3. 注意事项
*   **权限锁定**：系统会自动校验发送者的 `Chat ID`，只有配置在 `TELEGRAM_CHAT_ID` 中的用户才能操作。
*   **Webhook 报错**：若执行 `curl` 返回 `401`，请检查 Token 是否包含 `bot` 前缀或有多余空格。
*   **响应延迟**：AI 解析通常需要 2-5 秒，发送消息后请稍等片刻，机器人会返回处理结果表格。

---

## 终端 (CLI) 配置与使用

在使用 CLI 前，请在配置文件中注入环境变量：
```bash
export TASK_API_URL="https://<你的域名>/api"
export TASK_API_KEY="你的密钥"
```

### 常用命令示例
- **列表查看**：`claw-task list --status pending`
- **AI 录入**：`claw-task ai "明天中午十二点去取快递"`
- **生成任务总结**：`claw-task summary`

---

## 技术细节说明

### 时间处理
- 后端统一存储 **UTC** 时间。输入不含时区的字符串时，系统依据 `USER_TIMEZONE` 自动补齐。
- Web、CLI 和 Chatbots 均基于 `USER_TIMEZONE` 进行格式化展示，确保多端一致。

### AI 模型与限制
- **所用模型**：当前后端通过 Cloudflare Workers AI 调用 `AI_MODEL` 环境变量配置的模型（默认：`@cf/zai-org/glm-4.7-flash`）。
- **应用场景**：该模型用于两个核心功能：（1）解析用户的自然语言（从文本中提取任务标题、时间和动作）；（2）对近期的任务执行情况进行梳理，生成供推送的任务总结报告。
- **额度限制**：语义解析与总结生成均消耗 Cloudflare Workers AI 额度（免费版通常为每日 10,000 Neurons）。若额度耗尽，相关 AI 功能将报错。

---

## 项目结构
- `/src/worker`: 后端核心（TypeScript）。
- `/cli-rust`: 高性能终端工具（Rust）。
- `/src/web`: 原生 HTML 界面（No-build）。
- `/docs`: 开发计划与架构方案。

---
**Last Updated**: 2026-03-10
**Changes**: 移除CLI中的`check`命令（`--channel cloud/agent`），避免用户误操作，云端定时推送功能不受影响。
