import { Hono } from 'hono';
import { Bindings } from '../index';
import { escapeTelegramHTML } from '../services/telegram';

import { calculateNextFutureRemindAt } from '../services/recurrence';
import { apiResponse as response } from '../utils';
import { getOrCreateShareUrls } from './share';
import { sendToAllChannels } from '../services/notify';

const app = new Hono<{ Bindings: Bindings }>();

app.post('/check', async (c) => {
  const channel = c.req.query('channel'); // 'cloud' | 'agent'
  if (!channel || !['cloud', 'agent'].includes(channel)) {
    return c.json(response(false, null, { code: 'INVALID_CHANNEL', message: 'Query parameter "channel" must be "cloud" or "agent"' }), 400);
  }

  // Find pending tasks where remind_at is in the past (or now) and hasn't been reminded
  // Use datetime() to normalize remind_at format for reliable comparison with CURRENT_TIMESTAMP
  // (remind_at may be stored as ISO "2026-03-04T07:40:49.000Z" while CURRENT_TIMESTAMP is "2026-03-04 07:40:49")
  const query = `
    SELECT id, title, description, due_date, remind_at, recurring_rule
    FROM tasks 
    WHERE status = 'pending' 
      AND remind_at IS NOT NULL 
      AND datetime(remind_at) <= datetime('now') 
  `;
  const { results } = await c.env.DB.prepare(query).all();
  console.log(`[Remind] Channel: ${channel}, Found ${results.length} task(s) to remind.`);

  if (results.length === 0) {
    return c.json(response(true, { tasks: [], message: 'No tasks to remind' }));
  }

  if (channel === 'cloud') {
    // Generate share URLs for all reminding tasks
    const taskIds = results.map((t: any) => t.id);
    const shareUrls = await getOrCreateShareUrls(c, taskIds);

    // Cloud trigger -> send to Bark and/or Telegram and mark as reminded, then log it
    for (const t of results) {
      const task = t as any;
      const taskUrl = shareUrls[task.id];

      const { success: anySuccess, payloads } = await sendToAllChannels(c.env, {
        title: `任务提醒: ${task.title}`,
        plainText: `${task.description as string || '到期了，快去看看吧！'}${taskUrl ? `\n\n查看任务详情: ${taskUrl}` : ''}`,
        htmlText: `<b>任务提醒: ${escapeTelegramHTML(task.title as string)}</b>\n\n${escapeTelegramHTML(task.description as string || '到期了，快去看看吧！')}${taskUrl ? `\n\n<a href="${taskUrl}">查看任务详情</a>` : ''}`,
        linkUrl: taskUrl
      }, 'cron');

      let pushSuccess = anySuccess;

      // If no channels configured, we still might want to flip to avoid indefinite looping?
      // For now, if pushSuccess is true, we update DB.
      // Wait, if BOTH bark and telegram are not configured, pushSuccess is false, task will stay in remind loop forever.
      // Let's ensure that if neither is configured, we consider it a success just to move the task along.
      const noChannelsConfigured = !c.env.BARK_URL && (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_CHAT_ID) && (!c.env.FEISHU_APP_ID || !c.env.FEISHU_APP_SECRET || !c.env.FEISHU_ALLOWED_CHAT_ID);
      if (noChannelsConfigured) {
        console.warn(`[Remind] No push channels configured for cloud. Simulating success.`);
        pushSuccess = true;
      }

      if (pushSuccess) {
        // Update remind_at based on whether it's recurring
        const rule = task.recurring_rule as string;
        if (rule && rule !== 'none' && task.remind_at) {
          const nextRemindAt = calculateNextFutureRemindAt(task.remind_at as string, rule);
          await c.env.DB.prepare('UPDATE tasks SET remind_at = ? WHERE id = ?').bind(nextRemindAt, task.id).run();
        } else {
          await c.env.DB.prepare('UPDATE tasks SET remind_at = NULL WHERE id = ?').bind(task.id).run();
        }

        // Insert into bark_logs
        for (const p of payloads) {
          await c.env.DB.prepare('INSERT INTO bark_logs (task_id, payload) VALUES (?, ?)')
            .bind(task.id, p)
            .run();
        }
      }
    }

    // Auto-cleanup bark_logs older than 7 days
    try {
      await c.env.DB.prepare("DELETE FROM bark_logs WHERE pushed_at < datetime('now', '-7 days')").run();
    } catch (e) {
      console.error('Failed to auto-cleanup bark_logs:', e);
    }

    return c.json(response(true, { tasks: results, message: 'Cloud push executed and cleaned up logs' }));
  } else {
    // Agent trigger -> just return the tasks, agent handles the notification
    // We update the remind_at assuming the agent will succeed in notifying.
    for (const task of results) {
      const rule = task.recurring_rule as string;
      if (rule && rule !== 'none' && task.remind_at) {
        const nextRemindAt = calculateNextFutureRemindAt(task.remind_at as string, rule);
        await c.env.DB.prepare('UPDATE tasks SET remind_at = ? WHERE id = ?').bind(nextRemindAt, task.id).run();
      } else {
        await c.env.DB.prepare('UPDATE tasks SET remind_at = NULL WHERE id = ?').bind(task.id).run();
      }
    }
    return c.json(response(true, { tasks: results, message: 'Agent check executed' }));
  }
});

export const remindHandlers = app;
