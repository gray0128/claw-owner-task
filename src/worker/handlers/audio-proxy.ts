import { Hono } from 'hono';
import { Bindings } from '../index';
import { getTenantAccessToken, fetchFeishuResource } from '../services/feishu';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to verify proxy signature
async function verifyProxySignature(
  messageId: string,
  fileKey: string,
  sign: string,
  taskApiKey: string
): Promise<boolean> {
  const content = messageId + fileKey + taskApiKey;
  const msgBuffer = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const calculatedSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return calculatedSig === sign;
}

app.get('/', async (c) => {
  const messageId = c.req.query('message_id');
  const fileKey = c.req.query('file_key');
  const sign = c.req.query('sign');

  if (!messageId || !fileKey || !sign) {
    return c.text('Missing parameters', 400);
  }

  const isValid = await verifyProxySignature(messageId, fileKey, sign, c.env.TASK_API_KEY);
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

  return new Response(feishuRes.body, {
    headers: { 'Content-Type': 'audio/ogg' }
  });
});

export const audioProxyHandlers = app;
