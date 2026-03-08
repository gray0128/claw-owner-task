import { Hono } from "hono";
import { html, raw } from "hono/html";
import { Bindings } from "../index";
import { getAppBaseUrl } from "../utils";
import { errorPageHtml } from "../templates/components";
import { BASE_CSS_VARS, BASE_STYLES, GOOGLE_FONTS_LINK, materialIconsLink } from "../templates/styles";

export const publicShareHandlers = new Hono<{ Bindings: Bindings }>();
// Helper: Get or create share URLs for a list of tasks
export async function getOrCreateShareUrls(
  c: any,
  taskIds: number[],
): Promise<Record<number, string>> {
  if (taskIds.length === 0) return {};

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const baseUrl = `${getAppBaseUrl(c)}/share/`;

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

  const baseUrl = `${getAppBaseUrl(c)}/share/`;
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
      errorPageHtml(
        "链接已失效或不存在",
        "该分享链接可能已超过 24 小时有效期，或已被撤销。"
      ),
      404
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
    return c.html(errorPageHtml("任务不存在", "该任务可能已被删除。"), 404);
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
        ${raw(GOOGLE_FONTS_LINK)}
        ${raw(materialIconsLink(['alarm', 'autorenew', 'bolt', 'calendar_today', 'folder', 'schedule', 'tag']))}
        <style>
          ${raw(BASE_CSS_VARS)}
          ${raw(BASE_STYLES)}
          .wrapper { max-width: 680px; margin: 40px auto; padding: 0 20px; animation: fadeInUp 0.5s ease-out; }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .card {
            background: var(--surface);
            border-radius: var(--radius);
            box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(124,58,237,0.06);
            border: 1px solid var(--border);
            overflow: hidden;
            transition: box-shadow 0.3s ease;
          }
          .card:hover {
            box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 12px 40px rgba(124,58,237,0.1);
          }

          .card-accent {
            height: 5px;
            background: linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%);
          }

          .header { padding: 28px 32px 24px; }
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 16px;
          }
          .status-badge .dot { width: 7px; height: 7px; border-radius: 50%; }
          .status-completed .dot { background: var(--green); }
          .status-completed { background: #d1fae5; color: #065f46; }
          .status-pending .dot { background: var(--amber); }
          .status-pending { background: #fef3c7; color: #92400e; }
          .status-in_progress .dot { background: #3b82f6; }
          .status-in_progress { background: #dbeafe; color: #1e40af; }

          h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 800;
            letter-spacing: -0.03em;
            line-height: 1.3;
            color: var(--text);
            word-break: break-word;
          }

          .content { padding: 0 32px 32px; }
          .description {
            font-size: 15px;
            color: #4b5563;
            white-space: pre-wrap;
            margin-bottom: 28px;
            line-height: 1.7;
            word-break: break-word;
            padding: 16px 20px;
            background: #fafafa;
            border-radius: 10px;
            border: 1px solid #f0f0f0;
          }

          .meta-section {
            margin-bottom: 24px;
            background: #fafafa;
            border-radius: 12px;
            border: 1px solid #f0f0f0;
            overflow: hidden;
          }
          .meta-row {
            display: flex;
            align-items: center;
            padding: 14px 20px;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.15s ease;
          }
          .meta-row:last-child { border-bottom: none; }
          .meta-row:hover { background: #f5f5f5; }
          .meta-icon { font-family: 'Material Symbols Outlined'; font-size: 20px; width: 28px; flex-shrink: 0; opacity: 0.6; color: var(--primary); font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20; }
          .meta-label {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-muted);
            width: 100px;
            flex-shrink: 0;
          }
          .meta-value {
            font-size: 14px;
            color: var(--text);
            font-weight: 600;
            word-break: break-word;
          }

          .priority-pill {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .priority-high { background: #fee2e2; color: #b91c1c; }
          .priority-medium { background: #fef3c7; color: #b45309; }
          .priority-low { background: #d1fae5; color: #047857; }

          .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
          .tag {
            background: #ede9fe;
            color: var(--primary-dark);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            border: 1px solid #ddd6fe;
            transition: all 0.2s;
          }
          .tag:hover { background: #ddd6fe; }

          .context-box {
            background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
            border: 1px solid #ddd6fe;
            padding: 24px 24px 24px 44px;
            border-radius: 12px;
            position: relative;
            overflow: hidden;
          }
          .context-box::before {
            content: 'AI Context';
            position: absolute;
            top: 10px;
            left: 12px;
            font-size: 10px;
            font-weight: 700;
            color: var(--primary-light);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            writing-mode: vertical-rl;
            text-orientation: mixed;
          }
          .context-text {
            font-size: 13px;
            color: #3b0764;
            font-style: italic;
            margin: 0;
            line-height: 1.7;
            word-break: break-word;
          }

          .footer {
            padding: 16px 32px;
            background: #fafafa;
            border-top: 1px solid var(--border);
            font-size: 12px;
            color: #a1a1aa;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .brand {
            font-weight: 700;
            color: var(--primary-light);
            letter-spacing: 0.1em;
            text-transform: uppercase;
            font-size: 11px;
            opacity: 0.6;
          }

          @media (max-width: 640px) {
            .wrapper { margin: 20px auto; }
            .header, .footer { padding-left: 20px; padding-right: 20px; }
            .content { padding: 0 20px 24px; }
            .meta-label { width: 80px; }
            h1 { font-size: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="card">
            <div class="card-accent"></div>
            <div class="header">
              <div class="status-badge status-${task.status}">
                <span class="dot"></span>
                ${statusLabel}
              </div>
              <h1>${task.title}</h1>
            </div>
            <div class="content">
              ${task.description ? html`<div class="description">${task.description}</div>` : ""}
              
              <div class="meta-section">
                <div class="meta-row">
                  <span class="meta-icon">tag</span>
                  <span class="meta-label">任务 ID</span>
                  <span class="meta-value">#${task.id}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-icon">schedule</span>
                  <span class="meta-label">创建时间</span>
                  <span class="meta-value">${new Date(task.created_at + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-icon">bolt</span>
                  <span class="meta-label">优先级</span>
                  <span class="meta-value"><span class="priority-pill priority-${task.priority}">${task.priority.toUpperCase()}</span></span>
                </div>
                ${task.category_name ? html`
                <div class="meta-row">
                  <span class="meta-icon">folder</span>
                  <span class="meta-label">分类</span>
                  <span class="meta-value" style="color: ${task.category_color || 'inherit'}">${task.category_name}</span>
                </div>` : ""}
                ${task.due_date ? html`
                <div class="meta-row">
                  <span class="meta-icon">calendar_today</span>
                  <span class="meta-label">截止日期</span>
                  <span class="meta-value">${new Date(task.due_date + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                </div>` : ""}
                ${task.remind_at ? html`
                <div class="meta-row">
                  <span class="meta-icon">alarm</span>
                  <span class="meta-label">提醒时间</span>
                  <span class="meta-value">${new Date(task.remind_at + "Z").toLocaleString("zh-CN", { hour12: false })}</span>
                </div>` : ""}
                ${task.recurring_rule && task.recurring_rule !== 'none' ? html`
                <div class="meta-row">
                  <span class="meta-icon">autorenew</span>
                  <span class="meta-label">重复规则</span>
                  <span class="meta-value"><span class="priority-pill" style="background: #ede9fe; color: #5b21b6;">${task.recurring_rule === 'daily' ? '每天' : task.recurring_rule === 'weekly' ? '每周' : task.recurring_rule === 'monthly' ? '每月' : task.recurring_rule}</span></span>
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
              <span class="brand">Claw Task</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

