import { Hono } from 'hono';
import { Bindings } from '../index';
import { taskHandlers } from './tasks';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to format response
const response = (success: boolean, data: any, error: any = null) => ({ success, data, error });

const WHITELIST = ['create', 'update', 'query', 'complete'];

app.post('/', async (c) => {
  const { text } = await c.req.json();
  if (!text) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Text is required' }), 400);

  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const now = new Date();
  
  // Format current time for AI context
  const localTime = now.toLocaleString('zh-CN', { timeZone: userTimezone });

  const systemPrompt = `You are an AI assistant for a task management system.
Your goal is to parse natural language input into a structured JSON action.
Current Date/Time: ${localTime} (${userTimezone}).
Available actions:
- create: Create a new task. Fields: title (string, required), description (string), priority (low, medium, high), due_date (ISO string or YYYY-MM-DD HH:mm:ss), remind_at (ISO string or YYYY-MM-DD HH:mm:ss), tags (string array).
- update: Update an existing task. Fields: id (number, required), title (string), description (string), priority (low, medium, high), status (pending, completed), due_date (ISO string), remind_at (ISO string), tags (string array).
- query: Search for tasks. Fields: q (string, title search), status (pending, completed), priority (low, medium, high), tag_name (string), due_date (YYYY-MM-DD), remind_at (YYYY-MM-DD).
- complete: Mark a task as completed. Fields: id (number, required).

Return ONLY a JSON object with "action" and "fields" keys. No other text.
Action MUST be one of: create, update, query, complete.
If the user's intent is not covered by these actions, return action "none".
For dates/times, resolve relative terms (tomorrow, 3pm, etc.) based on the Current Date/Time and return them in YYYY-MM-DD HH:mm:ss format.
`;

  try {
    const aiResponse: any = await c.env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    });

    let result;
    if (typeof aiResponse.response === 'string') {
        result = JSON.parse(aiResponse.response);
    } else {
        // Some models or versions might return the object directly or in a different field
        result = aiResponse;
    }

    // Sometimes the response is wrapped in a 'response' field if not using specific response_format
    if (result.response && typeof result.response === 'string') {
        try {
            result = JSON.parse(result.response);
        } catch(e) {}
    }

    const { action, fields } = result;

    if (!action || !WHITELIST.includes(action)) {
      return c.json(response(false, null, { code: 'FORBIDDEN', message: `Action '${action}' is not allowed via AI or not understood.` }), 403);
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
          if (value !== undefined && value !== null) queryParams.append(key, String(value));
        }
        internalRes = await taskHandlers.request(`/?${queryParams.toString()}`, {
          method: 'GET',
          headers: { 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      case 'complete':
        internalRes = await taskHandlers.request(`/${fields.id}/complete`, {
          method: 'PUT',
          headers: { 'X-User-Timezone': userTimezone }
        }, c.env);
        break;
      default:
        return c.json(response(false, null, { code: 'NOT_SUPPORTED', message: `Action ${action} is not yet implemented in AI dispatcher.` }), 500);
    }

    const data = await internalRes.json();
    return c.json({ ...data, ai_parsed: result });

  } catch (err: any) {
    return c.json(response(false, null, { code: 'AI_ERROR', message: err.message }), 500);
  }
});

export const aiHandlers = app;
