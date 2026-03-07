import { Hono } from 'hono';
import { Bindings } from '../index';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';
import { getQQAccessToken, sendQQNotification } from '../services/qqbot';
import { getTenantAccessToken, sendFeishuMessage } from '../services/feishu';
import { getAppBaseUrl } from '../utils';

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
          <h1>页面不存在或已失效</h1>
          <p>请重新发起总结</p>
          <div class="brand">CLAW TASK</div>
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
          <h1>页面已过期</h1>
          <p>请重新发起总结</p>
          <div class="brand">CLAW TASK</div>
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
          --bg: #fafafa;
          --surface: #ffffff;
          --text: #171717;
          --text-muted: #737373;
          --border: #e5e5e5;
          --radius: 12px;
        }
        body {
          font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: var(--bg);
          color: var(--text);
          line-height: 1.6;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper { max-width: 720px; margin: 40px auto; padding: 0 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px 0; color: #0a0a0a; word-break: break-word; }
        .header .meta { font-size: 14px; color: var(--text-muted); font-weight: 500; }
        
        .grid { display: grid; gap: 24px; margin-bottom: 40px; }
        .card { background: var(--surface); border-radius: var(--radius); padding: 32px; box-shadow: 0 4px 24px -8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02); border: 1px solid var(--border); }
        .card h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 24px 0; display: flex; align-items: center; gap: 8px; }
        
        .stats-container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .stat-box { background: #fdfdfd; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #f0f0f0; }
        .stat-num { font-size: 36px; font-weight: 700; letter-spacing: -0.04em; color: #171717; line-height: 1; margin-bottom: 4px; }
        .stat-label { font-size: 13px; font-weight: 500; color: var(--text-muted); }
        
        .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 16px; }
        .task-item { background: #fdfdfd; border: 1px solid #f0f0f0; border-radius: 8px; padding: 16px 20px; border-left: 3px solid #171717; }
        .task-item.warning { border-left-color: #dc2626; }
        .task-title { font-size: 16px; font-weight: 600; color: #171717; margin-bottom: 4px; line-height: 1.4; word-break: break-word; }
        .task-desc { font-size: 14px; color: #52525b; line-height: 1.6; margin: 0; word-break: break-word; }
        
        .assessment { font-size: 16px; line-height: 1.8; color: #27272a; padding: 24px; background: #f4f4f5; border-radius: 8px; font-style: italic; position: relative; word-break: break-word; }
        .assessment::before { content: '"'; font-size: 48px; color: #d4d4d8; position: absolute; top: 12px; left: 16px; font-family: Georgia, serif; line-height: 1; }
        .assessment div { position: relative; z-index: 1; text-indent: 24px; margin: 0; }
        
        .footer { text-align: center; padding: 20px; font-size: 12px; font-weight: 600; color: #d4d4d4; letter-spacing: 0.05em; }

        @media (max-width: 640px) {
          .wrapper { margin: 20px auto; }
          .card { padding: 24px; }
          .stats-container { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <header class="header">
          <h1>${summaryData.title || 'AI 任务总结'}</h1>
          <div class="meta">有效至: ${new Date(expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
        </header>
        
        <div class="grid">
          <div class="card">
            <h2>概览 / Overview</h2>
            <div class="stats-container">
              <div class="stat-box"><div class="stat-num">${summaryData.stats?.total_pending || 0}</div><div class="stat-label">待处理</div></div>
              <div class="stat-box"><div class="stat-num">${summaryData.stats?.in_progress || 0}</div><div class="stat-label">处理中</div></div>
              <div class="stat-box"><div class="stat-num" style="color: ${summaryData.stats?.overdue > 0 ? '#dc2626' : 'inherit'}">${summaryData.stats?.overdue || 0}</div><div class="stat-label">已延期</div></div>
            </div>
          </div>
          
          ${summaryData.core_tasks && summaryData.core_tasks.length > 0 ? `
          <div class="card">
            <h2>核心必做 / Core Tasks</h2>
            <ul class="task-list">
              ${summaryData.core_tasks.map((t: any) => `
                <li class="task-item">
                  <div class="task-title">[#${t.id}] ${t.title} <span style="font-size: 12px; color: #a3a3a3; font-weight: normal; margin-left: 8px;">${t.created_at ? new Date(t.created_at + "Z").toLocaleString('zh-CN', { hour12: false }) : ''}</span></div>
                  ${t.reason ? `<p class="task-desc">${t.reason}</p>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>` : ''}

          ${summaryData.warnings && summaryData.warnings.length > 0 ? `
          <div class="card">
            <h2>风险警告 / Warnings</h2>
            <ul class="task-list">
              ${summaryData.warnings.map((w: any) => `
                <li class="task-item warning">
                  <div class="task-title">[#${w.id}] ${w.title} <span style="font-size: 12px; color: #a3a3a3; font-weight: normal; margin-left: 8px;">${w.created_at ? new Date(w.created_at + "Z").toLocaleString('zh-CN', { hour12: false }) : ''}</span></div>
                  <p class="task-desc">${w.suggestion}</p>
                </li>
              `).join('')}
            </ul>
          </div>` : ''}

          <div class="card">
            <h2>综合评估 / Assessment</h2>
            <div class="assessment">
              <div>${summaryData.overall_assessment || '暂无建议'}</div>
            </div>
          </div>
        </div>
        
        <div class="footer">CLAW TASK</div>
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
    SELECT t.id, t.title, t.description, t.priority, t.due_date, t.remind_at, t.status, t.created_at, c.name as category_name,
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
    { "id": 123, "title": "任务名称", "created_at": "YYYY-MM-DD HH:mm:ss", "reason": "为什么这是核心必做" }
  ],
  "warnings": [
    { "id": 124, "title": "拖延/风险任务名称", "created_at": "YYYY-MM-DD HH:mm:ss", "suggestion": "改善建议" }
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

  const summaryUrl = `${getAppBaseUrl(c)}/summary/${uuid}`;
  
  const source = c.req.query('source');

  let barkPushUrl = null;
  if (c.env.BARK_URL && (!source || source === 'cron')) {
    const baseUrl = c.env.BARK_URL.endsWith('/') ? c.env.BARK_URL : c.env.BARK_URL + '/';
    barkPushUrl = `${baseUrl}AI 任务总结?url=${encodeURIComponent(summaryUrl)}`;
    try {
      await fetch(barkPushUrl);
    } catch(e) {
      console.error("Bark push failed", e);
    }
  }

  if (c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID && (!source || source === 'cron' || source === 'telegram')) {
    try {
      const msg = `<b>📊 AI 任务总结已生成</b>\n\n<a href="${escapeTelegramHTML(summaryUrl)}">点击查看详细总结网页</a>`;
      await sendTelegramNotification(c.env.TELEGRAM_BOT_TOKEN, c.env.TELEGRAM_CHAT_ID, msg, 'HTML');
    } catch(e) {
      console.error("Telegram push failed", e);
    }
  }

  if (c.env.QQ_APP_ID && c.env.QQ_APP_SECRET && c.env.QQ_ALLOWED_OPENID && (!source || source === 'cron' || source === 'qq')) {
    try {
      const accessToken = await getQQAccessToken(c.env.QQ_APP_ID, c.env.QQ_APP_SECRET);
      if (accessToken) {
        const msg = `📊 AI 任务总结已生成\n\n点击查看详细总结网页：\n${summaryUrl}`;
        await sendQQNotification(accessToken, c.env.QQ_ALLOWED_OPENID, msg);
      }
    } catch(e) {
      console.error("QQ push failed", e);
    }
  }

  if (c.env.FEISHU_APP_ID && c.env.FEISHU_APP_SECRET && c.env.FEISHU_ALLOWED_CHAT_ID && (!source || source === 'cron' || source === 'feishu')) {
    try {
      const tenantAccessToken = await getTenantAccessToken(c.env.FEISHU_APP_ID, c.env.FEISHU_APP_SECRET);
      if (tenantAccessToken) {
        const firstChatId = c.env.FEISHU_ALLOWED_CHAT_ID.split(',')[0].trim();
        const msg = `📊 AI 任务总结已生成\n\n点击查看详细总结网页：\n${summaryUrl}`;
        // Since we don't know if the allowed ID is a user or group, we can just attempt both or default to chat_id
        // (usually chat_id fails if it's an open_id, and vice versa)
        let res = await sendFeishuMessage(tenantAccessToken, firstChatId, msg, 'chat_id', 'text');
        if (!res.success) {
            await sendFeishuMessage(tenantAccessToken, firstChatId, msg, 'open_id', 'text');
        }
      }
    } catch(e) {
      console.error("Feishu push failed", e);
    }
  }

  return c.json(response(true, {
    uuid,
    url: summaryUrl,
    summary: summaryObj,
    bark_url: barkPushUrl
  }));
});
