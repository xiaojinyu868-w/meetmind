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
├── TeachBackWindow.tsx         # 讲给同桌听：入口即教室（场景 + 底部毛玻璃「走上讲台」面板，无清单页）→ 半双工语音讲课（2026-09：分段讲，VoiceMicButton → /api/asr/oneshot 转写追加进可编辑文本框；每段经 /api/apps/teach-back/respond 让同桌（AI 学生）决定开口还是安静，开口的话经 useTeachSpeech → /api/teach/tts 出声）→ 四象限核对（/api/apps/teach-back/evaluate：服务端重试 + 客户端首败自动重试 + 429 区分 + 分阶段等待文案）→ 结果卡（headline 朗读 + 四象限地图揭示 + 盲区朱批强调、[MM:SS] 跳回证据、盲区/已知缺口可「就这点再讲一次」单项重讲、完成写课后学习黑板）
├── TeachBackSpeakPanel.tsx     # 讲课面板（teach 阶段）：同桌气泡区（最近 2 条 + 说话指示点）+ 可编辑 textarea + VoiceMicButton + 回到目标 / 讲给同桌 / 讲完了
├── use-teach-back-voice.ts     # 半双工语音 hook：submitUserSegment 同步 push turnsRef（与 evaluate 共享记录）+ 调 respond（requestId 丢弃过期响应）+ useTeachSpeech 出声；同桌不开口/请求失败一律静默
├── TeachBackClassroom.tsx      # 像素小教室（纯视觉场景）：黑板粉笔目标 + 前后两排 Octo 学生（窄屏自动减员防叠桌）；2026-08 起不再连语音、不做覆盖检测
├── TeachBackQuadrantMap.tsx    # 结果揭示仪式：自信×有据四象限地图，目标棋子错峰落位，盲区朱批脉冲，没讲到的虚线单列
├── teach-back-window-model.ts  # 目标正规化、四象限分组视图（盲区优先）、时间戳 helper
├── PodcastWindow.tsx           # 音频概览：优先播放、折叠制作详情与稳定失败兜底
├── podcast-window-model.ts     # 播客前端纯 helper：过滤 provider/HTTP 原始失败章节
├── ExplainerWindow.tsx         # 板书精讲：BoardScript → blackboard/BlackboardPlayer（v31 白纸讲义画布实时书写），头部显示标题与老师原话核对统计
├── blackboard/                 # 讲义播放器：board-model（纯函数网格/时间轴/bounds）+ BoardCanvas（v32 备课本/分栏总装）+ BoardFlow（双栏流式内容区）+ BoardFormula（KaTeX 块级公式）+ board-lecture（字阶/调色板/分栏纯函数）+ BoardWrite（token 接力显现，v32 起屏显字体）+ RoughStroke（roughjs 圈点勾画）+ useBoardPlayer（状态机 + Clock 抽象）+ BlackboardPlayer（控制条）。v32：BoardCaption（字幕）删除，鸿雷/Caveat/hanzi-writer 随手写体退役
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

### ExplainerWindow（板书精讲）

