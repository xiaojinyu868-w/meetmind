# Workshop Windows — 应用窗口组件

> AI 原生应用的窗口化展示系统，包含思维导图、信息图、回响卡等可视化窗口。

## 目录结构

```
src/components/apps/windows/
├── WorkshopWindowManager.tsx    # 窗口管理器（多窗口协调）
├── AppRenderSurface.tsx         # 统一应用渲染面（浮窗 / 对话内联 / 独立页共用）
├── MindmapWindow.tsx            # 思维导图窗口（692行，已拆分）
├── mindmap-layout.ts           # 思维导图布局引擎
├── InfographicWindow.tsx       # 信息图窗口（699行，已拆分）
├── infographic-window-data.ts  # 信息图数据处理
├── AppWindowShell.tsx          # 六类独立结果页统一外壳：保留现场的返回、学习动作、状态、成果就地分享与重做；手机端折叠次要文字
├── app-window-shell-tone.ts    # 独立应用页色调策略（闪卡使用低亮度沉浸背景，避免白底眩光）
├── FlashcardsWindow.tsx        # 闪卡训练窗口（主动回忆 → 翻面 → 自评 → 只复习薄弱卡）
├── flashcards-window-model.ts  # 闪卡结果正规化、证据锚点与时间显示 helper
├── flashcards-share-actions.ts # 闪卡试听成果外传文案/文件名 helper
├── QuizWindow.tsx              # 课堂测验（客观题即时反馈 + 主观题对照自评 + 薄弱题复练）
├── quiz-window-model.ts        # 测验题正规化、答案匹配、证据锚点与时间显示 helper
├── CheatsheetWindow.tsx        # 考试速查表：纸面轻编辑、打印约束与真实分页预览
├── CheatsheetRichText.tsx      # 速查表紧凑富文本：GFM / KaTeX / 表格 / Mermaid，屏幕与打印共用
├── cheatsheet-window-model.ts  # 纸张预设、容量、分页、来源标签与 Markdown 纯函数
├── TeachBackWindow.tsx         # 讲给同桌听：入口即教室（预习态场景 + 底部毛玻璃「走上讲台」面板，无清单页）→ 像素小教室讲课 / 打字降级 → 四象限核对（服务端重试 + 客户端首败自动重试 + 429 区分 + 分阶段等待文案）→ 结果卡（四象限地图揭示 + 盲区朱批强调、[MM:SS] 跳回证据、盲区/已知缺口可「就这点再讲一次」单项重讲、完成写课后学习黑板）
├── TeachBackClassroom.tsx      # 像素小教室 v2：讲台（说话时麦克风音柱亮起）+ 前后两排 Octo 学生（讲完一段有学生会心点头、提问随机学生举手冒泡、窄屏自动减员防叠桌）+ 黑板粉笔目标讲到哪划掉哪（/api/apps/teach-back/cover-check 轻量覆盖检测，讲到了≠讲对了）
├── TeachBackQuadrantMap.tsx    # 结果揭示仪式：自信×有据四象限地图，目标棋子错峰落位，盲区朱批脉冲，没讲到的虚线单列
├── teach-back-window-model.ts  # 目标正规化、四象限分组视图（盲区优先）、时间戳 helper
├── PodcastWindow.tsx           # 音频概览：优先播放、折叠制作详情与稳定失败兜底
├── podcast-window-model.ts     # 播客前端纯 helper：过滤 provider/HTTP 原始失败章节
├── AppWindowPlaceholder.tsx    # 六类应用共用的整理中 / 空结果 / 失败状态
├── EvidenceLabel.tsx           # 证据标签组件
└── index.ts                    # barrel 导出
```

## 已清理（M14.6+）

- `StudyReportWindow.tsx` / `StudyReportDocument.tsx` / `study-report-document-model.ts`(+test) — 学习报告已删除（产品定位错位 + 非视频场景死入口）

