-- 模拟数据初始化 (v1.1.1)
-- 此脚本用于在 D1 或本地 SQLite 数据库中填充测试数据。
-- 注意：所有时间均以 UTC 格式存储。

-- 清理已有数据（以便重复执行）
DELETE FROM task_tags;
DELETE FROM tasks;
DELETE FROM tags;
DELETE FROM categories;

-- 重置自增 ID（可选，主要为了与外部测试用例的 ID 强匹配）
DELETE FROM sqlite_sequence WHERE name IN ('categories', 'tags', 'tasks');

-- 1. 初始化分类 (ID: 1-工作, 2-生活, 3-学习)
INSERT INTO categories (id, name, color) VALUES 
(1, '工作', '#FF0000'),
(2, '生活', '#00FF00'),
(3, '学习', '#0000FF');

-- 2. 初始化标签 (ID: 1-紧急, 2-待讨论, 3-AI生成, 4-代码重构)
-- 注意：符合新需求，标签名仅允许中英文和数字，禁止空格和特殊字符。
INSERT INTO tags (id, name) VALUES 
(1, '紧急'),
(2, '待讨论'),
(3, 'AI生成'),
(4, '代码重构');

-- 3. 初始化任务 (包含 AI 元数据、来源和周期规则)
-- 设置明确的 id 以便与 api_tests.http 脚本对应
INSERT INTO tasks (id, title, description, status, priority, category_id, source, metadata, recurring_rule, due_date, remind_at, completed_at) VALUES 
(
  1,
  '购买咖啡豆', 
  '- [ ] 曼特宁
- [ ] 耶加雪菲', 
  'pending', 
  'medium', 
  2, 
  'user', 
  NULL, 
  'none', 
  '2026-03-01T10:00:00.000Z', 
  '2026-03-01T09:45:00.000Z',
  NULL
),
(
  2,
  '周会报告准备', 
  '整理上周开发进度', 
  'in_progress', 
  'high', 
  1, 
  'openclaw', 
  '{"chat_id": "conv_12345", "project": "claw-owner-task"}', 
  'weekly', 
  '2026-03-02T09:00:00.000Z', 
  '2026-03-02T08:30:00.000Z',
  NULL
),
(
  3,
  '每日英语练习', 
  '多邻国 15 分钟', 
  'pending', 
  'low', 
  3, 
  'user', 
  NULL, 
  'daily', 
  '2026-03-01T22:00:00.000Z', 
  '2026-03-01T21:00:00.000Z',
  NULL
),
(
  4,
  '已取消的任务', 
  '不做了', 
  'cancelled', 
  'low', 
  2, 
  'user', 
  NULL, 
  'none', 
  '2026-02-28T10:00:00.000Z', 
  NULL,
  NULL
),
(
  5,
  '已完成的任务', 
  '旧项目的交接', 
  'completed', 
  'medium', 
  1, 
  'user', 
  NULL, 
  'none', 
  '2026-02-25T10:00:00.000Z', 
  NULL,
  '2026-02-26T10:00:00.000Z'
);

-- 4. 建立任务与标签的关联
INSERT INTO task_tags (task_id, tag_id) VALUES 
(1, 2), -- 咖啡豆：待讨论
(2, 1), -- 周会报告：紧急
(2, 3), -- 周会报告：AI生成
(2, 4); -- 周会报告：代码重构

-- 5. 校验查询 (可选)
-- SELECT t.title, c.name as category, GROUP_CONCAT(tg.name) as tags 
-- FROM tasks t 
-- LEFT JOIN categories c ON t.category_id = c.id
-- LEFT JOIN task_tags tt ON t.id = tt.task_id
-- LEFT JOIN tags tg ON tt.tag_id = tg.id
-- GROUP BY t.id;
