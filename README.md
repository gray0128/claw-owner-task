# Claw Owner Task

这是一个专为个人用户和 **AI Agent (OpenCLaw)** 设计的跨平台任务管理工具。支持云端存储与多渠道（Cloud/Agent）提醒。

## 安装

1. 确保已安装 Node.js (>= 18.0.0)。
2. 克隆仓库并安装依赖，进行全局链接：
   ```bash
   git clone https://github.com/gray0128/claw-owner-task.git
   cd claw-owner-task
   npm install
   npm link
   ```
   *(或者使用 `npm install -g .`)*

3. 验证安装：
   ```bash
   claw-task --help
   ```

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

## 开发者指令

- `npm run dev`: 本地运行 Cloudflare Worker 开发服务器
- `npm run deploy`: 部署 Worker 和 D1 到云端
- `npm run db:migrate:local`: 本地数据库迁移
- `npm run db:migrate:remote`: 线上数据库迁移
