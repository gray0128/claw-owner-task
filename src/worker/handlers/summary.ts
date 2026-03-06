import { Hono } from 'hono';
import { Bindings } from '../index';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';

// Helper to format response
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

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
    return c.html(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>页面不存在</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f9fafb; color: #333; }
          .container { text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          h1 { color: #ef4444; font-size: 1.5rem; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>页面不存在或已失效</h1>
          <p>请重新发起总结</p>
        </div>
      </body>
      </html>
    `, 404);
  }
  
  const expiresAt = new Date(result.expires_at as string + 'Z');
  const now = new Date();
  
  if (now > expiresAt) {
    return c.html(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>总结已过期</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f9fafb; color: #333; }
          .container { text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          h1 { color: #ef4444; font-size: 1.5rem; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>页面已过期</h1>
          <p>请重新发起总结</p>
        </div>
      </body>
      </html>
    `, 403);
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
      <style>
        :root {
          --primary: #3b82f6;
          --bg: #f3f4f6;
          --surface: #ffffff;
          --text-main: #1f2937;
          --text-muted: #6b7280;
          --border: #e5e7eb;
        }
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background-color: var(--bg); color: var(--text-main); margin: 0; padding: 0; line-height: 1.6; }
        .max-w { max-width: 800px; margin: 0 auto; padding: 20px; }
        header { background: var(--surface); padding: 30px 20px; text-align: center; border-bottom: 1px solid var(--border); margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        h1 { margin: 0 0 10px; font-size: 1.8rem; }
        .meta { color: var(--text-muted); font-size: 0.9rem; }
        .card { background: var(--surface); border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card h2 { margin-top: 0; font-size: 1.25rem; border-bottom: 2px solid var(--bg); padding-bottom: 10px; margin-bottom: 15px; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-box { background: var(--bg); padding: 15px; border-radius: 8px; text-align: center; }
        .stat-num { font-size: 1.8rem; font-weight: bold; color: var(--primary); }
        .stat-label { font-size: 0.85rem; color: var(--text-muted); margin-top: 5px; }
        ul { list-style-type: none; padding-left: 0; margin: 0; }
        li { padding: 10px 0; border-bottom: 1px solid var(--bg); }
        li:last-child { border-bottom: none; }
        .task-title { font-weight: 500; }
        .task-desc { font-size: 0.9rem; color: var(--text-muted); margin-top: 4px; }
        .assessment { font-size: 1.05rem; line-height: 1.7; background: #eff6ff; color: #1e3a8a; padding: 15px; border-radius: 8px; border-left: 4px solid var(--primary); }
      </style>
    </head>
    <body>
      <header>
        <h1>${summaryData.title || 'AI 任务总结'}</h1>
        <div class="meta">有效至: ${new Date(expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
      </header>
      <div class="max-w">
        <div class="card">
          <h2>📊 任务概览</h2>
          <div class="stat-grid">
            <div class="stat-box"><div class="stat-num">${summaryData.stats?.total_pending || 0}</div><div class="stat-label">待处理</div></div>
            <div class="stat-box"><div class="stat-num">${summaryData.stats?.in_progress || 0}</div><div class="stat-label">处理中</div></div>
            <div class="stat-box"><div class="stat-num">${summaryData.stats?.overdue || 0}</div><div class="stat-label">已延期</div></div>
          </div>
        </div>
        
        ${summaryData.core_tasks && summaryData.core_tasks.length > 0 ? `
        <div class="card">
          <h2>🎯 今日核心必做</h2>
          <ul>
            ${summaryData.core_tasks.map((t: any) => `
              <li>
                <div class="task-title">🔥 ${t.title}</div>
                ${t.reason ? `<div class="task-desc">${t.reason}</div>` : ''}
              </li>
            `).join('')}
          </ul>
        </div>` : ''}

        ${summaryData.warnings && summaryData.warnings.length > 0 ? `
        <div class="card">
          <h2>⚠️ 风险与拖延警告</h2>
          <ul>
            ${summaryData.warnings.map((w: any) => `
              <li>
                <div class="task-title">❗ ${w.title}</div>
                <div class="task-desc">${w.suggestion}</div>
              </li>
            `).join('')}
          </ul>
        </div>` : ''}

        <div class="card">
          <h2>💡 综合评估与建议</h2>
          <div class="assessment">${summaryData.overall_assessment || '暂无建议'}</div>
        </div>
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
    SELECT t.id, t.title, t.description, t.priority, t.due_date, t.remind_at, t.status, c.name as category_name,
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
    { "title": "任务名称", "reason": "为什么这是核心必做" }
  ],
  "warnings": [
    { "title": "拖延/风险任务名称", "suggestion": "改善建议" }
  ],
  "overall_assessment": "对当前任务负载的总体评价和行动建议（约 50-100 字）。"
}

请确保 JSON 格式合法。当前时间（UTC）：${new Date().toISOString()}。
  `;

  let aiResponse: any;
  try {
    aiResponse = await c.env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: tasksJson }
      ]
    });
  } catch (error: any) {
    return c.json(response(false, null, { code: 'AI_API_ERROR', message: error.message }), 500);
  }

  let rawContent = '';
  if (typeof aiResponse === 'string') {
    rawContent = aiResponse;
  } else if (aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message) {
    rawContent = aiResponse.choices[0].message.content;
  } else if (aiResponse.response) {
    rawContent = aiResponse.response;
  } else if (aiResponse.result && aiResponse.result.response) {
    rawContent = aiResponse.result.response;
  } else {
    rawContent = JSON.stringify(aiResponse);
  }

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

  const requestUrl = new URL(c.req.url);
  // Determine public base URL: 1. env.BASE_URL, 2. X-Forwarded-Host header, 3. request.url host
  let summaryUrl;
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith('/') ? c.env.BASE_URL.slice(0, -1) : c.env.BASE_URL;
    summaryUrl = `${base}/summary/${uuid}`;
  } else {
    const host = c.req.header('x-forwarded-host') || requestUrl.host;
    const protocol = c.req.header('x-forwarded-proto') || requestUrl.protocol.replace(':', '');
    summaryUrl = `${protocol}://${host}/summary/${uuid}`;
  }
  
  let barkPushUrl = null;
  if (c.env.BARK_URL) {
    const baseUrl = c.env.BARK_URL.endsWith('/') ? c.env.BARK_URL : c.env.BARK_URL + '/';
    barkPushUrl = `${baseUrl}AI 任务总结?url=${encodeURIComponent(summaryUrl)}`;
    try {
      await fetch(barkPushUrl);
    } catch(e) {
      console.error("Bark push failed", e);
    }
  }

  if (c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID) {
    try {
      const msg = `<b>📊 AI 任务总结已生成</b>\n\n<a href="${escapeTelegramHTML(summaryUrl)}">点击查看详细总结网页</a>`;
      await sendTelegramNotification(c.env.TELEGRAM_BOT_TOKEN, c.env.TELEGRAM_CHAT_ID, msg, 'HTML');
    } catch(e) {
      console.error("Telegram push failed", e);
    }
  }

  return c.json(response(true, {
    uuid,
    url: summaryUrl,
    summary: summaryObj,
    bark_url: barkPushUrl
  }));
});