- 渲染 `explainer` 插件产出的 BoardScript（render mode `'board'`）：`blackboard/BlackboardPlayer` 驱动——AmIWrite 架构（LLM 只产「讲稿 + 板书动作 DSL」，播放器按序执行；分页不擦除；坏动作跳过不崩）。
- 窗口对 payload 再过一遍 `sanitizeBoardScript`（历史快照 / 分享链路防御），头部只放标题与引用核对统计（"N 处老师原话已核对"；有降级时提示"N 处引用未对上原话，已改为转述"），文案走 `COPY.apps.explainer`。
- 引用逐字校验与失败降级（narration 去「」+ 移出 quotes）都在服务端插件完成（`explainer-quotes.ts` + `explainer.plugin.ts`），窗口不做二次校验。
- 播放器分层（均在 `blackboard/`，纯函数层可单测）：
  - `board-model.ts` — 时间轴（`buildPageTimeline`；**v20 嘴手一体：cue 微提前 `anticipateCharsFor`——write 只提前 300ms 起笔量，嘴上开讲=落笔开始，书写与对应讲解共现（v9 按总时长倒排"念到已写完"是"一个人在讲、另一个人在写"的成因，已修正）；标注提前 500ms** + 动作时间窗预算 `budgetMs` + 书写变速 `paceScaleFor`；**v15 科学节奏：`MS_PER_CHAR` 标定 150（节奏诊断实测 cosyvoice 真实 137-163ms/字，原 280 把全轴稀释 1.8 倍）；全部动作（含无 cue、pause）统一锚定讲稿字位——消灭"cue 跟语音、非 cue 跟估算"双时间轴；段长 = 朗读估算不再被书写撑长**；**v19 人性化书写节奏：`buildWritePaceForTokens` 单一来源——每 token 耗时带确定性 hash 抖动（0.82~1.25×）+ token 间抬笔停顿（词间 70~140 / 标点 150~270 / CJK 每 4~6 字换气 190~340 / 字间微顿 25~70，全角标点按字符判定同样停顿），`estimateWriteMs` = 书写+停顿总时长（cue 倒排自动包含停顿，写完仍落在被念到的时刻）；`paceScaleFor` clamp 改 0.7~1——预算宽裕**不再拉伸书写填满窗口**（匀速慢放是"机器人写字"根源），按自然节奏写完抬笔休息，剩余窗口留给讲**；**v23 反向背压判定 `shouldDeferForInk`（纯函数：笔有积压时 write/标注延后、pause/ref 不背压）+ `MAX_INK_HOLD_MS` 3500 超时上限**）+ 逐字基准节奏（CHAR_PACE/`charPaceMs`）+ 字符分类（`isLatinBoardChar`/`isAsciiBoardPunct`）+ `hashSeed`；布局引擎拆在 `board-layout.ts`（行数限制）。同步架构的权威参考映射见 `docs/BOARD_PLAYER_SYNC.md`。
  - `board-timing.ts` — **节奏诊断打点通道**（v15）：段起播/念完/闸门等待/放行/write 写完/降级 广播 `board:timing` CustomEvent，`scripts/board-rhythm-audit.ts` 收集做逐段节奏分析；生产零开销。
  - `board-layout.ts` — **排版权收归播放器**：`layoutBoardPage` 流式布局（字号分级、折行、缩进、overflow 收缩；**v25 密度提升（2026-08-19 用户实测"板书密度太小、像低质量草稿本"根修）：主字号整体上抬 ~15%（title 0.12 / term 0.092 / step 0.066 / note 0.052，写满的页面由收缩路径兜底）+ 稀疏放大——内容装不满可用高 80% 时按比例放大字号（上限 1.5×，重折行后仍装得下才采用），真人老师内容少就写大字把黑板有组织撑满，三两行小字浮空板是草稿不是板书**）；`layoutWithExtras` **追加式布局（v11 不变式：已写在板上的字永远不动）**——页级 write 的 rect 原样来自 layoutBoardPage，extras 从内容底部续排、固定字号、不触发全局收缩，左栏装不下换右栏；**v22 右栏排布修正（2026-08-19 实拍"题目与示范同行相撞、另一份压字幕"根修）**：右栏从栏顶向下排、垂直避撞跳过所有与右半板相交的已放置内容（含越过中线的宽 extras——旧实现只避页级 write 是撞车根因），换栏与缩字号都按折行后真实高度判定（旧实现按单行高，多行 extra 底边溢出字幕区），缩字号后重折行重避撞；**v24 分区 + 双栏候选 + 字幕区红线（2026-08-19 用户拍题实拍"extras weave 乱/压字幕与字幕双影/clamp 叠影"根修）**：页级内容写满上半板（baseBottom > 50%）时 extras 优先进右栏从栏顶向下排（功能区固定，不 weave；疏朗页优先左栏续排）；每个 extra 在左右两栏各评估候选位（右栏避撞 + 缩字号），取字号更大的落位——一栏塞满用另一栏的空；两栏都装不下先把底边 clamp 进字幕区上沿（绝不压字幕），clamp 位仍与已放置内容相撞则**弃写**（`dropped` 零尺寸占位，BoardCanvas 串行链与渲染都跳过，内容仍由口述传达——黑板物理写满时真人老师也不再往上写）；`resolveTargetRect`（wN → bounds，仅作实测 fallback）；`toVirtualRect`（视口 → 960×540 虚拟坐标，含 border/transform 缩放，纯函数有单测）。
  - `annotation-measure.tsx` — **标注 bounds 实测**：字墨级（笔顺字量内部 path 的真实像素、字体字量字元 span）；**layout 变化（checkpoint extras 上板触发整页重排）必须重测——v9 偏移根因就是重排后标注留在旧坐标**；字体未加载完等 `document.fonts.ready` 复测；`?debug=bounds` 把实测 rect 画细线框。mark（勾/叉）落目标右肩。
  - `BoardCanvas.tsx` — **v32 备课本皮肤（2026-08-21 用户拍板）**：淡米色纸底（PAPER.bg #f7f2e4）+ 细横格线（PAPER.rule，行距 RULE_SPACING = step 字号 × 1.35 ≈ 22px @540，字写在格线上；v31 点阵纸纹退役）；**字幕 BoardCaption 删除**（真实课堂没有字幕，讲的话看右栏对话；PAD_BOTTOM 10%→6%，BlackboardPlayer 的 narration/subtitle 链同步移除）；手写字体与 @fontsource 引用全撤，默认 BOARD_FONT 系统屏显栈。其余机制不变——write **严格串行**（前一个 onDone 才放行下一个，半成品不再散落）；标注等目标 write 全部写完才落笔（讲写同步）；**段末/翻页硬同步（v9）**——已触发的页级 write 全部写完才播下一段（`onAllWritesDone` 上报语义 = 已触发 write drain，经 BlackboardPlayer → useBoardPlayer 的 advanceGate，段内前进与翻页都受闸）；**v23 反向背压上报：`onInkBacklog` 透出已触发但未写完的页级 write 数（含正在写的 active；checkpoint 追加 write 不计——交互态驱动、主时钟不在跑），供 useBoardPlayer 段内 hold 音频等笔**；`budgets` prop 接收时间窗预算并换算 `paceScale` 传给 BoardWrite；**v29 流式画布排版（2026-08-20 用户拍板"画布从上到下流式追加，避免重叠"）**：write 渲染从"layoutBoardPage 预计算坐标 + 绝对定位 + pending 占位"改为浏览器原生 flow——每个 write 一个块级容器（role 字号/缩进/呼吸沿用 ROLE_FONT_RATIO 章法），flex-wrap 自然折行、无 pending 占位（当前块永远最末，行随书写生长、已放置 token 永不移动），占位/终态宽度漂移与双引擎不一致这类重叠 bug 从根上消除；wN 身份按页内顺序机械分配（data-write-id DOM 锚点不变）；内容写满时整板 transform 等比收缩兜底（下限 0.55；**实测坐标不做 flowScale 二次补偿——DOM 实测即收缩后真值，v29 的 ÷flowScale 会把收缩页标注吹到 1/flowScale 倍虚空，2026-08-21 收缩页实拍根修；flowScale 仅作 MeasuredTarget 重测信号**）；标注链全量 DOM 实测（BoardAnnotation/MeasuredTarget 的 layout 预估算降级为可选 fallback，RefInterlude 脉冲高亮改 measureWriteGlyphRect 实测；**v31：KaTeX 公式块无 .mm-chalk-char 叶子，测不到叶子时量 .katex-html 直接子节点并集——displayMode 下 .katex/.katex-html 是 block 满栏宽，量宿主圈会横跨整栏**）；board-layout.ts 不再参与主渲染（ROLE_FONT_RATIO 常量与未接线的 penTipAt 保留，旧布局引擎及其单测原样留作对照）；**v27 粉笔光标已拆除（2026-08-20 用户实拍裁决"跟不上就去掉"）**——v10 虚拟粉笔手（token 级 `writeTipPosition` + v14 笔画级 `penTipAt` 双路上报）多轮迭代后仍有可感偏移（实拍：粉笔头停在词右缘外、与正在写的笔画明显错位），跟不上笔迹的笔是纯干扰；渲染层/状态/标注引导/空闲隐去全部移除，BoardWrite 的 `onCursor`/`penTipAt` 保留为未接线的可选能力（笔迹逐字逐笔动画本身已是足够的视线引导）；**暂停 = 整板冻结**（接力定时器可暂停化 + 当前笔写完即停 + 看门狗计时顺延 + CSS animation-play-state）；**默认参数数组必须模块级常量（EMPTY_EXTRAS/EMPTY_ANNOTATIONS）+ instant 全标记 effect 无变化回原引用**——字面量默认值每渲染新引用 + 必返新 Set = update-depth 死循环（RefInterlude 不传这两个 prop，实测必现）。**v31 白纸讲义画布（2026-08-21 用户拍板，黑板形态废弃）**：暖白纸底（PAPER.bg #faf7ef）+ 极淡点阵纸纹 + 深色墨迹字（PAPER.ink #2e2b26），木边框/板擦雾带/暗角/粉笔 noise/feTurbulence 文字滤镜全部退役（rough 标注层保留 mm-chalk-rough 轻抖动，scale 2.6→1.6）；一页**两栏**（BoardFlow：页首 title 通栏，正文栏内从上到下 flow 追加，`new_column` 动作显式换栏、首栏超高自动切下一栏兜底——已写墨迹永不动摇），字阶大幅下调（board-lecture.LECTURE_FONT_RATIO：title 0.062 / term 0.036 / step 0.030 / note 0.026 / formula 0.036，一屏 15-25 行，对齐参考图密度 4-5×）；节标题 term = 浅紫底 pill（PAPER.accent/accentBg），==重点== 马克笔黄横扫保留；公式走 write role='formula'（text 为 LaTeX → BoardFormula KaTeX 块级排版，整块 400ms 淡入不走逐字接力，data-write-id 锚点照常参与串行链与标注实测），v30 手写模拟结构 token（\frac/\sqrt/\pmatrix/上下标，BoardStructToken）退役——行内记法只留 ==高亮== 与 LaTeX 符号命令转 unicode（board-struct-tokens.ts 收缩）；圈点勾画维持朱砂 #D98271（线宽 3.3→3.6，打勾绿 #A8C8A0→#6FA468 白纸保清晰）；字幕改纸面风格（细紫分隔线 + 深色墨迹字，BoardCaption）。板面旧描述（#1f2a2e 基底 + 木质边框 + 雾带 + 暗角）随 v31 作废；字幕区旧描述（细朱砂分隔线、粉笔字、最多两行完整显示不截断，高度由布局下边距 10% 预留——原 7.5%（40.5px）小于字幕区实际 ~46px，最底行板书探进字幕顶部，2026-08-19 用户实测"字幕挡板书"后上调）；字幕内容经 `windowSubtitle` 卡拉 OK 窗口化（跟随朗读字位按子句滑动，讲到的必然可见，不再省略号截断）；v24 字幕防漂移：左缘固定 + textAlign left——原居中渲染时窗口长度每变一次同一句话的 x 位置就左中右漂一次（2026-08-19 用户实测）**；冷启动显示「老师正在备课…」手写字（preparing prop）；播完字幕区显示收束语（finishedCaption）。换页整体淡入，页内只增不减。
  - `BoardWrite.tsx` — **v32（2026-08-21 用户拍板）：手写体全部退役**——鸿雷板书/Caveat/ZCOOL KuaiLe 弃用，统一系统屏显栈（`BOARD_FONT`：-apple-system / PingFang SC / Noto Sans CJK SC），hanzi-writer 笔顺动画体系（HanziChar/笔画数据/降级链）随字体退役删除，所有 token 统一字体显现接力（文字按生成流速逐 token 出现）；绝对定位遗留模式（layout prop/pending 占位/onCursor 上报）一并移除，只留 v29 flow 模式。接力骨架保留：串行 onDone 链、v19 节奏计划（buildWritePaceForTokens）、token 分型（CJK 逐字/拉丁按词/标点逐字/空格/==高亮==）。v31 及更早的实现史（供考古）：title/term 用 hanzi-writer 真实笔顺逐字动画（笔画数据自托管 `/api/board/hanzi`——路由保留未删），step/note 用鸿雷板书简体（CHALK_FONT）渲染。**v16 原生 token 排版**：渲染/接力最小单元从"逐字"改为 token（CJK 逐字 / 英文按词 / 标点逐字 / 空格瞬时抬笔）——词内字距与词间距全部交给字体本身（空格 white-space:pre 原生宽度，零人工补偿；此前 0.35/0.55em 人工补宽与逐字占位误差导致"先连写后跳开"）；行内 token 一律 **baseline 对齐**（原 items-center + 按类型手动 --mm-y 偏移是括号内外错位根因）；未写 token 占位与真实渲染**完全同构**（同 token 同字体同字号，行零 reflow）；`wrapText` 拉丁词中间不断行（整词挪行）；**v8 逐字严格串行**：write 内部链式接力（第 i 字 onComplete 才挂载第 i+1 字，任何时刻全板最多一个字在动画中；已完成字遇 extras 回流只重建终态不重播动画）；节奏常量 CHAR_PACE 在 board-model（CJK 笔顺 320ms / CJK 手写 180ms / 拉丁 80ms / 标点 60+120ms 停顿 / 空格 30ms 瞬时抬笔），`estimateWriteMs` 进 `buildPageTimeline`；**v19 抬笔停顿接力**：token 写完后按节奏计划停顿 restMs 才放行下一个（restTarget 闸，可暂停冻结/恢复，instant 直通；字间间隔实测非匀速、含 ≥150ms 停顿——探针 `scripts/board-token-rhythm-probe.ts`）；字体 token 的 `durationMs` 与笔顺字的抖动 paceScale 都来自 `buildWritePaceForTokens`（与估算同一来源）；**v9 `paceScale` prop：书写速度按时间窗预算自适应（v19 起只快不慢，clamp 0.7~1）**；**onCursor/layout 走 ref 不进 effect deps**；**v14 笔画级笔尖追踪**——`penTipAt`（board-layout，与 hanzi-writer 3.7.3 同一套时序公式）逐帧驱动光标，字符原点 **DOM 实测**；**v22 粉笔色板（板书章法：黄=必记重点、白=讲解、朱砂=圈划）**——`chalkColorFor(role)`：term 暖黄 `#EFD694`（含 hanzi-writer strokeColor 同步），title/step 白，note 白 74%；Caveat 放大 1.18→1.12（笔画粗重压同行中文）；全角冒号显示层转半角后 `--mm-y` -0.22em 上提（Caveat 双点贴基线，夹在 CJK 间读作句号，标题实拍根修）；**v27 全角标点收紧（`，、。；？！`）**：印刷体全角空位在手写场景让行散架（实拍"边听边答 , 手不离笔"两侧各空半字），渲染盒压 0.55em + 左拉 0.12em 把墨迹贴到前字收尾（盒宽压完字形自带左轴承仍余 ~6px，DOM 实测补拉），pending 占位盒同宽同左拉保持零 reflow；行容器 nowrap（v29 flow 模式改 flex-wrap 自然折行、无占位，占位/终态漂移类重叠从根上消除；charOrigin/writeTipPosition 跳过）；**v30 结构 token（对齐参考产品的数学排版，保持手写体感）**：write 文本直接写 LaTeX 子集记法——`\frac{a}{b}` 分数（分子→手绘分数线→分母 stagger 落笔）、`\sqrt{x}` 根号（√+上横线）、`\pmatrix{a & b \\ c & d}`/`\bmatrix` 矩阵与列向量（SVG 手绘括号 preserveAspectRatio=none 随内容拉伸）、`x^{2}`/`a_{1}` 上下标、`==重点==` 马克笔高亮横扫——解析在 board-struct-tokens.ts（纯函数，记法写错退化为普通字符不崩），渲染在 BoardStructToken.tsx（整 token 一个接力单元、部件按 durationMs 比例 delay；支持嵌套——分数里的根号、矩阵 cell 里的下标经 instant 递归渲染；**sup/sub 上浮必须双通道：--mm-y 给 mm-chalk-in 关键帧终态（animation fill 会覆盖 inline transform，实测上标被压回基线）+ inline transform 给 instant**）；active/onDone 串行链接口。**v31（2026-08-21 黑板形态废弃）**：粉笔白/黄退役为纸面墨色——`inkColorFor(role)`：term 节标题紫（PAPER.accent）、note 注释灰（PAPER.inkSoft）、其余深墨 #2e2b26（含 hanzi-writer strokeColor 同步）；v30 手写模拟结构 token（frac/sqrt/matrix/sup/sub）与 BoardStructToken.tsx 一并退役——公式一律 write role='formula' 走 KaTeX（BoardFormula），行内只留 `==重点==` 马克笔高亮（HighlightToken，黄粉笔色的纸面继任）与 LaTeX 符号命令转 unicode；纸面无 textShadow 粉笔光晕。
  - `RoughStroke.tsx` — circle/underline/arrow/mark 用 `rough.generator`（**固定 seed = hash(target)**，防重渲染跳变）+ `toPaths()` + stroke-dashoffset 一笔画出（300-500ms）；圈/下划线/箭头/叉用朱砂 `#D98271`（strokeWidth 3.3-3.5），勾用粉笔绿。
  - `segment-clock.ts` — **Clock 抽象**，三条链：**AudioClock（`createAudioClock`，DashScope TTS 音频 + 字级 timings 插值 charIndex，真实/估算时长比例缩放对齐时间轴；模块级请求缓存（失败 null 不留缓存）+ `prefetchBoardTts` 预取；**共享 AudioContext**——每段新建 ctx 的初始化/策略竞速是段间缝来源；失败回调 `onUnavailable`；**手势门无限等待（2026-08-19 改）**：AudioContext suspended 时广播 board:awaiting-gesture 等用户点一下，不再 5s 倒计时降级——第一耳朵必须是真人，看门狗在手势拿到后才武装）→ speechSynthesis（`createSpeechClock`，boundary 词级事件回锚）→ 纯 timer**；当前走哪条链由 `board-clock` logger 标记；**v19 `SPEECH_BASE_RATE` 0.9 老师基础语速：cosyvoice v3 实测不支持 speech_rate（静默忽略）也不接受自由格式指令（InvalidParameter），播放层 playbackRate 天然保同步（charIndex 走音频媒体时间轴插值，与速率无关），放慢只是墙钟进度变缓**；**暂停感知定时器（2026-08-19 音画错位根修）：安全超时与看门狗都 arm/freeze/rearm——暂停中触发会误 finish 翻段或误降级（降级新建的 fallback 没人 pause 会在暂停中跑完），恢复后人声从段首重播或彻底消失**。
  - `useBoardPlayer.ts` — 播放状态机（播放/暂停/重播/倍速 1x·1.5x/页码）；v3：cue 动作按词级 charIndex 触发（v15 起全部动作都有字位锚）；checkpoint 段只播提问口述后进入 `'checkpoint'` 等待态，`advanceFromCheckpoint` 续播；**v9：段末硬同步闸门（任何段末/翻页，已触发 write 未 drain 则音等画，400ms 轮询）+ 透出 `actionBudgets` 给 BoardCanvas 调速**；AudioClock 起播前检测 `AudioContext.state`，被自动播放策略挂起（suspended）按不可用降级（**无手势进页即开播**，用户首次交互后后续段自动升回真人音色）；**v13 连贯性：checkpoint 提问与正段同一条 AudioClock 链（不再切浏览器机器人音）+ 页末段预取下一页首段（消除翻页音频空洞）+ `actionBudgets` 按 budgetMs/实际速率折算（1.5x 书写同步加速，不再全靠闸门吞差额）**；**v15 段间呼吸（页内 400ms / 翻页 1200ms 确定性停顿，闸门已等够不叠加）+ 首页首段看门狗冷启动宽限 30s（TTS 预取与播放并发，引擎冷+串行闸首段合成 10s+，15s 实测仍误杀第一耳朵判机器人音，2026-08-19 上调；依据见 `COLD_START_WATCHDOG_MS`）+ 降级前 cancel 原 AudioClock（防双音重合）**；**v19：所有 clock 速率 = 用户倍速 × `SPEECH_BASE_RATE`（0.9，`effectiveRate` 统一折算，含 toggleSpeed 的 setRate 与 actionBudgets 除数）**；**暂停/恢复根修（2026-08-19）：`status` 移出主循环 deps——暂停/恢复只走 `clock.pause()/resume()` 直控，不再触发 effect 重跑销毁 clock（旧实现每次暂停都 cancel、恢复时为同一段新建 clock 从 0 秒重播，而黑板 triggered 还在原位 = "板书写到 30 秒、人声从头开始"）；重起 clock 走 `runId` 信号（自动开播/重播/闸门期间暂停后恢复）；`handleEnd` 加 playing 守卫（任何残留定时器在暂停中触发都不许翻段）；降级 fallback clock 继承暂停态；脚本到达即预取首页前两段音频（首段不撞 15s 看门狗）**；**v23 反向背压（ink→speech，`inkBacklog` option 由 BoardCanvas 经 BlackboardPlayer 上报）：嘴到新动作 cue 时笔有积压 → 动作延后触发 + `clock.pause()` 词边界 hold 音频（只冻声音链不动 status，书写接力照常跑），backlog=0 即放行补触发（180ms 轮询），`MAX_INK_HOLD_MS` 超时强制放行并本段不再背压；hold 不越过用户暂停出声、fallback 继承 hold 态；打点 ink-hold/-release/-forced**；**v26 小讲解单元适配：TTS 预取深度 1→2 段（一口气一段后段短变密，合成延迟不能在新边界露头）**。
  - `board-checkpoint.ts` — **checkpoint 状态机**（纯逻辑）：ask → wait ⇄ hint（3 级递进，给完让位看解析）→ answer →（withDemo 时）demo → done；「我会了」跳 hint/示范直达 answer。
  - `BlackboardPlayer.tsx` — v3 交互总装：checkpoint 上板遗物（question/hints/demo writes 经 `extraWrites`/`extraAnnotations` 进 BoardCanvas 串行链，本页内保留、换页清空；**成双守卫：'done' 已入 cpArtifacts 的 segment 不再拼 activeArtifacts 份——页末 checkpoint advance 后无下一段、checkpoint 态不消失，两源叠加会让题目/示范成双上板，2026-08-19 末页实拍根修**）、**hint/answer ad-hoc 朗读与正段同一条声音（v11：走 createAudioClock，onUnavailable 原位降级 speechSynthesis；速率与主链一致 × SPEECH_BASE_RATE）**、**answer 阶段示范随 `answerCues` 渐进上板（解析念到哪个第几个 demoAction 落笔，与正段嘴手一体同规则；answer/hints 全部用剥标记后的 answerDisplay/清洗文本——此前 [aN] 会被 TTS 逐字念出+字幕外露，2026-08-19 根修）**、ref 触发检测（player.pause → RefInterlude → 2.7s 后淡回续播）、板演开关（**checkpoint 等待态禁入且按钮 disabled**——pause 在该态是 no-op，播放会在笔迹层下继续跑、翻页清掉笔迹、勾叉落错页，实测踩过）、**脚本就绪窗口化预取前 6 段音频（800ms stagger 限流防引擎 503；45 分钟真课全量预取会挤爆服务端 LRU 64，其余靠播放中下一段预取接力）+ 进 checkpoint 预取 hints/answer**、**首段手势等待提示（board:awaiting-gesture 事件 → 粉笔字「点一下黑板，听老师开讲」）**、**v15 checkpoint wait time（提问念完按钮延迟 2s 出现，Rowe 1974 等待时间研究）**、**v12 板演批改（Practice 闭环）**：「写完了」且课中出现过 checkpoint 时，笔迹栅格化（`ink-grading.ts` 叠 6×4 网格）→ `/api/board/grade-ink` → 勾叉经 RoughStroke 落在网格 cell 旁 + 点评走 speak()（念完才续播）+ **老师示范（v15）：VLM 返回 corrections（写错步骤的正确写法 1-3 行）时经 extraWrites 串行上板（暂停态解开 BoardCanvas 冻结），示范写完才续播**；批改中字幕显示「老师正在批改你的板演…」；学生笔迹收层后由 StaticInkLayer 留在板上（勾叉有附着对象）；失败静默降级不挡播放。
  - `CheckpointPanel.tsx` — 等待态按钮组（我会了/给我提示/看解析，3 级给完 hint 按钮让位）。
  - `RefInterlude.tsx` — ref 跨页插播：目标页 `instant` 最终态直接呈现（v32 起为屏显字体直出；v11~v31 曾走 hanzi-writer `showCharacter` 静态终态）+ 目标 write rough 圈脉冲高亮（呼吸 2 次）。
  - `StudentInkLayer.tsx` — 学生板演：pointer 采笔画，粉笔蓝 `#9EC5E8` polyline + 粉笔滤镜（与粉笔白/朱砂区分）；`StaticInkLayer`（v12）静态呈现已提交笔迹；擦掉重写/写完了恢复播放；换页清空。
  - `ink-grading.ts` — v12 板演批改客户端：网格契约（6 列 × 4 行，行 A-D 列 1-6，与服务端 ink-grading-service 一致）、`cellCenter`（cell → 960×540 虚拟坐标）、`rasterizeInkForGrading`（板面底色 + 标注网格 + 粉笔蓝笔迹 → 2× PNG dataURL 送 VLM）。
  - `BoardAnnotation.tsx` — 标注渲染（circle/underline/arrow/mark），从 BoardCanvas 拆出。

