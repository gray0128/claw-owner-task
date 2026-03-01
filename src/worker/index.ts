import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { timezoneMiddleware } from './middleware/timezone';

import { infoHandlers } from './handlers/info';
import { taskHandlers } from './handlers/tasks';
import { categoryHandlers } from './handlers/categories';
import { tagHandlers } from './handlers/tags';
import { remindHandlers } from './handlers/remind';

export type Bindings = {
  DB: D1Database;
  TASK_API_KEY: string;
  USER_TIMEZONE: string;
  BARK_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Global Middlewares
app.use('*', cors());
app.use('/api/*', authMiddleware);
app.use('/api/*', timezoneMiddleware);

// Routes
app.route('/api/info', infoHandlers);
app.route('/api/tasks', taskHandlers);
app.route('/api/categories', categoryHandlers);
app.route('/api/tags', tagHandlers);
app.route('/api/remind', remindHandlers);

// Root fallback
app.get('/', (c) => c.text('Claw Owner Task API is running.'));

export default app;
