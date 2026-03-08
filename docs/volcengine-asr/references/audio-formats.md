# Seed-ASR 2.0 Standard 音频格式&参数速查表

## 一、支持的音频格式

| 格式 | 参数 | 说明 |
|------|------|------|
| **Opus** | `format=ogg` + `codec=opus` | 飞书移动端默认格式，需封装为 ogg 容器 |
| **MP3** | `format=mp3` | 通用格式 |
| **WAV** | `format=wav` | 无损格式，推荐 |
| **PCM** | `format=pcm` | 裸流格式 |

## 二、通用推荐参数

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| **采样率** | 16000 Hz | 16kHz |
| **声道** | 单声道（mono） | 1 channel |
| **比特率** | 16 bit | 位深 |
| **音频时长** | ≤ 60s | 建议最大时长 |

## 三、Opus 格式专用要求

- ✅ 必须封装为 **ogg** 容器
- ✅ 推荐码率：24kbps～48kbps
- ❌ 不支持纯 Opus 裸流，必须带 ogg 头

## 四、最简可用请求示例（Opus）

```json
{
  "audio": {
    "format": "ogg",
    "codec": "opus",
    "sample_rate": 16000,
    "channels": 1
  },
  "data": "base64编码音频数据"
}
```

## 五、飞书语音处理

飞书移动端发送的语音通常是 **opus/ogg** 格式，这正好在 Seed-ASR 2.0 的支持列表中，理论上可以直接使用。

### 如遇格式问题，使用 ffmpeg 转码

安装 ffmpeg：

```bash
sudo apt update && sudo apt install -y ffmpeg
```

转码为 WAV（推荐）：

```bash
ffmpeg -i input.ogg -ar 16000 -ac 1 -c:a pcm_s16le output.wav
```

转码为 MP3：

```bash
ffmpeg -i input.ogg -ar 16000 -ac 1 -b:a 32k output.mp3
```

在 Skill 中通过 `child_process` 调用 ffmpeg：

```javascript
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

async function transcodeAudio(inputPath, outputPath) {
  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    '-y',
    outputPath
  ]);
}
```