**板面字体**：**v32 起统一系统屏显栈**（`BOARD_FONT`，见 BoardWrite.tsx；globals.css 的 HongleiBanShu @font-face 已删）。以下为 v31 及更早的手写体时代记录（已作废，留档）：鸿雷板书简体（`HongleiBanShu`，子集 `public/fonts/HongleiBanShu-subset.woff2` 1.8MB，GB2312 一级汉字 + ASCII + 全角标点；出处/授权待办/可复现命令见 `public/fonts/README.md`——作者声明免费商用，网页嵌入授权待联系鸿雷字记确认留证，当前为临时使用）——用户拍板的决赛胜出者，粉笔书写感复刻；栈尾保留站酷快乐体兜底（webfont 加载失败时）。**拉丁字符与半角标点统一分流到 Caveat（`@fontsource/caveat`，OFL）**——`isLatinBoardChar`（字母/数字）+ `isAsciiBoardPunct`（半角标点）分流：中文手写体的内置拉丁与半角标点（又小又浮）都拉胯，Caveat 是马克笔手写感最优解（x-height 小故字号 ×1.12——原 1.18 笔画粗重会压住同行鸿雷中文，2026-08-19 实拍下调）——这是生产行为。曾用字体：Ma Shan Zheng（毛笔楷书，笔画带锋显"刺"）、站酷快乐体（偏卡通）。hanzi-writer 笔顺动画渲染文鼎楷书字形（Arphic Public License），与字体文件无关。**度量按鸿雷+Caveat 校准**：Caveat 标点与笔顺字形混排时 `--mm-y` 0.1em（v11 复核：全角冒号转半角走 Caveat——但双点贴基线夹 CJK 间读作句号，v22 起 `--mm-y` -0.22em 上提到字腰，stroke/非 stroke 两条路径同修正；鸿雷全角冒号双点低位像句号，不用）、Caveat 字母 0.1em、FontChar 路径 CJK 标点 0.3em、笔顺路径 CJK 标点 0.55em；空格 span 显式补宽 **0.55em**（v15 修正：0.35 在纯英文词组里≈一个字母宽，"name and address" 词界被吃掉连成串；手写英文词间距需≥一个字母宽）；**笔顺模式未写字占位按字符类型给宽**（CJK 整字宽 / 拉丁 0.55em / 空格 0.55em——全字宽占位会让拉丁字符写成时后半行逐个左跳）；note 4.6% 板高。

**demo 字体评估设施（临时，后续可删）**：`public/demo/fonts/` 下的沐瑶软笔手写体（Muyao-Softbrush.ttf，作者声明免费商用）、鸿雷板书简体原始 TTF（HongleiBanShu.ttf，子集化的源文件备份）、小赖字体 SC（XiaolaiSC-Regular.ttf，OFL）是字体决赛候选/备份，不做子集化；demo 页 `?font=muyao|xiaolai` 时页内 `@font-face` 注入并经 `BlackboardPlayer.fontFamily` → `BoardCanvas.fontFamily` → `BoardWrite.fontFamily` 覆盖中文主字体（honglei 已转正为生产默认，从候选中移除）。

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
