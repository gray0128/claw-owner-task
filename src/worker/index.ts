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

import { feishuHandlers } from './handlers/feishu';
import { audioProxyHandlers } from './handlers/audio-proxy';
import { authSummaryHandlers, publicSummaryHandlers } from './handlers/summary';
import { publicShareHandlers } from './handlers/share';
import { publicListHandlers } from './handlers/list';
import githubAuth from './handlers/auth/github';

export type Bindings = {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  AI: any;
  ENABLE_AI: string | boolean;
  TASK_API_KEY: string;
  USER_TIMEZONE: string;
  BASE_URL?: string;
  BARK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;

  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_VERIFY_TOKEN?: string;
  FEISHU_ENCRYPT_KEY?: string;
  FEISHU_ALLOWED_CHAT_ID?: string;
  VOLC_API_KEY?: string;
  VOLC_API_HOST?: string;
  CRON_SUMMARY_TIME?: string; // Format: "HH:mm" in user timezone

  // GitHub OAuth Config
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_REDIRECT_URI?: string;
  GITHUB_ALLOWED_USER_ID?: string;
  GITHUB_ALLOWED_USERNAME?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Global Middlewares
app.use('*', cors());
app.use('/api/*', authMiddleware);
app.use('/api/*', timezoneMiddleware);

// Exclude auth middleware for public webhooks & proxies
app.route('/api/proxy/audio', audioProxyHandlers);

// Routes
app.route('/api/info', infoHandlers);
app.route('/api/tasks/ai', aiHandlers);
app.route('/api/tasks', taskHandlers);
app.route('/api/categories', categoryHandlers);
app.route('/api/tags', tagHandlers);
app.route('/api/remind', remindHandlers);
app.route('/api/logs', logsHandlers);
app.route('/api/summary', authSummaryHandlers);
app.route('/api/auth/github', githubAuth);

// Public Routes (No Auth)
app.route('/summary', publicSummaryHandlers);
app.route('/share', publicShareHandlers);
app.route('/list', publicListHandlers);

// Telegram Webhook is public and handles its own auth via Chat ID and Telegram Token
app.route('/api/webhook/telegram', telegramHandlers);



// Feishu Bot Webhook
app.route('/api/webhook/feishu', feishuHandlers);

// Root fallback
app.get('/', (c) => c.text('Claw Owner Task API is running.'));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Cron trigger execution
    try {
      // 1. Trigger remind check (Typically runs every minute)
      const url = "http://localhost/api/remind/check?channel=cloud";
      const req = new Request(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.TASK_API_KEY}`
        }
      });

      const res = await app.fetch(req, env, ctx);

      if (res.ok) {
        // Silently succeed for remind check to avoid log spam, only log errors
      } else {
        const body = await res.text();
        console.error("Cron remind check failed with status:", res.status, body);
      }

      // 2. Clean up old task summaries (older than 30 days)
      await env.DB.prepare(`
        DELETE FROM task_summaries 
        WHERE created_at <= datetime('now', '-30 days')
      `).run();

      // 2.5. Clean up old event dedup records (older than 1 day)
      await env.DB.prepare(`
        DELETE FROM event_dedup
        WHERE created_at <= datetime('now', '-1 day')
      `).run();

      // 3. Clean up expired task shares
      await env.DB.prepare(`
        DELETE FROM task_shares
        WHERE expires_at <= DATETIME('now')
      `).run();

      // 4. Clean up expired task lists
      await env.DB.prepare(`
        DELETE FROM task_lists
        WHERE expires_at <= DATETIME('now')
      `).run();

      // 5. Automated Summary Generation via Cron
      // To use this, user sets CRON_SUMMARY_TIME="08:00,20:00" (in their USER_TIMEZONE) in wrangler.toml
      if (env.CRON_SUMMARY_TIME && env.ENABLE_AI !== 'false' && env.ENABLE_AI !== false) {
        const timeZone = env.USER_TIMEZONE || 'Asia/Shanghai';
        
        // Get current time in user's timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        
        // Parts will give us the current HH:mm in the target timezone
        const parts = formatter.formatToParts(new Date());
        let currentHour = '', currentMinute = '';
        for (const part of parts) {
          if (part.type === 'hour') currentHour = part.value;
          if (part.type === 'minute') currentMinute = part.value;
        }
        
        // Standardize current time to HH:mm
        const currentTzTime = `${currentHour.padStart(2, '0')}:${currentMinute.padStart(2, '0')}`;
        
        // Split configured times by comma and trim whitespace
        const targetTimes = env.CRON_SUMMARY_TIME.split(',').map(t => t.trim());

        // If the current minute in user's timezone matches any of their configured times, trigger summary
        if (targetTimes.includes(currentTzTime)) {
          console.log(`Cron Summary Triggered! Local time matched configuration: ${currentTzTime}`);
          
          // Construct mock request for summary generation
          const summaryUrl = "http://localhost/api/summary?source=cron";
          const summaryReq = new Request(summaryUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.TASK_API_KEY}`,
              "X-User-Timezone": timeZone
            }
          });

          const summaryRes = await app.fetch(summaryReq, env, ctx);
          if (summaryRes.ok) {
             console.log("Cron automated summary generated and pushed successfully.");
          } else {
             console.error("Cron automated summary failed:", await summaryRes.text());
          }
        }
      }

    } catch (e) {
      console.error("Cron check threw an error:", e);
    }
  }
};
