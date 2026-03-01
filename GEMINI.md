# GEMINI.md

## 项目概述
**龙虾主人简易任务工具 (claw-owner-task)** 是一个专为个人用户和 **AI Agent (OpenCLaw)** 设计的任务管理系统。支持跨平台部署，提供云端自触发提醒（Bark）与 Agent 本地提醒的双重能力。

### 核心组件
- **后端 (API)**: Cloudflare Workers + TypeScript。提供自发现接口、Bark 推送、元数据处理及强制鉴权。
- **数据库**: Cloudflare D1 (SQLite)。存储 UTC 时间、AI 上下文及关联标签。
- **跨平台 CLI (`claw-task`)**: Node.js 编写，支持多环境下的任务管理与提醒。
- **前端 (Web)**: 原生 HTML/CSS/JS (No-build)，极简且功能完备。

## 核心原则 (AI 交互准则)

### 1. AI 友好性与自发现
- 始终通过 `/api/info` 获取系统状态、分类、标签及配置信息，避免参数幻觉。
- 利用 `metadata` (JSON) 字段存储任务生成的原始对话上下文，实现背景溯源。

### 2. 安全与时区规范
- **强制鉴权**: 所有非静态请求必须携带 Bearer Token (`TASK_API_KEY`)。
- **时区一致性**: 后端存储 UTC，根据 `USER_TIMEZONE` 动态转换 I/O 时间。

### 3. 跨平台兼容性
- CLI 不应依赖特定操作系统的私有脚本，应基于标准 Node.js 开发并兼容不同 Shell。

## 开发路线图 (Roadmap)

1.  **Phase 1 (Foundation)**: 完成 Cloudflare Workers 与 D1 数据库的基础架构搭建及核心 API。
2.  **Phase 2 (CLI)**: 实现跨平台 Node.js 命令行工具，支持 CRUD 及提醒检查。
3.  **Phase 3 (Web)**: 实现无构建步骤的 Web 管理界面。
4.  **Phase 4 (Integration)**: 完成 OpenCLaw 集成与多端联合验证。

## 目录结构
- `src/worker/`: 后端中间件、服务逻辑、数据库迁移。
- `src/web/`: 原生 Web 界面。
- `src/cli/`: 跨平台命令行工具。
- `docs/`: 包含 `需求说明.md`, `技术架构.md`, `开发计划.md`。
- `tests/`: 包含测试计划、Mock 脚本及 API 验证脚本。

---
**版本**: 1.3.3
**更新时间**: 2026-03-01 15:00:00
**变更历史**:
- 2026-03-01: 更新至 1.3.3，优化 AI 友好度：解除 `--help` 环境变量依赖、全局新增 `--json` 参数、新增 `delete` 命令容错、兼容 ISO 时间格式解析。
- 2026-03-01: 更新至 1.3.2，全局命令更名为 `claw-task`；支持按名称打标签、多分隔符及正则校验。
- 2026-03-01: 更新至 1.3.1，引入详细开发计划清单并同步项目进度。
- 2026-03-01: 更新至 1.3.0，支持跨平台解耦提醒路径。
