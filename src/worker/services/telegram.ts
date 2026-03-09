/**
 * Send a notification to Telegram.
 * 
 * @param token Telegram Bot Token
 * @param chatId Target Chat ID
 * @param text Formatted text message 
 * @param parseMode Parse mode (e.g. 'MarkdownV2' or 'HTML'). Default 'HTML' because it's easier to escape than MarkdownV2.
 * @returns Object indicating success/failure and the response payload
 */
export async function sendTelegramNotification(
    token: string,
    chatId: string,
    text: string,
    parseMode: 'HTML' | 'MarkdownV2' = 'HTML'
): Promise<{ success: boolean; payload?: string; error?: any }> {
    if (!token || !chatId) {
        return { success: false, error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const body = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const responseData = await response.json() as any;

        if (response.ok && responseData.ok) {
            return { success: true, payload: JSON.stringify(responseData) };
        } else {
            console.error(`[Telegram] Failed to send message: ${response.status} ${response.statusText}`, responseData);
            return { success: false, error: responseData };
        }
    } catch (error) {
        console.error('[Telegram] Request error:', error);
        return { success: false, error };
    }
}

/**
 * Escapes characters for Telegram HTML parse mode.
 */
export function escapeTelegramHTML(text: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Get public download URL for a Telegram voice/audio file.
 */
export async function getTelegramVoiceUrl(token: string, fileId: string): Promise<string | null> {
    const url = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
    try {
        const response = await fetch(url);
        const data: any = await response.json();
        if (data.ok && data.result?.file_path) {
            return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
        }
        console.error('[Telegram] getFile failed:', data);
        return null;
    } catch (error) {
        console.error('[Telegram] getFile request error:', error);
        return null;
    }
}
