import { Hono } from 'hono';
import { Bindings } from '../index';
import { calculateNextOccurrence, calculateNextRemindAt } from '../services/recurrence';
import { createShareUrl, getOrCreateShareUrls } from './share';
import { apiResponse as response, toSqliteUtc } from '../utils';
import { isValidDate, normalizeDate, fromSqliteUtc } from '../helpers/date';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * 同步任务的标签关联。
 * @param db    D1Database 实例
 * @param taskId  任务 ID
 * @param tags    标签名称数组
 * @param replace 是否先删除旧关联（更新场景为 true）
 */
async function syncTaskTags(
  db: D1Database,
  taskId: number | string,
  tags: string[],
  replace: boolean = false
): Promise<void> {
  const nameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;

  // 如果是更新场景，先清空旧的关联
  if (replace) {
    await db.prepare('DELETE FROM task_tags WHERE task_id = ?').bind(taskId).run();
  }

  for (const tagIdentifier of tags) {
    const tagName = String(tagIdentifier).trim();

    // 跳过不合法的标签名
    if (!nameRegex.test(tagName)) {
      console.warn(`Skipping invalid tag name: ${tagName}`);
      continue;
    }

    // 查找或创建标签
    let tagRecord = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first();
    let tagId = tagRecord?.id;

    if (!tagId) {
      const insertTag = await db.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id').bind(tagName).first();
      tagId = insertTag?.id;
    }

    // 建立关联（忽略重复）
    if (tagId) {
      try {
        await db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(taskId, tagId).run();
      } catch (e) { /* ignore constraint violation */ }
    }
  }
}

// GET /api/tasks - List tasks
app.get('/', async (c) => {
  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const id = c.req.query('id');
  const q = c.req.query('q');
  const status = c.req.query('status');
  const tagId = c.req.query('tag');
  const tagName = c.req.query('tag_name');
  const priority = c.req.query('priority');
  const categoryId = c.req.query('category_id');
  const dueDate = c.req.query('due_date');
  const remindAt = c.req.query('remind_at');
  const hasRemind = c.req.query('has_remind');
  const hasDue = c.req.query('has_due');

  let query = `
    SELECT t.*, c.name as category_name, c.color as category_color,
    (
      SELECT json_group_array(json_object('id', tg.id, 'name', tg.name))
      FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id
      WHERE tt.task_id = t.id
    ) as tags
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (id) {
    query += ` AND t.id = ?`;
    params.push(Number(id));
  }
  if (q) {
    query += ` AND (t.title LIKE ? OR t.description LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    query += ` AND t.status = ?`;
    params.push(status);
  }
  if (tagId) {
    query += ` AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)`;
    params.push(Number(tagId));
  }
  if (tagName) {
    query += ` AND t.id IN (SELECT task_id FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id WHERE tg.name = ?)`;
    params.push(tagName);
  }
  if (priority) {
    query += ` AND t.priority = ?`;
    params.push(priority);
  }
  if (categoryId) {
    query += ` AND t.category_id = ?`;
    params.push(Number(categoryId));
  }
  if (dueDate) {
    query += ` AND DATE(t.due_date) = DATE(?)`;
    params.push(dueDate);
  }
  if (remindAt) {
    query += ` AND DATE(t.remind_at) = DATE(?)`;
    params.push(remindAt);
  }
  if (hasRemind === 'true') {
    query += ` AND t.remind_at IS NOT NULL`;
  } else if (hasRemind === 'false') {
    query += ` AND t.remind_at IS NULL`;
  }
  if (hasDue === 'true') {
    query += ` AND t.due_date IS NOT NULL`;
  } else if (hasDue === 'false') {
    query += ` AND t.due_date IS NULL`;
  }

  query += ` ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`;

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  // Get share URLs for all tasks
  const taskIds = results.map(r => r.id as number);
  const shareUrls = await getOrCreateShareUrls(c, taskIds);

  // Parse tags JSON string to array
  const formattedResults = results.map(row => ({
    ...row,
    due_date: fromSqliteUtc(row.due_date as string, userTimezone),
    remind_at: fromSqliteUtc(row.remind_at as string, userTimezone),
    completed_at: fromSqliteUtc(row.completed_at as string, userTimezone),
    created_at: fromSqliteUtc(row.created_at as string, userTimezone),
    updated_at: fromSqliteUtc(row.updated_at as string, userTimezone),
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    view_url: shareUrls[row.id as number] || null
  }));

  return c.json(response(true, formattedResults));
});

// GET /api/tasks/:id - Get single task
app.get('/:id', async (c) => {
  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const id = c.req.param('id');
  const query = `
    SELECT t.*, c.name as category_name, c.color as category_color,
    (
      SELECT json_group_array(json_object('id', tg.id, 'name', tg.name))
      FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id
      WHERE tt.task_id = t.id
    ) as tags
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `;

  const result = await c.env.DB.prepare(query).bind(id).first();
  if (!result) return c.json(response(false, null, { code: 'NOT_FOUND', message: 'Task not found' }), 404);

  const viewUrl = await createShareUrl(c, result.id as number);

  const formattedResult = {
    ...result,
    due_date: fromSqliteUtc(result.due_date as string, userTimezone),
    remind_at: fromSqliteUtc(result.remind_at as string, userTimezone),
    completed_at: fromSqliteUtc(result.completed_at as string, userTimezone),
    created_at: fromSqliteUtc(result.created_at as string, userTimezone),
    updated_at: fromSqliteUtc(result.updated_at as string, userTimezone),
    tags: result.tags ? JSON.parse(result.tags as string) : [],
    metadata: result.metadata ? JSON.parse(result.metadata as string) : null,
    view_url: viewUrl
  };

  return c.json(response(true, formattedResult));
});

