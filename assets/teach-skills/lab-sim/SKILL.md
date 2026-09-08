---
name: lab-sim
title: "交互实验（lab-sim）"
description: "自包含 HTML 交互实验：单个 HTML 文档经 widget_show 动作以 iframe srcDoc 渲染进课堂，postMessage 双向通信。v2 预留——当前动作词表未启用 widget_show，本 skill 暂不对模型可见。"
disable-model-invocation: true
---

# 交互实验（lab-sim）

> 自研 skill 内容（2026-09，P2 落稿，**v2 接线**）。
> 状态：`widget_show` 动作在 `src/lib/services/teach-engine/runtime/action-map.ts`
> 标注为 v2 预留（ACTIONS_V2_RESERVED），前端 iframe srcDoc 渲染器属另一并行任务。
> 本文件先固化契约；`disable-model-invocation: true` 保证 v2 接线前模型看不到本 skill。

## 形态契约

- 实验是**一个自包含 HTML 文档**：内联 `<style>` 与 `<script>`，无外部依赖、无网络请求、无构建步骤。
- 交付动作：`{"type":"action","name":"widget_show","params":{"elementId":"lab_<slug>","html":"<完整 HTML 文档>"}}`。elementId 稳定，供 spotlight/laser 引用。
- 前端以 iframe `srcDoc` 渲染，沙箱隔离（`sandbox="allow-scripts"`），尺寸由课堂布局给定，HTML 内用 100% 宽高自适应。

## postMessage 协议（双向）

- 实验 → 课堂：`window.parent.postMessage({source:'lab-sim', elementId, type:'state'|'event'|'answer', payload}, '*')`
  - `state`：学生操作的参数快照（供老师针对性讲解）；
  - `event`：关键交互（点了什么、调到什么值）；
  - `answer`：实验内作答结果（配合 `/quiz-maker` 的实验题）。
- 课堂 → 实验：widget_setState（v2 词表）经 postMessage 下发 `{type:'setState', payload}`，HTML 内 `window.addEventListener('message', ...)` 接收并应用。

## 教学纪律

- 一个实验只隔离**一个机制/一个变量**（同 `/workshop-style` 的练习纪律）：学生动一个东西，看见一个结果。
- 实验不能是死路：任何操作都有可见反馈；错误操作是教学素材，不是异常。
- 先口播布置观察任务再展示实验（"先猜一下，再动手"）；学生操作时老师让开（discussion 语义），观察任务与结论在操作之后讲。
- HTML 内容受 `/fact-check` 实时纪律约束：模拟的物理/数学关系必须与学科事实一致。
