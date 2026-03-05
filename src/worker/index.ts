import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { timezoneMiddleware } from './middleware/timezone';

import { infoHandlers } from './handlers/info';
import { taskHandlers } from './handlers/tasks';
import { aiHandlers } from './handlers/ai';
import { categoryHandlers } from './handlers/categories';
import { tagHandlers } from './handlers/tags';
import { remindHandlers } from './handlers/remind';
import { logsHandlers } from './handlers/logs';
import { telegramHandlers } from './handlers/telegram';

export type Bindings = {
  DB: D1Database;
  AI: any;
  ENABLE_AI: string | boolean;
  TASK_API_KEY: string;
  USER_TIMEZONE: string;
  BARK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Global Middlewares
app.use('*', cors());
app.use('/api/*', authMiddleware);
app.use('/api/*', timezoneMiddleware);

// Routes
app.route('/api/info', infoHandlers);
app.route('/api/tasks/ai', aiHandlers);
app.route('/api/tasks', taskHandlers);
app.route('/api/categories', categoryHandlers);
app.route('/api/tags', tagHandlers);
app.route('/api/remind', remindHandlers);
app.route('/api/logs', logsHandlers);

// Telegram Webhook is public and handles its own auth via Chat ID and Telegram Token
app.route('/api/webhook/telegram', telegramHandlers);

// Root fallback
app.get('/', (c) => c.text('Claw Owner Task API is running.'));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Cron trigger execution
    try {
      // For local invocation without an external hostname, we can directly invoke the fetch handler
      // We construct a mock request to /api/remind/check?channel=cloud
      const url = "http://localhost/api/remind/check?channel=cloud";
      const req = new Request(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.TASK_API_KEY}`
        }
      });

      const res = await app.fetch(req, env, ctx);

      if (res.ok) {
        const body = await res.json();
        console.log("Cron remind check success:", JSON.stringify(body));
      } else {
        const body = await res.text();
        console.error("Cron remind check failed with status:", res.status, body);
      }
    } catch (e) {
      console.error("Cron remind check threw an error:", e);
    }
  }
};
