import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { authSummaryHandlers } from './summary';
import { taskHandlers } from './tasks';
import { createShareUrl } from './share';
import { createListUrl } from './list';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for Telegram HTML mode
async function formatTelegramResponse(c: any, aiResult: any): Promise<string> {
    if (!aiResult.success) {
        const errMsg = aiResult.error?.message || JSON.stringify(aiResult.error);
        return `❌ <b>操作失败</b>\n<pre>${escapeTelegramHTML(errMsg)}</pre>`;
    }

    const { ai_parsed, data } = aiResult;
    let text = `✅ <b>操作成功</b>\n\n`;

    let intentStr = '任务列表';
    if (ai_parsed && ai_parsed.action) {
        intentStr = `解析动作: ${ai_parsed.action}`;
        text += `<i>${escapeTelegramHTML(intentStr)}</i>\n`;
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
                text += `${escapeTelegramHTML(url)}`;
            } else {
                text += `- <b>${escapeTelegramHTML(data[0].title)}</b> [${data[0].status === 'completed' ? '已完成' : '待办'}]`;
            }
        } else {
            const listUrl = await createListUrl(c, data, intentStr);
            text += `\n成功查询到 ${data.length} 个任务。\n${escapeTelegramHTML(listUrl)}`;
        }
    } else if (data && typeof data === 'object') {
        if (data.title) text += `\n任务: <b>${escapeTelegramHTML(data.title)}</b>`;
        if (data.id) text += `\nTask ID: ${data.id}`;
        if (data.message) text += `\n${escapeTelegramHTML(data.message)}`;
        if (data.due_date) text += `\n📅 截止: ${escapeTelegramHTML(data.due_date)}`;
        if (data.remind_at) text += `\n⏰ 提醒: ${escapeTelegramHTML(data.remind_at)}`;
        if (data.view_url) text += `\n\n${escapeTelegramHTML(data.view_url)}`;
    } else if (data) {
        text += `\n结果: ${escapeTelegramHTML(String(data))}`;
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

    if (body?.message?.text && body.message.chat?.id) {
        const chatId = body.message.chat.id.toString();
        const userText = body.message.text;
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

            // Check if it starts with / to handle as a command
            const isCommand = trimmedText.startsWith('/');
            
            // Robust command parsing: handles /command, /command@bot, /command args
            const commandMatch = trimmedText.match(/^\/([^\s@]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
            const cmdName = commandMatch ? commandMatch[1].toLowerCase() : null;
            const cmdArgs = commandMatch ? commandMatch[2] : null;

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
