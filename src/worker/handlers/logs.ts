import { Hono } from 'hono';
import { Bindings } from '../index';
import { apiResponse as response } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/bark', async (c) => {
    const limitStr = c.req.query('limit') || '5';
    const taskIdStr = c.req.query('task_id');
    let limit = parseInt(limitStr);
    if (isNaN(limit) || limit < 1) limit = 5;
    if (limit > 100) limit = 100;

    try {
        let query = `
      SELECT id, task_id, pushed_at, payload 
      FROM bark_logs 
    `;
        const params: any[] = [];

        if (taskIdStr) {
            const taskId = parseInt(taskIdStr);
            if (!isNaN(taskId)) {
                query += ` WHERE task_id = ? `;
                params.push(taskId);
            }
        }

        query += ` ORDER BY pushed_at DESC LIMIT ?`;
        params.push(limit);

        let stmt = c.env.DB.prepare(query).bind(...params);

        const { results } = await stmt.all();
        return c.json(response(true, results));
    } catch (error: any) {
        return c.json(response(false, null, { code: 'DB_ERROR', message: error.message }), 500);
    }
});

export const logsHandlers = app;
