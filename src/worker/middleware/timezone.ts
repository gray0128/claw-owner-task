import { Context, Next } from 'hono';

export async function timezoneMiddleware(c: Context, next: Next) {
  // Set default timezone if not provided in environment
  const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';
  c.set('userTimezone', userTimezone);

  // In a real application, you might intercept responses and format dates here, 
  // or simply provide the timezone in context for handlers to use when querying/formatting.
  // For simplicity, we just pass the configured timezone in the Context variables.

  await next();
}
