import { Hono } from 'hono';
import { Bindings } from '../index';
import { getTenantAccessToken, fetchFeishuResource } from '../services/feishu';
import { getTelegramVoiceUrl } from '../services/telegram';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to verify proxy signature
async function verifyProxySignature(
  contentToSign: string,
  sign: string,
  taskApiKey: string
): Promise<boolean> {
  const content = contentToSign + taskApiKey;
  const msgBuffer = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const calculatedSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return calculatedSig === sign;
}

// Feishu Audio Proxy
app.get('/feishu/:message_id/:file_key/:sign', async (c) => {
  const messageId = c.req.param('message_id');
  const fileKey = c.req.param('file_key');
  let sign = c.req.param('sign');

  // Strip .ogg extension if present
  if (sign.endsWith('.ogg')) {
    sign = sign.slice(0, -4);
  }

  const isValid = await verifyProxySignature(messageId + fileKey, sign, c.env.TASK_API_KEY);
  if (!isValid) {
    return c.text('Forbidden: Invalid Signature', 403);
  }

  const tenantAccessToken = await getTenantAccessToken(c.env.FEISHU_APP_ID!, c.env.FEISHU_APP_SECRET!);
  if (!tenantAccessToken) {
    return c.text('Failed to get tenant access token', 500);
  }

  const feishuRes = await fetchFeishuResource(tenantAccessToken, messageId, fileKey, 'audio');

  if (!feishuRes.ok) {
    return c.text('Failed to fetch resource from Feishu', feishuRes.status as any);
  }

  // Buffer into memory to provide Content-Length, ensuring compatibility with strict downloaders
  const arrayBuffer = await feishuRes.arrayBuffer();

  return new Response(arrayBuffer, {
    headers: { 
      'Content-Type': 'audio/ogg',
      'Content-Length': arrayBuffer.byteLength.toString()
    }
  });
});

// Telegram Audio Proxy
app.get('/telegram/:file_id/:sign', async (c) => {
  const fileId = c.req.param('file_id');
  let sign = c.req.param('sign');

  // Strip .ogg extension if present
  if (sign.endsWith('.ogg')) {
    sign = sign.slice(0, -4);
  }

  const isValid = await verifyProxySignature(fileId, sign, c.env.TASK_API_KEY);
  if (!isValid) {
    return c.text('Forbidden: Invalid Signature', 403);
  }

  const telegramToken = c.env.TELEGRAM_BOT_TOKEN!;
  const voiceUrl = await getTelegramVoiceUrl(telegramToken, fileId);

  if (!voiceUrl) {
    return c.text('Failed to resolve Telegram voice URL', 500);
  }

  const tgRes = await fetch(voiceUrl);

  if (!tgRes.ok) {
    return c.text('Failed to fetch resource from Telegram', tgRes.status as any);
  }

  // Buffer into memory to provide Content-Length
  const arrayBuffer = await tgRes.arrayBuffer();

  return new Response(arrayBuffer, {
    headers: { 
      'Content-Type': 'audio/ogg',
      'Content-Length': arrayBuffer.byteLength.toString()
    }
  });
});

export const audioProxyHandlers = app;
