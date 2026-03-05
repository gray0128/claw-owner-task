import { Context, Next } from 'hono';

export async function timezoneMiddleware(c: Context, next: Next) {
  // Read timezone from header (X-User-Timezone) or fall back to env or default
  const userTimezone = c.req.header('X-User-Timezone') || c.env.USER_TIMEZONE || 'Asia/Shanghai';
  c.set('userTimezone', userTimezone);

  await next();
}