## 已拆分的窗口

### MindmapWindow（思维导图）

- 主文件：`MindmapWindow.tsx` — 渲染逻辑（导图 / 大纲双视图）
- 手机结果页和桌面三栏中的窄学习区先展示可读大纲，用户点“导图”后再探索；默认视图必须依据应用容器真实宽度而非浏览器宽度，避免宽屏下把中间窄栏误判成大画布。用户主动切换后不再被 ResizeObserver 抢回。结果页本身已是完整学习现场，禁止默认再 portal 一层全屏盖住返回栏；只有用户主动点“全屏”才进入沉浸层。画布使用 Pointer Events，触屏与鼠标共享拖动逻辑。
- 布局引擎：`mindmap-layout.ts` — 树布局算法、v7 色板、位置计算

**设计原则（第一性原理：用户打开就该一眼读懂整张图）**：
- v7 米白纸感（`PALETTE.bg` 近白），不是深色画布；落在复习工作区里不突兀。
- 节点 = **文字坐在一道墨线上**（朱批/松墨手感），不是七彩填色方块。
- **按一级主干分配颜色**：每条主干 + 整棵子树共享一种双签名色（pine / vermilion 家族交替，见 `BRANCH_HUES` / `getBranchHue`），一眼看出"我在哪条主干"——这是可读性的真正来源，而不是按 depth 彩虹。
- **默认整图展开 + 自适应**（`buildFullExpandedSet` + `fitToView`，带 `MIN_READABLE_SCALE` 可读下限），独立页必须给画布稳定的可视高度，不能出现“做好了但空白”。节点必须展示完整内容，不用省略号制造信息缺口；长分支由无限画布缩放和平移承接。
- **全屏沉浸阅读**：右上角 / 控制条「全屏」把导图 portal 到 `document.body` 全屏层（Esc 退出），给一块真正看得清的大画布。
- 从窄栏的大纲态点击「全屏」必须直接进入导图画布，不能先放大大纲。
- 滚轮缩放**以光标为锚**（光标下内容不动），拖拽平移；这是"顺手"的关键。

布局引擎纯函数（可单元测试，见 `mindmap-layout.test.ts`）：
- `getBranchHue()` / `branchIndexOf()` — 按一级主干取色
- `getHueByDepth()` — 旧的按深度取色（保留供测试 / 大纲兜底）
- `measureText()` / `compactVisualLabel()` / `getFontSize()` — 文本宽度、完整标签正规化与字号
- `buildLayoutTree()` / `subtreeHeight()` / `assignPositions()` / `flattenLayout()` / `boundingBox()` — 树布局

### QuizWindow（课堂测验）

- 客观题（single / judge）= 选项卡片即时判分；主观题（short / fill）= 看参考答案 + 一次轻量自评标记，统一进 `isAnswerCorrect` 计分。
- 主观题只有在用户对照答案并完成自评后才算完成；“只练需要回看的”会建立真实题目子集，不能只是跳到第一道错题后继续混入已会题。
- 结果页表达“这一轮答稳 / 还要回看”，不使用 A-F 等级给学习者贴标签；citation 必须显示并在复习工作区支持回到课堂原声。
- **铁律**：选项质量在生成端把关——`quiz.plugin.ts` 绝不再造 "该片段主要讨论了X / 跳过了话题 / 未做实质分析" 这类模板干扰项；凑不出有内容的干扰项就出成简答题（`resolveTypeAndOptions`）。
- 题目会落在三栏中间窄区，生成契约必须控制阅读成本：通常 4–6 题、每题只检验一个判断，中文题干约 32 字内 / 英文约 24 词内，选项更短；题面沿用原文主要语言，解析用简体中文，不用“根据上下文 / Based on…”重复铺垫。
- 手机窄屏隐藏题卡两侧的桌面箭头，保留滑动、题号点和底部主动作；提交后不得同时出现两个同名“下一题”按钮。
- 解析里不得显示“段002 / 片段003”等内部索引；旧结果由 `sanitizeQuizExplanation` 防御性清洗，真实证据统一由可回跳 citation 承接。

