/**
 * QQ Bot Service for Cloudflare Workers.
 * Handles AccessToken, Message Sending and Signature Verification.
 */

export interface QQAccessToken {
  access_token: string;
  expires_in: number;
}

/**
 * Fetch a new AccessToken from QQ Bot API.
 */
export async function getQQAccessToken(appId: string, clientSecret: string): Promise<string | null> {
  if (!appId || !clientSecret) return null;

  try {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: appId,
        clientSecret: clientSecret,
      }),
    });

    if (response.ok) {
      const data = await response.json() as QQAccessToken;
      return data.access_token;
    } else {
      console.error('[QQBot] Failed to get AccessToken:', await response.text());
      return null;
    }
  } catch (error) {
    console.error('[QQBot] Error fetching AccessToken:', error);
    return null;
  }
}

/**
 * Send a message to QQ User (C2C).
 */
export async function sendQQNotification(
  accessToken: string,
  openid: string,
  content: string,
  msgId?: string
): Promise<{ success: boolean; error?: any }> {
  if (!accessToken || !openid) return { success: false, error: 'Missing parameters' };

  // QQ C2C Message API
  const url = `https://api.sgroup.qq.com/v2/users/${openid}/messages`;

  const body: any = {
    content: content,
    msg_type: 0, // Text
  };

  // If msgId is provided, it's a passive reply (valid for 60 mins)
  if (msgId) {
    body.msg_id = msgId;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;

    if (response.ok) {
      return { success: true };
    } else {
      console.error('[QQBot] Failed to send message:', data);
      return { success: false, error: data };
    }
  } catch (error) {
    console.error('[QQBot] Error sending QQ message:', error);
    return { success: false, error };
  }
}

/**
 * Verification Helpers for Ed25519
 */
const hexToUint8 = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
const uint8ToHex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
const b64UrlToUint8 = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/**
 * Derive Ed25519 Key Pair from AppSecret.
 */
async function getKeys(appSecret: string) {
  // 1. Generate 32-byte Seed
  let seedStr = appSecret;
  while (seedStr.length < 32) seedStr += appSecret;
  const seed = new TextEncoder().encode(seedStr).slice(0, 32);

  // 2. PKCS#8 prefix for Ed25519
  const pkcs8Prefix = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + seed.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(seed, pkcs8Prefix.length);

  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);

  // 3. Export Public Key via JWK to get 'x' component
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await crypto.subtle.importKey("raw", b64UrlToUint8(jwk.x!), { name: "Ed25519" }, true, ["verify"]);

  return { privateKey, publicKey };
}

/**
 * Verify Webhook Signature.
 */
export async function verifyQQSignature(
  appSecret: string,
  signatureHex: string,
  timestamp: string,
  bodyText: string
): Promise<boolean> {
  try {
    const { publicKey } = await getKeys(appSecret);
    const msg = new TextEncoder().encode(timestamp + bodyText);
    return await crypto.subtle.verify("Ed25519", publicKey, hexToUint8(signatureHex), msg);
  } catch (e) {
    console.error('[QQBot] Signature verification error:', e);
    return false;
  }
}

/**
 * Sign for OpCode 13 validation.
 */
export async function signQQToken(appSecret: string, plainToken: string): Promise<string> {
  const { privateKey } = await getKeys(appSecret);
  const signed = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(plainToken));
  return uint8ToHex(new Uint8Array(signed));
}
