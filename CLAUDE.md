# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个任务管理工具，用于让 openclaw 跟踪用户任务并进行提醒。提供：
- **CLI 工具** (`claw-task`): 跨平台，由 AI Agent 或终端用户使用。
- **Web 界面**: 极简的原生 HTML/CSS/JS 管理后台。
- **云端后端**: Cloudflare Workers API 与 D1 数据库。

## 技术栈

- **后端**: Cloudflare Workers + TypeScript + Hono-like routing
- **数据库**: Cloudflare D1 (SQLite)
- **CLI**: Node.js 版 (`src/cli/`) + Rust 高性能版 (`cli-rust/`)，功能一致
- **前端**: 原生 HTML/CSS/JS（浏览器原生 ES Modules，无构建步骤）
- **测试**: Node.js 原生 Test Runner (`npm test`)，Rust 单元测试 (`cargo test`)

## 当前状态

项目已完成全链路开发（后端 API、CLI、Web 界面），并通过了自动化测试验证。
- **AI 友好设计**: 支持自发现接口 (`info`)、全局 `--json` 输出、任务 `metadata` 溯源。
- **健壮性**: 实现了 API 层的 ISO 日期格式严格校验，并配备了 100% 通过率的自动化测试套件。
- **提醒机制**: 已实现云端 (Bark) 与本地 (Agent) 双路径提醒触发逻辑。

## 开发与测试命令

- **开发服务器**: `npm run dev` (wrangler dev)
- **运行 API 测试**: `npm test` (运行 `tests/run_api_tests.js`)
- **运行 Rust 测试**: `cd cli-rust && cargo test`
- **数据库迁移**: `npm run db:migrate:local`
- **CLI (Node.js)**: `node src/cli/index.js [command]` 或 `claw-task [command]` (若已 link)
- **CLI (Rust)**: `cd cli-rust && cargo run -- [command]` 或编译后直接运行二进制
- **编译 Rust 版**: `cd cli-rust && cargo build --release`

## 开发注意事项

- **前端**: 使用浏览器原生 ES Modules，不要添加 npm/packaging 相关的构建配置。
- **校验**: 保持 API 层的输入校验与 CLI 端的解析一致。
- **测试**: 任何对核心 API 的修改都必须运行 `npm test` 确保无回归。

## 参考资料

- [OpenCLaw 工具文档](https://docs.openclaw.ai/zh-CN/tools)
---
**版本**: 1.3.0
**更新时间**: 2026-03-02 13:21:00
