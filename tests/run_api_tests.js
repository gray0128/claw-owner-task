import test from 'node:test';
import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8787/api';
const API_KEY = process.env.TASK_API_KEY || 'your_test_api_key_here';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

// 工具函数：封装带鉴权的 fetch
async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers }
  });
  
  if (res.status === 204) {
    return { status: res.status };
  }
  
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = text;
  }
  return { status: res.status, body };
}

test('【安全测试】S-01: 无效鉴权请求测试', async () => {
  const res = await fetch(`${BASE_URL}/info`, {
    headers: { 'Authorization': 'Bearer WRONG_KEY' }
  });
  assert.strictEqual(res.status, 403, '应该返回 403 状态码');
});

test('【AI自发现】AI-01: 获取系统自发现信息', async () => {
  const { status, body } = await apiFetch('/info');
  assert.strictEqual(status, 200);
  assert.ok(body.data.version, '应该包含版本号');
  assert.ok(body.data.enums.status, '应该包含状态枚举');
  assert.ok(body.data.timezone !== undefined, '应该包含系统时区');
});

test('【基础功能】F-01, F-02, AI-03, AI-02: 创建带标签和元数据的任务', async () => {
  const payload = {
    title: '自动化测试任务1',
    description: '- [ ] 检查功能\n- [ ] 验证数据',
    priority: 'high',
    source: 'openclaw',
    tags: ['紧急', '自动化测试'],
    metadata: { "test_id": "auto_001" },
    due_date: '2026-03-05T10:00:00.000Z'
  };

  const { status, body } = await apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  assert.strictEqual(status, 201, '应该成功创建任务并返回 201');
  assert.ok(body.data.id, '应该返回生成的任务 ID');
  
  // 保存生成的任务 ID 以供后续测试使用
  process.env.TEST_TASK_ID = body.data.id;
});

test('【异常测试】T-02: 非法时间格式校验', async () => {
  const payload = {
    title: '非法时间测试',
    due_date: '2026/03/05 10:00:00' // 非 ISO 格式
  };

  const { status } = await apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  assert.strictEqual(status, 400, '非法时间格式应返回 400 错误');
});

