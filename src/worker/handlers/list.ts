import { Hono } from "hono";
import { html } from "hono/html";
import { Bindings } from "../index";

export const publicListHandlers = new Hono<{ Bindings: Bindings }>();

// Helper: Generate a unique list URL for multiple tasks
export async function createListUrl(
  c: any,
  tasks: any[],
  intent: string = "任务列表"
): Promise<string> {
  const uuid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const sqliteExpiresAt = expiresAt
    .toISOString()
    .replace("T", " ")
    .split(".")[0];

  const tasksJson = JSON.stringify(tasks);

  await c.env.DB.prepare(
    `
    INSERT INTO task_lists (uuid, tasks_json, intent, expires_at)
    VALUES (?, ?, ?, ?)
  `
  )
    .bind(uuid, tasksJson, intent, sqliteExpiresAt)
    .run();

  const requestUrl = new URL(c.req.url);
  let baseUrl;
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith("/")
      ? c.env.BASE_URL.slice(0, -1)
      : c.env.BASE_URL;
    baseUrl = `${base}/list/`;
  } else {
    const host = c.req.header("x-forwarded-host") || requestUrl.host;
    const protocol =
      c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    baseUrl = `${protocol}://${host}/list/`;
  }
  return `${baseUrl}${uuid}`;
}

// GET /list/:uuid - Public route to view a multiple tasks list
publicListHandlers.get("/:uuid", async (c) => {
  const uuid = c.req.param("uuid");

  // 1. Validate list share
  const listShare = await c.env.DB.prepare(
    `
    SELECT tasks_json, intent, expires_at FROM task_lists
    WHERE uuid = ? AND expires_at > DATETIME('now')
  `
  )
    .bind(uuid)
    .first();

  if (!listShare) {
    return c.html(
      errorPage(
        "该任务列表已过期，请重新发起查询",
        "该链接可能已超过 24 小时有效期，或不存在。"
      ),
      404
    );
  }

  // 2. Render HTML
  const tasks = JSON.parse(listShare.tasks_json as string || "[]");
  const intent = listShare.intent || "任务列表";
  const expiresAtStr = new Date((listShare.expires_at as string) + "Z").toLocaleString("zh-CN", {
    hour12: false,
  });

  return c.html(html`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${intent} - 多任务列表</title>
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
            max-width: 800px;
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
          h1 {
            margin: 0 0 8px 0;
            font-size: 24px;
            color: #0f172a;
            line-height: 1.3;
          }
          .header-meta {
            font-size: 14px;
            color: var(--text-muted);
          }
          .content {
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .task-card {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            background: #ffffff;
            transition: box-shadow 0.2s;
          }
          .task-card:hover {
            box-shadow: 0 2px 4px -1px rgba(0,0,0,0.05);
          }
          .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            gap: 12px;
          }
          .task-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
            color: #0f172a;
          }
          .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            text-transform: uppercase;
          }
          .status-completed {
            background: #d1fae5;
            color: #065f46;
          }
          .status-pending {
            background: #fef3c7;
            color: #92400e;
          }
          .description {
            font-size: 14px;
            color: #334155;
            white-space: pre-wrap;
            margin-bottom: 16px;
            background: #f8fafc;
            padding: 12px;
            border-radius: 6px;
            border-left: 3px solid var(--primary-color);
            max-height: 150px;
            overflow-y: auto;
          }
          .meta-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 16px;
          }
          .meta-item {
            display: flex;
            align-items: center;
            font-size: 13px;
            color: var(--text-muted);
          }
          .meta-item strong {
            margin-right: 4px;
            font-weight: 500;
            color: #475569;
          }
          .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }
          .tag {
            background: #eff6ff;
            color: #1e40af;
            padding: 2px 8px;
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
            .content { padding: 16px; }
            .task-header { flex-direction: column; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${intent}</h1>
            <div class="header-meta">
              共 ${tasks.length} 个任务
            </div>
          </div>
          <div class="content">
            ${tasks.length === 0 ? html`<div style="text-align:center; color: #64748b; padding: 20px;">暂无任务</div>` : ""}
            ${tasks.map((task: any) => {
              const statusLabel = task.status === "completed" ? "已完成" : "待处理";
              const statusClass = task.status === "completed" ? "status-completed" : "status-pending";
              const tags = (task.tags && typeof task.tags === 'string' && task.tags.startsWith('[')) 
                            ? JSON.parse(task.tags) 
                            : (Array.isArray(task.tags) ? task.tags : []);

              return html`
                <div class="task-card">
                  <div class="task-header">
                    <h2 class="task-title">${task.title}</h2>
                    <span class="status-badge ${statusClass}">${statusLabel}</span>
                  </div>
                  
                  ${task.description ? html`<div class="description">${task.description}</div>` : ""}
                  
                  <div class="meta-grid">
                    ${task.priority ? html`
                      <div class="meta-item">
                        <strong>优先级:</strong>
                        <span class="priority-${task.priority}">${task.priority.toUpperCase()}</span>
                      </div>
                    ` : ""}
                    ${task.category_name ? html`
                      <div class="meta-item">
                        <strong>分类:</strong>
                        <span style="color: ${task.category_color || 'inherit'}">${task.category_name}</span>
                      </div>
                    ` : ""}
                    ${task.due_date ? html`
                      <div class="meta-item">
                        <strong>截止:</strong>
                        <span>${new Date(task.due_date + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                      </div>
                    ` : ""}
                    ${task.remind_at ? html`
                      <div class="meta-item">
                        <strong>提醒:</strong>
                        <span>${new Date(task.remind_at + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                      </div>
                    ` : ""}
                  </div>

                  ${tags.length > 0 ? html`
                    <div class="tags">
                      ${tags.map((t: any) => html`<span class="tag">#${t.name || t}</span>`)}
                    </div>
                  ` : ""}
                </div>
              `;
            })}
          </div>
          <div class="footer">
            此链接为临时分享链接，将于 ${expiresAtStr} 过期。<br />
            Powered by claw-owner-task
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
          body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
          h1 { color: #ef4444; margin-top: 0; font-size: 20px; }
          p { color: #64748b; line-height: 1.5; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${title}</h1>
          <p>${message}</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 1.5rem 0;" />
          <div style="font-size: 0.875rem; color: #94a3b8;">claw-owner-task</div>
        </div>
      </body>
    </html>
  `;
}
