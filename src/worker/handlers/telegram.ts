import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { authSummaryHandlers } from './summary';
import { taskHandlers } from './tasks';
import { createShareUrl } from './share';
import { createListUrl } from './list';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';
import { parseCommand, extractResult, isResponseExpired } from './bot-shared';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for Telegram HTML mode
async function formatTelegramResponse(c: any, aiResult: any): Promise<string> {
    const r = await extractResult(c, aiResult);
    
    if (!r.success) {
        return `❌ <b>操作失败</b>\n<pre>${escapeTelegramHTML(r.errorMessage!)}</pre>`;
    }
    
    let text = `✅ <b>操作成功</b>\n\n`;
    if (r.action) text += `<i>解析动作: ${escapeTelegramHTML(r.action)}</i>\n`;
    
    if (r.taskCount === 0) {
        text += `\n没有找到符合条件的任务。`;
    } else if (r.singleTaskUrl) {
        text += `\n成功查询到 1 个任务。\n${escapeTelegramHTML(r.singleTaskUrl)}`;
    } else if (r.listUrl) {
        text += `\n成功查询到 ${r.taskCount} 个任务。\n${escapeTelegramHTML(r.listUrl)}`;
    } else if (r.taskTitle) {
        text += `\n任务: <b>${escapeTelegramHTML(r.taskTitle)}</b>`;
        if (r.taskId) text += `\nTask ID: ${r.taskId}`;
        if (r.message) text += `\n${escapeTelegramHTML(r.message)}`;
        if (r.dueDate) text += `\n📅 截止: ${escapeTelegramHTML(r.dueDate)}`;
        if (r.remindAt) text += `\n⏰ 提醒: ${escapeTelegramHTML(r.remindAt)}`;
        if (r.viewUrl) text += `\n\n${escapeTelegramHTML(r.viewUrl)}`;
    } else {
        if (r.taskId) text += `\nTask ID: ${r.taskId}`;
        if (r.message) text += `\n${escapeTelegramHTML(r.message)}`;
        if (r.viewUrl) text += `\n\n${escapeTelegramHTML(r.viewUrl)}`;
    }

    return text;}

