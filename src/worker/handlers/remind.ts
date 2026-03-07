import { Hono } from 'hono';
import { Bindings } from '../index';
import { sendBarkNotification } from '../services/bark';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';
import { getQQAccessToken, sendQQNotification } from '../services/qqbot';
import { calculateNextFutureRemindAt } from '../services/recurrence';

const app = new Hono<{ Bindings: Bindings }>();
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

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
    // Cloud trigger -> send to Bark and/or Telegram and mark as reminded, then log it
    for (const task of results) {
      let pushSuccess = false;
      const payloads: string[] = [];

      // Bark Push
      const barkUrl = c.env.BARK_URL || '';
      if (barkUrl) {
        let bSuccess = false;
        try {
          const { success, payload } = await sendBarkNotification(
            barkUrl,
            `任务提醒: ${task.title}`,
            (task.description as string) || '到期了，快去看看吧！'
          );
          bSuccess = success;
          if (success && payload) payloads.push(payload);
        } catch (error) {
          console.error(`[Remind] Bark push error for task ${task.id}:`, error);
        }
        console.log(`[Remind] Bark push for task ${task.id}: success=${bSuccess}`);
        if (bSuccess) pushSuccess = true;
      }

      // Telegram Push
      const telegramToken = c.env.TELEGRAM_BOT_TOKEN || '';
      const telegramChatId = c.env.TELEGRAM_CHAT_ID || '';
      if (telegramToken && telegramChatId) {
        let tSuccess = false;
        try {
          const tText = `<b>任务提醒: ${escapeTelegramHTML(task.title as string)}</b>\n\n${escapeTelegramHTML(task.description as string || '到期了，快去看看吧！')}`;
          const { success, payload } = await sendTelegramNotification(
            telegramToken,
            telegramChatId,
            tText,
            'HTML'
          );
          tSuccess = success;
          if (success && payload) payloads.push(payload);
        } catch (error) {
          console.error(`[Remind] Telegram push error for task ${task.id}:`, error);
        }
        console.log(`[Remind] Telegram push for task ${task.id}: success=${tSuccess}`);
        if (tSuccess) pushSuccess = true;
      }

      // QQ Push
      const qqAppId = c.env.QQ_APP_ID || '';
      const qqAppSecret = c.env.QQ_APP_SECRET || '';
      const qqOpenid = c.env.QQ_ALLOWED_OPENID || '';
      if (qqAppId && qqAppSecret && qqOpenid) {
        let qSuccess = false;
        try {
          const accessToken = await getQQAccessToken(qqAppId, qqAppSecret);
          if (accessToken) {
            const qText = `任务提醒: ${task.title}\n\n${task.description || '到期了，快去看看吧！'}`;
            const { success } = await sendQQNotification(accessToken, qqOpenid, qText);
            qSuccess = success;
          }
        } catch (error) {
          console.error(`[Remind] QQ push error for task ${task.id}:`, error);
        }
        console.log(`[Remind] QQ push for task ${task.id}: success=${qSuccess}`);
        if (qSuccess) pushSuccess = true;
      }

      // If no channels configured, we still might want to flip to avoid indefinite looping?
      // For now, if pushSuccess is true, we update DB.
      // Wait, if BOTH bark and telegram are not configured, pushSuccess is false, task will stay in remind loop forever.
      // Let's ensure that if neither is configured, we consider it a success just to move the task along.
      const noChannelsConfigured = !barkUrl && (!telegramToken || !telegramChatId) && (!qqAppId || !qqAppSecret || !qqOpenid);
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
