export interface AsrConfig {
  apiKey: string;
  apiHost?: string;
}

const DEFAULT_HOST = 'https://openspeech.bytedance.com';
const SUBMIT_PATH = '/api/v3/auc/bigmodel/submit';
const QUERY_PATH = '/api/v3/auc/bigmodel/query';
const DEFAULT_RESOURCE_ID = 'volc.seedasr.auc';

function buildHeaders(config: AsrConfig, requestId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'X-Api-Resource-Id': DEFAULT_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  };
}

export async function submitAsrTask(audioUrl: string, config: AsrConfig): Promise<string> {
  const requestId = crypto.randomUUID();
  const headers = buildHeaders(config, requestId);

  const body = {
    user: {
      uid: 'openclaw-worker',
    },
    audio: {
      url: audioUrl,
      format: 'ogg', // Both Feishu and Telegram use ogg/opus
      codec: 'opus',
      rate: 16000,
      bits: 16,
      channel: 1,
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

  const host = config.apiHost || DEFAULT_HOST;
  const response = await fetch(`${host}${SUBMIT_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const statusCode = response.headers.get('x-api-status-code');
  const message = response.headers.get('x-api-message');

  if (statusCode !== '20000000') {
    throw new Error(`ASR Submit Failed [${statusCode}]: ${message || await response.text()}`);
  }

  return requestId;
}

export async function pollAsrResult(requestId: string, config: AsrConfig, maxRetries = 30, intervalMs = 2000): Promise<string> {
  const headers = buildHeaders(config, requestId);
  const host = config.apiHost || DEFAULT_HOST;

  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(`${host}${QUERY_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    const statusCode = response.headers.get('x-api-status-code');
    const message = response.headers.get('x-api-message');
    const body: any = await response.json();

    if (statusCode === '20000000') {
      return body.result?.text || '';
    }

    if (statusCode === '20000001' || statusCode === '20000002') {
      // Processing or queuing
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (statusCode === '20000003') {
      return '*(静音音频，无识别结果)*';
    }

    throw new Error(`ASR Query Failed [${statusCode}]: ${message || 'Unknown Error'}`);
  }

  throw new Error('ASR Task Timeout');
}

export async function processAudioToText(audioUrl: string, config: AsrConfig): Promise<string> {
  if (!config.apiKey) {
    throw new Error('VOLC_API_KEY is missing');
  }
  const requestId = await submitAsrTask(audioUrl, config);
  return await pollAsrResult(requestId, config);
}
