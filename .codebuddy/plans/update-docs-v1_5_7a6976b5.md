---
name: update-docs-v1.5
overview: 更新项目文档，记录 v1.5 版本的移动端优化和模型配置修复
todos:
  - id: explore-readme
    content: 使用 [subagent:code-explorer] 查看当前 README.md 的结构和最新更新部分的格式
    status: completed
  - id: update-changelog
    content: 在 README.md 的最新更新部分添加 v1.5 版本更新记录，包含移动端优化、ModelSelector改进和模型配置修复
    status: completed
    dependencies:
      - explore-readme
---

## 产品概述

更新项目文档，记录 v1.5 版本的功能改进和问题修复内容。

## 核心功能

- 更新 README.md 的"最新更新"部分，添加 v1.5 版本更新记录
- 记录移动端 AI 对话页面的 MiniPlayer 进度条和紧凑布局优化
- 记录 ModelSelector 组件新增的 compact 属性
- 记录精选功能中 qwen-turbo 模型更换为 qwen3-max 的修复