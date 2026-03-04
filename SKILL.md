---
name: claw-task
description: AI优先的任务管理系统 CLI。当用户要求查询、添加、完成或管理个人任务时，使用本 skill 调用 `claw-task` 命令。
---

# claw-task CLI 使用指南

本 skill 面向 **Antigravity / Claude Code / openclaw / 以及各种其他 claw** 等本地 AI coding assistant，通过 `run_command` 工具调用 `claw-task` CLI 与任务管理系统交互。

## 安装检查

```bash
# 一般情况下进行使用 -V 命令进行快速检查，以确定CLI工具是否已经安装。检查未通过再排查其他条件
claw-bash -V
```

## 前置条件

运行任何 `claw-task` 命令前，需确保用户已配置以下环境变量：

| 变量名 | 必填 | 说明 |
|---|---|---|
| `TASK_API_KEY` | ✅ 是 | API 鉴权 Bearer Token |
| `TASK_API_URL` | 否 | API 地址，默认 `http://localhost:8787/api` |

如果命令报错 `TASK_API_KEY is not set`，应提示用户配置该环境变量后重试。

## 调用规范

1. **始终使用 `--json` 参数**：所有查询类命令必须追加 `--json`，以获得机器可解析的结构化输出。
2. **标记操作来源**：当你代替用户创建任务时，使用 `--source antigravity`，便于后续溯源。
3. **先 info 后操作**：如不确定分类 ID 或系统枚举值，先执行 `claw-task info --json` 自发现。
4. **标签无需预创建**：直接在 `--tags` 传入名称，系统会自动创建不存在的标签。

## 完整命令参考

### 系统信息自发现
```bash
# 获取支持的状态、优先级、分类、标签等枚举配置
claw-task info --json
```

### 任务查询 (list)
```bash
# 列出所有任务
claw-task list --json

# 按状态筛选（pending / completed / archived）
claw-task list -s pending --json

# 按优先级筛选（low / medium / high）
claw-task list -p high --json

# 关键词搜索
claw-task list -q "季度报告" --json

# 按标签筛选
claw-task list -t "工作" --json

# 按截止日期筛选
claw-task list --due "2026-03-10" --json

# 按提醒日期筛选
claw-task list --remind "2026-03-09" --json

# 按分类筛选
claw-task list -c 1 --json

# 组合筛选
claw-task list -s pending -p high -q "报告" --json
```

### 创建任务 (add)
```bash
# 基础创建
claw-task add "完成季度报告" --source antigravity --json

# 完整参数创建
claw-task add "完成季度报告" \
  -d "包含 Q1 财务数据分析" \
  -p high \
  -c 1 \
  --due "2026-03-15 18:00:00" \
  --remind "2026-03-14 09:00:00" \
  --rule daily \
  --tags "工作,P1,财务" \
  --source antigravity \
  --metadata '{"context": "用户指定"}' \
  --json

# 携带上下文元数据（记录任务创建时的对话背景）
claw-task add "重构认证模块" \
  --source antigravity \
  --metadata '{"context": "用户在讨论安全漏洞修复时提出", "related_files": ["src/auth.ts"]}' \
  --json

# 周期性任务
claw-task add "每日站会" --rule daily --source antigravity --json
```

### 更新任务 (update)
```bash
# 修改标题和描述
claw-task update 5 -t "新标题" -d "新描述" --json

# 修改状态及优先级
claw-task update 5 -s archived -p high --json

# 修改时间信息
claw-task update 5 --due "2026-03-20 17:00:00" --remind "2026-03-19 09:00:00" --json

# 修改分类、重复规则与标签
claw-task update 5 -c 2 --rule weekly --tags "工作,紧急" --json

# 修改附加元数据
claw-task update 5 --metadata '{"context": "更新说明"}' --json
```

### 查询推送日志 (logs)
```bash
# 查询最近 50 条推送日志
claw-task logs --json

# 查询最近 10 条日志
claw-task logs -n 10 --json

# 查询特定任务相关的推送日志
claw-task logs -t 5 --json
```

### 完成任务 (complete)
```bash
claw-task complete 5 --json
```

### 删除任务 (delete)
```bash
claw-task delete 5 --json
```

### 提醒检查 (check)
```bash
# 检查并触发 agent 渠道提醒（返回当前需要提醒的任务列表）
claw-task check --channel agent --json
```

### 标签管理 (tags / add-tag)
```bash
claw-task tags --json
claw-task add-tag "新标签名" --json
```

### 分类管理 (categories / add-category)
```bash
claw-task categories --json
claw-task add-category "新分类" --color "#FF5733" --json
```

### 升级 CLI (upgrade)
```bash
# 升级到最新版本
claw-task upgrade --json
```

## 工作流示例

### 场景：用户说「帮我记一下，下周五之前要提交报告」

```bash
# Step 1: 先了解当前时间（使用 run_command 获取系统时间）
date

# Step 2: 创建任务，设置截止日期为下周五 EOD
claw-task add "提交季度报告" \
  -p medium \
  --due "2026-03-07 18:00:00" \
  --source antigravity \
  --json
```

### 场景：查看今日有哪些高优先级待办

```bash
claw-task list -s pending -p high --json
```

### 场景：用户完成了某个任务

```bash
# 先搜索确认 ID
claw-task list -q "报告" --json

# 确认 ID 后完成
claw-task complete 3 --json
```

## 响应格式说明

所有 `--json` 输出均为标准 JSON，任务对象结构如下：

```json
{
  "id": 1,
  "title": "完成季度报告",
  "description": "包含财务数据",
  "status": "pending",
  "priority": "high",
  "due_date": "2026-03-15 18:00:00",
  "remind_at": "2026-03-14 09:00:00",
  "recurring_rule": null,
  "source": "antigravity",
  "category_id": null,
  "category_name": null,
  "tags": [{ "id": 1, "name": "工作" }],
  "created_at": "2026-03-02T05:48:00Z",
  "updated_at": "2026-03-02T05:48:00Z"
}
```
