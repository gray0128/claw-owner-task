import { Hono } from 'hono';
import { Bindings } from '../index';
import { calculateNextOccurrence, calculateNextRemindAt } from '../services/recurrence';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format response
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

// GET /api/tasks - List tasks
app.get('/', async (c) => {
  const q = c.req.query('q');
  const status = c.req.query('status');
  const tagId = c.req.query('tag');
  const tagName = c.req.query('tag_name');
  const priority = c.req.query('priority');
  const categoryId = c.req.query('category_id');
  const dueDate = c.req.query('due_date');
  const remindAt = c.req.query('remind_at');
  
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

  query += ` ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`;

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  
  // Parse tags JSON string to array
  const formattedResults = results.map(row => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null
  }));

  return c.json(response(true, formattedResults));
});

// GET /api/tasks/:id - Get single task
app.get('/:id', async (c) => {
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

  const formattedResult = {
    ...result,
    tags: result.tags ? JSON.parse(result.tags as string) : [],
    metadata: result.metadata ? JSON.parse(result.metadata as string) : null
  };

  return c.json(response(true, formattedResult));
});

// POST /api/tasks - Create task
app.post('/', async (c) => {
  const body = await c.req.json();
  const { title, description, priority, category_id, source, metadata, recurring_rule, due_date, remind_at, tags } = body;

  if (!title) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Title is required' }), 400);

  // Time format validation
  const isValidDate = (dateStr: string) => {
    if (!dateStr) return true;
    const isoRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2}))?$/;
    return isoRegex.test(dateStr) && !isNaN(Date.parse(dateStr));
  };

  if (!isValidDate(due_date) || !isValidDate(remind_at)) {
    return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'due_date and remind_at must be valid ISO or YYYY-MM-DD strings' }), 400);
  }

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
      due_date || null, 
      remind_at || null
    ).first();

    const taskId = insertResult?.id;

    if (taskId && tags && Array.isArray(tags)) {
      const nameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;
      
      for (const tagIdentifier of tags) {
        // Assume tagIdentifier might be a string (name) or number (id). We now prefer strings.
        const tagName = String(tagIdentifier).trim();
        
        if (!nameRegex.test(tagName)) {
           // Skip invalid tags or we could fail the whole request. Here we skip with a warning.
           console.warn(`Skipping invalid tag name: ${tagName}`);
           continue;
        }

        // Check if tag exists
        let tagRecord = await c.env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first();
        let tagId = tagRecord?.id;

        // If not exists, create it
        if (!tagId) {
          const insertTag = await c.env.DB.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id').bind(tagName).first();
          tagId = insertTag?.id;
        }

        if (tagId) {
          // Ignore duplicate constraint errors if task is already tagged
          try {
            await c.env.DB.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(taskId, tagId).run();
          } catch(e) { /* ignore constraint violation */ }
        }
      }
    }

    return c.json(response(true, { id: taskId }), 201);
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
    let nextRemindAt = null;
    if (task.remind_at && nextDueDate) {
      nextRemindAt = calculateNextRemindAt(task.due_date as string, task.remind_at as string, nextDueDate);
    }
    
    query = `UPDATE tasks SET status = 'pending', due_date = ?, remind_at = ?, reminded = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params = [nextDueDate, nextRemindAt, id];
  } else {
    // Normal completion
    query = `UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
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

  // Time format validation
  const isValidDate = (dateStr: string) => {
    if (!dateStr || typeof dateStr !== 'string') return true;
    const isoRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2}))?$/;
    return isoRegex.test(dateStr) && !isNaN(Date.parse(dateStr));
  };

  if ((body.due_date !== undefined && !isValidDate(body.due_date)) || 
      (body.remind_at !== undefined && !isValidDate(body.remind_at))) {
    return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'due_date and remind_at must be valid ISO or YYYY-MM-DD strings' }), 400);
  }

  const updates: string[] = [];
  const params: any[] = [];

  const updateFields = ['title', 'description', 'status', 'priority', 'category_id', 'source', 'recurring_rule', 'due_date', 'remind_at'];
  
  for (const field of updateFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
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
      await c.env.DB.prepare('DELETE FROM task_tags WHERE task_id = ?').bind(id).run();
      const nameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;
      
      for (const tagIdentifier of body.tags) {
        const tagName = String(tagIdentifier).trim();
        if (!nameRegex.test(tagName)) continue;

        let tagRecord = await c.env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first();
        let tagId = tagRecord?.id;

        if (!tagId) {
          const insertTag = await c.env.DB.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id').bind(tagName).first();
          tagId = insertTag?.id;
        }

        if (tagId) {
          try {
            await c.env.DB.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(id, tagId).run();
          } catch(e) { }
        }
      }
    }

    return c.json(response(true, { message: 'Task updated successfully', id }));
  } catch (err: any) {
    return c.json(response(false, null, { code: 'DB_ERROR', message: err.message }), 500);
  }
});

export const taskHandlers = app;
