/**
 * 飞书 API 客户端
 * 参考文档: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/get
 */

const axios = require('axios');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;

/**
 * 获取 tenant_access_token
 */
async function getTenantAccessToken() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  }
  
  const response = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    }
  );
  
  if (response.data.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${response.data.msg}`);
  }
  
  return response.data.tenant_access_token;
}

/**
 * 从飞书下载文件
 */
async function downloadFile(fileKey, tenantAccessToken) {
  const response = await axios.get(
    `https://open.feishu.cn/open-apis/im/v1/files/${fileKey}`,
    {
      headers: {
        'Authorization': `Bearer ${tenantAccessToken}`
      },
      responseType: 'arraybuffer'
    }
  );
  
  return response.data;
}

/**
 * 从飞书消息中下载音频并返回 base64
 */
async function downloadFromFeishu(message, platform) {
  // 方法 1: 如果 message 中已有 file_id
  if (message.fileId || message.file_key) {
    const fileKey = message.fileId || message.file_key;
    const token = await getTenantAccessToken();
    const audioBuffer = await downloadFile(fileKey, token);
    return Buffer.from(audioBuffer).toString('base64');
  }
  
  // 方法 2: 如果 platform 提供了下载方法
  if (platform && platform.downloadFile) {
    const audioBuffer = await platform.downloadFile(message);
    return Buffer.from(audioBuffer).toString('base64');
  }
  
  // 方法 3: 如果 message 中已有直接的音频数据
  if (message.audioData || message.data) {
    const data = message.audioData || message.data;
    if (Buffer.isBuffer(data)) {
      return data.toString('base64');
    }
    return data;
  }
  
  throw new Error('无法获取音频数据，请根据你的 OpenClaw 飞书集成方式实现 downloadFromFeishu');
}

module.exports = {
  getTenantAccessToken,
  downloadFile,
  downloadFromFeishu
};
