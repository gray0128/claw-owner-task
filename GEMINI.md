# GEMINI.md

This file provides guidance to AI Agents (including Claude and Gemini) when working with code in this repository.

## 项目概述
**AI优先的任务管理系统 (claw-owner-task)** 是一个专为个人用户 and **AI Agent (OpenCLaw)** 设计的任务管理系统。支持跨平台部署，提供云端自触发提醒（Bark）与 Agent 本地提醒的双重能力。

## 技术栈与核心组件
- **后端 (API)**: Cloudflare Workers + TypeScript。提供自发现接口、Bark 推送（含审计日志记录与过期清理）、元数据处理、强制鉴权及严格的时间格式校验。
- **数据库**: Cloudflare D1 (SQLite)。存储 UTC 时间、AI 上下文及关联标签。
- **跨平台 CLI (`claw-task`)**: 基于 Rust 开发的高性能二进制实现。支持多平台构建、静默版本检查及一键自动升级。
- **前端 (Web)**: 原生 HTML/CSS/JS (No-build)，利用浏览器原生 ES Modules，极简且功能完备。

## 当前状态
项目已完成全链路开发，并通过了完整的自动化测试验证。
- **AI 友好设计**: 支持自发现接口 (`info`)、全局 `--json` 输出、任务 `metadata` 溯源、**Telegram 对话式交互**。
- **健壮性**: 实现了 API 层的 ISO 日期格式严格校验，并配备了广泛的自动化测试套件。
- **提醒机制**: 已实现云端 (**Bark & Telegram**) 与本地 (Agent) 多路径提醒触发逻辑，并配备了日志审计与滚动清理系统。

## 核心原则 (AI 交互准则)
### 1. AI 友好性与自发现
- 始终通过 `/api/info` 获取系统状态、分类、标签及配置信息，避免参数幻觉。
- 利用 `metadata` (JSON) 字段存储任务生成的原始对话上下文，实现背景溯源。
- CLI 全局支持 `--json` 输出，确保 AI 能准确解析返回结果。

### 2. 安全与时区规范
- **强制鉴权**: 所有非静态请求必须携带 Bearer Token (`TASK_API_KEY`)。
- **敏感信息保护**: 配置文件（如 `wrangler.toml`、`.dev.vars`）中严禁出现生产环境的敏感信息（如真实的 `database_id`、`TASK_API_KEY`、`BARK_URL` 等）。每次提交代码前必须检查，确保不会将敏感数据泄露到版本控制中。
- **时区一致性**: 后端存储 UTC，根据 `USER_TIMEZONE` 动态转换 I/O 时间。
- **数据完整性**: API 层对 `due_date` 和 `remind_at` 执行严格特 ISO/YYYY-MM-DD 格式校验。

### 3. 质量保障与自动化
- 项目内置完整的自动化 API 测试套件 (`npm test`)，覆盖 CRUD、异常边界、自发现及提醒触发逻辑。
- **本地测试注意**: 为防止本地 Shell 环境变量覆盖 `.dev.vars`，本地执行测试时需显式指定测试 Key：`TASK_API_KEY=your_test_api_key_here npm test`。

## 开发与测试命令
- **开发服务器**: `npm run dev` (wrangler dev)
- **运行 API 测试**: `TASK_API_KEY=your_test_api_key_here npm test` (运行 `tests/run_api_tests.js` 时需指定测试 Key 避免 Shell 环境变量覆盖)
- **运行 Rust 测试**: `cd cli-rust && cargo test`
- **数据库迁移**: `npm run db:migrate:local`
- **CLI (Rust)**: `cd cli-rust && cargo run -- [command]`
- **编译 Rust 版**: `cd cli-rust && cargo build --release`

## 目录结构
- `src/worker/`: 后端中间件、服务逻辑、数据库迁移。
- `src/web/`: 原生 Web 界面。
- `cli-rust/`: 跨平台命令行工具 (Rust 高性能版)。
- `docs/`: 包含 `需求说明.md`, `技术架构.md`, `开发计划.md`, `缺陷修复记录.md`。
- `tests/`: 包含测试计划、Mock 脚本及自动化 API 测试脚本 (`run_api_tests.js`)。

## 缺陷修复与已知问题
本项目维护了详细的缺陷修复记录，包含环境配置、时间解析等常见问题的解决方案：
- [缺陷修复记录](docs/缺陷修复记录.md)

