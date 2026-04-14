import { Hono } from 'hono';
import { Bindings } from '../index';
import { escapeTelegramHTML } from '../services/telegram';
import { sendToAllChannels } from '../services/notify';
import { apiResponse as response, extractAIContent, getAppBaseUrl } from '../utils';
import { errorPageHtml } from '../templates/components';
import { BASE_CSS_VARS, BASE_STYLES, GOOGLE_FONTS_LINK, materialIconsLink } from '../templates/styles';

export const authSummaryHandlers = new Hono<{ Bindings: Bindings }>();
export const publicSummaryHandlers = new Hono<{ Bindings: Bindings }>();

// GET /summary/:uuid - Public route to view summary
publicSummaryHandlers.get('/:uuid', async (c) => {
  const uuid = c.req.param('uuid');
  
  const query = `
    SELECT summary_json, expires_at 
    FROM task_summaries 
    WHERE uuid = ?
  `;
  const result = await c.env.DB.prepare(query).bind(uuid).first();
  
  if (!result) {
    return c.html(errorPageHtml("页面不存在或已失效", "请重新发起总结"), 404);
  }
  
  const expiresAt = new Date(result.expires_at as string + 'Z');
  const now = new Date();
  
  if (now > expiresAt) {
    return c.html(errorPageHtml("页面已过期", "请重新发起总结"), 403);
  }

  let summaryData;
  try {
    summaryData = JSON.parse(result.summary_json as string);
  } catch (e) {
    return c.html(`<h1>数据解析失败</h1>`, 500);
  }

  // Generate HTML
  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI 任务总结</title>
      ${GOOGLE_FONTS_LINK}
      ${materialIconsLink(['autorenew', 'folder', 'warning'])}
      <style>
        ${BASE_CSS_VARS}
        ${BASE_STYLES}
        .wrapper { max-width: 760px; margin: 0 auto; padding: 0 20px 40px; }

        .page-header {
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
          padding: 48px 32px 40px;
          text-align: center;
          margin-bottom: 32px;
          position: relative;
          overflow: hidden;
        }
        .page-header::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -20%;
          width: 300px;
          height: 300px;
          background: rgba(255,255,255,0.06);
          border-radius: 50%;
        }
        .page-header::after {
          content: '';
          position: absolute;
          bottom: -30%;
          left: -10%;
          width: 200px;
          height: 200px;
          background: rgba(255,255,255,0.04);
          border-radius: 50%;
        }
        .page-header h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.03em;
          margin: 0 0 8px 0;
          color: #ffffff;
          word-break: break-word;
          position: relative;
          z-index: 1;
        }
        .page-header .meta {
          font-size: 13px;
          color: rgba(255,255,255,0.7);
          font-weight: 500;
          position: relative;
          z-index: 1;
        }

        .grid { display: grid; gap: 20px; margin-bottom: 32px; animation: fadeInUp 0.5s ease-out; }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .card {
          background: var(--surface);
          border-radius: var(--radius);
          padding: 28px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(124,58,237,0.04);
          border: 1px solid var(--border);
          transition: box-shadow 0.25s ease, transform 0.25s ease;
        }
        .card:hover {
          box-shadow: 0 4px 24px rgba(124,58,237,0.08), 0 1px 3px rgba(0,0,0,0.04);
        }
        .card-title {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--primary);
          margin: 0 0 20px 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .card-title::before {
          content: '';
          width: 3px;
          height: 14px;
          background: var(--primary);
          border-radius: 2px;
        }

        .stats-container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .stat-box {
          background: linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%);
          padding: 20px 16px;
          border-radius: 12px;
          text-align: center;
          border: 1px solid #e5e7eb;
          position: relative;
          overflow: hidden;
          transition: transform 0.2s ease;
        }
        .stat-box:hover { transform: translateY(-2px); }
        .stat-box::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          border-radius: 0 0 12px 12px;
        }
        .stat-box:nth-child(1)::after { background: var(--amber); }
        .stat-box:nth-child(2)::after { background: var(--blue); }
        .stat-box:nth-child(3)::after { background: var(--red); }
        .stat-num {
          font-size: 36px;
          font-weight: 800;
          letter-spacing: -0.04em;
          color: var(--text);
          line-height: 1;
          margin-bottom: 6px;
        }
        .stat-label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

        .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
        .task-item {
          background: #fafafa;
          border: 1px solid #f0f0f0;
          border-radius: 10px;
          padding: 16px 20px;
          border-left: 4px solid var(--primary);
          transition: all 0.2s ease;
          cursor: default;
        }
        .task-item:hover {
          transform: translateX(4px);
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          border-left-color: var(--primary-dark);
        }
        .task-item.warning {
          border-left-color: var(--red);
          background: #fef2f2;
          border-color: #fecaca;
        }
        .task-item.warning:hover { border-left-color: #dc2626; }
        .task-title-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
        .task-id { font-size: 13px; font-weight: 700; color: var(--primary); }
        .task-name { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.4; word-break: break-word; }
        .task-time { font-size: 11px; color: #a1a1aa; font-weight: 500; background: #f4f4f5; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
        .task-desc { font-size: 13px; color: #71717a; line-height: 1.6; margin: 6px 0 0 0; word-break: break-word; }

        .assessment-box {
          background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
          border: 1px solid #ddd6fe;
          border-radius: 12px;
          padding: 28px 28px 28px 48px;
          position: relative;
          overflow: hidden;
        }
        .assessment-box::before {
          content: '\\201C';
          font-size: 72px;
          color: var(--primary-light);
          position: absolute;
          top: 4px;
          left: 14px;
          font-family: Georgia, serif;
          line-height: 1;
          opacity: 0.5;
        }
        .assessment-text {
          font-size: 15px;
          line-height: 1.8;
          color: #3b0764;
          font-style: italic;
          margin: 0;
          position: relative;
          z-index: 1;
          word-break: break-word;
        }

        .footer {
          text-align: center;
          padding: 24px 20px;
          font-size: 11px;
          font-weight: 700;
          color: var(--primary-light);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.6;
        }

        @media (max-width: 640px) {
          .page-header { padding: 36px 20px 32px; }
          .page-header h1 { font-size: 22px; }
          .card { padding: 20px; }
          .stats-container { grid-template-columns: 1fr; }
          .stat-num { font-size: 28px; }
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <h1>${summaryData.title || 'AI 任务总结'}</h1>
        <div class="meta">有效至: ${new Date(expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
      </div>
      <div class="wrapper">
        <div class="grid">
          <div class="card">
            <h2 class="card-title">概览 Overview</h2>
            <div class="stats-container">
              <div class="stat-box"><div class="stat-num">${summaryData.stats?.total_pending || 0}</div><div class="stat-label">待处理</div></div>
              <div class="stat-box"><div class="stat-num">${summaryData.stats?.in_progress || 0}</div><div class="stat-label">处理中</div></div>
              <div class="stat-box"><div class="stat-num" style="color: ${summaryData.stats?.overdue > 0 ? 'var(--red)' : 'inherit'}">${summaryData.stats?.overdue || 0}</div><div class="stat-label">已延期</div></div>
            </div>
          </div>
          
          ${summaryData.core_tasks && summaryData.core_tasks.length > 0 ? `
          <div class="card">
            <h2 class="card-title">核心必做 Core Tasks</h2>
            <ul class="task-list">
              ${summaryData.core_tasks.map((t: any) => `
                <li class="task-item">
                  <div class="task-title-row">
                    <span class="task-id">#${t.id}</span>
                    <span class="task-name">${t.title}</span>
                    ${t.category ? `<span class="task-time" style="background: #e0e7ff; color: #3730a3;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:2px;">folder</span>${t.category}</span>` : ''}
                    ${t.recurring_rule && t.recurring_rule !== 'none' ? `<span class="task-time" style="background: #ede9fe; color: #5b21b6;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:2px;">autorenew</span>${t.recurring_rule === 'daily' ? '每天' : t.recurring_rule === 'weekly' ? '每周' : t.recurring_rule === 'monthly' ? '每月' : t.recurring_rule}</span>` : ''}
                    ${t.created_at ? `<span class="task-time">${new Date(t.created_at + "Z").toLocaleString('zh-CN', { hour12: false })}</span>` : ''}
                  </div>
                  ${t.reason ? `<p class="task-desc">${t.reason}</p>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>` : ''}

          ${summaryData.warnings && summaryData.warnings.length > 0 ? `
          <div class="card">
            <h2 class="card-title"><span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:4px;color:var(--red);">warning</span>风险警告 Warnings</h2>
            <ul class="task-list">
              ${summaryData.warnings.map((w: any) => `
                <li class="task-item warning">
                  <div class="task-title-row">
                    <span class="task-id" style="color: var(--red);">#${w.id}</span>
                    <span class="task-name">${w.title}</span>
                    ${w.category ? `<span class="task-time" style="background: #e0e7ff; color: #3730a3;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:2px;">folder</span>${w.category}</span>` : ''}
                    ${w.recurring_rule && w.recurring_rule !== 'none' ? `<span class="task-time" style="background: #ede9fe; color: #5b21b6;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:2px;">autorenew</span>${w.recurring_rule === 'daily' ? '每天' : w.recurring_rule === 'weekly' ? '每周' : w.recurring_rule === 'monthly' ? '每月' : w.recurring_rule}</span>` : ''}
                    ${w.created_at ? `<span class="task-time">${new Date(w.created_at + "Z").toLocaleString('zh-CN', { hour12: false })}</span>` : ''}
                  </div>
                  <p class="task-desc">${w.suggestion}</p>
                </li>
              `).join('')}
            </ul>
          </div>` : ''}

          <div class="card">
            <h2 class="card-title">综合评估 Assessment</h2>
            <div class="assessment-box">
              <p class="assessment-text">${summaryData.overall_assessment || '暂无建议'}</p>
            </div>
          </div>
        </div>
        
        <div class="footer">Claw Task</div>
      </div>
    </body>
    </html>
  `;
  return c.html(html);
});

// POST /api/summary - Generate summary
authSummaryHandlers.post('/', async (c) => {
  if (c.env.ENABLE_AI === 'false' || c.env.ENABLE_AI === false) {
    return c.json(response(false, null, { code: 'AI_DISABLED', message: 'AI processing is disabled.' }), 403);
  }

  // Fetch pending and in_progress tasks
  const query = `
    SELECT t.id, t.title, t.description, t.priority, t.due_date, t.remind_at, t.recurring_rule, t.status, t.created_at, c.name as category_name,
    (
      SELECT json_group_array(tg.name)
      FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id
      WHERE tt.task_id = t.id
    ) as tags
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.status IN ('pending', 'in_progress')
  `;
  const { results: tasks } = await c.env.DB.prepare(query).all();

  if (!tasks || tasks.length === 0) {
    return c.json(response(false, null, { code: 'NO_TASKS', message: '没有待处理或处理中的任务需要总结。' }), 400);
  }

  const tasksJson = JSON.stringify(tasks.map(t => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    due_date: t.due_date,
    recurring_rule: t.recurring_rule,
    created_at: t.created_at,
    status: t.status,
    category: t.category_name,
    tags: t.tags ? JSON.parse(t.tags as string) : []
  })));

  const systemPrompt = `
你是一个高效的时间管理专家和AI助理。请根据用户提供的【当前未完成任务列表】，进行高维度的梳理与总结。
请严格输出为以下的 JSON 格式，不要包含任何 Markdown 代码块包裹（如 \`\`\`json ），直接输出纯 JSON 字符串：

{
  "title": "任务状态周/日度总结",
  "stats": {
    "total_pending": 10,
    "in_progress": 2,
    "overdue": 1
  },
  "core_tasks": [
    { "id": 123, "title": "任务名称", "created_at": "YYYY-MM-DD HH:mm:ss", "recurring_rule": "none", "category": "分类名称", "reason": "为什么这是核心必做" }
  ],
  "warnings": [
    { "id": 124, "title": "拖延/风险任务名称", "created_at": "YYYY-MM-DD HH:mm:ss", "recurring_rule": "none", "category": "分类名称", "suggestion": "改善建议" }
  ],
  "overall_assessment": "对当前任务负载的总体评价和行动建议（约 50-100 字）。"
}

请确保 JSON 格式合法。当前时间（UTC）：${new Date().toISOString()}。
  `;

  let aiResponse: any;
  try {
    const model = c.env.AI_MODEL || '@cf/zai-org/glm-4.7-flash';
    aiResponse = await c.env.AI.run(model, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: tasksJson }
      ]
    });
  } catch (error: any) {
    return c.json(response(false, null, { code: 'AI_API_ERROR', message: error.message }), 500);
  }

  let rawContent = extractAIContent(aiResponse);

  rawContent = rawContent.replace(/^[\s\S]*?\`\`\`(?:json)?/i, '').replace(/\`\`\`[\s\S]*$/i, '').trim();

  let summaryObj;
  try {
    summaryObj = JSON.parse(rawContent);
  } catch (e) {
    return c.json(response(false, null, { code: 'PARSE_ERROR', message: 'Failed to parse AI output as JSON', debug: rawContent }), 500);
  }

  const uuid = crypto.randomUUID();

  // Insert to DB
  await c.env.DB.prepare(`
    INSERT INTO task_summaries (uuid, summary_json, expires_at)
    VALUES (?, ?, datetime('now', '+24 hours'))
  `).bind(uuid, JSON.stringify(summaryObj)).run();

  const summaryUrl = `${getAppBaseUrl(c)}/summary/${uuid}`;
  
  const source = c.req.query('source');
  await sendToAllChannels(c.env, {
    title: 'AI 任务总结',
    plainText: `📊 AI 任务总结已生成\n\n点击查看详细总结网页：\n${summaryUrl}`,
    htmlText: `<b>📊 AI 任务总结已生成</b>\n\n<a href="${escapeTelegramHTML(summaryUrl)}">点击查看详细总结网页</a>`,
    linkUrl: summaryUrl,
  }, source || undefined);

  return c.json(response(true, {
    uuid,
    url: summaryUrl,
    summary: summaryObj,
  }));
});
