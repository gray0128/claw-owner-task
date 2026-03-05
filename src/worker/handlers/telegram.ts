import { Hono } from 'hono';
import { Bindings } from '../index';
import { aiHandlers } from './ai';
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
