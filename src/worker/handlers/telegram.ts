import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
import { authSummaryHandlers } from './summary';
import { taskHandlers } from './tasks';
import { sendTelegramNotification, escapeTelegramHTML } from '../services/telegram';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format AI response for Telegram HTML mode
function formatTelegramResponse(aiResult: any): string {
    if (!aiResult.success) {
        const errMsg = aiResult.error?.message || JSON.stringify(aiResult.error);
        return `❌ <b>操作失败</b>\n<pre>${escapeTelegramHTML(errMsg)}</pre>`;
    }

    const { ai_parsed, data } = aiResult;
    let text = `✅ <b>操作成功</b>\n\n`;

    if (ai_parsed && ai_parsed.action) {
        text += `<i>解析动作: ${escapeTelegramHTML(ai_parsed.action)}</i>\n`;
    }

    if (data && Array.isArray(data)) {
        if (data.length === 0) {
            text += `\n没有找到符合条件的任务。`;
        } else {
            text += `\n找到 ${data.length} 个任务:\n`;
            data.forEach(t => {
                text += `\n- <b>${escapeTelegramHTML(t.title)}</b> [${t.status === 'completed' ? '已完成' : '待办'}]`;
                if (t.due_date) text += `\n  📅 截止: ${escapeTelegramHTML(t.due_date)}`;
                if (t.remind_at) text += `\n  ⏰ 提醒: ${escapeTelegramHTML(t.remind_at)}`;
            });
        }
    } else if (data && typeof data === 'object') {
        if (data.title) text += `\n任务: <b>${escapeTelegramHTML(data.title)}</b>`;
        if (data.id) text += `\nTask ID: ${data.id}`;
        if (data.message) text += `\n${escapeTelegramHTML(data.message)}`;
        if (data.due_date) text += `\n📅 截止: ${escapeTelegramHTML(data.due_date)}`;
        if (data.remind_at) text += `\n⏰ 提醒: ${escapeTelegramHTML(data.remind_at)}`;
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
        if (chatId.toString() !== allowedChatId.toString()) {
            console.warn(`[Telegram Webhook] Unauthorized chat ID: ${chatId} (Expected: ${allowedChatId})`);
            return c.text('Unauthorized', 403);
        }

        // Wait context for background pushes if needed, but since it's an AI call we might just await it.
        // Note: Cloudflare Workers allow waiting for async operations.
        try {
            // Use userTimezone from env or default
            const userTimezone = c.env.USER_TIMEZONE || 'Asia/Shanghai';

            const trimmedText = userText.trim();
            if (trimmedText === '/summary' || trimmedText === '/总结') {
                await sendTelegramNotification(telegramToken, chatId, `⏳ <b>正在生成任务总结，请稍候...</b>`, 'HTML');
                
                // Directly call the summary generation handler
                const summaryRes = await authSummaryHandlers.request('/', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${c.env.TASK_API_KEY}`,
                        'X-User-Timezone': userTimezone
                    }
                }, c.env);

                if (summaryRes.ok) {
                    return c.text('OK');
                } else {
                    const errorText = await summaryRes.text();
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>生成任务总结失败</b>\n<pre>${escapeTelegramHTML(errorText)}</pre>`, 'HTML');
                    return c.text('OK');
                }
            } else if (trimmedText === '/add' || trimmedText === '/添加') {
                await sendTelegramNotification(telegramToken, chatId, `ℹ️ <b>使用说明</b>\n请提供任务内容，例如：\n<pre>/add 买牛奶</pre>`, 'HTML');
                return c.text('OK');
            } else if (trimmedText.startsWith('/add ') || trimmedText.startsWith('/添加 ')) {
                const title = trimmedText.replace(/^\/(add|添加)\s+/, '').trim();
                if (!title) {
                    await sendTelegramNotification(telegramToken, chatId, `ℹ️ <b>使用说明</b>\n请提供任务内容，例如：\n<pre>/add 买牛奶</pre>`, 'HTML');
                    return c.text('OK');
                }

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
                        await sendTelegramNotification(telegramToken, chatId, `✅ <b>任务添加成功</b>\n\n任务: <b>${escapeTelegramHTML(title)}</b>\nTask ID: ${addData.data.id}`, 'HTML');
                    } else {
                        await sendTelegramNotification(telegramToken, chatId, `❌ <b>添加失败</b>\n<pre>${escapeTelegramHTML(addData.error?.message || '未知错误')}</pre>`, 'HTML');
                    }
                } else {
                    const errorText = await addRes.text();
                    await sendTelegramNotification(telegramToken, chatId, `❌ <b>添加失败</b>\n<pre>${escapeTelegramHTML(errorText)}</pre>`, 'HTML');
                }
                return c.text('OK');
            }

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

            const replyText = formatTelegramResponse(aiResult);
            await sendTelegramNotification(telegramToken, chatId, replyText, 'HTML');

        } catch (e: any) {
            console.error('[Telegram Webhook] Error processing AI request:', e);
            await sendTelegramNotification(telegramToken, chatId, `❌ <b>系统错误</b>\n<pre>${escapeTelegramHTML(e.message)}</pre>`, 'HTML');
        }
    }

    // Always return 200 OK so Telegram doesn't retry
    return c.text('OK');
});

export const telegramHandlers = app;
