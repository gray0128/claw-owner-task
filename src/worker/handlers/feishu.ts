import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { taskHandlers } from './tasks';
import { authSummaryHandlers } from './summary';
import { getTenantAccessToken, sendFeishuMessage, verifyFeishuSignature, decryptFeishuEvent, fetchFeishuResource } from '../services/feishu';
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

            // Access Control
            if (FEISHU_ALLOWED_CHAT_ID) {
                const allowedChats = FEISHU_ALLOWED_CHAT_ID.split(',').map(id => id.trim());
                if (!allowedChats.includes(message.chat_id) && !allowedChats.includes(event.sender?.sender_id?.open_id)) {
                    console.warn(`[Feishu Webhook] Unauthorized request from ${receiveId}`);
                    // Reply once
                    c.executionCtx.waitUntil((async () => {
                        const token = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
                        if (token) {
                            await sendFeishuMessage(token, receiveId, `🔐 鉴权失败\n此会话或群组不在授权名单中。`, receiveIdType, 'text');
                        }
                    })());
                    return c.json({code: 0});
                }
            }

            const publicUrl = new URL(c.req.url);
            const baseUrl = c.env.BASE_URL || `${publicUrl.protocol}//${publicUrl.host}`;
            const publicHost = publicUrl.host;
            const publicProto = publicUrl.protocol.replace(':', '');
            const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';

            // Start background execution for everything else
            c.executionCtx.waitUntil((async () => {
                let userText = '';
                const tenantAccessToken = await getTenantAccessToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
                if (!tenantAccessToken) {
                    console.error('[Feishu Webhook] Failed to get tenant access token');
                    return;
                }
                
                if (message.message_type === 'audio') {
                    try {
                        const contentObj = JSON.parse(message.content);
                        const fileKey = contentObj.file_key;
                        if (fileKey) {
                            const messageId = message.message_id;
                            await sendFeishuMessage(tenantAccessToken, receiveId, '⏳ 正在识别语音...', receiveIdType, 'text');

                            // 1. Download audio from Feishu to ArrayBuffer
                            const feishuRes = await fetchFeishuResource(tenantAccessToken, messageId, fileKey, 'file');
                            if (!feishuRes.ok) {
                                const errorText = await feishuRes.text();
                                throw new Error(`Failed to fetch resource from Feishu: ${feishuRes.status} ${errorText}`);
                            }
                            const arrayBuffer = await feishuRes.arrayBuffer();

                            // 2. Upload to R2 with UUID
                            const hash = crypto.randomUUID().replace(/-/g, '');
                            const objectKey = `audio/feishu-${messageId}-${hash}.ogg`;

                            await c.env.AUDIO_BUCKET.put(objectKey, arrayBuffer, {
                                httpMetadata: { contentType: 'audio/ogg' }
                            });

                            try {
                                // 3. Construct proxy URL and call ASR
                                const proxyUrl = `${baseUrl.replace(/\/$/, '')}/api/proxy/audio/feishu/${messageId}/${hash}.ogg`;
                                const volcApiKey = c.env.VOLC_API_KEY;
                                if (!volcApiKey) {
                                     throw new Error('VOLC_API_KEY is not configured');
                                }

                                const { processAudioToText } = await import('../services/asr');
                                const asrText = await processAudioToText(proxyUrl, { apiKey: volcApiKey, apiHost: c.env.VOLC_API_HOST });

                                if (!asrText || asrText.includes('静音')) {
                                    await sendFeishuMessage(tenantAccessToken, receiveId, `⚠️ 语音似乎是静音或未识别出文字。`, receiveIdType, 'text');
                                    return; // stop execution for this message
                                }
                                userText = `[飞书语音转译]: ${asrText}`;
                            } finally {
                                // 4. Cleanup R2
                                await c.env.AUDIO_BUCKET.delete(objectKey).catch(e => console.error('[Feishu] Failed to delete R2 temp file', e));
                            }
                        } else {
                             throw new Error('No file_key found in audio message');
                        }
                    } catch (e: any) {
                        console.error('[Feishu Webhook] Audio process failed:', e);
                        await sendFeishuMessage(tenantAccessToken, receiveId, `⚠️ 语音识别失败，请尝试文字输入。\n(${e.message})`, receiveIdType, 'text');
                        return; // stop execution
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
                const trimmedText = userText.trim();
                const { name: cmdName, args: cmdArgs } = parseCommand(trimmedText);

                if (cmdName === 'summary' || cmdName === '总结') {
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
                    return;
                } else if (cmdName === 'add' || cmdName === '添加') {
                    if (!cmdArgs || !cmdArgs.trim()) {
                        await sendFeishuMessage(tenantAccessToken, receiveId, `ℹ️ 使用说明\n请提供任务内容，例如：\n/add 买牛奶`, receiveIdType, 'text');
                        return;
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
                    return;
                }

                // AI Flow
                const startTime = Date.now();
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