### FlashcardsWindow（闪卡）

- 默认先主动回忆，提示需要用户主动展开；翻面后才允许标记“记得 / 没想起”，避免答案泄露和无效自评。
- “只复习没想起的”会真正建立薄弱卡子集，而不是从第一张重新跑完整卡组；重新开始才恢复全部闪卡。
- 插件 citation 必须经 `flashcards-window-model.ts` 保留到卡片背面；在复习工作区有 seek 能力时可一键回到课堂原声。
- 3D 翻面时不可见卡面必须同步退出无障碍树，隐藏答案面的证据按钮也不能获得焦点，避免读屏提前泄题。
- 卡片整面仍可点击，但“想好后翻面”必须是真实可聚焦按钮，不能要求学生先猜出隐藏手势或只靠空格键。
- 长时间练习使用米白画布 + 白纸卡片，答案面用极淡松墨绿区分；松墨绿 / 朱批红只表达掌握状态，禁止整页纯黑、彩虹渐变、emoji 和装饰性光晕。

### InfographicWindow（信息图）

- 主文件：`InfographicWindow.tsx` — 渲染逻辑
- 数据文件：`infographic-window-data.ts` — 场景预设/风格预设/数据转换
- 信息图是结果型应用：进入后由 AI 直接生成并先展示完整成品，不把配置表单当作首屏。
- 只有用户主动点“调整”后，才展开尺寸、视觉感觉与一句补充要求；其余版式、语言和信息密度继续由模型判断。
- 结果与调整态统一使用米白纸感 / 松墨绿体系，禁止深色工作台、装饰渐变和解释设计决策的开发者文案。
- 图片 provider 未配置或单次生成失败时，不能把用户悄悄丢进配置表单；先用已生成的草案交付一张米白纸感的可读信息图，保留复制要点、重试图片和主动调整三个出口。
- 首次没有 `AppExecutionResult` 时，“生成信息图”必须先调用 `onGenerateDraft` 走 `/api/apps/execute` 形成有课堂依据的智能草案，再请求图片；禁止直接拿截断原文拼一个通用 fallback 当正式生成结果。

### 速查表 / 音频概览 / 共用状态

