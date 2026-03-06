# Claw Owner Task

这是一个专为个人用户和 **AI Agent (OpenCLaw)** 设计的跨平台任务管理工具。支持云端存储与多渠道（Cloud: **Bark/Telegram**, Agent: **OpenCLaw**）提醒。支持直接在 Telegram 中以自然语言对话方式管理任务。

## 安装

### 方案 A：直接下载二进制文件（推荐，高性能）
如果您追求极致的启动速度且不想安装开发环境：

1. **从 Release 页面下载：**
   前往 [GitHub Releases](https://github.com/gray0128/claw-owner-task/releases) 页面，下载对应您操作系统的二进制文件（如 `claw-task-macos-arm64`, `claw-task-macos-x64`, `claw-task-linux`, `claw-task.exe`）。

2. **全局可用：**
   ```bash
   # macOS/Linux 示例
   chmod +x claw-task-macos-arm64
   sudo mv your-claw-task-macos-arm64-path /usr/local/bin/claw-task
   ```

3. **验证安装：**
   ```bash
   claw-task --help
   ```

### 版本升级
Rust 版本的二进制文件内置了**静默版本检查与自动升级**功能。当检测到 GitHub Releases 有新版本时，会在命令末尾非阻塞提示您。

**升级命令：**
```bash
sudo claw-task upgrade
```

> ⚠️ **重要提示**：
> 1. **权限要求**：由于二进制文件通常安装在 `/usr/local/bin/` 等系统目录下，升级操作**必须使用 `sudo`** 提升权限。
> 2. **禁止使用别名**：升级时**请务必直接调用 `claw-task` 原名**，不要使用您自定义的别名（如 `ct upgrade`）。这是因为 `sudo` 环境通常不会继承您的 shell 别名设置，使用别名会导致系统找不到命令。

### 方案 B：自行编译源码
如果您有源码并希望手动编译高性能二进制：
1. 确保已安装 [Rust 工具链](https://rustup.rs/)。
2. 运行：`cd cli-rust && cargo build --release`。
3. 编译后的文件位于 `cli-rust/target/release/claw-task`。

### 设置别名（可选）
安装完成后，您可以在 `~/.bashrc` 或 `~/.zshrc` 中设置别名以简化使用：
```bash
alias ct='/usr/local/bin/claw-task'
```
之后即可通过 `ct` 快速调用，例如：`ct list`、`ct add "买牛奶"`。

## 配置环境变量

需要配置以下环境变量才能正常与后端交互：
- `TASK_API_URL`: 后端 API 基础地址（默认为 `http://localhost:8787/api`，部署到云端后需要修改为实际地址）
- `TASK_API_KEY`: API 鉴权密钥
- `USER_TIMEZONE`: 时区（例如 `Asia/Shanghai`），默认为 UTC+8
- `ENABLE_AI`: 是否开启 AI 语义解析功能（可选，默认为 `true`）。若需关闭，请在 Cloudflare Worker 的 `Vars` 中设置为 `false`。

> ℹ️ **关于 AI 功能的提示**：
> 1. **服务提供商**：语义解析功能由 [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) 驱动。
> 2. **额度限制**：Cloudflare 对 Workers AI 的免费套餐设有**每日调用限额**（通常为 10,000 Neurons/天，具体以 Cloudflare 官网为准）。若超过限额，AI 相关命令将返回错误。
> 3. **隐私与安全**：仅当您主动调用 `ai` 命令时，输入的文本才会被发送至 Cloudflare AI 模型进行解析。如果您对隐私有极高要求或不需要此功能，可以通过环境变量 `ENABLE_AI=false` 完全禁用后端解析接口。

如果作为本地用户使用，可以将其添加到 `~/.bashrc` 或 `~/.zshrc` 中：
```bash
export TASK_API_URL="https://your-worker-subdomain.workers.dev/api"
export TASK_API_KEY="your_secret_api_key"
export USER_TIMEZONE="Asia/Shanghai"
```

## 时间处理与时区规范

本系统采用 **“前端转换、后端存储 UTC、数据库原生对比、服务端时区渲染”** 的高可靠时间处理方案。其核心设计思想是 **“以服务端配置为准”**：

1. **强制 UTC 标准化**：后端 API 在接收到 `due_date` 或 `remind_at` 时，会自动将其强制转换为标准的 ISO UTC 格式存入数据库。
2. **时区识别与注入 (以服务端 Worker 配置为准)**：
   - **显式时区**：如果输入字符串自带时区标识（如 `Z` 或 `+08:00`），后端将按该时区解析。
   - **漂浮时间 (Floating Time)**：如果输入字符串**未标识时区**（如 `2026-03-09 10:00:00`），系统将优先使用 **服务端 Worker 配置的 `USER_TIMEZONE`** 进行解析；若未配置，缺省为 **北京时间 (`Asia/Shanghai`)**。
   - **多端一致性**：即便本地 CLI 的时区设置与服务端 Worker 不同，只要输入是不带时区的字符串，系统也会统一按照服务端定义的基准时区进行校准入库。
3. **Web 展示逻辑**：Web 界面会通过 API 获取服务端的 `USER_TIMEZONE` 配置，并以此为基准格式化展示所有任务时间。这意味着无论您在全球何处访问，看到的任务时间都将保持一致，避免了“因出差导致任务到期时间看起来变了”的问题。

## Cloudflare Worker 部署与配置

本项目的后端采用 Cloudflare Workers + D1 (SQLite) 构建。如果您希望自建后端服务，请按以下步骤操作：

### 1. 初始化并绑定数据库
在部署前，您需要在您的 Cloudflare 账户中创建一个 D1 数据库：
```bash
npx wrangler d1 create claw-owner-task-db
```
执行完毕后，终端会输出一段包含 `database_id` 的配置。请将该 ID 复制，并**更新到项目根目录的 `wrangler.toml` 文件中**的对应位置：
```toml
[[d1_databases]]
binding = "DB"
database_name = "claw-owner-task-db"
database_id = "在这里填入您的_DATABASE_ID"
```

### 2. 数据库迁移
应用初始的数据库表结构：
```bash
# 本地开发环境迁移
npm run db:migrate:local

# 线上生产环境迁移
npm run db:migrate:remote
```

### 3. 配置后端机密变量 (Secrets)
为了安全起见，`TASK_API_KEY`（鉴权密钥）和 `BARK_URL`（Bark 推送地址，云端提醒必需）不能明文写在配置文件中。
请通过 Wrangler 设置为 Worker 的机密变量：
```bash
npx wrangler secret put TASK_API_KEY
npx wrangler secret put BARK_URL
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```
*(在本地开发时，您可以在项目根目录创建一个 `.dev.vars` 文件并写入这些变量。)*

### 5. 激活 Telegram 机器人交互 (可选)

为了启用 Telegram 交互，建议您通过 `Secrets` 存储敏感信息，以防止部署时被覆盖：

```bash
# 设置机器人 Token
npx wrangler secret put TELEGRAM_BOT_TOKEN
# 设置允许交互的 Chat ID (您的个人 Telegram ID)
npx wrangler secret put TELEGRAM_CHAT_ID
```

配置完成后，您**必须**手动将 Webhook 地址关联到 Telegram 服务器：

```bash
# 将 <YOUR_BOT_TOKEN> 替换为您的 Token
# 将 <YOUR_WORKER_URL> 替换为您的 Worker 线上地址 (需包含 /api/webhook/telegram)
curl -F "url=https://<YOUR_WORKER_URL>/api/webhook/telegram" https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```

**支持的指令：**
- **自然语言对话**：直接发送“帮我创建明天下午三点的会议”等内容，AI 将自动解析并处理。
- **`/summary` (或 `/总结`)**：立即生成任务总结报告并推送到所有配置好的渠道。
- **`/add <任务标题>` (或 `/添加`)**：快速创建一个任务，绕过 AI 解析以确保 100% 精确度（例如：`/add 买牛奶`）。

**常见问题排查：**
- **发送消息无反馈**：请检查 `curl` 关联 Webhook 是否成功（返回 `{"ok":true...}`），并确认 `TELEGRAM_CHAT_ID` 是否与您的账号 ID 一致。
- **`curl` 返回 401**：说明 `TELEGRAM_BOT_TOKEN` 不正确，请检查是否完整包含了 `bot` 前缀且没有多余空格。
- **部署后配置消失**：请勿在 `wrangler.toml` 中明文填写 Token，始终优先使用 `wrangler secret put`。

### 6. 配置云端自动总结 (可选)

系统支持在指定时间点自动生成 AI 任务总结报告，并通过所有已激活的渠道（Bark/Telegram）主动推送到您的终端。

**启用条件：**
1.  **环境变量配置**：
    - `CRON_SUMMARY_TIME`: 设置自动触发的时间点（基于 `USER_TIMEZONE`）。支持**多个时间点**，以英文逗号分隔。
    - `ENABLE_AI`: 必须为 `true`（默认值）。
2.  **Cron 触发器**：确保 `wrangler.toml` 中配置了每分钟执行一次的触发器（项目默认已包含）。

**配置方法：**
建议直接在 `wrangler.toml` 的 `[vars]` 部分进行配置：
```toml
[vars]
# 示例：每天早上 08:30 和晚上 21:00 自动生成总结
CRON_SUMMARY_TIME = "08:30,21:00"
```
或者也可以通过 Cloudflare 控制台 -> Settings -> Variables -> **Environment Variables** 处进行修改（无需重新部署即可生效）。

**示例场景：**
- **单时间点**：`09:00` (每天上午 9 点发送昨日总结与今日计划)
- **多时间点**：`08:00,12:00,20:00` (早中晚三次状态同步)
- **时区注意**：时间点匹配严格遵循您设置的 `USER_TIMEZONE`。例如设置 `Asia/Shanghai`，则 `08:00` 即为北京时间上午 8 点。

### 4. 部署到云端
完成以上配置后，将 Worker 部署到您的 Cloudflare 账号：
```bash
npm run deploy
```
部署成功后，会返回您的 Worker 线上地址，请使用该地址更新前面提到的 CLI 或 OpenCLaw 的 `TASK_API_URL` 环境变量。

---

## OpenCLaw 智能体集成指南

为了让 OpenCLaw 能够最原生、最稳定地使用此任务管理器，建议将其封装为 **OpenClaw Skill**。

### 1. 注册 Skill
在项目中，我们已经为你准备了专门的 Skill 配置模板，位于 `skills/claw-task/SKILL.md`。
你需要将该文件夹链接或复制到 OpenCLaw 的 `skills` 目录下：

```bash
mkdir -p ~/.openclaw/skills
cp -r skills/claw-task ~/.openclaw/skills/
```

### 2. 配置 OpenCLaw 环境 (skills config)

为了安全起见，我们不需要在全局系统中暴露 `TASK_API_KEY`，而是利用 OpenClaw 的技能配置为其注入专属的环境变量。

编辑 `~/.openclaw/openclaw.json`，在 `skills.entries` 中加入以下配置：

```json
{
  "skills": {
    "entries": {
      "claw-task": {
        "enabled": true,
        "env": {
          "TASK_API_URL": "https://your-worker-subdomain.workers.dev/api",
          "TASK_API_KEY": "your_secret_api_key",
          "USER_TIMEZONE": "Asia/Shanghai"
        }
      }
    }
  }
}
```
*注意：完成配置后，OpenCLaw 启动时会自动检测到 `claw-task` 的 `SKILL.md` 文件并加载该工具。*

### 3. 本地 Agent 提醒触发 (Cron)
如果你希望 OpenCLaw 在本地接管任务提醒，请在宿主机设置一个 Crontab 任务，定时执行以下命令：
```bash
* * * * * claw-task check --channel agent --json | jq ... # 将输出传递给 OpenCLaw 通知 API 或通过某种方式让 Agent 感知
```
*(你也可以通过 OpenCLaw 内部的定时 Automation Hook 来直接调用此命令进行轮询。)*

## 项目文档

- [需求说明](docs/需求说明.md)
- [技术架构](docs/技术架构.md)
- [开发计划](docs/开发计划.md)
- [缺陷修复记录](docs/缺陷修复记录.md)

## 开发者指令

- `npm run dev`: 本地运行 Cloudflare Worker 开发服务器
- `npm run deploy`: 部署 Worker 和 D1 到云端
- `npm run db:migrate:local`: 本地数据库迁移
- `npm run db:migrate:remote`: 线上数据库迁移
- `cd cli-rust && cargo build --release`: 编译 Rust 版 CLI
- `cd cli-rust && cargo test`: 运行 Rust 单元测试
