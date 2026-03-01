---
name: claw-task
description: 龙虾主人专属的任务管理器 CLI 工具。用于记录用户的待办事项、读取任务列表以及更新任务状态。
metadata:
  {
    "openclaw": {
      "requires": {
        "bins": ["claw-task"]
      },
      "emoji": "📋"
    }
  }
---

# 使用说明
当你需要帮助用户管理任务、查询日程或记录新的待办事项时，请使用 `run_shell_command` 调用 `claw-task` 命令。

## 调用规范与最佳实践
1. **必须使用机器友好输出**：调用任何查阅类指令时，请务必追加 `--json` 参数，以便你更好地解析返回的结构化数据（例如 `claw-task list --json`）。
2. **标记数据来源**：当你自主为用户创建任务时，请通过参数指定 `--source openclaw`，以便系统进行上下文溯源。如果有相关的推理或聊天上下文，可通过 `--metadata` 传入 JSON 字符串。
3. **模糊搜索**：如果用户意图模糊，你可以先使用 `claw-task list -q "关键词" --json` 进行检索。
4. **标签处理**：无需查询标签 ID，直接传递名称即可（如 `--tags "紧急,工作"`），系统会自动处理创建与关联。
5. **周期任务**：对于周期性任务，可传入 `--rule daily` 或 `weekly`, `monthly` 等。

## 命令示例
- `claw-task list --json`：列出所有任务 (支持 `-s` 状态, `-p` 优先级, `-c` 分类, `-t` 标签, `--due` 日期 等过滤)
- `claw-task add "完成季度报告" -d "包含财务数据" --source openclaw --tags "工作,P1" --due "2026-03-05 18:00:00" --json`：添加一个任务
- `claw-task complete 1 --json`：完成 ID 为 1 的任务
- `claw-task info --json`：查看系统支持的状态、枚举、分类和标签
