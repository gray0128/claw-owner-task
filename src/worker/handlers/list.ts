import { Hono } from "hono";
import { html, raw } from "hono/html";
import { Bindings } from "../index";
import { getAppBaseUrl } from "../utils";
import { errorPageHtml } from "../templates/components";
import { BASE_CSS_VARS, BASE_STYLES, GOOGLE_FONTS_LINK, materialIconsLink } from "../templates/styles";

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
      errorPageHtml(
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
        ${raw(GOOGLE_FONTS_LINK)}
        ${raw(materialIconsLink(['alarm', 'autorenew', 'calendar_today', 'schedule']))}
        <style>
          ${raw(BASE_CSS_VARS)}
          ${raw(BASE_STYLES)}
          .wrapper { max-width: 760px; margin: 0 auto; padding: 0 20px 40px; }

          .page-header {
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            padding: 40px 32px 36px;
            margin-bottom: 28px;
            position: relative;
            overflow: hidden;
          }
          .page-header::before {
            content: '';
            position: absolute;
            top: -40%;
            right: -15%;
            width: 250px;
            height: 250px;
            background: rgba(255,255,255,0.06);
            border-radius: 50%;
          }
          .page-header h1 {
            margin: 0 0 8px 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.03em;
            color: #ffffff;
            word-break: break-word;
            position: relative;
            z-index: 1;
          }
          .header-meta {
            font-size: 13px;
            color: rgba(255,255,255,0.7);
            font-weight: 500;
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .count-badge {
            background: rgba(255,255,255,0.2);
            padding: 2px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            color: #fff;
          }

          .cards-grid {
            display: flex;
            flex-direction: column;
            gap: 12px;
            animation: fadeInUp 0.5s ease-out;
          }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .task-card {
            background: var(--surface);
            border-radius: var(--radius);
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(124,58,237,0.03);
            border: 1px solid var(--border);
            transition: all 0.25s ease;
            cursor: default;
          }
          .task-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(124,58,237,0.08), 0 1px 3px rgba(0,0,0,0.04);
            border-color: var(--primary-light);
          }

          .task-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 10px; }
          .task-title-area { flex: 1; }
          .task-id { font-size: 12px; font-weight: 700; color: var(--primary); margin-right: 6px; }
          .task-title { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); line-height: 1.4; word-break: break-word; display: inline; }
          .task-desc { margin: 8px 0 0 0; font-size: 13px; color: #71717a; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }

          .task-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
          .badge {
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .badge-status-completed { background: #d1fae5; color: #065f46; }
          .badge-status-in_progress { background: #dbeafe; color: #1e40af; }
          .badge-status-pending { background: #fef3c7; color: #92400e; }
          .badge-priority-high { background: #fee2e2; color: #b91c1c; }
          .badge-priority-medium { background: #fef3c7; color: #b45309; }
          .badge-priority-low { background: #d1fae5; color: #047857; }
          .badge-category {
            background: #ede9fe;
            color: var(--primary-dark);
            border: 1px solid #ddd6fe;
          }
          .badge-tag {
            background: #f4f4f5;
            color: #52525b;
            font-weight: 500;
            text-transform: none;
            font-size: 12px;
            border: 1px solid #e4e4e7;
          }

          .task-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-top: 14px;
            padding-top: 12px;
            border-top: 1px solid #f4f4f5;
            font-size: 12px;
            color: var(--text-muted);
          }
          .meta-item { display: flex; align-items: center; gap: 5px; }
          .meta-icon { font-family: 'Material Symbols Outlined'; font-size: 18px; opacity: 0.6; color: var(--primary); font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20; }
          .meta-item strong { font-weight: 600; color: #374151; }

          .empty-state {
            text-align: center;
            color: #a3a3a3;
            padding: 60px 20px;
            font-size: 14px;
            background: var(--surface);
            border-radius: var(--radius);
            border: 1px dashed var(--border);
          }

          .footer {
            text-align: center;
            margin-top: 28px;
            padding: 16px;
            font-size: 12px;
            color: #a1a1aa;
          }
          .footer .expire-text { margin-bottom: 6px; }
          .brand {
            font-weight: 700;
            color: var(--primary-light);
            letter-spacing: 0.12em;
            text-transform: uppercase;
            display: block;
            font-size: 11px;
            opacity: 0.6;
          }

          @media (max-width: 640px) {
            .page-header { padding: 32px 20px 28px; }
            .page-header h1 { font-size: 22px; }
            .task-card { padding: 18px; }
          }
        </style>
      </head>
      <body>
        <div class="page-header">
          <h1>${intent}</h1>
          <div class="header-meta">
            <span class="count-badge">${tasks.length}</span>
            <span>个任务</span>
          </div>
        </div>
        <div class="wrapper">
          ${tasks.length === 0 ? html`<div class="empty-state">暂无任务</div>` : ""}
          <div class="cards-grid">
            ${tasks.map((task: any) => {
              const tags = (task.tags && typeof task.tags === 'string' && task.tags.startsWith('[')) 
                            ? JSON.parse(task.tags) 
                            : (Array.isArray(task.tags) ? task.tags : []);
              const statusLabel = task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : '待处理';

              return html`
                <div class="task-card">
                  <div class="task-top">
                    <div class="task-title-area">
                      <span class="task-id">#${task.id}</span>
                      <h2 class="task-title">${task.title}</h2>
                      ${task.description ? html`<div class="task-desc">${task.description}</div>` : ""}
                    </div>
                  </div>
                  
                  <div class="task-badges">
                    <span class="badge badge-status-${task.status}">${statusLabel}</span>
                    ${task.priority ? html`<span class="badge badge-priority-${task.priority}">${task.priority}</span>` : ""}
                    ${task.category_name ? html`<span class="badge badge-category">${task.category_name}</span>` : ""}
                    ${task.recurring_rule && task.recurring_rule !== 'none' ? html`<span class="badge" style="background: #ede9fe; color: #5b21b6;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:2px;">autorenew</span>${task.recurring_rule === 'daily' ? '每天' : task.recurring_rule === 'weekly' ? '每周' : task.recurring_rule === 'monthly' ? '每月' : task.recurring_rule}</span>` : ""}
                    ${tags.map((t: any) => html`<span class="badge badge-tag">#${t.name || t}</span>`)}
                  </div>
                  
                  <div class="task-meta">
                    ${task.created_at ? html`<div class="meta-item"><span class="meta-icon">schedule</span><span>创建:</span> <strong>${new Date(task.created_at + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                    ${task.due_date ? html`<div class="meta-item"><span class="meta-icon">calendar_today</span><span>截止:</span> <strong>${new Date(task.due_date + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                    ${task.remind_at ? html`<div class="meta-item"><span class="meta-icon">alarm</span><span>提醒:</span> <strong>${new Date(task.remind_at + "Z").toLocaleString("zh-CN", { hour12: false })}</strong></div>` : ""}
                  </div>
                </div>
              `;
            })}
          </div>
          
          <div class="footer">
            <div class="expire-text">此临时链接将于 ${expiresAtStr} 过期</div>
            <span class="brand">Claw Task</span>
          </div>
        </div>
      </body>
    </html>
  `);
});

