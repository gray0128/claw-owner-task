import { Hono } from 'hono';
import { Bindings } from '../index';
import { taskHandlers } from './tasks';
import { apiResponse as response, extractAIContent } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

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
  if (c.env.ENABLE_AI === 'false' || c.env.ENABLE_AI === false) {
    return c.json(response(false, null, { code: 'DISABLED', message: 'AI functionality is disabled by administrator.' }), 403);
  }

  const { text } = await c.req.json();
  if (!text) return c.json(response(false, null, { code: 'INVALID_INPUT', message: 'Text is required' }), 400);

  const userTimezone = (c.get as any)('userTimezone') || 'Asia/Shanghai';
  const now = new Date();
  const localTime = now.toLocaleString('zh-CN', { timeZone: userTimezone });

  // Fetch system info to provide context to AI
  const infoRes = await c.env.DB.prepare('SELECT id, name FROM categories').all();
  const categories = infoRes.results.map(r => `${r.name}(id:${r.id})`).join(', ');
  const tagsRes = await c.env.DB.prepare('SELECT name FROM tags').all();
  const existingTags = tagsRes.results.map(r => r.name).join(', ');

  // Fetch active tasks for fuzzy matching context
  const activeTasksRes = await c.env.DB.prepare(`
    SELECT t.id, t.title, t.description, t.priority, t.due_date, t.remind_at, t.status, 
           c.name as category_name,
           (
             SELECT json_group_array(tg.name)
             FROM task_tags tt JOIN tags tg ON tt.tag_id = tg.id
             WHERE tt.task_id = t.id
           ) as tags
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.status != "completed"
    ORDER BY t.updated_at DESC
  `).all();

  // Format results: parse tags JSON string
  const formattedTasks = activeTasksRes.results.map(row => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags as string) : []
  }));

  let activeTasksJson = JSON.stringify(formattedTasks);
  
  // Truncate if exceeds 120,000 characters to fit in 131k token window
  if (activeTasksJson.length > 120000) {
    activeTasksJson = activeTasksJson.substring(0, 120000) + '... (truncated)';
  }

  const systemPrompt = `You are an AI assistant for a task management system.
Your goal is to parse natural language input into a structured JSON action.
Current Date/Time: ${localTime} (${userTimezone}).

Available Categories: ${categories || 'None'}
Available Tags: ${existingTags || 'None'}

### Context: Active Tasks (for fuzzy matching)
${activeTasksJson}

Supported Actions and Parameters:
1. create: Create a new task.
   - title (string, required): Task title.
   - description (string): Detailed description.
   - priority (low, medium, high): Default is 'medium'.
   - category_id (number): Use the ID from the list above.
   - due_date (YYYY-MM-DD HH:mm:ss): Deadline.
   - remind_at (YYYY-MM-DD HH:mm:ss): Reminder time.
   - recurring_rule (none, daily, weekly, monthly): Repetition frequency.
   - tags (string array): Names of tags to associate.

2. update: Update an existing task.
   - id (number, required): The ID of the task to update.
   - title, description, priority, category_id, due_date, remind_at, recurring_rule, tags: Same as 'create'.
   - status (pending, completed): Change task status.

3. query: Search for tasks.
   - q (string): Search text in title or description.
   - status (pending, completed): Filter by status.
   - priority (low, medium, high): Filter by priority.
   - tag_name (string): Filter by a single tag name.
   - category_id (number): Filter by category ID.
   - due_date (YYYY-MM-DD): Filter by tasks due on this specific date.
   - remind_at (YYYY-MM-DD): Filter by tasks with a reminder on this specific date.
   - has_remind (string: "true" or "false"): Use "true" to find tasks that HAVE any reminder set, "false" for those that don't.
   - has_due (string: "true" or "false"): Use "true" to find tasks that HAVE any due date set, "false" for those that don't.

4. complete: Mark a task as completed.
   - id (number, required): The ID of the task.

Return ONLY a JSON object with "action" and "fields" keys.
Action MUST be one of: create, update, query, complete.

Response Format Example:
{
  "action": "query",
  "fields": {
    "has_remind": "true",
    "status": "pending"
  }
}

Important Instructions:
1. If the user asks for tasks with reminders (e.g., "有提醒的任务"), use action "query" with "has_remind": "true".
2. If the user provides a short phrase that sounds like a task or a test (e.g., "测试 AI 功能"), prefer "create" with that phrase as the title.
3. For dates/times, resolve relative terms (like "tomorrow", "next Monday") based on the Current Date/Time.
4. If a task ID is mentioned or can be inferred from the context (e.g., "that task", "the water task"), ensure it's mapped to the "id" field.
`;

  try {
    const aiResponse: any = await c.env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ]
    });

    // Handle different response structures
    let rawContent = extractAIContent(aiResponse);

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

    // BREAK CIRCULAR REFERENCE: Deep clone the parse result before adding it to metadata
    const rawParseSnapshot = JSON.parse(JSON.stringify(result));

    // Audit Metadata
    const aiContext = {
      original_prompt: text,
      raw_parse_result: rawParseSnapshot,
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

    const data: any = await internalRes.json();
    return c.json({ ...data, ai_parsed: result });

  } catch (err: any) {
    return c.json(response(false, null, { code: 'AI_ERROR', message: err.message }), 500);
  }
});

export const aiHandlers = app;
