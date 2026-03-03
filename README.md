# Claw Owner Task

这是一个专为个人用户和 **AI Agent (OpenCLaw)** 设计的跨平台任务管理工具。支持云端存储与多渠道（Cloud/Agent）提醒。

## 安装

### 方案 A：直接下载二进制文件（推荐，高性能）
如果您追求极致的启动速度且不想安装开发环境：

1. **从 Release 页面下载：**
   前往 [GitHub Releases](https://github.com/gray0128/claw-owner-task/releases) 页面，下载对应您操作系统的二进制文件（如 `claw-task-macos-arm64`, `claw-task-macos-x64`, `claw-task-linux`, `claw-task.exe`）。

2. **全局可用：**
   ```bash
   # macOS/Linux 示例
   chmod +x claw-task-macos
   sudo mv claw-task-macos /usr/local/bin/claw-task
   ```

3. **验证安装：**
   ```bash
   claw-task --help
   ```

### 方案 B：自行编译 Rust 版本
如果您有源码并希望手动编译高性能二进制：
1. 确保已安装 [Rust 工具链](https://rustup.rs/)。
2. 运行：`cd cli-rust && cargo build --release`。
3. 编译后的文件位于 `cli-rust/target/release/claw-task`。

### 方案 C：通过 Node.js
1. 确保已安装 Node.js (>= 18.0.0)。
2. 克隆仓库并安装依赖，进行全局链接：
   ```bash
   git clone https://github.com/gray0128/claw-owner-task.git
   cd claw-owner-task
   npm install
   npm link
   ```
   *(或者使用 `npm install -g .`)*

### 设置别名（可选）
安装完成后，您可以在 `~/.bashrc` 或 `~/.zshrc` 中设置别名以简化使用：
```bash
# 二进制版本
alias ct='/usr/local/bin/claw-task'

# 或 Node.js 版本
alias ct='claw-task'
```
之后即可通过 `ct` 快速调用，例如：`ct list`、`ct add "买牛奶"`。

## 配置环境变量

需要配置以下环境变量才能正常与后端交互：
- `TASK_API_URL`: 后端 API 基础地址（默认为 `http://localhost:8787/api`，部署到云端后需要修改为实际地址）
- `TASK_API_KEY`: API 鉴权密钥
- `USER_TIMEZONE`: 时区（例如 `Asia/Shanghai`），默认为 UTC+8

如果作为本地用户使用，可以将其添加到 `~/.bashrc` 或 `~/.zshrc` 中：
```bash
export TASK_API_URL="https://your-worker-subdomain.workers.dev/api"
export TASK_API_KEY="your_secret_api_key"
export USER_TIMEZONE="Asia/Shanghai"
```

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
```
*(在本地开发时，您可以在项目根目录创建一个 `.dev.vars` 文件并写入这些变量。)*

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
