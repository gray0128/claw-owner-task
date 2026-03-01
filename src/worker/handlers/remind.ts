import { Hono } from 'hono';
import { Bindings } from '../index';
import { sendBarkNotification } from '../services/bark';

const app = new Hono<{ Bindings: Bindings }>();
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

app.post('/check', async (c) => {
  const channel = c.req.query('channel'); // 'cloud' | 'agent'
  if (!channel || !['cloud', 'agent'].includes(channel)) {
    return c.json(response(false, null, { code: 'INVALID_CHANNEL', message: 'Query parameter "channel" must be "cloud" or "agent"' }), 400);
  }

  // Find pending tasks where remind_at is in the past (or now) and hasn't been reminded
  const query = `
    SELECT id, title, description, due_date
    FROM tasks 
    WHERE status = 'pending' 
      AND remind_at IS NOT NULL 
      AND remind_at <= CURRENT_TIMESTAMP 
      AND reminded = 0
  `;
  const { results } = await c.env.DB.prepare(query).all();

  if (results.length === 0) {
    return c.json(response(true, { tasks: [], message: 'No tasks to remind' }));
  }

  if (channel === 'cloud') {
    // Cloud trigger -> send to Bark and mark as reminded
    for (const task of results) {
      const success = await sendBarkNotification(
        c.env.BARK_URL || '', 
        `任务提醒: ${task.title}`, 
        (task.description as string) || '到期了，快去看看吧！'
      );
      if (success) {
        await c.env.DB.prepare('UPDATE tasks SET reminded = 1 WHERE id = ?').bind(task.id).run();
      }
    }
    return c.json(response(true, { tasks: results, message: 'Cloud push executed' }));
  } else {
    // Agent trigger -> just return the tasks, agent handles the notification
    // The Agent should ideally call another endpoint to mark them as reminded, 
    // or we can optimistically mark them here. For simplicity and as per current design,
    // we mark them here assuming the agent will succeed in notifying.
    for (const task of results) {
      await c.env.DB.prepare('UPDATE tasks SET reminded = 1 WHERE id = ?').bind(task.id).run();
    }
    return c.json(response(true, { tasks: results, message: 'Agent check executed' }));
  }
});

export const remindHandlers = app;
