/**
 * 火山引擎 Seed-ASR 2.0 (大模型录音文件识别标准版) API 封装
 * 参考文档: https://www.volcengine.com/docs/6561/1354868
 *
 * 使用 x-api-key 单一 Header 鉴权。
 * 音频通过 HTTP(S) URL 传递。
 */

const crypto = require('crypto');
const axios = require('axios');

const HOST = 'https://openspeech.bytedance.com';
const SUBMIT_PATH = '/api/v3/auc/bigmodel/submit';
const QUERY_PATH = '/api/v3/auc/bigmodel/query';
// volc.bigasr.auc = 1.0 模型, volc.seedasr.auc = 2.0 模型
const DEFAULT_RESOURCE_ID = 'volc.seedasr.auc';

function getConfig(skillConfig) {
  return {
    apiKey: skillConfig?.VOLC_API_KEY,
    resourceId: skillConfig?.VOLC_RESOURCE_ID || DEFAULT_RESOURCE_ID,
  };
}

/**
 * 构建请求 Headers
 */
function buildHeaders(config, requestId) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'X-Api-Resource-Id': config.resourceId,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  };
}

/**
 * 提交录音文件识别任务
 *
 * @param {string} audioUrl - 音频的 HTTP(S) URL
 * @param {object} options - 音频参数配置
 * @returns {string} requestId - 用于后续查询的任务 ID
 */
async function submitTask(audioUrl, options = {}, skillConfig = {}) {
  const config = getConfig(skillConfig);
  if (!config.apiKey) {
    throw new Error('VOLC_API_KEY 未配置');
  }

  const requestId = crypto.randomUUID();
  const headers = buildHeaders(config, requestId);

  const body = {
    user: {
      uid: options.uid || 'openclaw-volcengine-asr',
    },
    audio: {
      url: audioUrl,
      format: options.format || 'ogg',
      codec: options.codec || 'opus',
      rate: options.rate || 16000,
      bits: options.bits || 16,
      channel: options.channel || 1,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      enable_speaker_info: false,
      enable_channel_split: false,
      show_utterances: true,
      vad_segment: false,
      sensitive_words_filter: '',
    },
  };

  const url = `${HOST}${SUBMIT_PATH}`;
  const response = await axios.post(url, body, { headers, validateStatus: () => true });

  const statusCode = response.headers['x-api-status-code'];
  const message = response.headers['x-api-message'];

  if (statusCode && statusCode !== '20000000') {
    throw new Error(`提交任务失败 [${statusCode}]: ${message || '未知错误'}`);
  }

  console.log(`[Volcengine] 任务已提交: ${requestId}, 状态: ${statusCode}, 消息: ${message}`);
  return requestId;
}

/**
 * 查询识别结果
 */
async function queryResult(requestId, skillConfig = {}) {
  const config = getConfig(skillConfig);
  const headers = buildHeaders(config, requestId);

  const url = `${HOST}${QUERY_PATH}`;
  const response = await axios.post(url, {}, { headers, validateStatus: () => true });

  return {
    statusCode: response.headers['x-api-status-code'],
    message: response.headers['x-api-message'],
    body: response.data,
  };
}

/**
 * 等待任务完成并获取结果
 *
 * 状态码:
 * - 20000000: 成功
 * - 20000001: 处理中
 * - 20000002: 队列中
 * - 20000003: 静音音频
 */
async function waitForResult(requestId, skillConfig = {}, maxRetries = 30, intervalMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await queryResult(requestId, skillConfig);

    if (result.statusCode === '20000000') {
      if (result.body && result.body.result) {
        return result.body.result.text || '';
      }
      return '';
    }

    if (result.statusCode === '20000001' || result.statusCode === '20000002') {
      console.log(`[Volcengine] 任务 ${requestId} 状态: ${result.message}, 等待中...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (result.statusCode === '20000003') {
      return '*(静音音频，无识别结果)*';
    }

    throw new Error(`识别任务失败 [${result.statusCode}]: ${result.message || '未知错误'}`);
  }

  throw new Error('识别任务超时');
}

module.exports = {
  submitTask,
  queryResult,
  waitForResult,
};
