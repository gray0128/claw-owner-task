import { sendBarkNotification } from './bark';
import { sendTelegramNotification, escapeTelegramHTML } from './telegram';
import { getTenantAccessToken, sendFeishuMessage } from './feishu';

export interface NotifyOptions {
  /** 通知标题（用于 Bark） */
  title: string;
  /** 纯文本内容（用于飞书） */
  plainText: string;
  /** HTML 内容（用于 Telegram，可选，不提供则用 plainText） */
  htmlText?: string;
  /** 可选的链接 URL（用于 Bark 点击跳转） */
  linkUrl?: string;
}

export interface NotifyResult {
  success: boolean;
  payloads: string[];
}

/**
 * 向所有已配置的渠道发送通知。
 * @param env  Worker 环境变量
 * @param options 通知内容
 * @param source  触发来源，用于跳过来源渠道避免重复通知
 */
export async function sendToAllChannels(
  env: any,
  options: NotifyOptions,
  source?: string
): Promise<NotifyResult> {
  const payloads: string[] = [];
  let anySuccess = false;

  // Bark
  if (env.BARK_URL && (!source || source === 'cron')) {
    try {
      const { success, payload } = await sendBarkNotification(
        env.BARK_URL,
        options.title,
        options.plainText,
        options.linkUrl
      );
      if (success) { anySuccess = true; if (payload) payloads.push(payload); }
    } catch (e) { console.error('Bark push failed:', e); }
  }

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && 
      (!source || source === 'cron' || source === 'telegram')) {
    try {
      const text = options.htmlText || escapeTelegramHTML(options.plainText);
      const { success, payload } = await sendTelegramNotification(
        env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text, 'HTML'
      );
      if (success) { anySuccess = true; if (payload) payloads.push(payload); }
    } catch (e) { console.error('Telegram push failed:', e); }
  }

  // 飞书
  if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_ALLOWED_CHAT_ID &&
      (!source || source === 'cron' || source === 'feishu')) {
    try {
      const token = await getTenantAccessToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      if (token) {
        const chatId = env.FEISHU_ALLOWED_CHAT_ID.split(',')[0].trim();
        let res = await sendFeishuMessage(token, chatId, options.plainText, 'chat_id', 'text');
        if (!res.success) {
          await sendFeishuMessage(token, chatId, options.plainText, 'open_id', 'text');
        }
        anySuccess = true;
      }
    } catch (e) { console.error('Feishu push failed:', e); }
  }

  return { success: anySuccess, payloads };
}
