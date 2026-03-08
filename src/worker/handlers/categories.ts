import { Hono } from 'hono';
import { Bindings } from '../index';
import { apiResponse as response } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY created_at DESC').all();
  return c.json(response(true, results));
});

app.post('/', async (c) => {
  const { name, color } = await c.req.json();
  if (!name) return c.json(response(false, null, { message: 'Name is required' }), 400);

  try {
    const { results } = await c.env.DB.prepare('INSERT INTO categories (name, color) VALUES (?, ?) RETURNING id').bind(name, color || null).all();
    return c.json(response(true, results[0]), 201);
  } catch (e: any) {
    return c.json(response(false, null, { message: e.message }), 500);
  }
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json(response(true, { message: 'Deleted successfully' }));
});

export const categoryHandlers = app;
