import { Hono } from "hono";
import { html } from "hono/html";
import { Bindings } from "../index";
import { getAppBaseUrl } from "../utils";

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

  const baseUrl = `${getAppBaseUrl(c)}/list/`;
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
          .wrapper { max-width: 720px; margin: 40px auto; padding: 0 20px; }
          .header { margin-bottom: 32px; padding: 0 12px; }
          h1 { margin: 0 0 8px 0; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; color: #0a0a0a; }
          .header-meta { font-size: 14px; color: var(--text-muted); font-weight: 500; }
          
          .list-container { background: var(--surface); border-radius: var(--radius); box-shadow: 0 4px 24px -8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02); border: 1px solid var(--border); overflow: hidden; }
          .task-row { padding: 24px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; transition: background-color 0.2s; }
          .task-row:last-child { border-bottom: none; }
          .task-row:hover { background-color: #fdfdfd; }
          
          .task-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
          .task-title-wrap { display: flex; align-items: flex-start; gap: 12px; flex: 1; }
          
          .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 8px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); }
          .status-completed .status-dot { background: #10b981; }
          .status-pending .status-dot { background: #f59e0b; }
          
          .task-title { margin: 0; font-size: 18px; font-weight: 600; color: #171717; line-height: 1.4; word-break: break-word; }
          .task-desc { margin: 8px 0 0 0; font-size: 14px; color: #52525b; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
          
          .task-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
          .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
          .badge-priority-high { background: #fee2e2; color: #b91c1c; }
          .badge-priority-medium { background: #fef3c7; color: #b45309; }
          .badge-priority-low { background: #d1fae5; color: #047857; }
          .badge-category { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
          .badge-tag { color: #71717a; font-weight: 500; text-transform: none; padding: 2px 0; font-size: 13px; }
          
          .task-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; font-size: 13px; color: var(--text-muted); }
          .meta-item { display: flex; align-items: center; gap: 4px; }
          
          .footer { text-align: center; margin-top: 32px; padding: 20px; font-size: 13px; color: #a3a3a3; }
          .brand { font-weight: 600; color: #d4d4d4; letter-spacing: 0.05em; display: block; margin-top: 8px; }
          
          @media (max-width: 640px) {
            .wrapper { margin: 20px auto; }
            .task-row { padding: 16px; }
            h1 { font-size: 26px; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="header">
            <h1>${intent}</h1>
            <div class="header-meta">共 ${tasks.length} 个任务</div>
          </div>
          
          <div class="list-container">
            ${tasks.length === 0 ? html`<div style="text-align:center; color: #a3a3a3; padding: 40px;">暂无任务</div>` : ""}
            ${tasks.map((task: any) => {
              const tags = (task.tags && typeof task.tags === 'string' && task.tags.startsWith('[')) 
                            ? JSON.parse(task.tags) 
                            : (Array.isArray(task.tags) ? task.tags : []);

              return html`
                <div class="task-row">
                  <div class="task-top">
                    <div class="task-title-wrap status-${task.status}">
                      <span class="status-dot" title="${task.status === 'completed' ? '已完成' : '待处理'}"></span>
                      <div>
                        <h2 class="task-title">#${task.id} ${task.title}</h2>
                        ${task.description ? html`<div class="task-desc">${task.description}</div>` : ""}
                        
                        <div class="task-badges">
                          ${task.priority ? html`<span class="badge badge-priority-${task.priority}">${task.priority}</span>` : ""}
                          ${task.category_name ? html`<span class="badge badge-category" style="color: ${task.category_color || 'inherit'}">${task.category_name}</span>` : ""}
                          ${tags.map((t: any) => html`<span class="badge-tag">#${t.name || t}</span>`)}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div class="task-meta">
                    ${task.created_at ? html`<div class="meta-item"><span>创建:</span> <strong>${new Date(task.created_at + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                    ${task.due_date ? html`<div class="meta-item"><span>截止:</span> <strong>${new Date(task.due_date + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                    ${task.remind_at ? html`<div class="meta-item"><span>提醒:</span> <strong>${new Date(task.remind_at + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                  </div>
                </div>
              `;
            })}
          </div>
          
          <div class="footer">
            此临时链接将于 ${expiresAtStr} 过期。<br />
            <span class="brand">CLAW TASK</span>
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
