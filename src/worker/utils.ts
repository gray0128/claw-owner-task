import { Context } from "hono";
import { Bindings } from "./index";

export function getAppBaseUrl(c: Context<{ Bindings: Bindings }>): string {
  const requestUrl = new URL(c.req.url);
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith("/")
      ? c.env.BASE_URL.slice(0, -1)
      : c.env.BASE_URL;
    return base;
  }
  const host = c.req.header("x-forwarded-host") || requestUrl.host;
  const protocol = c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/**
 * 统一的 API 响应格式构造函数。
 * 所有 handler 都应使用此函数构建返回值，确保格式一致。
 */
export const apiResponse = (success: boolean, data: any, error: any = null) => ({
  success,
  data,
  error,
});

/**
 * 将 Date 对象转换为 SQLite 兼容的 UTC 时间字符串。
 * 格式："YYYY-MM-DD HH:mm:ss"
 */
export const toSqliteUtc = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

/**
 * 从 Cloudflare AI 的响应中提取文本内容。
 * AI 的返回格式可能不固定，此函数处理所有已知格式。
 */
export function extractAIContent(aiResponse: any): string {
  if (typeof aiResponse === 'string') {
    return aiResponse;
  } else if (aiResponse.choices?.[0]?.message) {
    return aiResponse.choices[0].message.content;
  } else if (aiResponse.response) {
    return aiResponse.response;
  } else if (aiResponse.result?.response) {
    return aiResponse.result.response;
  }
  return JSON.stringify(aiResponse);
}
