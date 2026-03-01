import { Hono } from 'hono';
import { Bindings } from '../index';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', async (c) => {
  const userTimezone = c.get('userTimezone' as any);

  // Fetch all categories
  const categoriesResult = await c.env.DB.prepare('SELECT id, name, color FROM categories').all();
  // Fetch all tags
  const tagsResult = await c.env.DB.prepare('SELECT id, name FROM tags').all();

  return c.json({
    success: true,
    data: {
      version: '1.3.1',
      timezone: userTimezone,
      enums: {
        status: ['pending', 'in_progress', 'completed', 'cancelled'],
        priority: ['low', 'medium', 'high'],
        recurring_rule: ['none', 'daily', 'weekly', 'monthly'],
        source: ['user', 'openclaw']
      },
      categories: categoriesResult.results,
      tags: tagsResult.results
    },
    error: null
  });
});

export const infoHandlers = app;
