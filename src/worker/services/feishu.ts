/**
 * Feishu (Lark) Bot Service for Cloudflare Workers.
 * Handles AccessToken, Message Sending, Signature Verification, and Event Decryption.
 */

export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

/**
 * Fetch a new tenant_access_token from Feishu API.
 */
export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string | null> {
  if (!appId || !appSecret) return null;

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    if (response.ok) {
      const data = await response.json() as FeishuTokenResponse;
      if (data.code === 0) {
        return data.tenant_access_token;
      } else {
        console.error('[Feishu] Failed to get AccessToken:', data);
        return null;
      }
    } else {
      console.error('[Feishu] Failed to get AccessToken:', await response.text());
      return null;
    }
  } catch (error) {
    console.error('[Feishu] Error fetching AccessToken:', error);
    return null;
  }
}

/**
 * Send a message to Feishu (User or Group).
 */
export async function sendFeishuMessage(
  token: string,
  receiveId: string,
  content: string,
  receiveIdType: 'chat_id' | 'open_id' = 'chat_id',
  msgType: string = 'text'
): Promise<{ success: boolean; error?: any }> {
  if (!token || !receiveId) return { success: false, error: 'Missing parameters' };

  const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;

  const body = {
    receive_id: receiveId,
    content: msgType === 'text' ? JSON.stringify({ text: content }) : content,
    msg_type: msgType,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;

    if (data.code === 0) {
      return { success: true };
    } else {
      console.error('[Feishu] Failed to send message:', data);
      return { success: false, error: data.msg || data };
    }
  } catch (error) {
    console.error('[Feishu] Error sending message:', error);
    return { success: false, error };
  }
}

/**
 * Verify Webhook Signature.
 */
export async function verifyFeishuSignature(
  timestamp: string,
  nonce: string,
  token: string,
  bodyText: string,
  signature: string
): Promise<boolean> {
  try {
    const content = timestamp + nonce + token + bodyText;
    const msgBuffer = new TextEncoder().encode(content);
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const calculatedSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return calculatedSig === signature;
  } catch (e) {
    console.error('[Feishu] Signature verification error:', e);
    return false;
  }
}

/**
 * Decrypt Feishu Event Data.
 */
export async function decryptFeishuEvent(encryptKey: string, encryptStr: string): Promise<string | null> {
  try {
    const keyHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptKey));
    const key = await crypto.subtle.importKey(
      'raw',
      keyHashBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );

    const encryptedBuffer = Uint8Array.from(atob(encryptStr), c => c.charCodeAt(0));
    const iv = encryptedBuffer.slice(0, 16);
    const data = encryptedBuffer.slice(16);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv },
      key,
      data
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (e) {
    console.error('[Feishu] Decrypt event error:', e);
    return null;
  }
}

/**
 * Fetch a resource (like an audio file) from Feishu.
 */
export async function fetchFeishuResource(
  token: string,
  messageId: string,
  fileKey: string,
  type: string
): Promise<Response> {
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;
  
  return await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
}
