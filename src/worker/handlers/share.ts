import { Hono } from "hono";
import { html } from "hono/html";
import { Bindings } from "../index";

export const publicShareHandlers = new Hono<{ Bindings: Bindings }>();
// Helper: Get or create share URLs for a list of tasks
export async function getOrCreateShareUrls(
  c: any,
  taskIds: number[],
): Promise<Record<number, string>> {
  if (taskIds.length === 0) return {};

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const requestUrl = new URL(c.req.url);

  let baseUrl;
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith("/")
      ? c.env.BASE_URL.slice(0, -1)
      : c.env.BASE_URL;
    baseUrl = `${base}/share/`;
  } else {
    const host = c.req.header("x-forwarded-host") || requestUrl.host;
    const protocol =
      c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    baseUrl = `${protocol}://${host}/share/`;
  }

  // 1. Check for existing valid shares
  const placeholders = taskIds.map(() => "?").join(",");
  const existingShares = await c.env.DB.prepare(
    `
    SELECT task_id, uuid FROM task_shares
    WHERE task_id IN (${placeholders}) AND expires_at > DATETIME('now')
  `,
  )
    .bind(...taskIds)
    .all();

  const results: Record<number, string> = {};
  const existingTaskIds = new Set<number>();

  if (existingShares.results) {
    for (const row of existingShares.results) {
      results[row.task_id as number] = `${baseUrl}${row.uuid}`;
      existingTaskIds.add(row.task_id as number);
    }
  }

  // 2. Create new shares for those without one
  const missingTaskIds = taskIds.filter((id) => !existingTaskIds.has(id));
  if (missingTaskIds.length > 0) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sqliteExpiresAt = expiresAt
      .toISOString()
      .replace("T", " ")
      .split(".")[0];

    // We have to insert one by one or via a batch in D1
    const statements = missingTaskIds.map((id) => {
      const uuid = crypto.randomUUID();
      results[id] = `${baseUrl}${uuid}`;
      return c.env.DB.prepare(
        `
        INSERT INTO task_shares (uuid, task_id, expires_at)
        VALUES (?, ?, ?)
      `,
      ).bind(uuid, id, sqliteExpiresAt);
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
  const sqliteExpiresAt = expiresAt
    .toISOString()
    .replace("T", " ")
    .split(".")[0];

  await c.env.DB.prepare(
    `
    INSERT INTO task_shares (uuid, task_id, expires_at)
    VALUES (?, ?, ?)
  `,
  )
    .bind(uuid, taskId, sqliteExpiresAt)
    .run();

  const requestUrl = new URL(c.req.url);
  let baseUrl;
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith("/")
      ? c.env.BASE_URL.slice(0, -1)
      : c.env.BASE_URL;
    baseUrl = `${base}/share/`;
  } else {
    const host = c.req.header("x-forwarded-host") || requestUrl.host;
    const protocol =
      c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    baseUrl = `${protocol}://${host}/share/`;
  }
  return `${baseUrl}${uuid}`;
}

