/**
 * Volcengine ASR Plugin for OpenClaw
 * 使用火山引擎 Seed-ASR 2.0 (大模型录音文件识别标准版) 识别语音消息
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { submitTask, waitForResult } = require('./scripts/volcengine');
const { uploadWithAutoCleanup } = require('./scripts/s3-client');

let pluginConfig = {};

/**
 * 从 openclaw.json 加载 plugin 配置
 * （保持对原来配置方式的兼容，继续读取 skills.entries.volcengine-asr.env）
 */
function loadPluginConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = fsSync.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const env = config?.skills?.entries?.['volcengine-asr']?.env || config?.plugins?.entries?.['volcengine-asr']?.config;
    if (env && typeof env === 'object') {
      pluginConfig = env;
      console.log(`[Volcengine-ASR] 已从 openclaw.json 加载配置`);
    } else {
      console.warn(`[Volcengine-ASR] openclaw.json 中未找到 volcengine-asr 的配置 (请检查 skills.entries.volcengine-asr.env 或 plugins.entries.volcengine-asr.config)`);
    }
  } catch (err) {
    console.error(`[Volcengine-ASR] 读取配置文件失败 ${configPath}:`, err.message);
  }
}

// 初始化加载配置
loadPluginConfig();

function isConfigured() {
  return !!pluginConfig.VOLC_API_KEY;
}

/**
 * 根据文件扩展名推断音频格式参数
 */
function inferAudioFormat(filePath, contentType) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.ogg' || contentType?.includes('ogg')) {
    return { format: 'ogg', codec: 'opus', ext: '.ogg', mime: 'audio/ogg' };
  }
  if (ext === '.mp3' || contentType?.includes('mp3') || contentType?.includes('mpeg')) {
    return { format: 'mp3', codec: 'raw', ext: '.mp3', mime: 'audio/mpeg' };
  }
  if (ext === '.wav' || contentType?.includes('wav')) {
    return { format: 'wav', codec: 'raw', ext: '.wav', mime: 'audio/wav' };
  }
  if (ext === '.m4a' || contentType?.includes('m4a') || contentType?.includes('mp4')) {
    // M4A (AAC) 也使用 mp3 格式参数（API 支持的最接近格式）
    return { format: 'mp3', codec: 'raw', ext: '.m4a', mime: 'audio/mp4' };
  }
  // 默认按 ogg/opus 处理（飞书语音默认格式）
  return { format: 'ogg', codec: 'opus', ext, mime: contentType || 'audio/ogg' };
}

/**
 * Parses the event.messages object to find audio media.
 * Supported media forms: file:// URLs, web URLs, or buffers.
 */
function findAudioUrlsInMessages(messages) {
  const audioItems = [];
  if (!Array.isArray(messages)) return audioItems;

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'image_url') {
          // Some platform integrations may pass audio via image_url structure when type isn't standardized.
          const url = block.image_url?.url || '';
          if (url.includes('.ogg') || url.includes('.mp3') || url.includes('.wav') || url.includes('.m4a') || url.startsWith('file://')) {
            audioItems.push({ url, contentType: 'audio/unknown' });
          }
        }
      }
    }
    // Handle embedded OpenClaw platform message schema media objects if present 
    if (msg.media && Array.isArray(msg.media)) {
      for (const media of msg.media) {
        if (media.contentType?.startsWith('audio/') || media.path?.match(/\.(ogg|mp3|wav|m4a)$/i) || media.url?.match(/\.(ogg|mp3|wav|m4a)$/i)) {
          audioItems.push({
            url: media.url,
            path: media.path,
            contentType: media.contentType
          });
        }
      }
    }
    // Also parse explicit text content string for file:// links (Common in OpenClaw messages)
    if (typeof msg.content === 'string') {
      const fileLinkRegex = /file:\/\/[^\s]+(?:\.(?:ogg|mp3|wav|m4a))/gi;
      const matches = msg.content.match(fileLinkRegex);
      if (matches) {
        matches.forEach(m => audioItems.push({ path: m.replace('file://', ''), contentType: 'audio/unknown' }));
      }
    }
  }
  return audioItems;
}

exports.register = function (api) {
  api.registerHook('before_prompt_build', async (event, ctx) => {
    // 检查配置
    if (!isConfigured()) {
      return {}; // 未配置时不做任何拦截
    }

    try {
      const audioMediaList = findAudioUrlsInMessages(event.messages || []);
      if (audioMediaList.length === 0) {
        return {}; // 没有找到语音，跳过
      }

      console.log(`[Volcengine-ASR] 检测到 ${audioMediaList.length} 个可能的语音文件，开始提取...`);
      let allTranscripts = [];

      for (let i = 0; i < audioMediaList.length; i++) {
        const audioMedia = audioMediaList[i];
        let audioUrl;

        const audioFormat = inferAudioFormat(
          audioMedia.path || audioMedia.url || '',
          audioMedia.contentType
        );

        if (audioMedia.url && !audioMedia.url.startsWith('file://')) {
          // 远程 URL 直接使用
          audioUrl = audioMedia.url;
          console.log(`[Volcengine-ASR] 使用远程 URL: ${audioUrl}`);
        } else if (audioMedia.path || (audioMedia.url && audioMedia.url.startsWith('file://'))) {
          // 本地文件 → 上传到 S3 → 获取公开 URL
          const localPath = audioMedia.path || audioMedia.url.replace('file://', '');
          console.log(`[Volcengine-ASR] 本地文件，上传到 S3: ${localPath}`);
          const fileBuffer = await fs.readFile(localPath);
          const r2Result = await uploadWithAutoCleanup(fileBuffer, audioFormat.mime, audioFormat.ext, pluginConfig);
          audioUrl = r2Result.url;
          console.log(`[Volcengine-ASR] S3 URL: ${audioUrl}`);
        }

        if (audioUrl) {
          // 提交识别任务
          const requestId = await submitTask(audioUrl, {
            format: audioFormat.format,
            codec: audioFormat.codec,
            rate: 16000,
            channel: 1,
          }, pluginConfig);
          console.log(`[Volcengine-ASR] 任务已提交: ${requestId}`);

          // 等待并获取结果
          const transcriptText = await waitForResult(requestId, pluginConfig);
          console.log(`[Volcengine-ASR] 识别结果 [${i + 1}/${audioMediaList.length}]: ${transcriptText}`);
          if (transcriptText) {
            allTranscripts.push(transcriptText);
          }
        }
      }

      if (allTranscripts.length > 0) {
        // 将语音识别结果以提示词的形式喂给 LLM
        const combinedText = allTranscripts.map((t, idx) => `语音文件 ${idx + 1} 识别结果：\n${t}`).join('\n\n');

        return {
          prependContext: `*[系统拦截提示：用户发送了语音消息，自动转写结果如下]*\n\n${combinedText}`
        };
      }

      return {};

    } catch (error) {
      console.error('[Volcengine-ASR] 音频解析失败:', error);
      return {
        prependContext: `*[系统拦截提示：提取或转写语音消息失败: ${error.message}]*`
      };
    }
  }, {
    name: 'volcengine-asr.before-prompt-build',
    description: 'Intercepts incoming audio files and attaches volcanic seed-asr transcripts into the system prompt'
  });
}
