import { Hono } from 'hono';
import { Bindings } from '../index';
import { taskHandlers } from './tasks';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format response
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

const WHITELIST = ['create', 'update', 'query', 'complete'];

// Robust JSON extractor
function tryParseJson(text: string): any {
    try {
        // 1. Try direct parse
        return JSON.parse(text);
    } catch (e) {
        // 2. Try to extract JSON from markdown code blocks
        const match = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
        if (match && match[1]) {
            try {
                return JSON.parse(match[1].trim());
            } catch (e2) {}
        }
        
        // 3. Try to find the first '{' and last '}'
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.substring(start, end + 1));
            } catch (e3) {}
        }
    }
    return null;
}

app.post('/', async (c) => {
  const { text } = await c.req.json();
  if (!text) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Text is required' }), 400);

  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const now = new Date();
  const localTime = now.toLocaleString('zh-CN', { timeZone: userTimezone });

  const systemPrompt = `You are an AI assistant for a task management system.
Your goal is to parse natural language input into a structured JSON action.
Current Date/Time: ${localTime} (${userTimezone}).
Available actions:
- create: Create a new task. Fields: title (string, required), description (string), priority (low, medium, high), due_date (YYYY-MM-DD HH:mm:ss), remind_at (YYYY-MM-DD HH:mm:ss), tags (string array).
- update: Update an existing task. Fields: id (number, required), title (string), description (string), priority (low, medium, high), status (pending, completed), due_date (YYYY-MM-DD HH:mm:ss), remind_at (YYYY-MM-DD HH:mm:ss), tags (string array).
- query: Search for tasks. Fields: q (string, title search), status (pending, completed), priority (low, medium, high), tag_name (string), due_date (YYYY-MM-DD), remind_at (YYYY-MM-DD).
- complete: Mark a task as completed. Fields: id (number, required).

Return ONLY a JSON object with "action" and "fields" keys.
Action MUST be one of: create, update, query, complete.

Response Format Example:
{
  "action": "create",
  "fields": {
    "title": "Task title",
    "due_date": "YYYY-MM-DD HH:mm:ss",
    "priority": "medium",
    "tags": ["tag1", "tag2"]
  }
}

If the intent is not clear or not covered, return {"action": "none", "fields": {}}.
For dates/times, resolve relative terms based on the Current Date/Time.
`;

  try {
    const aiResponse: any = await c.env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ]
    });

    // Handle different response structures from Workers AI
    let rawContent = '';
    if (typeof aiResponse === 'string') {
        rawContent = aiResponse;
    } else if (aiResponse.response) {
        rawContent = aiResponse.response;
    } else if (aiResponse.result && aiResponse.result.response) {
        rawContent = aiResponse.result.response;
    } else {
        rawContent = JSON.stringify(aiResponse);
    }

    const result = tryParseJson(rawContent);

    if (!result || !result.action) {
      return c.json(response(false, null, { 
        code: 'AI_PARSE_ERROR', 
        message: 'Could not parse AI response as valid JSON action.',
        debug: rawContent 
      }), 500);
    }

    const { action, fields = {} } = result;

    if (action === 'none') {
        return c.json(response(false, null, { code: 'NOT_UNDERSTOOD', message: 'AI could not understand the task action from your input.' }), 400);
    }

    if (!WHITELIST.includes(action)) {
      return c.json(response(false, null, { code: 'FORBIDDEN', message: `Action '${action}' is not allowed via AI.` }), 403);
    }

    // Audit Metadata
    const aiContext = {
      original_prompt: text,
      raw_parse_result: result,
      timestamp: new Date().toISOString()
    };

    // Internal Dispatch
    let internalRes;
    switch (action) {
      case 'create':
        fields.metadata = { ... (fields.metadata || {}), ai_context: aiContext };
        internalRes = await taskHandlers.request('/', {
          method: 'POST',
          body: JSON.stringify(fields),
          headers: { 'Content-Type': 'application/json', 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      case 'update':
        const updateId = fields.id;
        if (!updateId) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Task ID is required for update' }), 400);
        delete fields.id;
        fields.metadata = { ... (fields.metadata || {}), ai_context: aiContext };
        internalRes = await taskHandlers.request(`/${updateId}`, {
          method: 'PUT',
          body: JSON.stringify(fields),
          headers: { 'Content-Type': 'application/json', 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      case 'query':
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    // For tags or other arrays in query
                    queryParams.append(key, value.join(','));
                } else {
                    queryParams.append(key, String(value));
                }
            }
        }
        internalRes = await taskHandlers.request(`/?${queryParams.toString()}`, {
          method: 'GET',
          headers: { 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      case 'complete':
        if (!fields.id) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Task ID is required for complete' }), 400);
        internalRes = await taskHandlers.request(`/${fields.id}/complete`, {
          method: 'PUT',
          headers: { 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      default:
        return c.json(response(false, null, { code: 'NOT_SUPPORTED', message: `Action ${action} is not yet implemented.` }), 500);
    }

    const data = await internalRes.json();
    return c.json({ ...data, ai_parsed: result });

  } catch (err: any) {
    return c.json(response(false, null, { code: 'AI_ERROR', message: err.message }), 500);
  }
});

export const aiHandlers = app;