## 参考资料
- [OpenCLaw 工具文档](https://docs.openclaw.ai/zh-CN/tools)

---
**版本**: 1.8.3
**更新时间**: 2026-03-06 11:00:00
**变更历史**:
- 2026-03-06: 更新至 1.8.3，为 `claw-task list` 命令增加 `-i` / `--id` 参数支持，支持通过 ID 快速筛选任务并以表格形式展示。
- 2026-03-06: 更新至 1.8.2，实现单条任务独立查看页面（Task Share Page），支持 24 小时有效期的临时分享链接。
    - 后端：实现基于 UUID 的分享链接机制、公共渲染路由及过期自动清理。
    - CLI (Rust)：任务表格新增 `ViewURL` 展示；创建/更新任务后显式提示在线查看链接。
- 2026-03-06: 更新至 1.8.1，为 Telegram Webhook 增加斜杠命令支持（`/summary`, `/add`）。支持命令直接拦截并调用对应业务逻辑，绕过 AI 解析以提升响应确定性。
- 2026-03-05: 更新至 1.8.0，正式接入 Telegram 机器人。支持将其作为云端推送通道，并实现了对话式 AI 任务管理 Webhook（支持 Markdown 优化输出、账号权限锁定及全量 AI 指令集对接）。
- 2026-03-05: 更新至 1.7.8，彻底重构提醒系统架构。移除了造成死锁与状态纠缠的 `reminded` 字段。当前 Cron 探测频率提升至**每分钟 1 次**。系统在推送后，会自动计算并将周期任务推移至**下一个未到来的未来时间**；非周期任务及「已完成任务」会自动将其 `remind_at` 字段置空。这实现了提醒轮转与人工 Complete 验证流的完全解耦。
- 2026-03-05: 更新至 1.7.7，深度修复时区一致性问题。后端重构了日期归一化与本地化逻辑，确保所有 API 输出均为用户时区格式；Rust CLI 新增自动注入 `X-User-Timezone` 头，实现了跨时区的精准时间解析与展示。
- 2026-03-05: 更新至 1.7.6，优化 AI 操作反馈。后端更新接口现返回完整任务对象；Rust CLI 增强了对 AI `update`/`create` 等操作的结果展示，改为以表格形式呈现任务详情（含提醒时间），提升用户感知。
- 2026-03-05: 更新至 1.7.5，完成 AI 语义解析与模糊指代功能的闭环开发并成功部署。支持 `has_remind`/`has_due` 快速筛选；实现基于未闭环任务列表的 AI 上下文自动注入（JSON 序列化 + 12万字符截断）；同步更新测试计划与全链路自动化 API 测试脚本。
- 2026-03-05: 发布 1.7.0，重大架构优化：彻底移除 Node.js 版 CLI 及其相关依赖（commander），全面转向基于 Rust 实现的高性能二进制 CLI。精简项目结构，专注单一高效的终端工具维护。
- 2026-03-05: 发布 1.6.4，新增 `ENABLE_AI` 后端开关（默认为开启），允许通过 Worker 配置禁用 AI 语义解析功能；更新 README，补充 Cloudflare Workers AI 每日调用限额及隐私说明。
- 2026-03-05: 发布 1.6.3，优化 CLI 交互：AI 解析提示语更新为英文并增加动态动画；延长 Rust CLI 超时时间至 60s 以适配长耗时 AI 解析；更新 README 明确 `sudo` 升级指令及别名限制。
- 2026-03-05: 发布 1.6.2，修复 GLM-4 返回内容中的循环引用 Bug（500 错误）；优化 CLI 交互，新增 AI 解析中状态提示。
- 2026-03-05: 更新至 1.6.1，优化 AI 语义解析 System Prompt，增加显式的 JSON 响应示例以提升 GLM-4 模型输出的稳定性。
- 2026-03-05: 发布 1.6.0，正式引入 AI 语义任务处理系统。后端集成 GLM-4.7-Flash 模型，支持自然语言解析、业务逻辑闭环流转、安全 white-list 拦截及审计溯源。
- 2026-03-05: 更新至 1.5.6 (CLI)，将 reqwest 切换至 `rustls-tls`，修复跨平台构建时的编译错误。
- 2026-03-05: 整合 GEMINI.md 与 CLAUDE.md 文档内容，统一项目认知。
- 2026-03-05: 发布 CLI 专属版本 1.5.5，为 GitHub Actions 构建脚本引入 `cross` 工具，增加 `aarch64-unknown-linux-musl` 和 `x86_64-unknown-linux-musl` 的完整静态链接构建支持。
- 2026-03-05: 更新至 1.7.1，新增敏感信息保护规则。
- 2026-03-04: 更新至 1.7.0，实现 Bark 推送日志审计系统。
- 2026-03-03: 更新至 1.6.0，新增任务完成时间 (`completed_at`) 字段。
- 2026-03-03: 更新至 1.5.2，修复 CLI 更新任务时报错：非法的 ISO 时间格式问题。
- 2026-03-03: 更新至 1.5.1，新增 `GET /api/tasks/:id` 接口。
- 2026-03-02: 更新至 1.5.0，移除 Bun 打包方案，改用 Rust 实现高性能 CLI 二进制。
- 2026-03-02: 更新至 1.3.7，引入自动化 API 测试套件。
- 2026-03-01: 更新至 1.3.3，优化 AI 友好度。
- 2026-03-01: 更新至 1.3.2，全局命令更名为 `claw-task`。
- 2026-03-01: 更新至 1.3.1，引入详细开发计划清单。
- 2026-03-01: 更新至 1.3.0，支持跨平台解耦提醒路径。
---