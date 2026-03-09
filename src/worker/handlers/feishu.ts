import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { taskHandlers } from './tasks';
import { authSummaryHandlers } from './summary';
import { getTenantAccessToken, sendFeishuMessage, verifyFeishuSignature, decryptFeishuEvent } from '../services/feishu';
import { createListUrl } from './list';
import { createShareUrl } from './share';
import { parseCommand, extractResult, isResponseExpired } from './bot-shared';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for Feishu text mode
async function formatFeishuResponse(c: any, aiResult: any): Promise<string> {
    const r = await extractResult(c, aiResult);
    
    if (!r.success) {
        return `❌ 操作失败\n${r.errorMessage!}`;
    }
    
    let text = `✅ 操作成功\n\n`;
    if (r.action) text += `解析动作: ${r.action}\n`;
    
    if (r.taskCount === 0) {
        text += `\n没有找到符合条件的任务。`;
    } else if (r.singleTaskUrl) {
        text += `\n成功查询到 1 个任务。\n${r.singleTaskUrl}`;
    } else if (r.listUrl) {
        text += `\n成功查询到 ${r.taskCount} 个任务。\n${r.listUrl}`;
    } else if (r.taskTitle) {
        text += `\n任务: ${r.taskTitle}`;
        if (r.taskId) text += `\nTask ID: ${r.taskId}`;
        if (r.message) text += `\n${r.message}`;
        if (r.dueDate) text += `\n📅 截止: ${r.dueDate}`;
        if (r.remindAt) text += `\n⏰ 提醒: ${r.remindAt}`;
        if (r.viewUrl) text += `\n\n${r.viewUrl}`;
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
        // Event deduplication: Feishu retries webhook delivery if no timely response
        const eventId = bodyObj.header.event_id;
        if (eventId) {
            try {
                const existing = await c.env.DB.prepare(
                    'SELECT event_id FROM event_dedup WHERE event_id = ?'
                ).bind(eventId).first();

                if (existing) {
                    console.log(`[Feishu Webhook] Duplicate event detected, skipping: ${eventId}`);
                    return c.json({code: 0});
                }

                // Record this event as processed
                await c.env.DB.prepare(
                    'INSERT INTO event_dedup (event_id) VALUES (?)'
                ).bind(eventId).run();
            } catch (dedupErr) {
                // INSERT 失败（PRIMARY KEY 冲突）说明另一个并发请求已处理此事件
                console.log(`[Feishu Webhook] Dedup INSERT conflict for ${eventId}, treating as duplicate`);
                return c.json({code: 0});
            }
        }

        const event = bodyObj.event;
        const message = event.message;

        if (message && (message.message_type === 'text' || message.message_type === 'audio')) {
            // Determine the correct receive ID and type
            let receiveId = message.chat_id;
            let receiveIdType: 'chat_id' | 'open_id' = 'chat_id';
            
            if (message.chat_type === 'p2p') {
                receiveId = event.sender?.sender_id?.open_id || receiveId;
                receiveIdType = 'open_id';
            }

            // Extract text from JSON string content
            let userText = '';
            
            if (message.message_type === 'audio') {
                try {
                    const contentObj = JSON.parse(message.content);
                    const fileKey = contentObj.file_key;
                    if (fileKey) {
                        const messageId = message.message_id;
                        
                        // Construct proxy URL
                        const taskApiKey = c.env.TASK_API_KEY;
                        const contentToSign = messageId + fileKey + taskApiKey;
                        const msgBuffer = new TextEncoder().encode(contentToSign);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const calculatedSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        
                        const publicUrl = new URL(c.req.url);
                        // Using current request host to form proxy URL
                        const proxyUrl = `${publicUrl.protocol}//${publicUrl.host}/api/proxy/feishu-audio?message_id=${messageId}&file_key=${fileKey}&sign=${calculatedSig}`;
                        
                        const { processAudioToText } = await import('../services/asr');
                        
                        const tenantAccessToken = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
                        if (tenantAccessToken) {
                             await sendFeishuMessage(tenantAccessToken, receiveId, '⏳ 正在识别语音...', receiveIdType, 'text');
                        }

                        const volcApiKey = c.env.VOLC_API_KEY;
                        if (!volcApiKey) {
                             throw new Error('VOLC_API_KEY is not configured');
                        }

                        const asrText = await processAudioToText(proxyUrl, { apiKey: volcApiKey, apiHost: c.env.VOLC_API_HOST });
                        if (!asrText || asrText.includes('静音')) {
                            if (tenantAccessToken) {
                                await sendFeishuMessage(tenantAccessToken, receiveId, `⚠️ 语音似乎是静音或未识别出文字。`, receiveIdType, 'text');
                            }
                            return c.json({code: 0});
                        }
                        userText = `[语音转写]: ${asrText}`;
                    } else {
                         throw new Error('No file_key found in audio message');
                    }
                } catch (e: any) {
                    console.error('[Feishu Webhook] Audio process failed:', e);
                    const tenantAccessToken = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
                    if (tenantAccessToken) {
                        await sendFeishuMessage(tenantAccessToken, receiveId, `⚠️ 语音识别失败，请尝试文字输入。\n(${e.message})`, receiveIdType, 'text');
                    }
                    return c.json({code: 0});
                }
            } else {
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
            
            const { name: cmdName, args: cmdArgs } = parseCommand(trimmedText);

            const tenantAccessToken = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
            if (!tenantAccessToken) {
                console.error('[Feishu Webhook] Failed to get tenant access token');
                return c.json({code: 0});
            }

            if (cmdName === 'summary' || cmdName === '总结') {
                const publicUrl = new URL(c.req.url);
                const publicHost = publicUrl.host;
                const publicProto = publicUrl.protocol.replace(':', '');

                c.executionCtx.waitUntil((async () => {
                    await sendFeishuMessage(tenantAccessToken, receiveId, '⏳ 正在生成任务总结，请稍候...', receiveIdType, 'text');
                    try {
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
                })());
                return c.json({code: 0});
            } else if (cmdName === 'add' || cmdName === '添加') {
                if (!cmdArgs || !cmdArgs.trim()) {
                    c.executionCtx.waitUntil(sendFeishuMessage(tenantAccessToken, receiveId, `ℹ️ 使用说明\n请提供任务内容，例如：\n/add 买牛奶`, receiveIdType, 'text'));
                    return c.json({code: 0});
                }

                const title = cmdArgs.trim();
                c.executionCtx.waitUntil((async () => {
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
                                const shareUrl = await createShareUrl(c, addData.data.id);
                                await sendFeishuMessage(tenantAccessToken, receiveId, `✅ 任务添加成功\n\n任务: ${title}\nTask ID: ${addData.data.id}\n链接: ${shareUrl}`, receiveIdType, 'text');
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
                })());
                return c.json({code: 0});
            }

            // AI Flow
            const startTime = Date.now();
            c.executionCtx.waitUntil((async () => {
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
                    if (isResponseExpired(startTime)) return;
                    await sendFeishuMessage(tenantAccessToken, receiveId, replyText, receiveIdType, 'text');

                } catch (e: any) {
                    console.error('[Feishu Webhook] Error processing AI request:', e);
                    await sendFeishuMessage(tenantAccessToken, receiveId, `❌ 系统错误\n${e.message}`, receiveIdType, 'text');
                }
            })());
        }
    }

    return c.json({code: 0});
});

export const feishuHandlers = app;
