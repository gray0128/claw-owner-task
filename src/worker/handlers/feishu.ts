import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { taskHandlers } from './tasks';
import { authSummaryHandlers } from './summary';
import { getTenantAccessToken, sendFeishuMessage, verifyFeishuSignature, decryptFeishuEvent } from '../services/feishu';
import { createListUrl } from './list';
import { createShareUrl } from './share';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for Feishu text mode
async function formatFeishuResponse(c: any, aiResult: any): Promise<string> {
    if (!aiResult.success) {
        const errMsg = aiResult.error?.message || JSON.stringify(aiResult.error);
        return `❌ 操作失败\n${errMsg}`;
    }

    const { ai_parsed, data } = aiResult;
    let text = `✅ 操作成功\n\n`;

    let intentStr = '任务列表';
    if (ai_parsed && ai_parsed.action) {
        intentStr = `解析动作: ${ai_parsed.action}`;
        text += `${intentStr}\n`;
    }

    if (data && Array.isArray(data)) {
        if (data.length === 0) {
            text += `\n没有找到符合条件的任务。`;
        } else if (data.length === 1) {
            text += `\n成功查询到 1 个任务。\n`;
            let url = data[0].view_url;
            if (!url && data[0].id) {
                url = await createShareUrl(c, data[0].id);
            }
            if (url) {
                text += `${url}`;
            } else {
                text += `- ${data[0].title} [${data[0].status === 'completed' ? '已完成' : '待办'}]`;
            }
        } else {
            const listUrl = await createListUrl(c, data, intentStr);
            text += `\n成功查询到 ${data.length} 个任务。\n${listUrl}`;
        }
    } else if (data && typeof data === 'object') {
        if (data.title) text += `\n任务: ${data.title}`;
        if (data.id) text += `\nTask ID: ${data.id}`;
        if (data.message) text += `\n${data.message}`;
        if (data.due_date) text += `\n📅 截止: ${data.due_date}`;
        if (data.remind_at) text += `\n⏰ 提醒: ${data.remind_at}`;
        if (data.view_url) text += `\n\n${data.view_url}`;
    } else if (data) {
        text += `\n结果: ${String(data)}`;
    }

    return text;
}

