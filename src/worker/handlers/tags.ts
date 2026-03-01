import { Hono } from 'hono';
import { Bindings } from '../index';

const app = new Hono<{ Bindings: Bindings }>();
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tags ORDER BY created_at DESC').all();
  return c.json(response(true, results));
});

app.post('/', async (c) => {
  const { name } = await c.req.json();
  if (!name) return c.json(response(false, null, { message: 'Name is required' }), 400);

  const isValidName = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/.test(name);
  if (!isValidName) {
    return c.json(response(false, null, { message: 'Tag name can only contain Chinese characters, English letters, and numbers without spaces or special characters.' }), 400);
  }

  try {
    const { results } = await c.env.DB.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id').bind(name).all();
    return c.json(response(true, results[0]), 201);
  } catch (e: any) {
    return c.json(response(false, null, { message: e.message }), 500);
  }
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  return c.json(response(true, { message: 'Deleted successfully' }));
});

export const tagHandlers = app;
