import { createShareUrl } from './share';
import { createListUrl } from './list';

/** 命令解析结果 */
export interface ParsedCommand {
  isCommand: boolean;
  name: string | null;    // 'summary', 'add', null (AI 透传)
  args: string | null;     // 命令参数
}

/**
 * 统一的 Bot 命令解析器。
 * 支持 /command, /command@bot, /command args 等格式。
 */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([^\s@]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  
  if (!match) {
    return { isCommand: false, name: null, args: null };
  }

  return {
    isCommand: true,
    name: match[1].toLowerCase(),
    args: match[2] || null,
  };
}

/**
 * 构建通用的 AI 结果描述（纯文本版本）。
 * 各渠道的 formatResponse 可基于此结果添加平台特定格式。
 */
export interface FormattedResult {
  success: boolean;
  action?: string;
  taskCount?: number;
  singleTaskUrl?: string;
  listUrl?: string;
  taskTitle?: string;
  taskId?: number;
  message?: string;
  dueDate?: string;
  remindAt?: string;
  viewUrl?: string;
  errorMessage?: string;
}

/**
 * 将 AI handler 的返回结果提炼为结构化对象。
 * 各渠道的 format 函数可以用这个对象来生成各自格式的消息。
 */
export async function extractResult(c: any, aiResult: any): Promise<FormattedResult> {
  if (!aiResult.success) {
    return {
      success: false,
      errorMessage: aiResult.error?.message || JSON.stringify(aiResult.error),
    };
  }

  const result: FormattedResult = { success: true };
  const { ai_parsed, data } = aiResult;

  if (ai_parsed?.action) {
    result.action = ai_parsed.action;
  }

  if (data && Array.isArray(data)) {
    result.taskCount = data.length;
    if (data.length === 1) {
      let url = data[0].view_url;
      if (!url && data[0].id) {
        url = await createShareUrl(c, data[0].id);
      }
      result.singleTaskUrl = url;
      result.taskTitle = data[0].title;
    } else if (data.length > 1) {
      const intentStr = result.action ? `解析动作: ${result.action}` : '任务列表';
      result.listUrl = await createListUrl(c, data, intentStr);
    }
  } else if (data && typeof data === 'object') {
    result.taskTitle = data.title;
    result.taskId = data.id;
    result.message = data.message;
    result.dueDate = data.due_date;
    result.remindAt = data.remind_at;
    result.viewUrl = data.view_url;
  }

  return result;
}

/** 检查 AI 响应是否因 Isolate 挂起而过期 */
export function isResponseExpired(startTime: number, maxMs: number = 60000): boolean {
  const elapsed = Date.now() - startTime;
  if (elapsed > maxMs) {
    console.warn(`AI response expired due to Isolate suspension (${elapsed}ms). Dropping message.`);
    return true;
  }
  return false;
}
