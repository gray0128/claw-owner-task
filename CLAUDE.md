# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个任务管理工具，用于让 openclaw 跟踪用户任务并进行提醒。提供：
- CLI 工具（供 openclaw 使用）
- 网页界面（供用户查看和管理任务）

## 技术栈

- **后端**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **前端**: 原生 HTML/CSS/JS（浏览器原生 ES Modules，无构建步骤）
- **部署**: Cloudflare Pages / Workers

## 当前状态

项目核心功能（后端 Cloudflare Worker API、多平台 CLI 工具以及基础前端页面）已开发完成并可用。
CLI 工具具有对 AI 高度友好的设计，包括自发现命令 `info`，全局机器可读输出参数 `--json`，以及健全的错误捕获与严格时间格式解析机制。

## 开发注意事项

- 前端使用浏览器原生 ES Modules，不要添加 npm/packaging 相关的构建配置
- 后端使用 Cloudflare Workers 生态，需要配置 `wrangler.toml`

## 参考资料

- [OpenCLaw 工具文档](https://docs.openclaw.ai/zh-CN/tools)
