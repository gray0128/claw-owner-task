import { Hono } from 'hono';
import { html } from 'hono/html';
import { Bindings } from '../index';

export const publicShareHandlers = new Hono<{ Bindings: Bindings }>();
// Helper: Get or create share URLs for a list of tasks
export async function getOrCreateShareUrls(c: any, taskIds: number[]): Promise<Record<number, string>> {
  if (taskIds.length === 0) return {};

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}/share/`;

  // 1. Check for existing valid shares
  const placeholders = taskIds.map(() => '?').join(',');
  const existingShares = await c.env.DB.prepare(`
    SELECT task_id, uuid FROM task_shares
    WHERE task_id IN (${placeholders}) AND expires_at > DATETIME('now')
  `).bind(...taskIds).all();

  const results: Record<number, string> = {};
  const existingTaskIds = new Set<number>();

  if (existingShares.results) {
    for (const row of existingShares.results) {
      results[row.task_id as number] = `${baseUrl}${row.uuid}`;
      existingTaskIds.add(row.task_id as number);
    }
  }

  // 2. Create new shares for those without one
  const missingTaskIds = taskIds.filter(id => !existingTaskIds.has(id));
  if (missingTaskIds.length > 0) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sqliteExpiresAt = expiresAt.toISOString().replace('T', ' ').split('.')[0];

    // We have to insert one by one or via a batch in D1
    const statements = missingTaskIds.map(id => {
      const uuid = crypto.randomUUID();
      results[id] = `${baseUrl}${uuid}`;
      return c.env.DB.prepare(`
        INSERT INTO task_shares (uuid, task_id, expires_at)
        VALUES (?, ?, ?)
      `).bind(uuid, id, sqliteExpiresAt);
    });

    if (statements.length > 0) {
      await c.env.DB.batch(statements);
    }
  }

  return results;
}

// Helper: Generate a unique share URL for a single task
export async function createShareUrl(c: any, taskId: number): Promise<string> {
  const uuid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const sqliteExpiresAt = expiresAt.toISOString().replace('T', ' ').split('.')[0];

  await c.env.DB.prepare(`
    INSERT INTO task_shares (uuid, task_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(uuid, taskId, sqliteExpiresAt).run();

  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}/share/${uuid}`;
}

// GET /share/:uuid - Public route to view a single task
publicShareHandlers.get('/:uuid', async (c) => {
  const uuid = c.req.param('uuid');

  // 1. Validate share and get task_id
  const share = await c.env.DB.prepare(`
    SELECT task_id, expires_at FROM task_shares
    WHERE uuid = ? AND expires_at > DATETIME('now')
  `).bind(uuid).first();

  if (!share) {
    return c.html(errorPage('链接已失效或不存在', '该分享链接可能已超过 24 小时有效期，或已被撤销。'), 404);
  }

  // 2. Fetch task details
  const taskQuery = `
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

  const task: any = await c.env.DB.prepare(taskQuery).bind(share.task_id).first();
  if (!task) {
    return c.html(errorPage('任务不存在', '该任务可能已被删除。'), 404);
  }

  // 3. Render HTML
  const tags = JSON.parse(task.tags || '[]');
  const metadata = task.metadata ? JSON.parse(task.metadata) : null;
  const statusLabel = task.status === 'completed' ? '已完成' : '待处理';
  const statusClass = task.status === 'completed' ? 'status-completed' : 'status-pending';

  return c.html(html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${task.title} - 任务详情</title>
    <style>
        :root {
            --primary-color: #2563eb;
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border-color: #e2e8f0;
            --completed-color: #10b981;
            --pending-color: #f59e0b;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
        }
        .container {
            width: 100%;
            max-width: 600px;
            background: var(--card-bg);
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            border: 1px solid var(--border-color);
        }
        .header {
            padding: 24px;
            border-bottom: 1px solid var(--border-color);
            background: linear-gradient(to bottom right, #ffffff, #f1f5f9);
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 12px;
            text-transform: uppercase;
        }
        .status-completed { background: #d1fae5; color: #065f46; }
        .status-pending { background: #fef3c7; color: #92400e; }

        h1 { margin: 0; font-size: 24px; color: #0f172a; line-height: 1.3; }

        .content { padding: 24px; }
        .description {
            font-size: 16px;
            color: #334155;
            white-space: pre-wrap;
            margin-bottom: 24px;
            background: #f8fafc;
            padding: 16px;
            border-radius: 8px;
            border-left: 4px solid var(--primary-color);
        }

        .meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        .meta-item { display: flex; flex-direction: column; }
        .meta-label { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
        .meta-value { font-size: 14px; font-weight: 500; }

        .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
        .tag {
            background: #eff6ff;
            color: #1e40af;
            padding: 2px 10px;
            border-radius: 4px;
            font-size: 12px;
            border: 1px solid #bfdbfe;
        }

        .footer {
            padding: 16px 24px;
            background: #f1f5f9;
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-muted);
            text-align: center;
        }

        .priority-high { color: #ef4444; font-weight: bold; }
        .priority-medium { color: #f59e0b; }
        .priority-low { color: #10b981; }

        @media (max-width: 480px) {
            body { padding: 10px; }
            h1 { font-size: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="status-badge ${statusClass}">${statusLabel}</span>
            <h1>${task.title}</h1>
        </div>
        <div class="content">
            ${task.description ? html`<div class="description">${task.description}</div>` : ''}

            <div class="meta-grid">
                <div class="meta-item">
                    <span class="meta-label">优先级</span>
                    <span class="meta-value priority-${task.priority}">${task.priority.toUpperCase()}</span>
                </div>
                ${task.category_name ? html`
                <div class="meta-item">
                    <span class="meta-label">分类</span>
                    <span class="meta-value" style="color: ${task.category_color}">${task.category_name}</span>
                </div>` : ''}
                ${task.due_date ? html`
                <div class="meta-item">
                    <span class="meta-label">截止日期</span>
                    <span class="meta-value">${new Date(task.due_date + 'Z').toLocaleString('zh-CN', {hour12: false})}</span>
                </div>` : ''}
                ${task.remind_at ? html`
                <div class="meta-item">
                    <span class="meta-label">提醒时间</span>
                    <span class="meta-value">${new Date(task.remind_at + 'Z').toLocaleString('zh-CN', {hour12: false})}</span>
                </div>` : ''}
            </div>

            ${tags.length > 0 ? html`
            <div class="meta-label" style="margin-bottom: 8px;">标签</div>
            <div class="tags">
                ${tags.map((t: any) => html`<span class="tag">#${t.name}</span>`)}
            </div>` : ''}

            ${metadata && metadata.context ? html`
            <div class="meta-label" style="margin-bottom: 8px;">AI 溯源上下文</div>
            <div style="font-size: 13px; color: #475569; background: #f1f5f9; padding: 12px; border-radius: 6px; font-style: italic;">
                "${metadata.context}"
            </div>` : ''}
        </div>
        <div class="footer">
            此链接为临时分享链接，将于 ${new Date(share.expires_at + 'Z').toLocaleString('zh-CN', {hour12: false})} 过期。
            <br>Powered by claw-owner-task
        </div>
    </div>
</body>
</html>
  `);
});

function errorPage(title: string, message: string) {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
        .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
        h1 { color: #ef4444; margin-top: 0; }
        p { color: #64748b; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 1.5rem 0;">
        <div style="font-size: 0.875rem; color: #94a3b8;">claw-owner-task</div>
    </div>
</body>
</html>
  `;
}
