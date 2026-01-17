---
name: fix-outdated-model-and-verify-changes
overview: 修复项目中使用的过时模型配置（qwen-turbo），并确认之前的移动端布局修改已正确生效
todos:
  - id: find-models
    content: 使用 [subagent:code-explorer] 搜索 AVAILABLE_MODELS 定义，获取可用模型列表
    status: completed
  - id: fix-model
    content: 修复 highlight-service.ts 中的 FAST_MODEL 配置，替换为有效模型
    status: completed
    dependencies:
      - find-models
  - id: check-mobile-ui
    content: 使用 [subagent:code-explorer] 搜索移动端AI对话页面和MiniPlayer相关代码
    status: completed
  - id: verify-changes
    content: 验证模型修复和移动端UI修改是否正确生效
    status: completed
    dependencies:
      - fix-model
      - check-mobile-ui
---

## 产品概述

修复项目中存在的过时模型配置问题，并验证之前的移动端UI优化是否正确生效。

## 核心功能

- 修复精选功能中使用的过时模型 qwen-turbo，替换为 AVAILABLE_MODELS 中支持的有效模型
- 验证移动端AI对话页面的布局优化是否已正确应用
- 验证MiniPlayer进度条的样式修改是否生效

## 问题分析

### 问题一：过时模型配置

- 位置：`highlight-service.ts` 文件
- 问题：`FAST_MODEL` 变量使用了 `qwen-turbo`，该模型不在 `AVAILABLE_MODELS` 列表中
- 影响：精选功能调用AI时报错"未知模型: qwen-turbo"

### 问题二：移动端UI修改未生效

- 需要排查的内容：
- AI对话页面的布局优化代码是否正确
- MiniPlayer进度条样式是否正确应用
- 可能存在缓存问题或代码未正确部署

## 修复方案

### 模型配置修复

1. 查找 `AVAILABLE_MODELS` 中可用的快速模型
2. 将 `FAST_MODEL` 的值从 `qwen-turbo` 替换为有效模型（如 `qwen-turbo-latest` 或其他可用模型）

### UI验证方案

1. 检查移动端相关组件的代码实现
2. 确认样式文件是否正确引用
3. 验证条件渲染逻辑是否正确

## 修改文件

```
src/
├── services/
│   └── highlight-service.ts  # 修改：更新 FAST_MODEL 配置
```

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：搜索项目中的 AVAILABLE_MODELS 定义，找到所有可用模型列表；同时搜索移动端布局相关组件代码
- 预期结果：获取有效模型列表，确定应使用的替代模型；定位移动端UI相关代码文件