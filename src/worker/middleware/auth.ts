import { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next) {
  // skip auth for preflight requests
  if (c.req.method === 'OPTIONS') {
    return await next();
  }

  // skip auth for telegram webhook (it has its own token validation)
  if (c.req.path === '/api/webhook/telegram' || c.req.path.endsWith('/webhook/telegram')) {
    return await next();
  }

  const authHeader = c.req.header('Authorization');
  const expectedKey = c.env.TASK_API_KEY;

  if (!expectedKey) {
    console.warn('TASK_API_KEY is not configured in environment variables.');
    return c.json({ success: false, data: null, error: { code: 'SERVER_ERROR', message: 'Server configuration error' } }, 500);
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = authHeader.substring(7);
  if (token !== expectedKey) {
    return c.json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Invalid API Key' } }, 403);
  }

  await next();
}