app.post('/', async (c) => {
    const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_VERIFY_TOKEN, FEISHU_ENCRYPT_KEY, FEISHU_ALLOWED_CHAT_ID } = c.env;

    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
        return c.text('Feishu credentials missing', 400);
    }

    // Signature verification
    const timestamp = c.req.header('x-lark-request-timestamp');
    const nonce = c.req.header('x-lark-request-nonce');
    const signature = c.req.header('x-lark-signature');
    const rawBody = await c.req.text();

    const tokenForVerify = FEISHU_ENCRYPT_KEY || FEISHU_VERIFY_TOKEN;
    if (tokenForVerify && timestamp && nonce && signature) {
        const isValid = await verifyFeishuSignature(timestamp, nonce, tokenForVerify, rawBody, signature);
        if (!isValid) {
            console.error('[Feishu Webhook] Signature verification failed');
            return c.json({ error: 'Invalid signature' }, 401);
        }
    }

    let bodyObj: any;
    try {
        bodyObj = JSON.parse(rawBody);
    } catch (e) {
        return c.text('Invalid JSON', 400);
    }

    // Handle decryption
    if (bodyObj.encrypt) {
        if (!FEISHU_ENCRYPT_KEY) {
            console.error('[Feishu Webhook] Encrypted event received but FEISHU_ENCRYPT_KEY is not configured');
            return c.text('Encryption key missing', 500);
        }
        const decryptedStr = await decryptFeishuEvent(FEISHU_ENCRYPT_KEY, bodyObj.encrypt);
        if (!decryptedStr) {
            return c.text('Decryption failed', 500);
        }
        try {
            bodyObj = JSON.parse(decryptedStr);
        } catch (e) {
            return c.text('Invalid decrypted JSON', 400);
        }
    }

    // Handle URL verification challenge
    if (bodyObj.type === 'url_verification' && bodyObj.challenge) {
        return c.json({ challenge: bodyObj.challenge });
    }

    // Handle Event: im.message.receive_v1
    if (bodyObj.header && bodyObj.header.event_type === 'im.message.receive_v1') {
        const event = bodyObj.event;
        const message = event.message;

        if (message && message.message_type === 'text') {
            // Determine the correct receive ID and type
            let receiveId = message.chat_id;
            let receiveIdType: 'chat_id' | 'open_id' = 'chat_id';
            
            if (message.chat_type === 'p2p') {
                receiveId = event.sender?.sender_id?.open_id || receiveId;
                receiveIdType = 'open_id';
            }

            // Extract text from JSON string content
            let userText = '';
            try {
                const contentObj = JSON.parse(message.content);
                userText = contentObj.text;
                // Remove @bot mentions from text
                if (message.mentions) {
                    message.mentions.forEach((mention: any) => {
                        userText = userText.replace(mention.key, '').trim();
                    });
                }
            } catch (e) {
                userText = message.content;
            }

            console.log(`[Feishu Webhook] Received message from ${receiveIdType} ${receiveId}: ${userText}`);

            // Access Control
            if (FEISHU_ALLOWED_CHAT_ID) {
                const allowedChats = FEISHU_ALLOWED_CHAT_ID.split(',').map(id => id.trim());
                if (!allowedChats.includes(message.chat_id) && !allowedChats.includes(event.sender?.sender_id?.open_id)) {
                    console.warn(`[Feishu Webhook] Unauthorized request from ${receiveId}`);
                    // Reply once
                    const token = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
                    if (token) {
                        await sendFeishuMessage(token, receiveId, `🔐 鉴权失败\n此会话或群组不在授权名单中。`, receiveIdType, 'text');
                    }
                    return c.json({code: 0});
                }
            }

            const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';
            const trimmedText = userText.trim();
            
            const commandMatch = trimmedText.match(/^\/([^\s@]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
            const cmdName = commandMatch ? commandMatch[1].toLowerCase() : null;
            const cmdArgs = commandMatch ? commandMatch[2] : null;

            const tenantAccessToken = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
            if (!tenantAccessToken) {
                console.error('[Feishu Webhook] Failed to get tenant access token');
                return c.json({code: 0});
            }

            if (cmdName === 'summary' || cmdName === '总结') {
                await sendFeishuMessage(tenantAccessToken, receiveId, '⏳ 正在生成任务总结，请稍候...', receiveIdType, 'text');
                
                try {
                    const publicUrl = new URL(c.req.url);
                    const publicHost = publicUrl.host;
                    const publicProto = publicUrl.protocol.replace(':', '');

                    const summaryRes = await authSummaryHandlers.request('/?source=feishu', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                            'X-User-Timezone': userTimezone,
                            'X-Forwarded-Host': publicHost,
                            'X-Forwarded-Proto': publicProto
                        }
                    }, c.env);

                    if (!summaryRes.ok) {
                        const errorData = await summaryRes.json() as any;
                        const errorMsg = errorData.error?.message || await summaryRes.text();
                        await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 生成任务总结失败\n${errorMsg}`, receiveIdType, 'text');
                    }
                } catch (err: any) {
                    await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 内部指令执行崩溃 (Summary)\n${err.message}`, receiveIdType, 'text');
                }
                return c.json({code: 0});
            } else if (cmdName === 'add' || cmdName === '添加') {
                if (!cmdArgs || !cmdArgs.trim()) {
                    await sendFeishuMessage(tenantAccessToken, receiveId, `ℹ️ 使用说明\n请提供任务内容，例如：\n/add 买牛奶`, receiveIdType, 'text');
                    return c.json({code: 0});
                }

                const title = cmdArgs.trim();
                try {
                    const addRes = await taskHandlers.request('/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                            'X-User-Timezone': userTimezone
                        },
                        body: JSON.stringify({ title, source: 'feishu' })
                    }, c.env);

                    if (addRes.ok) {
                        const addData: any = await addRes.json();
                        if (addData.success) {
                            await sendFeishuMessage(tenantAccessToken, receiveId, `✅ 任务添加成功\n\n任务: ${title}\nTask ID: ${addData.data.id}`, receiveIdType, 'text');
                        } else {
                            await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 添加失败\n${addData.error?.message || '未知错误'}`, receiveIdType, 'text');
                        }
                    } else {
                        const errorText = await addRes.text();
                        await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 添加失败\n${errorText}`, receiveIdType, 'text');
                    }
                } catch (err: any) {
                    await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 内部指令错误 (Add)\n${err.message}`, receiveIdType, 'text');
                }
                return c.json({code: 0});
            }

            // AI Flow
            try {
                const aiRes = await aiHandlers.request('/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-Timezone': userTimezone
                    },
                    body: JSON.stringify({ text: trimmedText })
                }, c.env);

                let aiResult: any;
                try {
                    aiResult = await aiRes.json();
                } catch (e) {
                    aiResult = { success: false, error: { message: 'AI Handler returned invalid JSON' } };
                }

                const replyText = await formatFeishuResponse(c, aiResult);
                await sendFeishuMessage(tenantAccessToken, receiveId, replyText, receiveIdType, 'text');

            } catch (e: any) {
                console.error('[Feishu Webhook] Error processing AI request:', e);
                await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 系统错误\n${e.message}`, receiveIdType, 'text');
            }
        }
    }

    return c.json({code: 0});
});

export const feishuHandlers = app;