test('【异常测试】F-08: 标签格式校验测试 (包含特殊字符)', async () => {
  const payload = {
    name: 'Invalid Tag !'
  };

  const { status } = await apiFetch('/tags', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  assert.strictEqual(status, 400, '包含特殊字符的标签名应被拒绝，返回 400 错误');
});

test('【基础功能】F-06: 修改任务', async () => {
  const taskId = process.env.TEST_TASK_ID;
  assert.ok(taskId, '未能获取测试任务 ID，可能是创建任务用例失败');

  const payload = {
    title: '修改后的自动化测试任务',
    priority: 'low',
    tags: ['已修改'],
    due_date: '2026-03-06T12:00:00.000Z',
    remind_at: '2026-03-06T11:30:00.000Z'
  };

  const { status } = await apiFetch(`/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  
  assert.strictEqual(status, 200, '应该成功修改任务');

  // 验证修改是否生效
  const { body: checkBody } = await apiFetch(`/tasks?q=修改后的自动化测试任务`);
  const updatedTask = checkBody.data.find(t => t.id === parseInt(taskId));
  
  assert.ok(updatedTask, '修改后的任务应能被检索到');
  assert.strictEqual(updatedTask.priority, 'low', '优先级应更新为 low');
  assert.strictEqual(updatedTask.due_date, '2026-03-06T12:00:00.000Z', '截止时间应更新');
  assert.strictEqual(updatedTask.remind_at, '2026-03-06T11:30:00.000Z', '提醒时间应更新');
});

test('【基础功能】F-03: 更新任务状态至 completed', async () => {
  const taskId = process.env.TEST_TASK_ID;
  assert.ok(taskId, '未能获取测试任务 ID');

  const { status, body } = await apiFetch(`/tasks/${taskId}/complete`, {
    method: 'PUT'
  });
  
  assert.strictEqual(status, 200, '应该成功标记任务为完成');
});

test('【基础功能】F-07: 任务列表多维度筛选', async () => {
  // 此时数据库中应该有刚刚完成的任务
  const { status, body } = await apiFetch('/tasks?status=completed&priority=low&tag_name=已修改');
  
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.data), '应该返回任务数组');
  
  const foundTask = body.data.find(t => t.id === parseInt(process.env.TEST_TASK_ID));
  assert.ok(foundTask, '通过多维度筛选应能找到之前创建并修改的任务');
});

test('【基础功能】F-07: 按截止日期和提醒日期筛选', async () => {
  // 使用之前修改的任务日期进行筛选
  const dueDate = '2026-03-06'; // DATE(?) 只比较日期部分
  const { status, body } = await apiFetch(`/tasks?due_date=${dueDate}`);
  
  assert.strictEqual(status, 200);
  assert.ok(body.data.some(t => t.id === parseInt(process.env.TEST_TASK_ID)), '应该能根据截止日期筛选到任务');

  const remindDate = '2026-03-06';
  const { status: rStatus, body: rBody } = await apiFetch(`/tasks?remind_at=${remindDate}`);
  
  assert.strictEqual(rStatus, 200);
  assert.ok(rBody.data.some(t => t.id === parseInt(process.env.TEST_TASK_ID)), '应该能根据提醒日期筛选到任务');
});

test('【周期逻辑】REC-01: 完成每日任务 (daily) 并验证下次时间', async () => {
  // 1. 创建一个每日重复任务
  const payload = {
    title: '每日锻炼',
    priority: 'medium',
    recurring_rule: 'daily',
    due_date: '2026-03-05T08:00:00.000Z',
    remind_at: '2026-03-05T07:30:00.000Z'
  };

  const { status, body } = await apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  assert.strictEqual(status, 201);
  const taskId = body.data.id;

  // 2. 标记任务为完成
  const { status: completeStatus } = await apiFetch(`/tasks/${taskId}/complete`, {
    method: 'PUT'
  });
  assert.strictEqual(completeStatus, 200);

  // 3. 验证下次时间 (应推迟 24 小时)
  const { body: checkBody } = await apiFetch(`/tasks/${taskId}`);
  const task = checkBody.data;
  
  assert.strictEqual(task.status, 'pending', '周期任务完成后状态应重置为 pending');
  // SQLite 返回格式可能略有不同，后端可能返回 YYYY-MM-DD HH:mm:ss 或 ISO
  // 检查是否推迟了一天
  const nextDueDate = new Date(task.due_date.includes('Z') ? task.due_date : task.due_date + 'Z');
  const expectedDueDate = new Date('2026-03-06T08:00:00.000Z');
  assert.strictEqual(nextDueDate.toISOString(), expectedDueDate.toISOString(), '截止时间应推迟 24 小时');
  
  const nextRemindAt = new Date(task.remind_at.includes('Z') ? task.remind_at : task.remind_at + 'Z');
  const expectedRemindAt = new Date('2026-03-06T07:30:00.000Z');
  assert.strictEqual(nextRemindAt.toISOString(), expectedRemindAt.toISOString(), '提醒时间应同步推迟 24 小时');
});

test('【基础功能】F-04: 删除任务测试', async () => {
  const taskId = process.env.TEST_TASK_ID;
  assert.ok(taskId, '未能获取测试任务 ID');

  const { status } = await apiFetch(`/tasks/${taskId}`, {
    method: 'DELETE'
  });
  
  assert.strictEqual(status, 200, '应该成功删除任务');
  
  // 删除后的任务不应该出现在列表中
  const checkRes = await apiFetch(`/tasks?q=修改后的自动化测试任务`);
  const foundTask = checkRes.body.data.find(t => t.id === parseInt(taskId));
  assert.ok(!foundTask, '删除后的任务不应被检索到');
});

test('【提醒机制】R-01: 模拟云端提醒检查 (Bark)', async () => {
  const { status, body } = await apiFetch('/remind/check?channel=cloud', {
    method: 'POST'
  });
  assert.ok(status >= 200 && status < 300, '提醒检查接口应正常工作');
  assert.ok(Array.isArray(body.data.tasks), '应该返回任务数组');
});

test('【提醒机制】R-02: 模拟 Agent 提醒检查', async () => {
  const { status, body } = await apiFetch('/remind/check?channel=agent', {
    method: 'POST'
  });
  assert.strictEqual(status, 200, 'Agent 提醒检查应正常返回 200');
  assert.ok(Array.isArray(body.data.tasks), 'Agent 频道应该返回任务数组');
});
