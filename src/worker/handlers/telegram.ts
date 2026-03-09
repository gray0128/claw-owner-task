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
    }
    
    return text;
}

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
        let userText = message.text || '';

        if (message.voice) {
            try {
                const fileId = message.voice.file_id;
                await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在识别语音...</b>`, 'HTML');
                
                const { getTelegramVoiceUrl } = await import('../services/telegram');
                const voiceUrl = await getTelegramVoiceUrl(telegramToken, fileId);
                
                if (!voiceUrl) {
                    throw new Error('Failed to get voice file URL');
                }
                
                const volcApiKey = c.env.VOLC_API_KEY;
                if (!volcApiKey) {
                     throw new Error('VOLC_API_KEY is not configured');
                }
                
                const { processAudioToText } = await import('../services/asr');
                const asrText = await processAudioToText(voiceUrl, { apiKey: volcApiKey, apiHost: c.env.VOLC_API_HOST });
                
                if (!asrText || asrText.includes('静音')) {
                    await sendTelegramNotification(telegramToken, chatId, `⚠️ 语音似乎是静音或未识别出文字。`, 'HTML');
                    return c.text('OK');
                }
                
                userText = `[语音转写]: ${asrText}`;
            } catch (e: any) {
                console.error('[Telegram Webhook] Voice process failed:', e);
                await sendTelegramNotification(telegramToken, chatId, `⚠️ <b>语音识别失败，请尝试文字输入。</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
                return c.text('OK');
            }
        }

        console.log(`[Telegram Webhook] Received message from ${chatId}: ${userText}`);

        // Authorization: only the allowed chat ID can interact with the bot
        // Trim to prevent accidental space issues in env vars
        const expectedId = allowedChatId.toString().trim();
        const actualId = chatId.trim();

        if (actualId !== expectedId) {
            console.warn(`[Telegram Webhook] Unauthorized chat ID: ${actualId} (Expected: ${expectedId})`);
            // Reply once to let the user know their ID so they can fix the configuration
            await sendTelegramNotification(telegramToken, chatId, `🔐 <b>鉴权失败</b>\n你的 Telegram Chat ID (<code>${actualId}</code>) 不在授权名单中。\n请在 Worker 配置中更新 <code>TELEGRAM_CHAT_ID</code>。`, 'HTML');
            return c.text('Unauthorized', 403);
        }

        // Wait context for background pushes if needed, but since it's an AI call we might just await it.
        // Note: Cloudflare Workers allow waiting for async operations.
        try {
            // Use userTimezone from env or default
            const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';

            const trimmedText = userText.trim();
            console.log(`[Telegram Debug] Handling text: "${trimmedText}"`);

            // Robust command parsing: handles /command, /command@bot, /command args
            const { name: cmdName, args: cmdArgs } = parseCommand(trimmedText);

            if (cmdName === 'summary' || cmdName === '总结') {
                const publicUrl = new URL(c.req.url);
                const publicHost = publicUrl.host;
                const publicProto = publicUrl.protocol.replace(':', '');

                c.executionCtx.waitUntil((async () => {
                    await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在生成任务总结，请稍候...</b>`, 'HTML');
                    try {
                        // Directly call the summary generation handler
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
                })());
                return c.text('OK');
            } else if (cmdName === 'add' || cmdName === '添加') {
                if (!cmdArgs || !cmdArgs.trim()) {
                    c.executionCtx.waitUntil(sendTelegramNotification(telegramToken, chatId, `ℹ️ <b>使用说明</b>\n请提供任务内容，例如：\n<pre>/add 买牛奶</pre>`, 'HTML'));
                    return c.text('OK');
                }

                const title = cmdArgs.trim();
                c.executionCtx.waitUntil((async () => {
                    try {
                        // Directly call the task creation handler, bypassing AI
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
                })());
                return c.text('OK');
            }

            const startTime = Date.now();
            c.executionCtx.waitUntil((async () => {
                try {
                    const aiRes = await aiHandlers.request('/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-User-Timezone': userTimezone
                        },
                        body: JSON.stringify({ text: userText })
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
                        // 回退纯文本模式重试
                        const plainText = replyText.replace(/<[^>]+>/g, '');
                        await sendTelegramNotification(telegramToken, chatId, plainText);
                    }

                } catch (e: any) {
                    console.error('[Telegram Webhook] Error processing AI request:', e);
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>系统错误</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
                }
            })());

        } catch (e: any) {
            console.error('[Telegram Webhook] Error processing AI request:', e);
            await sendTelegramNotification(telegramToken, chatId, `❌ <b>系统错误</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
        }
    }

    // Always return 200 OK so Telegram doesn't retry
    return c.text('OK');
});

export const telegramHandlers = app;
