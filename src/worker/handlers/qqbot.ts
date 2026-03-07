import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { authSummaryHandlers } from './summary';
import { taskHandlers } from './tasks';
import { 
  getQQAccessToken, 
  sendQQNotification, 
  verifyQQSignature, 
  signQQToken 
} from '../services/qqbot';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for QQ (Simple text for now)
function formatQQResponse(aiResult: any): string {
    if (!aiResult.success) {
        const errMsg = aiResult.error?.message || JSON.stringify(aiResult.error);
        return `❌ 操作失败\n${errMsg}`;
    }

    const { ai_parsed, data } = aiResult;
    let text = `✅ 操作成功\n\n`;

    if (ai_parsed && ai_parsed.action) {
        text += `解析动作: ${ai_parsed.action}\n`;
    }

    if (data && Array.isArray(data)) {
        if (data.length === 0) {
            text += `\n没有找到符合条件的任务。`;
        } else {
            text += `\n找到 ${data.length} 个任务:\n`;
            data.forEach(t => {
                text += `\n- ${t.title} [${t.status === 'completed' ? '已完成' : '待办'}]`;
                if (t.due_date) text += `\n  📅 截止: ${t.due_date}`;
                if (t.remind_at) text += `\n  ⏰ 提醒: ${t.remind_at}`;
            });
        }
    } else if (data && typeof data === 'object') {
        if (data.title) text += `\n任务: ${data.title}`;
        if (data.id) text += `\nTask ID: ${data.id}`;
        if (data.message) text += `\n${data.message}`;
        if (data.due_date) text += `\n📅 截止: ${data.due_date}`;
        if (data.remind_at) text += `\n⏰ 提醒: ${data.remind_at}`;
    } else if (data) {
        text += `\n结果: ${String(data)}`;
    }

    return text;
}

app.post('/', async (c) => {
    const appId = c.env.QQ_APP_ID;
    const appSecret = c.env.QQ_APP_SECRET;
    const allowedOpenid = c.env.QQ_ALLOWED_OPENID;

    if (!appId || !appSecret) {
        return c.text('QQ Bot configuration missing', 400);
    }

    const signatureHex = c.req.header('X-Signature-Ed25519');
    const timestamp = c.req.header('X-Signature-Timestamp');

    if (!signatureHex || !timestamp) {
        return c.text('Missing signature headers', 401);
    }

    const bodyText = await c.req.text();
    const isValid = await verifyQQSignature(appSecret, signatureHex, timestamp, bodyText);

    if (!isValid) {
        console.error('[QQBot Webhook] Invalid signature');
        return c.text('Invalid signature', 401);
    }

    const payload = JSON.parse(bodyText);

    // 1. Handle callback validation (OpCode 13)
    if (payload.op === 13) {
        const plainToken = payload.d.plain_token;
        const signature = await signQQToken(appSecret, plainToken);
        return c.json({
            plain_token: plainToken,
            signature: signature
        });
    }

    // 2. Handle events (OpCode 0)
    if (payload.op === 0) {
        const eventType = payload.t;
        const data = payload.d;

        // We only care about user messages (C2C_MESSAGE_CREATE)
        if (eventType === 'C2C_MESSAGE_CREATE') {
            const openid = data.author.user_openid;
            const userText = data.content?.trim();
            const msgId = data.id;

            console.log(`[QQBot Webhook] Received message from ${openid}: ${userText}`);

            // Authorization
            if (allowedOpenid && openid !== allowedOpenid.trim()) {
                console.warn(`[QQBot Webhook] Unauthorized openid: ${openid}`);
                // Notify user they are not authorized
                c.executionCtx.waitUntil((async () => {
                  const token = await getQQAccessToken(appId, appSecret);
                  if (token) {
                    await sendQQNotification(token, openid, `🔐 鉴权失败\n你的 QQ OpenID (${openid}) 不在授权名单中。`, msgId);
                  }
                })());
                return c.json({ code: 0 });
            }

            // Process message asynchronously to satisfy 3s response requirement
            c.executionCtx.waitUntil((async () => {
                try {
                    const token = await getQQAccessToken(appId, appSecret);
                    if (!token) return;

                    const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';
                    
                    // Handle Commands
                    const isCommand = userText.startsWith('/');
                    const commandMatch = userText.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
                    const cmdName = commandMatch ? commandMatch[1].toLowerCase() : null;
                    const cmdArgs = commandMatch ? commandMatch[2] : null;

                    if (cmdName === 'summary' || cmdName === '总结') {
                        await sendQQNotification(token, openid, `⏳ 正在生成任务总结，请稍候...`, msgId);
                        
                        const publicUrl = new URL(c.req.url);
                        const summaryRes = await authSummaryHandlers.request('/', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                                'X-User-Timezone': userTimezone,
                                'X-Forwarded-Host': publicUrl.host,
                                'X-Forwarded-Proto': publicUrl.protocol.replace(':', '')
                            }
                        }, c.env);

                        if (!summaryRes.ok) {
                            const errorMsg = await summaryRes.text();
                            await sendQQNotification(token, openid, `❌ 生成任务总结失败\n${errorMsg}`, msgId);
                        }
                        // Success is handled by the summary handler sending notifications via Bark/Telegram
                        // But since we want it in QQ, the summary handler might need to be aware of QQ.
                        // For now, let's assume summary handler sends to "all configured channels" or just Bark/Telegram.
                        // Optimization: if summary handler returns data, we can send it here.
                        return;
                    } else if (cmdName === 'add' || cmdName === '添加') {
                        if (!cmdArgs) {
                            await sendQQNotification(token, openid, `ℹ️ 使用说明\n请提供任务内容，例如：\n/add 买牛奶`, msgId);
                            return;
                        }
                        const addRes = await taskHandlers.request('/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                                'X-User-Timezone': userTimezone
                            },
                            body: JSON.stringify({ title: cmdArgs, source: 'qq' })
                        }, c.env);
                        const addData: any = await addRes.json();
                        if (addData.success) {
                            await sendQQNotification(token, openid, `✅ 任务添加成功\n\n任务: ${cmdArgs}\nTask ID: ${addData.data.id}`, msgId);
                        } else {
                            await sendQQNotification(token, openid, `❌ 添加失败\n${addData.error?.message || '未知错误'}`, msgId);
                        }
                        return;
                    }

                    // Pass to AI
                    const aiRes = await aiHandlers.request('/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-User-Timezone': userTimezone
                        },
                        body: JSON.stringify({ text: userText })
                    }, c.env);

                    const aiResult = await aiRes.json() as any;
                    const replyText = formatQQResponse(aiResult);
                    await sendQQNotification(token, openid, replyText, msgId);

                } catch (err: any) {
                    console.error('[QQBot Webhook] Error processing message:', err);
                }
            })());

            return c.json({ code: 0 });
        }
    }

    return c.text('OK');
});

export const qqHandlers = app;