app.post('/', async (c) => {
    const telegramToken = c.env.TELEGRAM_BOT_TOKEN;
    const allowedChatId = c.env.TELEGRAM_CHAT_ID;

    if (!telegramToken) {
        return c.text('TELEGRAM_BOT_TOKEN is missing', 400);
    }
    if (!allowedChatId) {
        return c.text('TELEGRAM_CHAT_ID is missing', 400);
    }

    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.text('Invalid JSON', 400);
    }

    const message = body?.message;
    if (message && (message.text || message.voice) && message.chat?.id) {
        const chatId = message.chat.id.toString();

        // Authorization: only the allowed chat ID can interact with the bot
        const expectedId = allowedChatId.toString().trim();
        const actualId = chatId.trim();

        if (actualId !== expectedId) {
            console.warn(`[Telegram Webhook] Unauthorized chat ID: ${actualId} (Expected: ${expectedId})`);
            // Reply once to let the user know their ID so they can fix the configuration
            c.executionCtx.waitUntil(
                sendTelegramNotification(telegramToken, chatId, `🔐 <b>鉴权失败</b>\n你的 Telegram Chat ID (<code>${actualId}</code>) 不在授权名单中。\n请在 Worker 配置中更新 <code>TELEGRAM_CHAT_ID</code>。`, 'HTML')
            );
            return c.text('Unauthorized', 403);
        }

        const publicUrl = new URL(c.req.url);
        const baseUrl = c.env.BASE_URL || `${publicUrl.origin}`;
        const publicHost = publicUrl.host;
        const publicProto = publicUrl.protocol.replace(':', '');
        const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';

        // Process message in background
        c.executionCtx.waitUntil((async () => {
            let userText = message.text || '';

            if (message.voice) {
                try {
                    const fileId = message.voice.file_id;
                    const messageId = message.message_id || fileId;
                    await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在识别语音...</b>`, 'HTML');
                    
                    const { getTelegramVoiceUrl } = await import('../services/telegram');
                    const voiceUrl = await getTelegramVoiceUrl(telegramToken, fileId);
                    
                    if (!voiceUrl) {
                        throw new Error('Failed to get voice file URL');
                    }

                    // 1. Download audio to ArrayBuffer
                    const tgRes = await fetch(voiceUrl);
                    if (!tgRes.ok) {
                        throw new Error(`Failed to download from Telegram: ${tgRes.status}`);
                    }
                    const arrayBuffer = await tgRes.arrayBuffer();

                    // 2. Upload to R2 with UUID
                    const hash = crypto.randomUUID().replace(/-/g, '');
                    const objectKey = `audio/telegram-${messageId}-${hash}.ogg`;

                    await c.env.AUDIO_BUCKET.put(objectKey, arrayBuffer, {
                        httpMetadata: { contentType: 'audio/ogg' }
                    });

                    try {
                        // 3. Construct proxy URL and call ASR
                        const proxyUrl = `${baseUrl.replace(/\/$/, '')}/api/proxy/audio/telegram/${messageId}/${hash}.ogg`;
                        
                        const volcApiKey = c.env.VOLC_API_KEY;
                        if (!volcApiKey) {
                             throw new Error('VOLC_API_KEY is not configured');
                        }
                        
                        const { processAudioToText } = await import('../services/asr');
                        const asrText = await processAudioToText(proxyUrl, { 
                            apiKey: volcApiKey, 
                            apiHost: c.env.VOLC_API_HOST,
                            modelName: c.env.VOLC_ASR_MODEL,
                            resourceId: c.env.VOLC_ASR_RESOURCE_ID
                        });
                        
                        if (!asrText || asrText.includes('静音')) {
                            await sendTelegramNotification(telegramToken, chatId, `⚠️ 语音似乎是静音或未识别出文字。`, 'HTML');
                            return; // Stop processing this message
                        }
                        
                        userText = `[Telegram 语音转译]: ${asrText}`;
                    } finally {
                        // 4. Cleanup R2
                        await c.env.AUDIO_BUCKET.delete(objectKey).catch(e => console.error('[Telegram] Failed to delete R2 temp file', e));
                    }
                } catch (e: any) {
                    console.error('[Telegram Webhook] Voice process failed:', e);
                    await sendTelegramNotification(telegramToken, chatId, `⚠️ <b>语音识别失败，请尝试文字输入。</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
                    return; // Stop processing
                }
            }

            console.log(`[Telegram Webhook] Processed text: ${userText}`);
            const trimmedText = userText.trim();
            const { name: cmdName, args: cmdArgs } = parseCommand(trimmedText);

            if (cmdName === 'summary' || cmdName === '总结') {
                await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在生成任务总结，请稍候...</b>`, 'HTML');
                try {
                    const summaryRes = await authSummaryHandlers.request('/?source=telegram', {
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
                        console.error('[Telegram] Summary command failed:', errorMsg);
                        await sendTelegramNotification(telegramToken, chatId, `❌ <b>生成任务总结失败</b>\n<pre>${escapeTelegramHTML(errorMsg)}</pre>`, 'HTML');
                    }
                } catch (err: any) {
                    console.error('[Telegram] Summary command exception:', err);
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>内部指令执行崩溃 (Summary)</b>\n<pre>${escapeTelegramHTML(err.message)}</pre>`, 'HTML');
                }
                return;
            } else if (cmdName === 'list' || cmdName === '列表') {
                await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在获取任务列表，请稍候...</b>`, 'HTML');
                try {
                    const listRes = await taskHandlers.request('/', {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                            'X-User-Timezone': userTimezone,
                            'X-Forwarded-Host': publicHost,
                            'X-Forwarded-Proto': publicProto
                        }
                    }, c.env);

                    if (listRes.ok) {
                        const listData: any = await listRes.json();
                        if (listData.success) {
                            const tasks = listData.data;
                            if (!tasks || tasks.length === 0) {
                                await sendTelegramNotification(telegramToken, chatId, `✅ <b>当前没有任务。</b>`, 'HTML');
                            } else {
                                const listUrl = await createListUrl(c, tasks, '所有任务列表');
                                await sendTelegramNotification(telegramToken, chatId, `✅ <b>任务列表获取成功</b>\n\n共 ${tasks.length} 个任务。\n${escapeTelegramHTML(listUrl)}`, 'HTML');
                            }
                        } else {
                            await sendTelegramNotification(telegramToken, chatId, `❌ <b>获取列表失败</b>\n<pre>${escapeTelegramHTML(listData.error?.message || '未知错误')}</pre>`, 'HTML');
                        }
                    } else {
                        const errorText = await listRes.text();
                        console.error('[Telegram] List command failed:', errorText);
                        await sendTelegramNotification(telegramToken, chatId, `❌ <b>获取列表失败</b>\n<pre>${escapeTelegramHTML(errorText)}</pre>`, 'HTML');
                    }
                } catch (err: any) {
                    console.error('[Telegram] List command exception:', err);
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>内部指令错误 (List)</b>\n<pre>${escapeTelegramHTML(err.message)}</pre>`, 'HTML');
                }
                return;
            } else if (cmdName?.startsWith('#')) {
                const queryId = cmdName.substring(1);
                if (!/^\d+$/.test(queryId)) {
                    await sendTelegramNotification(telegramToken, chatId, `ℹ️ <b>任务 ID 格式错误</b>\n请提供有效的数字 ID，例如：\n<pre>/#71</pre>`, 'HTML');
                    return;
                }
                await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在获取任务 #${queryId} 详情...</b>`, 'HTML');
                try {
                    const taskRes = await taskHandlers.request(`/?id=${queryId}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                            'X-User-Timezone': userTimezone,
                            'X-Forwarded-Host': publicHost,
                            'X-Forwarded-Proto': publicProto
                        }
                    }, c.env);

                    if (taskRes.ok) {
                        const taskData: any = await taskRes.json();
                        if (taskData.success && taskData.data && taskData.data.length > 0) {
                            const task = taskData.data[0];
                            const shareUrl = await createShareUrl(c, task.id);
                            let text = `✅ <b>查询成功</b>\n\n任务: <b>${escapeTelegramHTML(task.title)}</b>\nTask ID: ${task.id}`;
                            if (task.description) text += `\n${escapeTelegramHTML(task.description)}`;
                            if (task.due_date) text += `\n📅 截止: ${escapeTelegramHTML(task.due_date)}`;
                            if (task.remind_at) text += `\n⏰ 提醒: ${escapeTelegramHTML(task.remind_at)}`;
                            text += `\n\n${escapeTelegramHTML(shareUrl)}`;
                            
                            await sendTelegramNotification(telegramToken, chatId, text, 'HTML');
                        } else {
                            await sendTelegramNotification(telegramToken, chatId, `❌ <b>未找到任务 #${queryId}</b>`, 'HTML');
                        }
                    } else {
                        const errorText = await taskRes.text();
                        console.error('[Telegram] Query task command failed:', errorText);
                        await sendTelegramNotification(telegramToken, chatId, `❌ <b>查询失败</b>\n<pre>${escapeTelegramHTML(errorText)}</pre>`, 'HTML');
                    }
                } catch (err: any) {
                    console.error('[Telegram] Query task command exception:', err);
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>内部指令错误 (Query)</b>\n<pre>${escapeTelegramHTML(err.message)}</pre>`, 'HTML');
                }
                return;
            } else if (cmdName === 'add' || cmdName === '添加') {
                if (!cmdArgs || !cmdArgs.trim()) {
                    await sendTelegramNotification(telegramToken, chatId, `ℹ️ <b>使用说明</b>\n请提供任务内容，例如：\n<pre>/add 买牛奶</pre>`, 'HTML');
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
                        body: JSON.stringify({ title, source: 'telegram' })
                    }, c.env);

                    if (addRes.ok) {
                        const addData: any = await addRes.json();
                        if (addData.success) {
                            const shareUrl = await createShareUrl(c, addData.data.id);
                            await sendTelegramNotification(telegramToken, chatId, `✅ <b>任务添加成功</b>\n\n任务: <b>${escapeTelegramHTML(title)}</b>\nTask ID: ${addData.data.id}\n链接: ${escapeTelegramHTML(shareUrl)}`, 'HTML');
                        } else {
                            await sendTelegramNotification(telegramToken, chatId, `❌ <b>添加失败</b>\n<pre>${escapeTelegramHTML(addData.error?.message || '未知错误')}</pre>`, 'HTML');
                        }
                    } else {
                        const errorText = await addRes.text();
                        console.error('[Telegram] Add command failed:', errorText);
                        await sendTelegramNotification(telegramToken, chatId, `❌ <b>添加失败</b>\n<pre>${escapeTelegramHTML(errorText)}</pre>`, 'HTML');
                    }
                } catch (err: any) {
                    console.error('[Telegram] Add command exception:', err);
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>内部指令错误 (Add)</b>\n<pre>${escapeTelegramHTML(err.message)}</pre>`, 'HTML');
                }
                return;
            }

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

                const replyText = await formatTelegramResponse(c, aiResult);
                if (isResponseExpired(startTime)) return;
                const sendResult = await sendTelegramNotification(telegramToken, chatId, replyText, 'HTML');
                if (!sendResult.success) {
                    console.error('[Telegram Webhook] Failed to send formatted response:', JSON.stringify(sendResult.error));
                    const plainText = replyText.replace(/<[^>]+>/g, '');
                    await sendTelegramNotification(telegramToken, chatId, plainText);
                }

            } catch (e: any) {
                console.error('[Telegram Webhook] Error processing AI request:', e);
                await sendTelegramNotification(telegramToken, chatId, `❌ <b>系统错误</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
            }
        })());
    }

    // Always return 200 OK immediately so Telegram doesn't retry
    return c.text('OK');
});

export const telegramHandlers = app;