// GET /share/:uuid - Public route to view a single task
publicShareHandlers.get("/:uuid", async (c) => {
  const uuid = c.req.param("uuid");

  // 1. Validate share and get task_id
  const share = await c.env.DB.prepare(
    `
    SELECT task_id, expires_at FROM task_shares
    WHERE uuid = ? AND expires_at > DATETIME('now')
  `,
  )
    .bind(uuid)
    .first();

  if (!share) {
    return c.html(
      errorPage(
        "链接已失效或不存在",
        "该分享链接可能已超过 24 小时有效期，或已被撤销。",
      ),
      404,
    );
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

  const task: any = await c.env.DB.prepare(taskQuery)
    .bind(share.task_id)
    .first();
  if (!task) {
    return c.html(errorPage("任务不存在", "该任务可能已被删除。"), 404);
  }

  // 3. Render HTML
  const tags = JSON.parse(task.tags || "[]");
  const metadata = task.metadata ? JSON.parse(task.metadata) : null;
  const statusLabel = task.status === "completed" ? "已完成" : "待处理";
  const statusClass =
    task.status === "completed" ? "status-completed" : "status-pending";

  return c.html(html`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${task.title} - 任务详情</title>
        <style>
          :root {
            --bg: #fafafa;
            --surface: #ffffff;
            --text: #171717;
            --text-muted: #737373;
            --border: #e5e5e5;
            --radius: 8px;
          }
          body {
            font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
          }
          .wrapper { max-width: 640px; margin: 40px auto; padding: 0 20px; }
          .card {
            background: var(--surface);
            border-radius: var(--radius);
            box-shadow: 0 4px 24px -8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02);
            border: 1px solid var(--border);
            overflow: hidden;
          }
          .header { padding: 32px 32px 24px; border-bottom: 1px solid var(--border); }
          .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
          .status-completed .status-dot { background: #10b981; }
          .status-pending .status-dot { background: #f59e0b; }
          .status-text { font-size: 13px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; margin-bottom: 16px; }
          h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; color: #0a0a0a; word-break: break-word; }
          
          .content { padding: 32px; }
          .description { font-size: 16px; color: #404040; white-space: pre-wrap; margin-bottom: 32px; line-height: 1.7; word-break: break-word; }
          
          .meta-section { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 32px; padding: 24px; background: #fdfdfd; border-radius: 6px; border: 1px solid #f0f0f0; }
          .meta-item { display: flex; flex-direction: column; gap: 4px; }
          .meta-label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
          .meta-value { font-size: 14px; color: var(--text); font-weight: 500; word-break: break-word; }
          
          .priority-high { color: #dc2626; }
          .priority-medium { color: #d97706; }
          .priority-low { color: #059669; }
          
          .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px; }
          .tag { background: #f4f4f5; color: #52525b; padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 500; border: 1px solid #e4e4e7; transition: all 0.2s; }
          .tag:hover { background: #e4e4e7; }
          
          .context-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 6px; position: relative; }
          .context-box::before { content: "AI Context"; position: absolute; top: -10px; left: 16px; background: #f8fafc; padding: 0 8px; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #e2e8f0; border-radius: 12px; }
          .context-text { font-size: 13px; color: #475569; font-style: italic; margin: 0; line-height: 1.6; word-break: break-word; }
          
          .footer { padding: 20px 32px; background: #fafafa; border-top: 1px solid var(--border); font-size: 12px; color: #a3a3a3; display: flex; justify-content: space-between; align-items: center; }
          .brand { font-weight: 600; color: #d4d4d4; letter-spacing: -0.02em; }
          
          @media (max-width: 640px) {
            .wrapper { margin: 20px auto; }
            .header, .content, .footer { padding: 20px; }
            .meta-section { grid-template-columns: 1fr; padding: 16px; gap: 16px; }
            h1 { font-size: 24px; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="card">
            <div class="header">
              <div class="status-text status-${task.status}">
                <span class="status-dot"></span>
                ${statusLabel}
              </div>
              <h1>${task.title}</h1>
            </div>
            <div class="content">
              ${task.description ? html`<div class="description">${task.description}</div>` : ""}
              
              <div class="meta-section">
                <div class="meta-item">
                  <span class="meta-label">优先级 / Priority</span>
                  <span class="meta-value priority-${task.priority}">${task.priority.toUpperCase()}</span>
                </div>
                ${task.category_name ? html`
                <div class="meta-item">
                  <span class="meta-label">分类 / Category</span>
                  <span class="meta-value" style="color: ${task.category_color || 'inherit'}">${task.category_name}</span>
                </div>` : ""}
                ${task.due_date ? html`
                <div class="meta-item">
                  <span class="meta-label">截止日期 / Due Date</span>
                  <span class="meta-value">${new Date(task.due_date + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                </div>` : ""}
                ${task.remind_at ? html`
                <div class="meta-item">
                  <span class="meta-label">提醒时间 / Reminder</span>
                  <span class="meta-value">${new Date(task.remind_at + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                </div>` : ""}
              </div>

              ${tags.length > 0 ? html`
              <div class="tags">
                ${tags.map((t: any) => html`<span class="tag">#${t.name}</span>`)}
              </div>` : ""}
              
              ${metadata && metadata.context ? html`
              <div class="context-box">
                <p class="context-text">"${metadata.context}"</p>
              </div>` : ""}
            </div>
            <div class="footer">
              <span>过期时间: ${new Date(share.expires_at + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
              <span class="brand">CLAW TASK</span>
            </div>
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
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
        <style>
          :root { --bg: #fafafa; --surface: #ffffff; --text: #171717; --text-muted: #737373; --border: #e5e5e5; }
          body { font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: var(--bg); color: var(--text); height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; -webkit-font-smoothing: antialiased; }
          .card { background: var(--surface); padding: 40px; border-radius: 12px; box-shadow: 0 4px 24px -8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02); border: 1px solid var(--border); text-align: center; max-width: 400px; width: 100%; margin: 20px; }
          h1 { color: #dc2626; margin: 0 0 12px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
          p { color: var(--text-muted); line-height: 1.6; margin: 0 0 24px 0; font-size: 15px; }
          .brand { font-size: 12px; font-weight: 600; color: #d4d4d4; letter-spacing: 0.05em; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${title}</h1>
          <p>${message}</p>
          <div class="brand">CLAW TASK</div>
        </div>
      </body>
    </html>
  `;
}
