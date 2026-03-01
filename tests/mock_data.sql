-- 模拟数据初始化 (v1.0.0)

-- 1. 初始化分类
INSERT INTO categories (name, color) VALUES 
('工作', '#FF0000'),
('生活', '#00FF00'),
('学习', '#0000FF');

-- 2. 初始化标签
INSERT INTO tags (name) VALUES 
('紧急'),
('待讨论'),
('OpenCLaw 自动生成'),
('代码重构');

-- 3. 初始化任务 (包含 AI 元数据、来源和周期规则)
INSERT INTO tasks (title, description, status, priority, category_id, source, metadata, recurring_rule, due_date, remind_at) VALUES 
(
  '购买咖啡豆', 
  '- [ ] 曼特宁
- [ ] 耶加雪菲', 
  'pending', 
  'medium', 
  2, 
  'user', 
  NULL, 
  'none', 
  '2026-03-01 10:00:00', 
  '2026-03-01 09:45:00'
),
(
  '周会报告准备', 
  '整理上周开发进度', 
  'in_progress', 
  'high', 
  1, 
  'openclaw', 
  '{"chat_id": "conv_12345", "project": "claw-owner-task"}', 
  'weekly', 
  '2026-03-02 09:00:00', 
  '2026-03-02 08:30:00'
),
(
  '每日英语练习', 
  '多邻国 15 分钟', 
  'pending', 
  'low', 
  3, 
  'user', 
  NULL, 
  'daily', 
  '2026-03-01 22:00:00', 
  '2026-03-01 21:00:00'
),
(
  '已取消的任务', 
  '不做了', 
  'cancelled', 
  'low', 
  2, 
  'user', 
  NULL, 
  'none', 
  '2026-02-28 10:00:00', 
  NULL
);

-- 4. 建立任务与标签的关联
INSERT INTO task_tags (task_id, tag_id) VALUES 
(1, 2), -- 咖啡豆：待讨论
(2, 1), -- 周会报告：紧急
(2, 3), -- 周会报告：OpenCLaw 自动生成
(2, 4); -- 周会报告：代码重构

-- 5. 校验查询 (可选)
-- SELECT t.title, c.name as category, GROUP_CONCAT(tg.name) as tags 
-- FROM tasks t 
-- LEFT JOIN categories c ON t.category_id = c.id
-- LEFT JOIN task_tags tt ON t.id = tt.task_id
-- LEFT JOIN tags tg ON tt.tag_id = tg.id
-- GROUP BY t.id;