// POST /api/tasks - Create task
app.post('/', async (c) => {
  const body = await c.req.json();
  const { title, description, priority, category_id, source, metadata, recurring_rule, due_date, remind_at, tags } = body;

  if (!title) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Title is required' }), 400);

  if (!isValidDate(due_date) || !isValidDate(remind_at)) {
    return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'due_date and remind_at must be valid ISO or YYYY-MM-DD strings' }), 400);
  }

  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const finalDueDate = normalizeDate(due_date, userTimezone);
  const finalRemindAt = normalizeDate(remind_at, userTimezone);

  const metaString = metadata ? JSON.stringify(metadata) : null;

  try {
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO tasks (title, description, priority, category_id, source, metadata, recurring_rule, due_date, remind_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      title,
      description || '',
      priority || 'medium',
      category_id || null,
      source || 'user',
      metaString,
      recurring_rule || 'none',
      finalDueDate || null,
      finalRemindAt || null
    ).first();

    const taskId = insertResult?.id;

    if (taskId && tags && Array.isArray(tags)) {
      await syncTaskTags(c.env.DB, taskId as number, tags);
    }

    const viewUrl = taskId ? await createShareUrl(c, taskId as number) : null;
    return c.json(response(true, { id: taskId, view_url: viewUrl }), 201);
  } catch (err: any) {
    return c.json(response(false, null, { code: 'DB_ERROR', message: err.message }), 500);
  }
});

// PUT /api/tasks/:id/complete - Complete a task
app.put('/:id/complete', async (c) => {
  const id = c.req.param('id');

  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) return c.json(response(false, null, { code: 'NOT_FOUND', message: 'Task not found' }), 404);

  const rule = task.recurring_rule as string;
  let query = '';
  let params: any[] = [];

  if (rule !== 'none' && task.due_date) {
    // Calculate next occurrence
    const nextDueDate = calculateNextOccurrence(task.due_date as string, rule);

    query = `UPDATE tasks SET status = 'pending', due_date = ?, remind_at = NULL, updated_at = CURRENT_TIMESTAMP, completed_at = NULL WHERE id = ?`;
    params = [nextDueDate, id];
  } else {
    // Normal completion
    query = `UPDATE tasks SET status = 'completed', remind_at = NULL, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params = [id];
  }

  await c.env.DB.prepare(query).bind(...params).run();
  return c.json(response(true, { message: 'Task marked as completed/re-scheduled' }));
});

// DELETE /api/tasks/:id - Delete task
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return c.json(response(true, { message: 'Deleted successfully' }));
});

// PUT /api/tasks/:id - Update task
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existingTask = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!existingTask) return c.json(response(false, null, { code: 'NOT_FOUND', message: 'Task not found' }), 404);

  if ((body.due_date !== undefined && !isValidDate(body.due_date)) ||
    (body.remind_at !== undefined && !isValidDate(body.remind_at))) {
    return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'due_date and remind_at must be valid ISO or YYYY-MM-DD strings' }), 400);
  }

  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const updates: string[] = [];
  const params: any[] = [];

  const updateFields = ['title', 'description', 'status', 'priority', 'category_id', 'source', 'recurring_rule', 'due_date', 'remind_at'];

  for (const field of updateFields) {
    if (body[field] !== undefined) {
      let value = body[field];
      if ((field === 'due_date' || field === 'remind_at') && value !== null) {
        value = normalizeDate(value, userTimezone);
      }
      if (field === 'status') {
        if (value === 'completed') {
          updates.push("completed_at = CURRENT_TIMESTAMP");
        } else if (value === 'pending') {
          updates.push("completed_at = NULL");
        }
      }
      updates.push(`${field} = ?`);
      params.push(value);
    }
  }

  if (body.metadata !== undefined) {
    updates.push('metadata = ?');
    params.push(body.metadata ? JSON.stringify(body.metadata) : null);
  }

  if (updates.length === 0 && body.tags === undefined) {
    return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'No update fields provided' }), 400);
  }

  try {
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      const query = `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`;
      await c.env.DB.prepare(query).bind(...params).run();
    }

    if (body.tags && Array.isArray(body.tags)) {
      await syncTaskTags(c.env.DB, id, body.tags, true);
    }

    // Fetch the updated task to return
    const updatedTaskQuery = `
      SELECT t.*, c.name as category_name, c.color as category_color,
      (
        SELECT json_group_array(json_object('id', tg.id, 'name', tg.name))
        FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id
        WHERE tt.task_id = t.id
      ) as tags
      FROM tasks t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `;
    const updatedTask = await c.env.DB.prepare(updatedTaskQuery).bind(id).first();
    const viewUrl = updatedTask ? await createShareUrl(c, updatedTask.id as number) : null;
    const formattedTask = {
      ...updatedTask,
      due_date: fromSqliteUtc(updatedTask?.due_date as string, userTimezone),
      remind_at: fromSqliteUtc(updatedTask?.remind_at as string, userTimezone),
      completed_at: fromSqliteUtc(updatedTask?.completed_at as string, userTimezone),
      created_at: fromSqliteUtc(updatedTask?.created_at as string, userTimezone),
      updated_at: fromSqliteUtc(updatedTask?.updated_at as string, userTimezone),
      tags: updatedTask?.tags ? JSON.parse(updatedTask.tags as string) : [],
      metadata: updatedTask?.metadata ? JSON.parse(updatedTask.metadata as string) : null,
      view_url: viewUrl
    };

    return c.json(response(true, formattedTask));
  } catch (err: any) {
    return c.json(response(false, null, { code: 'DB_ERROR', message: err.message }), 500);
  }
});

export const taskHandlers = app;
