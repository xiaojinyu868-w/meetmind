# NotebookLM 对标落地计划 v1（2026Q1）

更新时间：2026-02-14
目标：按三层架构完成可落地迭代，优先国内部署（火山引擎 + 阿里云），并保持当前自动化回归稳定。

## 1. 三层架构定义（本项目统一口径）

### 1.1 数据采集层（Ingestion）

职责：把多来源内容统一转成可检索、可引用的“标准化源（Source）”。

本期必须支持：
- 录音（实时 + 上传）
- 视频链接（B 站优先）
- 文档文件：PDF / DOCX / PPTX / TXT / MD / HTML / 图片（OCR）
- 直接粘贴文本（Copied text）
- 网页 URL（文章抽取）

统一产物：
- `SourceRecord`（source_id、type、title、origin、raw_blob_ref、parse_status、language）
- `SegmentRecord`（source_id、start_ms/end_ms、text、tokens、modality）

### 1.2 数据处理/存储/记忆层（Processing + Memory）

职责：
- 清洗与解析：ASR、OCR、文档解析、网页正文抽取
- 结构化：分段、去重、时间戳对齐、引用锚点
- 检索记忆：向量检索 + 元数据过滤 + 会话写回

本期要求：
- 统一 chunk 规则（文本、音频转写、OCR 文本）
- 统一 citation 协议（所有下游输出都可回链到 source + 时间戳/段落）
- 结果落盘（IndexedDB + 服务端持久化）

### 1.3 应用矩阵层（App Matrix）

职责：将同一份学习材料映射成不同学习产物。

本期目标（对标 NotebookLM Studio）：
- Audio Overview（音频概览）
- Video Overview（视频概览）
- Mind Map（思维导图）
- Reports（报告）
- Flashcards（记忆卡）
- Quiz（测验）
- Infographic（信息图）
- Slide Deck（幻灯片）
- Data Table（数据表）

---

## 2. 当前项目现状（代码基线）

已具备：
- 数据采集：录音、音频上传、B 站链接导入
- 处理层：ASR + 转录分段 + 基础时间轴 + 锚点体系
- 应用矩阵：已落地插件底座 + `knowledge-cards` 闭环
- 前端模型切换：已支持按已配置 key 动态显示可用模型（Qwen/Gemini/OpenAI）

缺口：
- 文档采集与粘贴文本入口尚未形成统一 ingestion 流
- 应用矩阵与 NotebookLM Studio 的产物覆盖仍有差距
- 国内供应商分工尚未固化成清晰执行规范

---

## 3. 对标基线（NotebookLM）

公开能力（官方信息汇总）：
- 支持多类型来源导入（含网页、PDF、文本等）
- Studio 支持生成多种学习产物（含 Audio/Video Overviews、Mind Maps、Reports 等）
- 近期持续强化学习工具（Flashcards、Quizzes 等）

结论：
- 我们的方向正确，但需补齐采集入口、产物广度和统一 citation 规范。

---

## 4. 国内供应商策略（按功能而不是按“抽象层”）

### 4.1 单供应商固定入口（不做切换）

- AI 播客（Audio Overview 生产链）
  - 默认固定火山引擎能力（你已明确偏好）
  - 前端不展示 provider 切换

### 4.2 多供应商可切换入口（前端显式切换）

- AI 对话
- 摘要/报告
- Quiz / Flashcards / Mind Map（文本与结构生成）

执行规则：
- 前端显示“可用模型”= 根据已配置 key 动态显示
- 后端不再引入额外 provider 抽象层
- 当前已实现基础模型动态启用，后续只增量扩展功能映射

### 4.3 环境变量规范（收敛）

火山 AI 播客鉴权统一字段：
- `VOLCENGINE_PODCAST_APP_ID`
- `VOLCENGINE_PODCAST_ACCESS_TOKEN`
- `VOLCENGINE_PODCAST_SECRET_KEY`

火山 Ark（通用大模型）字段：
- `VOLCENGINE_ARK_API_KEY`
- `VOLCENGINE_ARK_BASE_URL`
- `VOLCENGINE_ARK_MODEL`

---

## 5. 开源复用策略（避免重复造轮子）

候选参考：
- `run-llama/notebookllama`：NotebookLM 风格开源实现，含 ingest + retrieval + audio overview 方向
- `mshumer/OpenNotebook`：NotebookLM 风格开源项目（前后端整体参考）
- `githubsaturn/open-notebook`：强调“NotebookLM 替代”方向（功能拆解可参考）

复用原则：
- 可直接复用：文档解析流程、RAG 管线、产物生成 Prompt 框架
- 需改造复用：与本项目数据模型/时间戳引用协议对齐
- 不建议直接照搬：整站 UI 与状态管理（会放大迁移成本）

---

## 6. 里程碑（4 周可执行）

### M1（第 1 周）：采集层补齐
- 新增 Source 入口：文档上传 + 粘贴文本 + 网页 URL
- 统一 source parser 接口
- 验收：同一会话可混合导入 3 种以上来源并可检索

### M2（第 2 周）：记忆层统一
- 统一 chunk/citation 协议
- 建立 source->segment->citation 回链
- 验收：所有 AI 输出均可定位到原段落/时间戳

### M3（第 3 周）：应用矩阵扩容
- 首批上线：Quiz、Flashcards、Mind Map、Reports
- 保持现有 `cards/tasks/trace` 协议
- 验收：每个应用均支持“生成-预览-写回任务”闭环

### M4（第 4 周）：Audio/Video Overview + 稳定性
- 音频概览接火山固定链路
- 视频概览打通（可先模板化生成 + TTS 合成）
- 验收：端到端可用，自动化回归通过

---

## 7. 测试与验收（必须）

自动化门槛：
- `npm run lint` 通过
- `npm run build` 通过
- `npm run e2e` 全通过

新增测试建议：
- Source ingest 回归：文档、文本、网页三类
- App matrix 回归：Quiz/Flashcards/MindMap 任务写回
- Provider 可用性回归：仅显示已配置模型

---

## 8. 本仓库已完成的本次改动

- 前端模型选择器支持按已配置 key 动态显示 provider（Qwen/Gemini/OpenAI）
- 默认模型选择加入合法性校验（避免落到不可用模型）
- Gemini key 兼容 `GOOGLE_API_KEY` / `GEMINI_API_KEY`
- `.env.example` 中火山播客鉴权字段收敛为 `APP_ID + ACCESS_TOKEN + SECRET_KEY`
- 自动化现状：`lint`、`build`、`e2e` 均通过

---

## 参考链接（官方/主仓）

NotebookLM 官方：
- https://workspaceupdates.googleblog.com/2025/03/notebooklm-expands-to-over-50-languages.html
- https://workspaceupdates.googleblog.com/2025/07/google-vids-is-now-included-in-notebooklm-plus.html
- https://workspaceupdates.googleblog.com/2025/09/notebooklm-adds-quizzes-and-enhanced-source-discovery.html
- https://support.google.com/notebooklm/answer/16150426
- https://support.google.com/notebooklm/answer/16433606

火山引擎：
- https://www.volcengine.com/docs/6561/1105162
- https://www.volcengine.com/docs/82379/1399008

阿里云百炼：
- https://www.alibabacloud.com/help/zh/model-studio/get-api-key
- https://bailian.console.aliyun.com/?apiKey=1#/api-key

开源项目：
- https://github.com/run-llama/notebookllama
- https://github.com/mshumer/OpenNotebook
- https://github.com/githubsaturn/open-notebook
