# 飞书（Lark）机器人 API 调用指南：推送与接收消息

飞书机器人主要分为**自定义机器人**（群组专用，简单推送）和**应用机器人**（自建应用，支持完整推送 + 交互接收）。两者适用场景不同，选择取决于需求复杂度。

- **自定义机器人**：适合单向通知（如监控告警、定时推送），无需开放平台开发，无管理员审批，但**仅限当前群组**，**无法接收/回复用户消息**。
- **应用机器人**：适合自动化集成（如智能客服、审批通知），支持事件订阅实时接收消息、回复交互、群管理等，但需在开放平台创建应用、申请权限、管理员审批发布。

下面从**创建流程、推送实现、接收实现、权限/限流/安全、代码示例、边缘情况**多角度详细说明（基于2025-2026最新官方文档）。

### 2. 应用机器人（推送 + 接收完整方案）

#### 第一步：创建应用 & 启用机器人
1. 登录 [飞书开放平台](https://open.feishu.cn/app) → 创建**企业自建应用**。
2. 应用详情 → 「机器人」 → 开启机器人能力 → 设置头像/名称。
3. 「权限管理」申请必要权限（见下文）。
4. 「版本管理与发布」 → 创建版本 → 企业管理员审批通过。
5. 将机器人添加到群/用户（群设置添加，或用户私聊）。

#### 推送消息（推荐方式：im/v1/messages/create API）
- **URL**：`POST https://open.feishu.cn/open-apis/im/v1/messages`
- **认证**：`Authorization: Bearer {tenant_access_token}`（有效期2小时）

**先获取 tenant_access_token**（自建应用）：
```bash
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
{
  "app_id": "cli_xxxx",
  "app_secret": "xxxx"
}
```
返回 `tenant_access_token`（建议缓存，剩余<30分钟自动刷新）。

**请求参数**：
- `receive_id_type`（query）：`chat_id`（群） / `open_id`（用户）
- `receive_id`：群 chat_id 或用户 open_id
- `msg_type`、`content` 同自定义机器人（文本 ≤150KB，卡片 ≤30KB）
- `uuid`（可选）：去重（1小时内相同 uuid 只发一次）

**curl 示例**（群发文本）：
```bash
curl -X POST 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id' \
  -H 'Authorization: Bearer t-xxxx' \
  -H 'Content-Type: application/json' \
  -d '{
    "receive_id": "oc_xxxxxxxx",
    "msg_type": "text",
    "content": "{\"text\":\"API推送成功！\"}"
  }'
```

**获取 chat_id**：调用搜索群组 API 或从事件中获取。

#### 接收消息（事件订阅：im.message.receive_v1）
**订阅流程**：
1. 应用详情 → 「事件订阅」 → 添加事件 → 搜索「接收消息」（im.message.receive_v1）。
2. 权限申请（消息与群组分类）：
   - 单聊：获取用户发给机器人的单聊消息
   - 群聊：获取群组中@机器人的消息 / 获取群组中所有消息（敏感权限，需管理员审批）
3. **选择接收模式**（推荐**长连接**）：

**模式对比**：
| 模式         | 优点                          | 缺点                     | 适用 |
|--------------|-------------------------------|--------------------------|------|
| **长连接（SDK）** | 无需公网IP、本地开发友好、自动加密、5分钟集成 | 仅自建应用，最多50连接 | 强烈推荐 |
| **Webhook**  | 通用                          | 需公网URL、自行验签     | 有公网服务器时 |

**长连接（SDK 推荐，Python 示例）**：
```python
import lark_oapi as lark

def do_p2_im_message_receive_v1(data: lark.im.v1.P2ImMessageReceiveV1):
    print("收到消息！", data.event.message)  # 含 message_id、chat_id、content 等
    # 在此回复：调用发送消息 API

handler = lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(do_p2_im_message_receive_v1).build()
cli = lark.ws.Client("你的APP_ID", "你的APP_SECRET", event_handler=handler)
cli.start()  # 启动 WebSocket
```

**Webhook 模式**：配置公网 URL，飞书 POST 事件 JSON（需解密+验签）。

**事件结构关键字段**（简化）：
```json
{
  "event": {
    "sender": { "sender_id": { "open_id": "ou_xxx" } },
    "message": { "message_id": "om_xxx", "chat_id": "oc_xxx", "msg_type": "text" /* content 可能需额外获取 */ }
  }
}
```
- 事件仅含基础信息，**完整 content** 建议调用「获取指定消息内容」API：
  `GET /open-apis/im/v1/messages/{message_id}`（带 tenant_access_token）。

**回复用户**：拿到 chat_id + message_id 后，用发送消息 API 回复（或 reply 接口）。

### 3. 权限、限流、安全、注意事项

**必备权限**（管理员审批）：
- 发送消息：`im:message`
- 读取消息：根据单聊/群聊选择
- 获取群信息：`im:chat.info`

**频率限制**（应用机器人更严格）：
- 单用户/单群：5 QPS
- 接口整体：1000次/分钟、50次/秒
- 自定义机器人：100次/分钟

**消息大小 & 合规**：
- 避免明文手机号/邮箱（会被拦截，错误码 230028）
- 卡片用飞书卡片搭建器生成 JSON

**安全**：
- tenant_access_token 勿泄露
- Webhook 事件需验签（官方 SDK 已处理）
- 长连接自动加密

**边缘情况 & 常见坑**：
- 机器人不在群 → 发送失败（230002）
- 用户不在机器人可用范围 → 私聊失败（230013）
- 重复推送 → 用 uuid 或 message_id 幂等
- 商店应用 vs 自建应用：商店应用事件仅支持 Webhook
- 本地开发：必须用长连接，否则无法测试
- 消息卡片交互：不支持 postback（仅 URL 跳转）
- 频率高峰（整点）易限流

### 4. 推荐代码库 & 工具
- **Python SDK**：`pip install lark-oapi`（推送 + 事件全支持）
- **卡片搭建**：飞书卡片搭建器（可视化拖拽）
- **测试工具**：Apifox / Postman（导入飞书 OpenAPI）
- **完整示例项目**：开放平台体验教程「一键开发自动回复机器人」

### 5. 参考官方文档（实时更新）
- 自定义机器人：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
- 发送消息 API：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
- 接收消息事件：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive
- 事件订阅配置：https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-
- 机器人概述：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-overview

**建议起步路径**：
1. 先用自定义机器人验证推送（5分钟搞定）。
2. 需求互动 → 切换应用机器人 + 长连接 SDK（推荐 Python/Go）。
3. 生产上线前：申请权限、管理员审批、压测限流。

有具体语言（Python/Java/Go）或场景（卡片回复、@所有人、定时任务）需求，随时提供代码模板或排查细节！官方社区（open.feishu.cn/community）也有大量示例。