- `CheatsheetWindow` 只有一种形态，对齐学术 cheat sheet 传统（LaTeX 排印）：A4 纵向 · 3 栏 · 正文衬线密排（Georgia / 宋体栈，展示衬线只留给首页大标题，小字号下展示体笔画会让整页文字显歪）· 首页居中衬线标题带粗线 · booktabs 表格 · 居中展示公式。**默认黑白 + 荧光笔高亮**（strong 术语像被黄色马克笔划过，黑白打印呈浅灰依然可读）；彩色语义引导词（粉=定义 / 藏青=公式 / 青=流程 / 紫=对比 / 红=易错 / 绿=例题）是唯一可选开关。**没有其他排版选项**——密度恒定，内容少就留白，绝不把少量内容拉松铺满页面；顶栏只保留标题统计和「复制文字 / 打印 PDF」两个成品出口。学生直接在纸面预览上改、删、收起条目（这是内容编辑，不是排版选择），触屏端每条内容通过可见的更多按钮展开“编辑 / 不打印”，长文档底部持续保留“复制 / 打印 PDF”动作条。
- 条目排版对齐学术 cheat sheet 的密排传统：单行正文与术语同段自然折行（黑白模式术语墨色、彩色模式引导词着色，正文均为端正衬线），多行（列表 / 表格 / 图）条目保持上下结构；strong 条目用荧光笔高亮术语（`.cs-hl`），不整行铺色。
- 分页必须由 `cheatsheet-window-model.ts` 的同一“页 → 栏 → 语义区块”容量模型驱动屏幕和打印；页内按均衡栏高装栏（像 LaTeX multicols，栏满到均衡高度即换栏），容量系数按 A4 纵向 3 栏衬线的真实行高校准。速查表是纸面优先产物：条目不逐条展示时间戳，只在首页页首标注一行来源清单（课次 / 大纲 / 真题）；每条的证据回锚仍保留在产物数据里作为防编造质量门槛，不在纸面露出。
- 条目正文由 `CheatsheetRichText` 渲染 GFM（标题 / 列表 / 引用 / 代码 / 表格）、行内与块级 KaTeX、紧凑 Mermaid 图；表格和图表必须避免跨栏断裂，打印时隐藏图表工具栏并限制高度。富文本是为了压缩关系，不得把普通定义装饰成大图。
- `PodcastWindow` 把“能否立刻听”作为第一任务；音频成功时脚本与章节默认折叠，音频失败时保留稳定重试动作并直接展开已经生成的脚本，让一次失败仍然有可用产物，且不透出 provider 原始错误。
- 失败产物中若混入“播客音频未生成 / 403 Forbidden / 建连失败”等技术章节，必须在 `podcast-window-model.ts` 过滤；前端只保留可重试状态、脚本和真实课堂证据。
- 播客只有真实音频，或至少真实脚本 / 章节存在时，才写入“最近学习现场”；禁止把 provider 调用结束当作用户已经得到可播放成品。
- `AppWindowPlaceholder` 是六类应用整理中、空结果与失败状态的唯一展示；等待态使用“同学正在整理”，禁止重新出现“酿”等内部隐喻。

## AppRenderSurface

统一承接 `AppExecutionResult` → 具体应用 UI 的分发。`WorkshopWindowManager`、应用矩阵独立页、课堂/复习对话内联应用都必须复用这里，避免同一个 app 维护两套 UI。六类独立结果页（包括信息图）同时复用 `AppWindowShell`；不得为单个应用复制返回栏、标题或状态说明。可分享的场景成果必须通过 `headerActions` 把 `ShareArtifactAction` 放在结果标题旁，不能要求用户回到矩阵再找分享。

## 排版约定

- 应用窗口默认使用 `canvas/card/ink/divider` 平涂体系；闪卡这类长时间主动回忆页面允许使用低亮度沉浸背景以降低白底眩光，但不要把这种深色舞台扩散到普通文档 / 报告类应用。
- 报告类应用优先复用疏朗文档排版：大标题、长正文 1.75+ 行高、主内容和建议区分栏。
- 用户可见应用名称必须避开 `COPY.bannedWords`；`app-catalog.test.ts` 也会额外守住目录里的 `AI / 生图 / 智能生成` 等技术词。
- 独立应用页和 `AppWindowShell` 不展示内部 sessionId 或模型选择；动作文案使用“再做一版 / 已做好 / 没做好”。返回链接必须保留游客身份等入口参数，不能把体验中的用户送去登录页；手机顶栏隐藏长副标题和重复按钮文字，只保留可访问名称。

## WorkshopWindowManager

负责多窗口的：
- 打开/关闭/层叠管理
- 窗口间通信
- 拖拽位置持久化（localStorage）

## 关键回归测试

- `mindmap-layout.test.ts` — 布局、短标签与完整标题保留
- `infographic-window-data.test.ts` — 首次先取智能草案、已有结果不重复生成、旧调用方 fallback
- `flashcards-window-model.test.ts` / `quiz-window-model.test.ts` / `podcast-window-model.test.ts` — 三类结果正规化与失败清洗
- `cheatsheet-window-model.test.ts` — 纸张容量、单双面页数、跨页不丢条目、多源引用标签与富文本容量约束

## 证据标签（EvidenceLabel）

将转录片段锚定到 AI 生成内容上，支持：
- 点击跳转到对应时间点
- 引用文本高亮
- 多标签折叠展开
