---
name: readme-refactor-docs-split
overview: 将 README.md 拆分重构，把技术架构、API 文档、开发路线图等内容拆到项目开发文档文件夹，README 只保留核心内容和索引引用。
todos:
  - id: explore-readme
    content: 使用 [subagent:code-explorer] 读取并分析 README.md 的完整内容结构
    status: completed
  - id: create-docs-folder
    content: 创建 docs 项目开发文档文件夹
    status: completed
    dependencies:
      - explore-readme
  - id: split-architecture
    content: 提取技术架构内容，创建 docs/技术架构.md
    status: completed
    dependencies:
      - create-docs-folder
  - id: split-api-docs
    content: 提取 API 接口内容，创建 docs/API接口文档.md
    status: completed
    dependencies:
      - create-docs-folder
  - id: split-roadmap
    content: 提取开发路线图内容，创建 docs/开发路线图.md
    status: completed
    dependencies:
      - create-docs-folder
  - id: split-structure
    content: 提取项目结构内容，创建 docs/项目结构.md
    status: completed
    dependencies:
      - create-docs-folder
  - id: refactor-readme
    content: 重构 README.md，保留核心介绍并添加文档索引链接
    status: completed
    dependencies:
      - split-architecture
      - split-api-docs
      - split-roadmap
      - split-structure
---

## 产品概述

将现有 README.md 文档进行拆分重构，将技术性内容迁移至项目开发文档文件夹，使 README 保持简洁，仅包含核心介绍和文档索引引用。

## 核心功能

- 创建项目开发文档文件夹结构
- 将技术架构内容拆分为独立文档（技术架构.md）
- 将 API 接口文档内容拆分为独立文档（API接口文档.md）
- 将开发路线图内容拆分为独立文档（开发路线图.md）
- 将项目结构说明拆分为独立文档
- 重构 README.md，保留核心内容并添加文档索引引用

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：探索当前项目结构，读取 README.md 完整内容，分析需要拆分的各部分内容
- 预期结果：获取 README.md 的完整内容结构，识别技术架构、API文档、开发路线图、项目结构等各部分的具体位置和内容