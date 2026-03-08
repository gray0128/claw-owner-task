# Volcengine ASR Plugin

## 1. 插件作用与适用场景

本插件作为 OpenClaw 的**前置拦截处理器（Plugin Hook）**，会自动挂载 `before_prompt_build` 钩子，接管通过各平台（飞书、Telegram、钉钉等）发给开放终端大模型的语音文件。它会提取其中的音频、通过火山引擎 Seed-ASR 模型转写文字，并在最终喂给大模型的系统提示词前，无缝拼接转写段落。

这对作为 AI 助理的底座大模型而言，它彻底屏蔽了处理上游“音频格式处理”、“API对接”与“格式降级”的麻烦。

## 2. 安装指引 (How to Install)

该项目现已转化为标准的 OpenClaw Plugin 架构。

### 步骤
1. 请确保你在本地检出了本仓库，并执行 `npm install` 安装完依赖。
2. 在 OpenClaw 终端执行安装（指定仓库所在路径）：
   ```bash
   openclaw plugins install /path/to/volcengine-asr
   ```
3. 在 `~/.openclaw/openclaw.json` (或系统配置文件) 中，确保已添加配置：
   ```json
   {
     "plugins": {
       "entries": {
         "volcengine-asr": {
           "enabled": true,
           "config": {
             "VOLC_API_KEY": "你的火山引擎API_KEY",
             "S3_ENDPOINT": "...",
             "S3_REGION": "...",
             "S3_BUCKET": "...",
             "S3_ACCESS_KEY_ID": "...",
             "S3_SECRET_ACCESS_KEY": "..."
           }
         }
       }
     }
   }
   ```
   *(注：插件仍旧向下兼容读取 `skills.entries.volcengine-asr.env` 作为配置。)*
4. 重启 OpenClaw Gateway。

> **安装失败排查：** 如果您遇到了 Config Invalid 或者 package.json 等注册校验错误，请查阅 [常见问题与排查指南](./TROUBLESHOOTING.md)。

## 3. Agent 工作流 (How it affects you)

当用户对你发送语音时：
1. 本 Plugin 会在准备 Prompt 时获取音频媒体。
2. 转写结果将会自动添加到你看到的**前置请求提示(prependContext)** 中，例如：
   `*[系统拦截提示：用户发送了语音消息，自动转写结果如下]*`。
3. 当你最终收到用户 Prompt 时，你可以直接阅读并解答用户的诉求。

你需要做的：
- 当识别成功时：正常解答用户的语音文本诉求即可。
- 当识别失败时：你收到的提示词会类似于 `*[系统拦截提示：提取或转写语音消息失败]*`。看到此句时，请你耐心回复并提醒用户遇到了系统识别错误。

## 4. 支持的音频规格 (Core Capabilities)

支持音频范围：
- Ogg 容器内的 Opus，这是大部分即时通讯如 Web/飞书/Telegram 的默认语音。
- 通用 MP3 / M4A / WAV等格式。
- 时长限制：受下沉 S3 网速及火山 API 限制，建议处理 60s 内短语音。
