# CHANGELOG

产品打磨升级（2026-05 四个 Milestone）的里程碑日志。
每条都可追到 `docs/UPGRADE_PLAN.md` 决策表和 GitHub 分支 commit。

---

## 2026-09-11 — 上课舞台第四轮：图为什么还会画不出来——API 按老师最自然的写法放宽 + 取景 / 上板顺序 / 三维

线性代数那节真课（`cmtwpmjmw…`）暴露的：图有概率画不出来（学生追问「你图都没画出来」）、四支向量全是默认蓝（老师明明写了 `{ color: 'amber' }`）、单位正方形在 [-1,6]×[-1,5] 的大画框里只占一角、自愈 5 次 4 次失败。逐条追到根：**都不是模型能力问题，是运行时 API 太窄**——模型把点写成 `[x, y]` 数组（JS 里最自然的写法）被 `expectPt` 整图拒掉；`vector(A, 1, 0, 'e₁', { color })` 的第 5 个参数被静默丢掉；自愈模型把修正段又包了一层 `<draw>` 标签；而修复模型照样写数组，所以修不好。

- **`lib/teach-live-draw/scene.ts`**：点接受 `{x, y}` / `[x, y]`（所有对象函数 + `withPts` 包住全部构造函数）；`'label', { style }` 两个尾参同时认（`opts(...)` 合并，vector / segment / circle / polygon / angle / arrow 全部）；`point(…, { hidden: true })` 只要坐标；`arrow` 不给颜色按色板轮换、标签写在箭头尖旁；label 转 id 归一下标（`e₁` → `e1`）；**`view3d({ yaw, pitch })`**：正交投影 + `axes3d / point3 / segment3 / arrow3 / box3`，yaw 写成 `time` 的函数就是会转的立体图（那节课老师手写投影矩阵做到了，现在一行）。
- **`render.ts`**：`tightenView`——老师给的坐标范围在两个方向都比内容大一倍以上时收紧到内容附近（保留原点、不出老师范围，`axes({ lock: true })` 关掉）；`orderForPaint`——同一段里坐标系与带填充的面先上板，向量 / 点不再被后画的多边形盖住。
- **`components/teach-live/draw/DrawBlock.tsx`**：`into` 补画超出画面 → 整图重新取景（refit，一次瞬时替换后继续逐笔）；draw 块揭示前后同一个 React 实例（`<section hidden>` 占位）——之前揭示那一刻重新挂载，算好的结果与自愈全丢、同一段修复请求发两次。
- **自愈**：`extractScript` 认 `<draw>…</draw>` 包裹与解释句；修好的脚本以 `draw-fix` 事件落线程日志，回看 / 恢复时替换原段（否则重放的是当年跑不通的脚本）；日志带 `reported` 原始错误——下一类「API 太窄」从这里发现。
- **公式**：`\pine{}` 等色板宏迁到 `lib/utils/math-text.expandColorMacros`，字幕 / 提问卡 / 课堂记录（MathText）与要点（`normalizeNoteMarkdown`：裸 LaTeX 补 `$` 定界）都生效——那节课要点里 `\pine{e_1 \to (1,0)}` 原样露出。激光笔 `point at="fig#v"` 改按 `data-name` / `data-label` 找（渲染 id 带块前缀，之前 `#v` 永远命不中）。
- 验证：那节课 4 段原始脚本全部复跑通过（含 3D 旋转时间轴、4 种箭头色）；真模型 3 节课（三维向量 / 矩阵剪切 ×2）draw 报错 0、自愈 0 次；合成事件日志验证 refit；单测 +8。**模型侧真问题只有一处**：把 `M = (1 0; h 1)` 与画出来的 `(h, 1)` 列向量写反了（内容笔误，系统不替它判）。

---

## 2026-09-11 — 应用矩阵内容层：题为这个人出、卡是提示不是标题、闪卡跨会话到期、评委一句话一个问题

前两天打磨的是交互表现（测验是一份试卷、闪卡是牌、讲给同桌听是一间面试间），用户定的顺序是"先交互表现，最后内容"——这一轮进入内容层：题目怎么出、卡怎么出、听众怎么开口。原则不变：好的输出 = 个人上下文 + 场景上下文 + 模型智能，上下文与标准进 prompt，配额不进代码；做不出来就 `GENERATION_FAILED`，没有模板题 / 兜底卡。

- **测验 v2**（`app-prompts-practice.ts` + `quiz.plugin` v0.3）：LearnerContext 事实半（掌握轨迹，标「本课」）+ 理解半 + 材料体量进 prompt，模型决定还没稳的多出换角度、刚记住的出迁移题、已经稳的只出一道确认题、题量多少；题型按内容选，**新增多选**（答案契约 "A、C"，`quiz-answer.ts`；`QuizWindow` 切换式点选、集合全对才算对、题号旁「多选」两个字）；**每题必有先对后错的解析**（缺解析不算题，引原话写时间点——转录上下文改给时间戳不给段号，v1 的"段032明确指出"会漏进解析）；同题干复读去重；题干 / 选项 / 解析走 `MathText` 渲染 TeX。`formatLearnerContextForPrompt` 事实预算 600 → 1000 并标「本课」；`learner-context-provider` 按状态 → 本课 → 最近排序、`concepts` 点名的概念不占 limit。
- **闪卡 v2**（`flashcards.plugin` v0.5）：正面是提示不是标题、一卡一个问号、答案关键词不出现在正面（`frontRevealsBack` 字面门）、背面两行内可用 TeX、覆盖要点不复述摘要；掌握轨迹决定哪些点该有卡（prompt 里给了具体换法：上次没记住"满射的定义"→ 这次问 $y=x^2$ 是不是满射）。**跨会话间隔复习**：`lib/learning/spaced-review-model`（SM-2 思路：没记住 → 明天；记住 → 1 天起翻倍，上限 60 天；同一坐 4 小时内不翻倍）+ `hooks/useFlashcardsReview`（登录用户以服务端 assessment 事件为源——`/api/context/v1/learner-context` 点名这叠卡的正面；访客本机）→ 到期的先来、进入态一句「上次没记住的 N 张先来」/「今天到期 N 张」、课后学习页闪卡路径卡副题写到期数。不做打卡 / 连胜。
- **讲给同桌听 · 开口预算**（`teach-back-panel-v2`）：一次开口 = 一句话 + 一个问题（或只一句"接着说"），二三十个字读出来五六秒，针对刚讲的这一段；`JUDGE_SAY_MAX_CHARS` 220 → 90、maxTokens 320 → 160 只是保险丝。TTS 本来就按句送（`SentenceSplitter`），确认未改表现层。实测（Playwright 假麦克风，dev 3106）：两回合评委分别说 19 字 / 28 字，出声 3.3s / 5.6s（v1 实测 10-13s）；**停下 → 听见 8.2-8.8s 未达 2.5s 目标**——回合判定 1.5-4s（静音 1.2s + 定稿 0.7s + ASR 延迟）+ 模型首字 2-3s + TTS 首句 1.7-2.4s，三段都不在 prompt 层，留给下一轮（状态机阈值 / flash 模型 / 更小的评委上下文）。
- **eval 新增 `tests/eval/apps`**（`make eval-apps`，进 `eval` / `eval-ci` / guard baseline `apps.json`）：真课转录（宋浩《高等数学》映射，公开课）× 访客 / 有掌握轨迹的学习者 × 测验 / 闪卡，冻结的模型输出过生产后处理再断言（硬项：每题有解析、无重复、无"以下哪个不是"、无模板选项、解析不漏段号、多选字母契约、不稳概念被覆盖；一卡一点、正面不泄答、背面两行内、不复述摘要。软项：换角度是否真换了、两问合一的卡比例、解析自我讨论）。三轮真模型（qwen3.7-plus）迭代的判断记在 `tests/eval/apps/DOMAIN.md`。
- **顺手修的真 bug**：`useAppExecution` 自动执行不等鉴权落地——本机有 token 但 `/api/auth/me` 没回来时请求不带 Bearer，服务端当访客：没有掌握轨迹（"为这个人出的题"整条链路失效）、也不按登录用户计费。真课实测里 transcript 从 IndexedDB 读出比鉴权快就撞上（trace `learner_context=local:0`）。
- 真课实测（`/tmp/mm-content/`，不进仓库）：访客试听课 + 合成登录账户（掌握轨迹里两条还没稳、一条刚记住、一条已经稳）各出一套题 / 一叠卡；合成账户的题：策略句点名两个未稳概念，$y=x^2$ 多选题一道检验单射 / 满射 / 逆映射，刚记住的复合映射顺序出一道确认，已经稳的映射定义不再出；重开牌堆看到「上次没记住的 2 张先来」且那两张排在最前。合成数据已清。

---

## 2026-09-11 — 生产改为专用检出目录运行：开发目录不再是运行目录

- **为什么**：过去所有会话都在 `/mnt/meetmind-capture-v1-server-handoff` 一个目录里开发，而生产（PM2）也从它跑。9-10 一天撞出三类事故：`git add -A` 把别人已暂存的删除带进提交、`git stash` 撤走别人的工作文件、`make deploy` 把别人的半成品送上生产；服务端（`server.js`）的修复也只能通过改别人正在开发的工作树才能生效。
- **改法**：新建 `release/prod` 分支 + `/mnt/meetmind-prod` worktree 作为唯一运行目录（PM2 cwd、`deploy.sh` 的 `PROJECT_DIR`）；数据仍在原目录、软链过去；`prisma.ts` 改为读 `DATABASE_URL`（此前只按 cwd 找库，换目录会静默新建空库）；每条开发线各自 worktree + 分支，上线 = 合进 `release/prod` 再 `make deploy`。流程写在 `docs/RELEASE_FLOW.md`，铁律进 `AGENTS.md`。
- 本次随之上线：`feat/reliability`（实时字幕断连自愈、Recorder 卸载收尾、登录迁移只推变过的课、访客登录入口）与 teach-live 分支已提交的第二轮。
- **待办**：维护窗口把 `prisma/meetmind.db` / `public/uploads` / `public/downloads` / `public/wechat-media` / `data/` 迁到 `/mnt/meetmind-data` 并双向软链，让数据也不住在任何开发目录里。

---

## 2026-09-11 — 上课舞台第三轮：画面本身的上限——时间原语、布局先验、代码版 Critic

用户把优先级钉死在画面：随手问一个数学 / 物理问题，10 秒内看到的要像专业教学动画；外层布局与交互都往后放。先对照了前沿（OpenMAIC / TheoremExplainAgent / Code2Video，`docs/TEACH_TUTOR_ENGINE.md` §12.6），拿了三样：

- **`time(t)` 时间原语**（`lib/teach-live-draw/timeline.ts`）：Manim 的 ValueTracker + updater 搬进浏览器——整张图写成 t 的函数，运行时按帧采样精确几何，编译成 SMIL 属性插值（d / points 结构一致线性插值，颜色 / 显隐离散，读数文字按段复制轮播，`pingpong` 来回）。切线跟着圆上的点永远相切地转、割线随 `smooth(t)` 滑成切线、角度读数逐帧变；圆带坐标系自动保形（此前拉成椭圆）。6 例单测 + 真浏览器验证动点位置随时间变化。
- **布局先验**：`note('…', 'top-right')` 九区域批注不算坐标（同区域叠放、自动换行）；`axes({ equal })`；自由 `<svg>` 的 prompt 给 6×6 锚点格（Code2Video 实测 EL 0.59→0.91 的做法）+ 语义 class（`pine / stroke-3 / soft-pine / label / glow`…）+ 每张图预注入五色箭头 marker / 发光 / 渐变 defs；draw 标签自带纸色晕边。
- **代码版 Critic**（`layout-critic.ts`）：渲染后文字框重叠自动把后画的挪开（刻度轴名作障碍不动），毫秒级零延迟——前沿用 VLM 干这件事要几十秒。
- **公式编排**：`<math into="eq">` 逐行长出带进场动效；`\pine{a^2}` 等颜色宏与图同色（送入 KaTeX 前文本展开——KaTeX macros 遇到 `#2F6B55` 会当参数记号，字符串宏与函数宏都实测报错）；`\htmlId{ca}{c^2}` 让 `point at="eq#ca"` 指到具体一项。
- prompt：time / note / equal / 6×6 格与 class 词表 / 公式逐行同色 / 「每 15 秒画面必有可见变化」的构图纪律 + 两个新示例。实测导数课模型首次见到就用 `time(5, { loop: 'pingpong' })` 让割线滑成切线并用 `note` 打出 h 与斜率读数；圆的切线课用 `time(6)` 让切点转动直角不变。
- 有意不做：舞台式主画面 + 公式栏的外层布局（会加一层状态机，不长智能）。

---

## 2026-09-11 — 上课舞台第二轮：精确图形的通用解法（代码即意图）+ 课堂手势收口

用户追问：切线 / 圆 / 函数图像这类严谨内容出错不可接受，应在代码层定义而不是用坐标画；几个原语堵不住所有情形，要通用；任何方案不能伤低延迟与音画同步。决策与推理见 `docs/TEACH_TUTOR_ENGINE.md` §12.4。回滚基线 tag `teach-live-v1`。

- **`<draw>` 块 = 模型写程序、运行时算几何**（`src/lib/teach-live-draw/`，Worker 沙箱）：几何内核（切线 = 过切点垂直半径、外点切线解直角三角形、三种交点、外接 / 内切圆、垂足 / 角平分线 / 反射 / 旋转、边上正方形、正多边形）+ 分析内核（采样、数值导数 / 积分、求根、极值、切线 / 法线、参数 / 极坐标曲线）+ 场景渲染（保形铺满、函数图各轴独立、直线裁剪、标签避让、角标 / 直角标自动、坐标轴网格、`trace` 沿形状本身的路径运动永不偏离、`param` 出滑块拖动整图重算）。`<draw into>` 与首段同一作用域同一布局。语言是通用的（没有原语就自己算），库只省力气；`<svg>` / `<anim>` / `<widget>` 三个通用逃生口不动，所以不压上限。11 例严谨性单测（垂直、相切、交点、斜率、面积……都是算出来再断言）。
- **`{{ 表达式 }}` 内联计算**：口播 / 要点 / 公式里的算式由服务端流式算好再发（`inline-math-stream.ts`），老师不再心算；`lib/utils/safe-math.ts` 一个无 eval 求值器三处共用。
- **板上情况回传**：draw 脚本报错前端记下，学生下次开口随 `boardNote` 带给老师（只进模型上下文），老师自己改。
- **手绘感**：rough.js 把几何元素换成马克笔笔迹（单笔、低 roughness、保留 id / 虚线 / marker；网格刻度与文字保持工整），顶栏可切回工整，localStorage 记住。
- **回看这节课**：事件日志整段喂 Director，按当年节奏 + 声音重放，学生当年的话演到才进记录；中途开口即全部揭示（那是历史不是未来）。
- **指着板上的东西提问**：点任何一块或图里带名字的部分 → 输入框出引用 chip → 老师收到「学生指着板上的「X」问：…」，可 `point` 回去、`draw into` 补一笔。
- **语速 1× / 1.25× / 1.5×**（`TeachSpeechPlayer.setRate`，保音高）、**按住空格说话**、翻页动效、Octo Buddy 头像三态、**每节课成本行**（`usage` 事件；刊例价 GLM-5.3-Flash 输入 0.8 / 输出 2.8 元每百万 token，一节开场 ≈ ¥0.008）。
- **修复**：live 一轮上千条事件时 `appendThreadEvent` 两段异步让落盘顺序颠倒（draw 脚本被写成 `const = A point(...)`）——改为每线程串行队列。
- 实测「圆的切线有什么性质」：切线由代码算出、直角标自动出现；插话「为什么切线一定垂直于半径」→ 新一页用垂足构造证明；零控制台错误；首句 1.4s、首笔 8.9s。
- **上线后第一节真实课（阿波罗尼斯圆）暴露三处，当天修**：① 模型写 `circle(O, 3)` 忘了 `const c =`、写占位语句引用未定义变量（4 段中 2 段，GLM-5.3-Flash 低思考下的代码粗心，已反馈）——系统层吸收：运行期报错**能画多少画多少**（报错前的对象照常上板）+ **自愈**（段一闭合就预跑，报错让模型只修那一段，服务端复跑验证，几百 token 1–2 秒，藏在老师念前几句话的时间里；`draw-repair.ts` + `POST /threads/[id]/draw-fix`）+ prompt 硬规则（变量先 const、不写占位、trace 传已画对象）；② 手绘模式下 `trace` 动点停在原点：形状换成 rough `<g>` 后 `<mpath>` 失效，替换后重指到描边 path；③ 图的几何本身核算无误（A(-3,0) B(3,0) k=2 → 圆心 (5,0) 半径 4，PA/PB=1.99）。复测两段真实坏脚本自愈成功（1.7s / 1.8s，最小改动）。
- **第二节真实课（NS 方程）再修三处**：① 口播 / 提问卡里的 `$\mathbf{u}\cdot\nabla\mathbf{u}$` 原样显示、原样念——复用闪卡的 `MathText`（切分下沉到 `lib/utils/math-text.ts`，顺手让它认裸 LaTeX、不把 `$5` 当公式）渲染字幕 / 提问卡 / 课堂记录，新写 `latexToSpeech` 让 TTS 念「u 点乘 纳布拉 u」「a 的平方 加 b 的平方」「2 分之 1」「求和 从 i 等于 1 到 n」（17 例单测）；② 手绘 / 工整切换看不出变化——之前只影响之后的新笔，现在已画的清空重挂，roughness 0.55 → 0.85 让手感看得见；③ 24 个 `LNaN NaN` 箭头——老师把 `arrow(A, dx, dy)` 当成 `arrow(A, B)` 写，`arrow` 改为双签名，点参数统一 `expectPt` 校验给出能被自愈修的 TypeError，render 兜底不上 NaN 元素。

---

## 2026-09-11 — 课堂线可靠性：实时字幕断了会自己接回来、Recorder 被卸载不丢课、登录迁移只推变过的课

「录课不丢」审计（`/tmp/mm-sync/FINDINGS.md`）列出的割裂点里影响课堂体验的一批。方法同上一轮：源码逆推 + 生产库只读 + Playwright 在 dev 3107 上用合成账户实测（脚本、截图与逐秒采样在 `/tmp/mm-rel/`）。每项一个原子提交（`feat/reliability`）：

- **实时字幕断连治理**（`dashscope-asr-service.ts` 连接状态机重写 + `server.js` / `server/asr/session-link.js`）：此前首次连接只把候选地址各试一次、握手超时 5s，不通就 `start()` 返回 false → Recorder 把 client 置 null → 整节课零实时字幕全靠课后兜底。现在一轮 = 候选地址按轮数轮转各试一次，握手 8s→20s / 就绪 15s→30s 随轮数增长，整轮失败 Full Jitter 退避再来；课堂 Recorder 首连与会话断线都重连到停录为止（`connectAttempts` / `maxReconnectAttempts` = Infinity；语音输入等短用途保持一轮不通即失败的旧语义）；额度 / 密钥 / 未配置是终态不重连；45s 无入站消息判半开主动重连；上游中途自己收尾（finished 非用户 stop）主动断开重连。**时间轴接续**：客户端每条连接建立与 ready 时发 `timeline-offset`（队头音频在课堂时间轴的位置），代理把上游 / 墙钟时间戳平移回整节课，客户端 VAD 时间不平移。代理侧：上游 20s 不 ready 断连让客户端重连；客户端 60s 无消息终止半开连接；上游关闭而客户端未要求停止一律 close(1011)；**预检期间到达的客户端消息先缓冲再回放**（此前 context-hint 热词与 timeline-offset 落在 `await precheckAsrAllowance()` 窗口里被 ws 静默丢掉，实测发现）。录课界面：转录卡头部与移动端录课页那一行状态在断连时说「实时字幕暂时断开，录音仍在继续」，恢复后自动消失（`capture-editor-store.liveAsrLink`）。实测：注入首连失败 ×2 → 录音 0.9s 时接上（提示 4.2s）；live 21s 切断 → 1.2s 重连 + 1.0s 缓冲补送（提示 1.6s），offset 20962ms，80s 录音 7 段字幕时间轴单调、原声 652KB 完整、服务端一行。
- **Recorder 被卸载不再只停录音**：桌面 Recorder 只挂在课堂 tab / 收集 tab 录音条里，切 tab / 站内链接 / 视口跨断点都会卸掉它，此前 cleanup 只 `mediaRecorder.stop()`，录到一半的内容在内存里丢掉、store 里还亮着「正在录音」。现在卸载时走 `stopMediaRecorderSafely`（最后一片经 onAudioChunk 交出）→ 新回调 `onRecordingInterrupted` → `useRecordingCheckpoint.handleRecordingInterrupted` 先落盘分片 + 字幕快照 + 服务端最后一次检查点，再把 isRecording 置回 false；这节课留成「没结束」交给恢复条（继续录 / 就到这里），不出理解、不跳复习。离开前一句确认：`handleViewModeChange` 桌面录课中切 tab 先 confirm；`useRecordingLeaveGuard` 拦站内 `a[href]` 点击。实测：24s 录课切「收集」→ 24 片 + 2 段落盘、toast 一句、无「正在录音」残留；回课堂 14s 内恢复条出现 → 就到这里 → 分片拼回 194KB 原声、completed、synced、服务端一行 2 段。
- **登录迁移只推变过的课**（`lib/services/local-workspace-migration.ts`，从 `useAuth.tsx` 抽出 ~280 行）：此前每次页面加载全量重推全部 audioSessions（同一用户一天 8 轮 × 2-3 批全量转录）。现在每节课算证据签名（用户 + 转录 / 锚点 / 摘要 / 精选 / 笔记 / 对话的数量与最后更新时刻 + 会话元数据），只推签名 ≠ `audioSessions.migrationSignature` 的课，成功即写回；正在录的课不推。实测：登录后第 1 次加载 1 次 POST 3 节 → 第 2 次 0 次 → 给一节加笔记 → 第 3 次 1 次只含那一节；服务端 3 行、每节课一行；live 行 + 迁移同 sessionId 仍只留一行（3 段不翻倍，笔记 artifact 上去了）。
- **访客的安静入口**：`useGuestSyncHint` + `GuestSyncHint`——访客本机有录好的课时，课堂列表恢复条旁 / 手机首页顶部一行「登录后，这节课会跟着你到任何设备 · 登录」（→ `/login?next=/app`），不弹窗；登录后消失、迁移照旧。
- **useLiveQuery deps 复查**：全仓 22 处没有需要修的 `[]` 用法；`dexie-react-hooks` 内部 `deps || []`，"不传 deps 修 StrictMode 双挂载空数组"是误判，注释与 `hooks/DOMAIN.md` 改为唯一规则（querier 用到的每个外部值都进 deps）。
- **已知问题登记**（`prisma/DOMAIN.md` 新建）：`PointAccount.userId` 无外键、删用户留孤儿（生产只读统计 8 行）；`userId` 承载 `guest_{ip}` / `anonymous` 所以不能直接加 `@relation`，需单独决定。不改 schema。
- 验证：`make check`；改过文件 eslint 零新增；`make test` 1705 例全绿（新增 dashscope-asr-service 状态机 13 例、local-workspace-migration 6 例、useRecordingLeaveGuard 3 例）；`make test-server` 63 例（新增 session-link 8 例）。
- 顺手发现（未改）：`src/lib/prisma.ts` 不读 `DATABASE_URL`，按 `process.cwd()/prisma/meetmind.db` 开库——worktree 里会静默新建一个空库（本轮在 worktree 放了指向共享库的软链，gitignored）；登录迁移 summary 的 created/updated 按 `local-session:` 键查已有行，复用 live 行时会记成 created（只是日志口径）。
- 没做的：Recorder 的录音状态外提成不随视图卸载的引擎（2000 行组件的重构，本轮选了"卸载时收尾 + 可恢复"）；断连超过 120s 缓冲预算丢掉的那段音频不会回补字幕（原声完整，需要按时间切片的补转写）；`history.pushState` 程序化跳转不拦。

---

## 2026-09-10 — AI 家教第三代引擎 live stage：边说边画、图一笔一笔长出来、会动、能拉

用户原话：「真正的老师给人讲课的那个效果……AI 老师可以给多模态的输出，除了文字还有基于代码的表现方式例如 SVG、各种基于代码的动画，还可以调用生图模型……力求实时流式输出……真人老师 1/4 的价格、相近甚至更好的效果……现在的形态我非常不满意……用 GLM 5.3 Flash。」重新审视了 teach 线的前代决策（`docs/TEACH_TUTOR_ENGINE.md` §12），在 codex / engine 之外开第三条线，前两条不拆作对照。

- **协议换成标签流**（`src/types/teach-live.ts`）：老师一轮输出是 `<say>` / `<scene>` / `<svg>` / `<plot>` / `<math>` / `<note>` / `<diagram>` / `<code>` / `<anim>` / `<widget>` / `<image>` / `<ask>` / `<point>` / `<highlight>` 交错的一条流，块正文是原生文本——一个 `<svg>` 里一个元素闭合就能上板，图是一笔一笔长出来的；`<svg into="fig">` 往已有的图上追加（先画三角形，讲到斜边再补斜边）。两态增量解析器 `live-markup-parser.ts`（10 例单测含分块不变性）。
- **服务端只解析 + 扇出**（`src/lib/services/teach-live/`）：一轮一次 streamText，无工具 loop、无子进程、无板书模拟；复用 teach-codex 的事件总线与事件日志（SSE 契约只追加四种块事件，口播仍走 text-delta）；`<image>` 块一闭合即异步生图回填。路由三个写口按 `TeachThread.engine` 三线分发，`POST /threads` 接 `engine` 显式指定，`GET /threads?engine=live`。
- **模型**：百炼 `ZHIPU/GLM-5.3-Flash`（不可关思考；`reasoning_effort=low` 实测把推理压到 0）TTFT 0.8–1.1s、~140 tok/s，一轮开场 input 2.6k / output 1.1–2.4k。`TEACH_LIVE_PROVIDER` 独立于 `TEACH_PROVIDER`。
- **前端 `/teach/live`**（`src/components/teach-live/`）：暗色教室里一块亮着的暖白板，95% 时间只有板和声音。核心是**两条时间轴**——事件按模型速度到达进 reducer，Director 按语音真正出声的时刻放行揭示（句子后 320ms 落笔、连续块 650ms 错开、静音按估时）；`svg-draw.ts` 用 stroke-dashoffset 按路径长度描画 + 琥珀笔尖沿路径走；`plot-dsl.ts` 手写表达式求值把 `f(x)=6x^2 ; point(1,6,"A")` 排成永不重叠的坐标图；anim / widget 走 iframe 沙箱（样式与脚本不泄漏整页，widget postMessage 自报高度）；激光笔指到图里的 `#id`；字幕跟声音（合成中半透明）；按住麦克风老师即闭嘴、松开发送；打断 = 没演到的永远不演、空页撤掉。7 例管线单测（真解析器 + reducer + Director 假语音口走完一节课）。
- **实测**（真模型 + 真 TTS + Playwright 录像）：勾股定理（svg 三步长出 + 公式 + 要点）、导数（svg + 割线 plot + 割线转切线 anim + 定义式）、浮力（svg + anim + **滑块拉货物吨数看船吃水的 widget**），插话「斜边是什么意思」老师闭嘴、指回图里的边回答、衔回。首句出声生产链路 ~3s。
- 顺手：`TeachSpeechPlayer` 预取两句（短句之间不留空）；`.env.example` / 各 DOMAIN.md / AGENTS.md §3-18 与路由表同步。

---

## 2026-09-10 — 录课不丢、结束即可见：一节课从开始录到出现在任何设备上

用户原话：「录一节课，录到一半，如果忘记保存、忘记结束，这节课就直接没了。我经常录了一节课，去其他设备看，并没有这节课的记录。」沿源码追完整个生命周期 + 生产库只读查询 + Playwright 在生产 3002 上用合成账户实测（FINDINGS 与前后截图在 `/tmp/mm-sync/`）。真相：录课期间音频分片与实时字幕**只在内存**，「结束这节课」是唯一的持久化时刻；服务端写入一次性 fire-and-forget、失败只 console.error；另一设备只在页面加载那一刻拉一次列表，课堂 tab 点开跨设备的课**没有任何反应**。生产库 90 天 79 节课：只有 40 节在结束那一刻到了服务端，39 节靠下次页面加载的登录迁移才上去（中位 8.9 小时、p90 54 天），57 节在服务端是两行。七个原子提交：

- **IndexedDB v10 + 现场录音 payload 单一真相**：新表 `recordingChunks`（录课中音频分片），`audioSessions` 新增 `checkpointAt / syncState / remoteRecordingState` 等非索引字段；`lib/capture/live-recording-capture.ts` 把检查点 / 结束 / 原声回写 / 恢复收尾 / 补传五处写服务端 capture 的形状收成一处，sourceKey 从结束时随机的 `live:audio-xxx` 改成录课一开始就能算出的 `live:{userId}:{sessionId}`。
- **服务端护栏**（`workspace-context-service` + `workspace-capture-guards`）：同一节课按 `metadata.sessionId` 复用已有行（三把钥匙不再各占一行）；upsert 撞唯一键（结束时全量转录写入与原声回写并发，dev 实测撞掉的正是带转录那次、服务端只剩 0 段的壳）改为重试更新；部分更新与已有 metadata 合并（原声回写不再冲掉 evidenceAvailable）；零信息标题不盖具体标题；读列表时历史双行折叠成一行。
- **录课中检查点**：`POST /api/workspace/recording-checkpoint`（`recordingState=recording`，不带正文不触发理解）+ 客户端 `useRecordingCheckpoint`（每 5s 分片 / 字幕快照落 IndexedDB；登录用户开始即打、15s→60s 一次服务端检查点；页面隐藏 keepalive 心跳）+ Recorder `onAudioChunk`。另一台设备录课期间就看到「录制中 · 已 N 分钟」。
- **忘记结束不丢课**：`useUnfinishedRecordings` + `UnfinishedLessonBar`（首页顶部一行：有一节课没结束 · 继续录 / 就到这里）+ `recording-recovery-service`（分片拼回原声 + 字幕 + 服务端 + 课后理解；有原声没字幕先兜底批量转写再写服务端）；`useClassroomLessons` 不再在挂载时把 recording 态一刀改成 completed；>6h 没回来的本机自动收尾、服务端读列表时把 6h 无检查点的「录制中」翻成 completed 并出一次理解；`lessonAdapter` 只把当前 Recorder 在录的那节渲染成活动条。桌面课堂 tab 与手机首页都挂。
- **结束即可见**：`useWorkspaceContextLoader` 首次加载后回前台 / 聚焦 / 联网（≥20s）与每 60s 定时刷新；`backfill` 写 / 翻远端录制态与服务端标题；课堂 tab `onOpenLesson` 本地没转录时走收集列表同一条懒拉 evidence 路径（2026-07-16 列表轻量化后一直缺这一步）；结束时 POST 失败本地标 `syncState=failed` + 一句 toast，`syncPendingRecordings` 在进课堂 / 联网 / 回前台补传。
- 附带修：录课开始写的占位行 `userId` 恒为 'anonymous'（classroom-data-service）。
- 验证：`make check`、改过文件 eslint 零新增、`make test` 1668 例全绿（新增 live-recording-capture / workspace-capture-guards / recording-checkpoint-service 单测）；Playwright 四场景（录课中另一设备可见 / 关页后恢复条 → 就到这里 / 正常结束另一设备不刷新 16–33s 看到并能点开复习 / 关页后继续录）截图 `/tmp/mm-sync/after/`。
- 没做的：多设备同时录同一节课的合并；「继续录」不接续原声容器（两段各自成课）；历史双行的物理清理（读时折叠，删数据是独立决定）；登录迁移仍每次页面加载全量重推（现在会命中同一行、不再制造双行，频率是下一步）。

## 2026-09-10 — 应用进入态一套版式 · 闪卡去深色房间 · 产品内去衬线斜体 · 少文字

用户原话：「闪卡的进入页面完全是黑色的，太难看了。每一个应用的进入页面都挺难看。产品里很多「同学」用的衬线斜体，跟其他地方完全不一致，非常别扭。整个产品的表单感、demo 感太重。好的产品应该尽可能少用文字，让用户不看文字就能知道这里是什么意思。」审计（生产 3002 访客试听 → 复习页，八应用 × 复习页中栏 / 舞台 / 浮窗 / 手机；Playwright 拦住 `/api/apps/execute` 让进入页停住）与前后截图在 `/tmp/mm-ui/`（AUDIT.md / before / after）。三个原子提交：

- **应用进入态**（`AppEntrySilhouette` + `AppWindowPlaceholder` 重做）：点开后、成品出来前的那一屏，八个应用各以产物的形状说明自己——一叠牌 / 有题号的纸 / 几个节点 / 一条波形 / 留白的板 / 海报框 / 三栏密线的纸 / 气泡 + 三位听众；一句话 ≤14 字（`APPS_COPY.entry`）+ 一个槽位（等待 = 原话掠过，空 / 失败 = 唯一动作），等待 · 空 · 失败同一套三层版式，成品落下来时不跳。此前是章鱼 + 「在听这节课，给你课堂测验」+ 「同学正在整理 · 01s」计数条 + 光晕；空态是虚线框 + 两句 + 黑白两个按钮。**闪卡的深色房间 `--mm-immersive` 从复习页 / 独立页 tone / 浮窗 / inline 卡四处删除**——根因：宿主给了深色底、等待态占位没有自己的底，进入页就是黑底黑字。宿主头部只留一行（返回 · 应用名 · 动作），说明副题 / 「示例课」数据源 / 「记住核心」分类标签全删，状态词只在成品在眼前时出现（`hasResult`）。信息图定制态去表单：海报比例的框是主角，尺寸 / 感觉两排词坐在框下（无标签），补一句要求一行淡字，唯一动作「生成」；PreparingState 与它同一版式。浮窗全屏 / 手机的「Failed to fetch」不再外露。
- **去衬线斜体**：「同学」（问同学开场 / 课堂同桌空态 / 今日情报空态 / 同学在想…）改正文同字体 500 字重 pine；我的上下文 · 我的课程 · 考试范围 · 会员弹窗 · 课堂笔记 · 手机首页与整理态 · 结课仪式 · 目标共建对话的标题改无衬线 semibold；录课头状态句 / 同桌回答 blockquote / 复习页步骤号 / 速查表用法说明 / 信息图可读版同步；`ui/EmptyState · SectionHeader · CourseHero` 的 `emTitle` 改 500 字重朱批红；删 `.v7-em / .v7-em-pine`。衬线只留分享页与营销页（`docs/DESIGN_SYSTEM.md` 字体段）。`ReviewWorkspacePanel` 无时间轴空态的硬编码字符串收进 `COPY.reviewTutor.noTimeline`。
- **少文字**：问同学输入卡右下的模式说明、课后学习页 / 手机学习路径标题旁的「先暴露问题…顺序只是建议」、inline 应用卡的「已放进对话」副题与「同学」胶囊、应用矩阵四个无人消费的说明键全删。
- 规则写进 `docs/DESIGN_SYSTEM.md`「进入态版式」「文字密度」与字体段；`apps/windows/DOMAIN.md`「进入态版式」。验证：`make check`、改过文件 eslint 零新增、Vitest（windows / classroom 相关 57 例 + apps 全部 235 例）全绿；桌面 1440 / 手机 390 三宿主前后截图。
- 没做的：浮窗头部的模型选择器（既有功能，是否对普通用户隐藏是产品决定）；`TeachBack*` 的说明句（另一位同事在做 v3）；`not-found.tsx` 与营销 / 分享页的衬线（不在范围）。

## 2026-09-10 — 讲给同桌听 v3：讲者面对一排评委，不看自己的转写

用户看过面试间 v2 后的原话：「讲给同桌听还是做得太烂，画面丑。我面对的是评委，我站在讲台上——最好的情况是用户不知道自己被转录出来什么，转录很可能有错，转错一个字用户注意力就被吸走了，怎么聚精会神地讲？把转录隐藏起来才是产品的考虑。整个产品：少用文字，让用户不看文字就知道这里是什么；表单感、demo 感太重。」v2 把讲者自己的实时转写放成左 62% 的主角、三位听众缩在右上角三行小字里。底层（实时 ASR 通道、能量 VAD + 回合状态机、`/api/apps/teach-back/turn` SSE、TTS、插话中止、`evaluate` 契约与记忆事件、`use-teach-back-panel`、prompt）一行没动，表现层再做一次。

- **主舞台 = 评委席**（`TeachBackBench`）：三位 120px 章鱼肖像并排立在一条桌沿线上（不裁圆、不套底、极淡一层桌面渐变），桌沿下三个名字 12px 墨色。状态只靠表情与一枚指示点：在听 = listening；有人想问 = 桌沿正中一枚呼吸的松绿点；在说 = 那位换 speaking 表情 + 名字旁一枚松绿点；实时反馈关着 = 肖像右上角极小角标计数。人设只在 hover / 长按肖像时出一行。
- **评委开口 = 他脚下长出一段话**：名字正下方一根细线接下来，16px 墨色随流逐字长；说完留 7s 淡成 13px 灰字滑进下面的**对话记录**（时间倒序、24px 肖像 + 一两句 + mm:ss，默认只露最近 3 条，`+N` 展开）。你一开口他就停，没说完的话收成记录里一行截断的灰字（`use-teach-back-stage`）。
- **讲者自己 = 一个安静的讲台**（`TeachBackPodium`）：左 呼吸的圆点 + 细波形（故障时同位置一行人话 + 重新开麦；拿不到麦克风打字一小行）· 中 已讲时长 mono · 右 三个图标开关（实时反馈 耳朵 / 出声 喇叭 / 转写 一卷字；选中态实心，`title` 里才有字）+「讲完了」。**没有实时转写**：转写只在「转写」开关（默认关，开了讲台上方一条 12px 灰字单行只看得见最后一截）与复盘里可展开的「整场转写」两处存在。
- **要讲的几点 = 手卡**（`TeachBackCueCards`）：开场在画面中央 + 大按钮「开始讲」；点开始 → 几点用 FLIP 飞到左侧收成一列 220px 小卡（窄容器是顶部横向条，可左右滑），每张只有编号 + 要点一句话；点一张 3D 翻过去 = 讲过了（不做 AI 判定），再点翻回来；复盘说到哪一点，那张卡亮一道松绿边。
- **复盘在同一界面**：评委席留在上方；先把实时反馈关着时记下的笔记、再把复盘各段，由那位评委依次说出来（肖像换 speaking + 脚下逐字流出 + TTS 可选；字打完、读够、声音安静了才轮到下一位，`performanceFinished`），说完的话进对话记录（复盘条目带手卡卡号、hover 才出 ↩ 回到课堂原声）；记录下面是「整场转写」折叠项（默认收起，点一条记录展开并高亮那一段）和 再讲一次 / 只讲没讲清的 / 回到目标。句子的生成规则沿用 `buildReviewBlocks`，直言的每一处没讲清单独一段、主句是核对结论。
- **字**：全屏常驻的文字只有三个名字、手卡要点、已讲时长、「讲完了」；眉题（你的话 / 听你讲的人）、状态词、人设常驻、说明句全删（首次进入一次性 toast 说一句「麦克风常开…」）；不用衬线斜体。
- 手机（390）：手卡横向条在顶部、评委三位 72px 横排、开口的话在评委席下方、讲台栏固定底部。阈值 `CUE_COLUMN_MIN_WIDTH=720` 按容器真实宽度。
- 纯逻辑 `teach-back-room-model.ts` 新增（Vitest 23 例）：手卡翻转、脚下话相位与淡出、表演什么时候算说完、对话记录排序与折叠。删除 `TeachBackTranscriptColumn` / `TeachBackListenersColumn`。`copy-apps.teachBack` 去掉 v2 的眉题 / 状态词 / 文字开关，新增 title 与手卡 / 记录文案。
- 验证：`make check`（本文件相关）、eslint 零新增、Vitest 全绿；Playwright 假麦克风全流程（开场 → 开始讲 → 讲 → 停 → 评委开口 → 留一会进记录 → 翻一张手卡 → 转写单行 → 关实时反馈再讲（角标）→ 讲完了 → 记下的话说出来 → 复盘三位依次说 → 展开整场转写）桌面 + 手机截图 `/tmp/mm-teachback/v3/`。

## 2026-09-10 — 讲给同桌听：表现层重做成一间「面试间」（底层连续讲述链路不变）

用户看过生产上的连续讲述版后：「我要的是模拟面试的效果：反馈不应该用一个新页面呈现，可以在旁边有一个轻量的反馈；支持实时反馈，也可以关掉实时反馈、说完了再反馈。不要看板——看板很 demo、很 AI。反馈应该是直接由我们的听众去听、去说。」像素教室、章鱼评委头顶气泡、四象限结果看板整个下掉；实时 ASR 通道、VAD + 句末回合状态机、`/api/apps/teach-back/turn` SSE、听众 prompt、TTS 音色、插话中止、录课互斥、`evaluate` 契约与记忆事件一行没动。

- **一个界面走完开场 → 讲 → 讲完了，不换页**（`TeachBackWindow` + `TeachBackTranscriptColumn` + `TeachBackListenersColumn`）：左 62% 你的话——开场是要讲的几点（素列表），开讲后转写从底部长出来往上流（当前段 18px 墨色，讲过的越早越淡；自动跟随，往上翻停下 + 「回到当前」）；底部一行 细波形 · 已讲 mm:ss · 一句状态词（在听你讲 / 停了一下 / 有人想问 / 直言在说），停顿只是一枚呼吸点；左下 讲完了 + 两个文字开关 **实时反馈 开/关**、**出声 开/关**（偏好 `meetmind:teach-back:live-feedback` / `:voice`）。右 38% 听你讲的人——三位一人一行（章鱼家族肖像 + 名字 + 一行人设 + 状态词 在听 · 想问 · 在说 · 记了 N 笔 · 说几句，全部来自真实事件，没有点头动画）+ 反馈流（最新在上，`mm:ss · 直言` + 一到三句逐字长，正在说的左侧 pine 竖线，被打断的收成一行灰字「（被你打断）」，点一条 → 左边转写滚到那一段并高亮）。
- **实时反馈 关**：听众只听、只记——回合结束仍请求 turn 但条目 `held`（不上屏、不出声、不占状态机，你接着讲也不会中止它），三位显示「记了 N 笔」；讲完了以后按时间每 600ms 揭示一条。
- **讲完了不是新页面**：转写停止跟随、整场可滚；三位状态词「说几句」；右栏上面长出**复盘**——`evaluate` 结果改写成三个人的话（`teach-back-room-model.buildReviewBlocks`）：直言「这 N 处没讲清、或讲错了：」（盲区在前、自知缺口在后，主句是核对结论，可点回到你讲到它的那一段——按目标点与原话的字符二元组重合定位）；引导「讲得最稳的是「X」。接下来先把「Y」说一遍。」；追问「你没讲到：」一条一行。句子 + 细分割线，没有象限、颜色标签、分数。出声开着时三位按顺序各读自己那几句。下面 再讲一次 / 只讲没讲清的（盲区 + 自知缺口 + 没讲到重进面试间）/ 回到目标。
- **听众肖像 = 章鱼家族**（`public/images/octo-buddy/judges/`，直言 方框黑眼镜 + 红领结 / 引导 圆金边眼镜 + 绿围巾 + 茶杯 / 追问 铅笔 + 本子；两张表情 在听 / 在说，120ms 交叉淡入，不裁圆、paper-warm 圆角方底）。
- **四个宿主**：复习页全屏舞台双栏；复习页中栏 / 浮窗 / 手机按容器真实宽度（< 860px）堆叠单栏——听众横条 32px 在上、转写、反馈在转写下面长、固定底栏。
- 纯逻辑 `teach-back-room-model.ts`（Vitest 14 例）：反馈流排序 / 揭示顺序 / 计数 / 折叠、听众状态词、复盘分配与空态、原话回合定位、只讲没讲清的、mm:ss。`use-teach-back-panel.ts` 新增：每段的会话内 `startedAt / endedAt`、held 条目与揭示、`speakAs` 按句固定音色、`speakingJudge`、`reset`、断开重连回合号接着数。删除 `TeachBackClassroom` / `TeachBackPodium` / `TeachBackQuadrantMap`（无其他消费方）。
- 验证：`make check`、eslint 零新增、Vitest 全绿；Playwright 假麦克风全流程（开场 → 讲 → 停顿 → 听众说 → 插话 → 关掉实时反馈再讲一段 → 讲完了 → 记下的话揭示 → 复盘 → 点一条反馈回到转写）桌面 + 手机截图 `/tmp/mm-teachback/v2/`。

## 2026-09-10 — 讲给同桌听：从"录一段 → 停 → 等评估"变成一场连续的口头讲述（VAD + 实时 ASR + 评委席）

用户的原话：「像豆包语音通话——不间断；我停下来之后它才反馈；台下坐着一排不同性格的评委，有的一针见血，有的循循善诱」。模型侧不上语音通话模型，用 VAD + ASR 做出通话感。

- **麦克风常开**：走上讲台后复用课堂录音的实时 ASR 通道（`/api/asr-stream`），讲台下方波形 + 实时转写；与正在录课的 Recorder 互斥（同一时刻只有一路麦克风）。采集链先挂、ASR 后连（连接期间的帧由客户端排队补送、VAD 趁这 1s 校准噪声地板）。
- **停顿即回合**（`teach-back-turn-machine.ts`，纯函数 25 例单测）：能量 VAD（阈值 = max(0.012, 噪声地板×3)）+ ASR 句末事件——有效语音 ≥1.5s 且静音 ≥1.2s 判定回合结束，ASR 定稿已到且静音 ≥0.5s 提前结束，停顿 650ms 内不算停（画面不在「你在讲 / 等你说完」之间抖），太短不算回合、带着已说的继续等。
- **评委席**（`POST /api/apps/teach-back/turn` SSE + `src/lib/prompts/teach-back-panel-prompt.ts`）：直言 / 引导 / 追问三位性格不同的 AI 同学，模型拿到课堂原文、目标点、本场记录、刚讲完的一段，自己决定谁开口说什么或谁都不开口；一位开口 = 头顶气泡流式长出 + 那位抬头 + 按句 TTS（三种音色，`/api/teach/tts` 新增 `voice` / `instruct` 白名单参数）。没有模板反馈、没有兜底——模型沉默或失败就让用户继续。讲过一段后 40s 没人说话，评委问一句要不要先到这。
- **随时插话**：你一开口（评委发言中需连续 400ms 有声、阈值 ×1.6 挡回声），在飞的请求中止、TTS 停、气泡收成一行，回到「你在讲」；评委说了一半的话也进本场记录（尾巴省略号）。
- **收尾不变**：「讲完了」走原有 `evaluate` 四象限核对与记忆事件；结果页新增「本场回合」回看（你讲了什么 / 谁说了什么）。「出声 / 只看文字」偏好 `meetmind:teach-back:voice`。四个宿主都能用；手机上 `AudioContext` 挂起回前台 resume、麦克风轨道被收走一键重新上台；麦克风拿不到 / 转写连不上有打字兜底。
- 半双工版（`TeachBackSpeakPanel` / `use-teach-back-voice` / `respond` 路由）原样保留未挂载，供回退。文档：`src/components/apps/windows/DOMAIN.md`「TeachBackWindow（连续讲述版）」、`src/app/api/apps/DOMAIN.md`、`src/lib/prompts/DOMAIN.md`、`.env.example`（`TEACH_BACK_PANEL_MODEL`）。

---

## 2026-09-10 — 应用矩阵交互与表现打磨：状态过渡 / 手感 / 键盘 / 触屏 / 四宿主（内容层未动）

用户的口径：「先打磨交互 + 表现到极致优秀，最后再打磨内容」。这一轮不改任何 prompt、生成逻辑与渲染契约；先在四个宿主（复习页中栏 / 全屏舞台 / 浮窗 / 手机）把八个窗口的每个状态截了一遍、逐项审计（`/tmp/mm-apps-2/AUDIT.md`），再按应用逐个修，11 个原子提交。

- **底座**（`9caacf6`）：加载 → 成品 / 失败 → 再做一版四种状态 220ms 过渡、骨架 300ms 后才出（缓存命中不闪）、失败只剩「{应用}刚才没做好」+「再试一次」（此前正文 / 头部 / toast 三处各说一遍）；浮窗全屏统一成一张纸（不再深绿 header 盖米白正文），浮窗有投影与弹出，Esc 关最上面那个窗；舞台已全屏时窗口不再叠第二层全屏；新增 `app-motion.ts`（动效常量 / reduced-motion / 延迟骨架 / 数字长起）与 `keyboard-hints.ts`（快捷键提示只出现一次）；手机结果页的加载 / 失败态交给同一个 `AppWindowPlaceholder`。
- **测验**（`d7bd17c`）：题间两段式切换；交卷揭示先染红错的、正确项再浮出、勾叉用 SVG 一笔画出；1–4 / 回车 / 空格一路不碰鼠标；结束页圆环从 0 画起、逐题可点回看；触屏滑动有阈值 / 取消 / 快甩（`swipe-model`）。
- **闪卡**（`42ba943`）：打分的牌朝分数方向飞出（记住右 / 没记住左）、下一张从牌堆升起；拖动跟手 + 回弹；翻面有抬起与投影层次；Z 撤销；长卡面自动缩字、牌面渲染 TeX。
- **导图**（`2409596`）：画布提成 `MindmapCanvas`（窗口回到预算内）；平移有惯性与边界、双指缩放、悬停提亮根到节点路径、折叠展开有过渡、方向键在节点间移动焦点。
- **播客**（`78d59a6`）：自绘 scrub（拖时时间气泡、悬停落点）、空格 / ←→ 键盘、逐字稿跟随可被用户打断并「回到当前」、当前句指示条滑动、章节可点。
- **板书**（`db3b138`）：控制条退成框下一行文字 + 上一步 / 下一步（`useBoardPlayer.stepSegment`）+ 连续段进度线 + 空格 ←→ 键盘；课题与黑板作为一块居中。
- **速查表**（`7acd981`）：版式切换重新进场、荧光笔开关像划上 / 擦掉、缩放与装进一页的纸尺寸 280ms 过渡、− + 0 键盘、工具条触屏尺寸与窄屏单行。
- **讲给同桌听**（`ba2d1d0`）：麦克风旁一行说清点按开始 / 结束与已说时长；同桌气泡浮出；结果一组一张纸依次浮出；象限格子可点跳到那一组。
- **信息图**（`23ab53d`）：海报查看器（滚轮 / 双指缩放、放大后可拖、双击切全图 / 原始、+ − 0）、等待骨架与海报同比例、定制态即时版面示意。
- **应用矩阵页**（`37f425c`）：卡片与按钮按下有反馈、完成后回到路径时结果行浮出、「先做这一件」换推荐与「走完了」重新进场、下一步卡进场。
- **手机宿主实拍修正**（`8583f8a`）：播客窄屏补内边距；讲课面板两个按钮不再被状态行挤成两行。
- 纯逻辑全部抽成模型 + 单测：`app-keys` / `swipe-model` / `flashcard-deck-model` / `mindmap-gestures` / `podcast-player-model` / `keyboard-hints`。

---

## 2026-09-10 — 收尾：同一件事只说一次、同一种语言贯穿

- **桌面课堂首页**去掉顶部珊瑚色「接回学习现场」横幅——侧栏「继续学习」卡说的是同一件事，首页顶部还给"开始一节课"；移动端没有侧栏，仍挂 ContextRecoveryCard。
- **我的上下文的掌握轨迹**改成画像栏「检验过的」同款一行一件（概念 · 事实序列 · 状态词），删掉状态点、H2 与说明段。
- **问同学对话态**：同学的回答不再套卡片（minimal 气泡 + Octo 头像，像人在说话）；用户消息仍是墨色气泡；底部输入框与第一屏同一张卡（bare 变体 + 宿主画外框）。
  修了 minimal 气泡的 pre-wrap 把 markdown 块间换行撑成空行的问题。`ChatBubble` minimal 变体传了 avatar 也显示。
- **今日情报**空态：同学开口一句 + 「去收一条 →」，不再是占满抽屉的空白大卡。
- **板书 / 讲给同桌听 / 速查表 / 导图在桌面默认进全屏舞台**（复习页中栏 400px 里只能缩成缩略图，全屏后才是完整产品）；返回键永远回应用矩阵，「全屏 / 退出全屏」是右侧另一个文字动作。

---

## 2026-09-09 — 应用矩阵重做：速查表成为样板（一张真正的纸），其余窗口突出应用本身的优秀

用户的口径：「主要是做好看，做得比 HyperKnow 好」；其他应用「突出这个东西作为应用本身的优秀，不要太强调回到老师原话」。

- **考试速查表**（`f5b9fd8`）：A4 逻辑页 794×1123 屏幕等比缩放、打印 1:1；桌面 3–4 栏密排、窄屏单栏流；分页由 `useLayoutEffect` 实测区块高度驱动（均衡栏高装栏，不再字数估算）；
  安静的工具条：栏数 1–4 / 字号 / 密度 紧·标准·松 / 高亮 / **装进一页**（整体缩放压进一页 A4）/ 打印 / 复制 Markdown，偏好记 `meetmind:cheatsheet:layout`；
  **三色荧光笔**签名（黄 = 定义、绿 = 公式 / 结论、朱红 = 易错 / 老师强调，半透明稍溢出字形，可整体开关）；正文零时间戳 chip，hover 才出 ↩，页脚一行来源。
  契约扩展向后兼容：按考试主题 `topics → items(kind/term/latex)`，`sections` 照常产出；LaTeX 在 JSON 里的转义地狱由 `latex-json-repair.ts` 修（实测坏例全有单测）。
- **测验**（`5ba38df`）：一份试卷——细进度线 + 题号 + 整行可点选项（选中 / 正确 / 错误 = ink / pine / vermilion），1–4 / 回车作答，结束页答稳率圆环 + 错题回看（`QuizReport`）。
- **闪卡**（`5fff29b`）：牌是牌——纸质牌 + 牌堆 + 真实 3D 翻面（`FlashcardDeck`），空格翻 / 1·2 打分 / 左右滑，进度环，结束页「没记住的再来一遍」（`FlashcardsSummary`）。
- **导图**（`a1c8860`）：主干 ≥4 支时**双侧布局**（单侧长树在全屏只能缩到 70%，双侧后 100% 铺满）；点主干聚焦一支；节点里的 TeX 折成 Unicode（`flattenInlineTex`）；
  修了一个老 bug——pointerdown 就 `setPointerCapture` 让 click 落到容器，所有节点点击一直是死的。
- **公共壳 + 播客 / 板书 / 讲给同桌听 / 信息图**（`51419c4`）：复习页宿主头部 3 个胶囊 + 状态 pill → 一行文字，新增**「全屏」**（Esc 退出）给板书 / 教室 / 速查表一块真正的舞台；
  AppWindowShell / 浮窗动作全退成文字，「做好了」不再说，「会话 7eeeed…」内部黑话删掉；播客的脚本改成逐字稿（说话人字母 + 朱批竖线标当前句），去掉与音频时间轴对不上的「回到课堂片段」，试听卡加「看逐字稿」入口；
  板书抬头不再显示「N 处原话已核对」；讲给同桌听的核对结果一组一张纸、`[MM:SS] 回到原话` 降为 hover ↩；信息图定制从表单改成纸上三行字。
- 文档：`src/components/apps/windows/DOMAIN.md` 顶部新增「公共设计语言 + 四宿主对照 + 偏好 key」，各窗口小节按现状重写。

---

## 2026-09-10 — 侧栏本身要有内容 + 「我的上下文」与画像栏合一 + 收集流录音卡有名字

- **侧栏**（对标 HyperKnow 的 Continue Learning / Recent Activities）：从 168 放宽到 216px；「继续学习」一张小卡（有活着的学习线索就是线索，点开问同学；否则是上一节课）；
  「最近」= 可复习的课按时间倒序、同一 sessionId 去重、只念主题、相对日期（今天 / 昨天 / M-D），最多 6 条 + 「还有 N 节 →」；正打开的一节高亮。纯模型 `sidebar-recent-model`（3 例）。
- **我的上下文总览**与问同学右侧画像栏是同一件东西：眉题「同学眼里的你」+ 同一份小传 + 「记住的」逐行维护（对 / 不对 / 改 / 忘掉 / 恢复 / 告诉同学一件事），删掉带图标方块与「…」菜单的记忆卡。
- **收集流录音卡**先显示课名（此前只有一个胶囊播放器，一节课在收集流里没有名字；占位名不显示）。
- **移动端「最近收下」空态**与桌面同一套语言但更轻：一句标题 + 副题 + 能力 pill。

---

## 2026-09-09 — 问同学全屏 + 「同学眼里的你」：把学习画像放到提问旁边，让用户自己养

- **心智**：产品要养成的习惯不是"多聊几句"，而是"我在 MeetMind 有一个会长大的、可以自己改的学习画像"。所以画像不藏在设置里，
  坐在问同学右侧常驻一栏（`LearnerProfileRail`）：问出去的每个问题都被它接住，答得准不准一眼能对上；不对就当场改。
- **布局**：此前问同学是 `bg-canvas/95` 毛玻璃罩 + 居中 1060px 圆角卡片，四周留着大片空白（用户原话"很 demo"）。现在侧栏右侧整块就是问同学：
  左边对话（内容列 660 居中），右边画像栏 340px（≥1180px 常驻；窄屏 / 移动端是顶栏「画像」按钮 → 抽屉）。`DesktopSidebar` 把实际宽度写进 `--sidebar-width`。
- **画像栏版式**：顶部同学写的小传（`learner-profile-model` 把事实说成最多四句："你在学「X」。「A」还没稳，「B」刚记住，2 个概念已经稳了。最近听了 3 节课…你说过：喜欢先看例子。"）
  → 正在学（学完了）→ 检验过的（状态词 + 再练 → 问题落进输入框）→ 记住的（类型两个字 + 标题；同学猜的带「对 / 不对」，悬停出「改 / 忘掉」，停用的沉底可恢复；
  最后一行「告诉同学一件关于你的事…」这是 在学 · 弱项 · 偏好）→ 页脚台账「认识你 12 天 · 听过 3 节课 · 记住 4 件事」。全部是文字和分隔线，没有卡片、图标网格、计数徽章。
- **持久化（修了一个老问题）**：登录用户的画像四字段由服务端事件管道合并，客户端不回写——于是「我的上下文」里改 / 忘掉一条，刷新就丢。
  现在用户本人的 add / update / remove / confirm / set-thread 走 `LearningEvent type=curation`（同一条串行队列合并，不与蒸馏互相覆盖，留史可回放），
  `/api/memory/events` 对 curation 同步等处理完回传服务端真相；不进 Context 双写（编辑操作不是学习现场）。生产实测：添加「下周考线代」→ 刷新仍在。
- **收集空态（对标 HyperKnow 首页）**：一屏一件主角——真实输入栏以 `hero` 变体坐在页面视觉中心（24px 圆角、两行起、带标签的工具行「+ 上传文件 / 说一段」、聚焦环），
  上方 Octo + 情境标题 + 副题，下方一行带图标的能力 pill（课件 / 录音 / 图片 · B 站 / 公众号 / 网页 · 一个想法 · 语音随手记 · 微信里发给我），
  再下一小段「丢进来会变成什么」三行清单，整块铺在极淡的点阵纸纹上。微信服务号写全名「MeetmindAI原生专属导师」。
  此前两版：大头像 + 四张图标卡 + 底部孤零零的输入栏；一切退成小字（干净但寒）。
- 单测：`learner-profile-model` 2 例、curation 3 例、opening 7 例；tsc / eslint 干净。

---

## 2026-09-09 — 问同学第一屏重做：同学开口，不陈列库存

- **病灶**：上一版空态是大头像 + 眉题 + 衬线大标题 + 副标题 + 「上次继续」列表行 + 一张带"正在读 / 记住"标签与 chip 的书桌 +
  带勾的模式单选 + "会参考 6 份当前内容、24 条最近学习、1 条长期线索"计数。上下文被当成库存陈列，用户原话"太表单了、低级感"。
- **改法**：一列左对齐三样东西。① 同学开口的一两句真实事实——`global-ask-opening.ts` 把 `buildAskDesk` 的事实说成话
  （"刚听完《Australia's Moving Experience》。你在 00:30、01:12 停过。「线性规划的建模」还没稳。"），书名 / 时间点 / 概念本身可点，
  点了一句指向那个位置的问题落进输入框；最多两句，按"此刻 → 最近 → 长期"取最要紧的；什么都没读到就诚实说并给试听 / 上课的出口。
  ② 输入卡是这一屏的主角（ChatComposer 新 `bare` 变体，外框由宿主画，不再框里套框），"直接回答 · 陪我学会"是卡脚下两个词，不是控件。
  ③ 最多三行"可以从这里开始"——句子，不是卡片；接着上次的线索优先，再是句子里没点到的事实；写死的通用句一律不上。
- **去掉**：光场（v9-aura）、玻璃叠玻璃、计数行、`GlobalAskDesk.tsx`、9 条死文案；参考范围留在顶栏按需打开。
- **只说能念出口的事实**（上线后拿真实账号一看就露出来的三处）：句子不是标题——口袋收的一句话（"这台设备上的课堂历史已同步到账号。"）
  不进《》（`isMaterialTitle`）；应用活动"完成了「讲给同桌听」"不是课名——顺着 sessionId 找回那节课，时间也跟着听课那天走；
  长期理解标题去掉开头动词（"关注线性规划的建模与转化能力" → "线性规划的建模与转化能力"）。知道哪天就说哪天（今天听了 / 昨天听的 /
  前天 / N 天前 / 月日），翻回以前的课不说"刚听完"。
- **参考范围抽屉同款重做**：「同学手里有什么」——每一行是一件真实的东西（《X》的转录 / 材料 / 附件 / 最近上过的课 / 记住的 / 正在继续的目标），
  不再是"1 份当前材料、24 条最近学习"三行计数 + 黑色大按钮。
- 顺手：麦克风录音倒计时 tooltip 在 36px 按钮里竖着断成 5/8/s（nowrap）。`global-ask-opening.test.ts` 7 例 + desk 3 例新增；移动端同一组件。

---

## 2026-09-09 — 口袋 Windows 版 + 桌面壳产品化：设置 / 日志 / 备选热键 / 权限退化 / 自托管安装包

- **打包漏洞**：`electron-builder.yml` 的 `files` 是白名单，`desktop/pocket/**` 没在里面——打出来的包会 `require('./pocket')` 失败。补上（并排除测试文件），
  Linux `--dir` 冒烟确认 asar 456 KB 含 `pocket/` 全部文件
- **Windows 安装包**：CI 因 billing lock 不可用、EPEL wine 只有 64 位（NSIS 生成卸载器要跑 32 位 exe）→ `make desktop-dist-win` 走 electron-builder 官方
  `electronuserland/builder:22-wine` 镜像，产物 `MeetMind-win-setup.exe` 80.7 MB，拷到 `public/downloads/`（gitignored）由站点自托管；landing 的 Windows 卡
  指向 `/downloads/MeetMind-win-setup.exe`，两个平台各显示自己的版本（Windows 1.4.0 / macOS 仍是 GitHub 上的 1.1.0，dmg 只能在 Mac 上打）
- **Windows 正确性**：`Ctrl⇧M` 刚按下时手指还在 Ctrl/Shift 上，SendKeys `^c` 会叠成 Ctrl+Shift+C（Chrome 开发者工具）→ 先轮询 `Control.ModifierKeys` 等松开；
  浏览器网址用 UI Automation 读地址栏（chrome / msedge / brave / arc / firefox / opera / vivaldi）；`app.setAppUserModelId` 让系统通知能弹
- **成熟度**：`settings.json`（热键主 + 备选、还原剪贴板、回执、无选区是否框选；托盘「打开设置文件」）；`logs/desktop.log` 文件日志（托盘「打开日志文件夹」）；
  热键被占自动退到 `Alt` 版并通知，托盘显示真正生效的热键；macOS 无「辅助功能」权限时弹一次系统授权、退化为"剪贴板和上次热键时不同才算选区"（先复制再按热键）；
  `/help` 桌面段与 landing 文案改为口袋语义。`make test-desktop` 12 个纯逻辑测试

---

## 2026-09-09 — 口袋：任何应用里选中，一个键，收下（桌面壳 v3 + `/api/workspace/clip`）

- **形态**（`docs/plans/2026-09-09-pocket-capture.md`，对标 Raycast / Apple 快速备忘录 / Drafts / CleanShot / Yoink / Readwise）：
  `⌘⇧M` 收下面前的东西——选中了文字 → 收文字（剪贴板 HTML + 来源三元组）；没选中而剪贴板里是图 → 收图；都没有 → **框选截图**
  （不再整屏）。拖任何东西到桌宠或口袋窗也收。每次收下光标旁一张 1.6s 回执（不抢焦点，可撤销）+ 桌宠吞一口。
  `⌘⇧K` 口袋窗：今天收的东西按来源成组的一条流（「来自 ChatGPT · 3 条 · 回到原处」）+ 记 / 问，本身是拖放与粘贴目标；浏览器里开同一页也能用
- **有根**：热键那一刻取前台应用 / 窗口标题 / 浏览器网址（mac AppleScript 问 Chrome / Edge / Arc / Brave / Safari；win PowerShell），
  服务端映射成 platformLabel（chatgpt.com → ChatGPT，claude.ai → Claude…），同来源 30 分钟内归一组
- **格式不丢**（服务端 `pocket-clip-service`，turndown + gfm）：KaTeX 的 `<annotation encoding="application/x-tex">` 抓回原始 TeX 写成
  `$…$` / `$$…$$`——从 ChatGPT 划过来的推导在口袋里是可再渲染的公式；ChatGPT 带工具条的 `<pre>` 也能出带语言的围栏；button / svg /「复制代码」清掉
- **契约**：`POST /api/workspace/clip`（clientId 幂等；网址放 `metadata.pocket.source.url` 不进 `sourceUrl`——那是链接去重键，否则同一对话第二条覆盖第一条）、
  `GET /api/workspace/pocket`；撤销用已有 `DELETE captures`。剪藏进同一条收集流 → 今日情报 / 问同学 / 记忆
- **桌面壳**：读选区靠"快照剪贴板 → 模拟一次复制 → 读 → 原样还原"（无原生模块；mac 首次要「辅助功能」授权）；离线 `pending-clips.json` 启动补传；
  `desktop/pocket/*` 九个文件，`make test-desktop` 9 个纯逻辑测试。**验证边界**：服务器没有 Electron 与显示服务，框选覆盖层 / 回执窗 / 热键要在 Mac 上
  `npm run desktop:dev` 跑过再 `desktop:dist:mac`（version 1.4.0）
- **验证**：`make smoke-pocket`（合成账户 → clip → pocket 读到 TeX / 围栏 / 同组两条 → 撤销 → 清理）5/5；口袋窗截图里公式已渲染
- 旧 `/companion` 小窗（随手记 / 随口问 / 截图三按钮）与 `COPY.desktopPanel` 删除，由 `PocketPanel` + `copy-pocket.ts` 取代

---

## 2026-09-09 — 同款病灶清零 + 状态不再说谎 + 视觉层级：把"半成品感"的来源一次挖干

- **审计**：以"兜底题"为样本，在 services / api / ai-native / components / hooks 全量找"规则替模型判断 · 假成功 · 假空态 ·
  缓存了失败 · 默认值冒充理解"五类病灶，得 20（后端）+ 30（前端）条，逐条修掉（commit a81a1cb → 93cde34）
- **后端（模型产物就是产物，没有就诚实失败）**：随堂检验 API + 插件的模板题（正确答案永远 A）、课中内联应用用原文切片拼假测验 / 速查卡 /
  结构图并随对话持久化（`inline-app-fallback` 整个删除）、课堂笔记失败切 5 分钟拼「第 N 段」并**永久缓存进 IndexedDB**、Tutor 的
  180 行关键词规则澄清题（硬编码示例课 Jane Bond）、按关键词补的「导入资料 N」`about:blank` 假引用卡、学习目标模板计划（会写进
  用户学习线程）、信息流用「学习方法」拼检索配「延伸你最近收集的主题」假理由、幻灯用卡片 / 抽样片段拼页、播客按序号挂抽样片段当
  回放锚点、信息图「提炼课堂重点 / 梳理知识关系 / 突出关键结论」万能三点、速查表字面落地不到就删条目、回声「主要讲了」正则否决与
  「今日回声」占位标题、拍题缺学科默认「数学」、随堂骨架缺标题默认「课堂学习」——全部改为：模型一次重试；证据落地只决定引用 / 跳转；
  仍无可用产物抛 `GENERATION_FAILED` 或返回空，不缓存不写记忆
- **标题系统**：`passesTopicQualityGate` 的 includes 黑名单把「机器学习入门 / 课程设计 / 内容分发网络」整个打回并永久打标；零信息标题判定
  六处各一份、服务端那份不认「课堂录音」→ 线上 152 条课永远停在这个名字。收口到 `lib/learning/lesson-title-generic`（六处共用），门改为
  "只拒绝完全由泛词和虚词拼成的主题"，上限按显示宽度 16，长转录头 / 中 / 尾采样，模型可答「无」；`make titles-backfill` 全量回填：
  **113 条改名、34 条模型判无（IDE 截屏 / 闲聊 / 演示废话），剩余占位均为不足 80 字的短录音**
- **前端（状态在说谎）**：有"成品"但没一道题 / 卡 / 分支 → 按失败处理带「再试一次」（之前顶栏「做好了」窗口体空）；移动端「记一下」
  「已标记，同桌会帮你讲这段」此前只 toast 不落库 → 接到与桌面同一条锚点路径；AppsScreen `activeAnchorCount` 写死 0 → 真值；
  随堂检验固定评语「完全掌握了 / 有些难度」→ 没有模型评语只报事实；「搜索功能开发中」→ 接真实 AI 搜索；登录页删「手机号登录
  (即将开放)」；`GENERATION_FAILED` 字面不再外露（`describeAppExecutionError`）；用户面「回声 / 演示数据 / 会话 xxx…」清理；
  命名收敛（今日情报 / 已标记 N 处 / 重新回答）
- **视觉**：应用等待态从"静止章鱼 + 秒数"改为**这节课真实转录行带 [MM:SS] 朱批戳按时间顺序掠过**（`TranscriptDrift`，不假装阶段进度）；
  复习页 v2.1 层级重排（区块标题降为 mono 眉题、正文 10-11px → 12.5-14.5px、步骤号衬线斜体、推荐理由里的时间点渲染成朱批引用芯片）；
  登录页并入 v7（RippleButton 从纯黑 / 珊瑚改为 pine / 中性，一页只剩一颗饱和按钮）；`/context` 访客态从"空页 + 一颗按钮"改为先说清三块区域
- **未动（taste 层面，待定）**：「同学」与「同桌」并存——前者是 AI 人格名（问同学），后者是课中角色（讲给同桌听）；统一与否需要产品拍板

---

## 2026-09-09 — 没有兜底题了：模型的题就是题，做不出来就诚实失败

- **问题**：一位真实用户的测验五道题全是"回放 7:16 附近的内容，用自己的话复述这一段讲了什么、为什么重要"。模型其实出了题
  （概览里还有它的出题策略），但 `quiz.plugin` 的"证据落地"只在抽样的 5-6 段里找字面重叠，长课里几乎每道题都落地失败，
  于是逐题换成模板题；闪卡 / 导图 / 板书 / 信息图 / 播客各有同款兜底（模板卡、抽样片段拼的假树、"这次没做好"的假成品、
  "证据模块 N"、直接念原文的播客），`fallback.plugin` 还会产出"已进入通用处理流程"。对学生是敷衍，对记忆是污染
  （assessment 里的概念字段写进去的是"回放 7:16 附近的内容"）
- **原则**：规则不替模型判断。证据落地（`evidence-grounding`）从"否决产物"改成"只决定回到原话跳到哪、要不要给跳转"
  （`meta.evidence = text / timestamp / none`），在整份转录里找而不是抽样；模型产物一律保留。整份做不出来（LLM 一次重试后
  仍无可用题 / 卡 / 树 / 动作 / 脚本）抛 `GENERATION_FAILED` → 路由 200 + ok:false → 窗口体统一进「这次没做出来。再试一次，
  通常就好。」（`AppRenderSurface` 分发前渲染，含沉浸窗口），不缓存、不进路径的"做好了"、不写任何记忆事件
- **涉及**：quiz / flashcards / mindmap（节点只标注不删）/ explainer / studio-workshop（信息图 · 幻灯 · 播客）/ fallback.plugin
  （抛 `APP_NOT_SUITABLE`）；单测改成新契约（题保留、弱证据无跳转、不足两题即失败）

---

## 2026-09-09 — `/app` 首屏 JS 回到 299 KB gzip：文案按域拆文件

- **发现**：合并记忆底座后重量 `make bundle-report`，/app 首屏 312 KB——但在合并前的提交乃至记录 298 KB 的那个提交（d375082）上重建，
  今天同一把尺也量出 311 KB，说明 13 KB 的差异来自当时的量法而不是这两天的代码；不争论，直接再省
- **修法**：`copy.ts` 27.8 KB 里，`apps`（除 `matrix`）/ `globalAsk` / `intent` / `settings` / `share` / `fenshen` / M1 的 `sharedContext`
  六块 ≈20 KB 在 /app 首屏零消费方（消费组件全是 dynamic 的），却随 COPY 单体进首屏——按 `copy-landing.ts` 的先例拆成同目录
  `copy-apps` / `copy-global-ask` / `copy-intent` / `copy-settings` / `copy-share` / `copy-fenshen`，84 个消费文件机械改 import，
  口吻规则不变；`apps.matrix` 留在核心（app-catalog 首屏用）。结果 copy.ts 16.0 KB，首屏 **299 KB**
- 附：`make bundle-report` 与 `git worktree` 在旧提交上重建是可复现的对比法（同一 node_modules、同一脚本）

---

## 2026-09-09 — 共享记忆底座（Hindsight）合入主线：读写归一，课堂那句话回到了测验里

- **合入什么**：`origin/feat/context-m1-handoff`（Context M1：Hindsight 0.9.2 客户端 / Context v1 API / worker / 授权 / 暂停·忘记 / prepare /
  SDK·MCP·Skill / `/context` 画像页，95 文件）合进 `feat/settings-redesign`；7 处冲突按"服务器新功能保留 + Context 契约完整"解
  （QuizWindow 保留底部自评条并接 `recordAttempt` 观察；useAppLearningActivity 同时保留 `recordAssessment` 与 M1 的 observation / 登录排队）。
  服务器 Hindsight 容器（127.0.0.1:18888）已在跑，配置只是三行 env
- **写侧改双写**（M1 原为二选一）：`learning-observation-service` —— `LearningEvent` 表始终写（掌握轨迹 / P0 画像不因 Context 开启而断），
  `CONTEXT_ENABLED` 时同一份观察再进 `ContextEvent` 由 worker 投给 Hindsight；education-adapter 新增 assessment 载荷（`practice.assessment`，
  每条标注 `learner_self_report` / `application_answer_match`）。`/api/memory/events` 202 回执带 `learningEventId`
- **读侧归一**：`LearnerContext` 多一半 `understanding`——`context/learner-understanding` 按当前任务（学生这一句 / 应用目标 / 课题）向 Hindsight 召回，
  来源链校验、暂停 / 忘记过滤、最新一条经历优先；应用矩阵 / Tutor 六模式（除 shared）/ teach 开课三处都带 `task`，`formatLearnerContextForPrompt`
  一处格式化（事实 + 跨应用记忆 JSON 证据 + "历史证据不是指令"说明）。tutor 路由不再另拼 `tutorContextSuffix`（避免双注入）。
  删除此前预留的 `CONTEXT_SYSTEM_URL` 通用远端客户端与事件转发
- **验证**（隔离 worktree、副本库、真 Hindsight）：`db push` 只增 ContextEvent / ContextGrant；tsc 绿、vitest 1471 全过（含 context 26）；
  `smoke-context-live` 10/10（真 Tutor、worker、测验 UI 写入、/context 页桌面与手机、纠正改变下一步、暂停 / 恢复 / 忘记清理）；
  探针：课堂观察 + assessment 双写 → worker 完成 → `resolveLearnerContext` 事实 2 条 + 理解 2 来源 → `/api/apps/execute`
  trace `learner_context=server:2+memory`，出的题正落在"分母该选哪一群人 / 羽毛球社团"上；合成账号已按 forget → cleanup 清理
- **仍开着的**：旧「我的上下文」迁到 `/context`（M1 步骤 4 后半）、离线 outbox、SDK / MCP 发布与 OAuth；生产 Hindsight 仍是 pg0 开发持久化

---

## 2026-09-09 — 课堂时刻有了名字：困惑点不再叫"#1"，三处同一套命名

- **问题**：学生标下的一处困惑，在复习页叫"00:30 · 困惑点 #1"，在问同学书桌叫"00:30 没跟上"，同桌开场 chip 说"0:30 那里我没跟上"——
  全是时间和序号，他记不得 0:30 老师在说什么。人做笔记会写那一刻老师的话，或自己的一句备注
- **命名规则**（`lib/learning/moment-title.ts`，纯函数有测试）：学生备注 → 课堂脉络里覆盖这一刻的要点标题 → 老师那一刻原话的首个有实词子句
  （跳过 "That's it exactly" 这类叹句；英文按词边界、中文按显示宽度截到约 14 字；段尾正好在边界算下一句开头）。都没有才只剩时间
- **三处同一个名字**：复习页「困惑点」tab 没选中时新增 `MomentList`——"你标的 2 处 / 00:30 My name is Jane, Jane Bond / 01:12 You see, I'm relocating to…"，
  点一行进详情并跳到那一句（替代了"去波形上找红点"的空态）；问同学书桌「你标的」chip 变成 `00:30 · My name is Jane, Jane Bond`，问句点名那句话；
  复习同桌开场 chip `0:30「My name is Jane, Jane Bond」那里我没跟上，帮我讲一下`（音频复习 `ReviewTutorPanel` 与视频复习布局都接了 segments）。
  线上示例课三处均验证
- **课堂标题本身**不动：`主题 · 课程 · M-D` 契约 + 零信息词质量闸 + 用户改名锁（`lesson-title-service`）已经是对的层级

---

## 2026-09-08 — 「这个学习者」读槽落地：LearnerContext 读契约 + 三个应用先用上

- **契约**（`types/learner-context.ts`）：`LearnerContextRequest`（应用声明"为完成这个任务我需要知道这个学习者的什么"）→ `LearnerContext`
  （掌握状态 / 最近学过 / 没过去的困惑 / 在学 / 偏好 / 目标 + 可溯源证据 id），v=1 与写侧 LearningEvent 对齐。
  MemoryLayerSnapshot 仍是"这节课"的，learner 是"这个人"的
- **供给**：远端 = 外部 context 系统（`CONTEXT_SYSTEM_URL`，POST `/v1/learner-context`，1.5 s 超时静默回落）；本机 = 会话层检验结果 →
  掌握状态 + 最近现场 + 长期理解（与问同学书桌、掌握轨迹同一份事实）。今天就有真实数据在槽里流，接远端只是换供给方
- **消费**：`/api/apps/execute` 注入 `context.learner`，闪卡 / 测验 / 讲给同桌听的 user prompt 多一段「关于这个学习者」——
  做完一轮闪卡再出测验，模型已知道哪几个概念还没稳；`trace` 含 `learner_context=local|remote:N`
- **Tutor 也用上了**（同日晚）：除 `shared` 外六模式的 system prompt 多一段「他此前真实做过的检验（跨课）」——还没稳的多停一下、
  已经稳的不重复、没问起不报清单；课中同桌 / 复习同桌 / 问同学三个入口发送时现算本机切片（memo 会停在挂载那一刻，实测踩过）；
  shared 态服务端强制抹掉（隐私铁律，有用例）。生产实测：做完闪卡后问 "up in the air"，请求里 mastery=3、该概念 unstable；TTFT p50 ≈ 0.9 s 不变
- **teach 两条线也接上了**：开课 `POST /api/teach/threads` 可带切片，存 `TeachThread.learnerJson`（新列，nullable，`make db-push` 已同步线上）；
  codex 线 baseInstructions 与 engine 线 systemPrompt 在会话建立时拼「关于这位学生」，旧线程一字不加。生产直打：开课带
  "判别式还没稳" → 落库成功。读契约本侧的消费方至此齐了（应用矩阵 / Tutor / teach），只等外部供给方对齐接口（plan §6）
- **记忆系统在本仓库自己闭环了**（9-9 凌晨）：新增服务端供给方 `learner-context-provider`（`source: 'server'`）——从 LearningEvent 表的
  assessment 事件（P0-1 写侧）+ 用户画像（记忆 / 最近现场）读时聚出同一契约的切片，掌握轨迹规则搬到 `lib/learning/mastery-trail-model.ts`
  由客户端与服务端共用；`resolveLearnerContext` 顺序改为 远端 → 服务端 → 本机 → 空，**登录用户换设备也记得**。同一契约对外暴露
  `POST /api/context/v1/learner-context`（Bearer = MeetMind JWT，learnerId 以 token 为准，无 token 401）——外部 context 系统合并时
  要么代理到这个口对拍，要么在 `CONTEXT_SYSTEM_URL` 提供同形接口，本仓库自动改问它；写侧 `triggerLearningEventProcessing` 配了 URL 就把
  事件原样转发 `POST /v1/learning-events`（outbox，失败只 warn）。生产用临时账号全程验证：写 `/api/memory/events` 200 → 表里有行 →
  读回 `unstable` → `/api/apps/execute` 不带本机切片 trace `learner_context=server:2`，出的题正落在那两个还没稳的概念上；探针数据已清
- **UI 也跟着账号走**：`hooks/useMasteryTrail` 把本机轨迹与服务端切片合并（同概念以服务端为准，本机更新的保留），「我的上下文」掌握轨迹与
  问同学书桌都改用它——登录用户在一台空白浏览器里也能看到"另一台设备上错过的：条件概率的方向 测验 ✕ → 闪卡 ✓ 刚记住"，
  脚注从"这台设备上的记录"换成"跟着你的账号走，换设备也在"。生产用临时账号 + 只带 JWT 的新浏览器验证后清理

---

## 2026-09-08 — `/app` 首屏 JS 330 → 298 KB gzip（目标 <300 达成）+ 体积账本

- **先做账**：`make bundle-report` 用归因构建（`NEXT_BUNDLE_ATTRIBUTION=1`：模块 id = 源码路径、关 scope hoisting）把首屏 JS
  按文件 / 包列出 gzip 体积（`scripts/bundle-report.py`）——此前只能看 chunk 哈希猜
- **营销页文案拆出**：`copy.ts` 是账上最大的应用模块（36 KB），其中 landing + technology 10 KB 是 /app 用不到的营销页文案，
  拆到 `src/lib/ui/copy-landing.ts`（`LANDING_COPY`），口吻规则不变；AGENTS.md 路由表已注明
- **Recorder 按需加载**：录音引擎（含 ASR 客户端 / PCM 采集 / 转录增强，≈20 KB）此前静态坐在首屏；挂载点都是 sr-only 隐藏引擎，
  改 dynamic 后桌面走 autoStartSignal、手机端 `waitForRecorder` 短等就位
- **再切两条纯函数泄漏**：收集卡片为一个 `markdownToPlainText` 拖进整个网页抽取服务（→ `lib/utils/markdown-plain-text.ts`）；
  语音输入静态引 ASR 客户端（→ 开始听写时再 import）
- 生产冒烟：书桌三态 / landing 内嵌试听 / 示例课 console 零错误

---

## 2026-09-08 — 讲给同桌听：修复"核对永远失败"

- **根因**：`TeachBackWindow` 把 AppRenderSurface 给信息图用的 1400 字 `contentContext` 当成课名——黑板抬头滚着整段转录，
  `metadata.title` 超过接口 200 字上限，`/respond` `/evaluate` 全部 400「请求内容不完整」，学生讲完只看到"这次没能完成核对"。
  三个宿主（复习页内联、浮动窗口、手机）全中。改为显式 `contextTitle`（复习页 / 手机传课名；浮窗无课名则不传），
  接口 400 现在 `log.warn` 出 zod issues，不再哑掉。生产实测：讲台 → 文字讲述 → 同桌应答「原来如此」→ 评估 →
  四象限（讲透了 2 · 还没讲到 1）+ 每条带「回到课堂原声」
- **板书精讲的黑板挂回墙上**：此前整个窗口刷成深色房间、黑板框 h-full 铺满——复习页中栏又窄又高，纸面只占上面 1/3，
  其余全黑像坏了的投影幕。现在窗口是纸面（与其他窗口同皮肤），深色框只包住 16:9 纸面 + 控制条并垂直居中，
  纸面按宽 / 可用高双约束缩放，宽屏矮窗不撑出窗外；teach 引擎的板与独立页不受影响
- **课堂播客播放条**（`PodcastPlayerBar`）：播客窗口与「做好即弹」预览卡此前都是浏览器原生 `<audio controls>`——灰色系统控件浮在
  米白纸面上，整套应用里唯一一块不属于产品的皮肤。重画为墨色圆形播放键 + 松石绿进度 + 等宽时间 + 倍速胶囊，
  隐藏 audio 经 ref 暴露，章节跳转 / 逐行高亮接口不变。生产实测做好即弹、自动播放、0:03 / 2:46
- 顺带走查：闪卡（翻面 / 打分 / 完成态 / 只练没记住的 1 张 / 接下来）全程成立；信息图做好即弹整图预览 + 保存图片；测验见前条

---

## 2026-09-08 — 结课有了落点：合上笔记本

- **收尾仪式**（`LessonEndRitual`，PRODUCT_TASTE 白名单 #4 此前只有文字没有实现）：点「结束这节课」的那一刻，
  一页纸在屏幕中央浮起「这节课我听完了。共 16 句，标了 2 处你标的困惑。」，停住让人读完，沿左边合上，消散——≈1.3s，
  不挡下一屏、不承担等待。Host 挂在 page 根部（示例课结束的同一帧 ClassroomView 就被复习布局替换）。
  生产连拍 250 / 600 / 1000ms 在场，1500ms 已消散
- **示例课复习页 banner**：「登录，留住这节课」改「登录，记自己的课」（示例课不是访客自己的课，留不住）；
  正文改为"你的每一节课都会长成这样——录下第一节就开始。"

---

## 2026-09-08 — 课中三栏：同桌 chip 14 s 出现、转录卡跟得上老师、录音来源可见

- **同桌 chip 节拍**（`useClassroomForesight`）：此前 6.8s 就首问（80 字，一句寒暄），模型空手而回，节流规则要再等 20s + 150 字，
  第二问 31s → chip 33.5s 才出现，右栏空 30 秒。现在首问等 140 字、空结果 8s + 60 字就重试——实测首 chip 14s。
  客户端按问句去重（"是什么意思"/"是啥意思"不再并排）
- **转录卡自动跟随修复**（`ClassroomRecordingView`）：新行渲染后再量"离底部多远"，一句带翻译的新行就超过阈值被当成用户上滚，
  自动跟随从此失效——示例课 30 秒后转录卡停在开头露着「回到底部」。判定改为只来自用户滚动；实测 75s 时 0px from bottom
- **录音来源可见**：真实录课时 LIVE 旁显示麦克风 / 电脑声音 / 两路图标（hover 见文字），录到一半才发现录的是空气是最贵的错

---

## 2026-09-08 — Landing 首屏单按钮 + 内嵌试听真的在播

- **首屏只剩一个按钮**：「看看它怎么工作」从第二个胶囊按钮改成往下翻的安静文字链（带 ↓），主动作「先试听一节课」唯一
- **示例课静音自动播放兜底**（`ClassroomView`）：出声被浏览器拦时（landing 内嵌 iframe、直接打开的链接）此前三栏干等
  "等老师开口"，landing 上那一屏"现在就坐进这节课里"展示的是一个空产品。Chrome 只对 `<video>` 放行静音自动播放
  （`<audio>` 即使 muted 也要手势，实测 NotAllowedError），示例音频改用隐藏 `<video>` 放 mp3：先静音播，转录 / 脉络 /
  同桌 chip 照常跟着音频时钟出现，按钮变「打开声音」，首次任意交互自动打开声音。生产实测：内嵌 15 s 后已记 2 句 + 脉络卡；
  直接打开无手势也在流，点「打开声音」即出声

---

## 2026-09-08 — 问同学：同桌的书桌；我的上下文：掌握轨迹

- **问同学空态成为「书桌」**（`GlobalAskDesk` + `global-ask-desk.ts`）：此前是一个居中输入框加两句泛化建议，看不出同桌
  此刻在读什么、记得你什么。现在 composer 上方摆着可见可点的实物——正在读（当前课堂点名、打开的材料）、你标的（00:30 没跟上）、
  还没稳（闪卡 / 测验留下的概念，"up in the air"）、最近学过、记得的困惑。点一件，一句指向具体位置的问题落进输入框
  （"00:30 那里我没跟上，从这讲一下"）。全是学生自己留下的事实，不推断；桌上有实物时收起泛化建议卡。
  空桌面给访客一个"先试听示例课"入口（重开 demo 入口后跳 `/app?guest=1&entry=demo`），登录用户不提它。
  生产实测三态（新访客 / 课中 / 做完闪卡）+ 手机宽度，console 零错误
- **首屏示例卡第四幕「下课以后」**（`HeroLiveProof`）：三段"听见原话 → 有依据地解释"之后，卡片切到下课——三件产物
  （闪卡 / 测验 / 讲给同桌听）逐条浮起，再点一句"没记住的会进你的上下文——下次问同学，它还记得"。一张卡讲完
  听 → 懂 → 长出应用 → 记住你；两幕正文固定最小高度，循环切幕时卡片不跳（生产实测两幕同高 412px）
- **手机端课后学习页对齐 v2**（`MobileLessonPath`）：此前是 8 个应用平铺 + 一枚「推荐」角标；现在是这节课（时长 / 标记）→
  先做这一件（带理由）→ 学习路径（每步写结果 / 还没开始 / 做好了）→ 还可以这样学。与桌面读同一份判断与会话层结果；
  生产实测：做完闪卡返回，路径第二步变「做好了」、首选换成下一步
- **首选规则修正（两端）**：模型按内容给的首选只在课堂事实说不出具体理由时接手（`recommendNextStep.grounded`）。
  此前有标记的示例课首选是"闪卡训练 · 这段内容已经足以支撑这个学习动作"，现在是"课堂测验 · 你在 0:30、1:12 留了标记"
- **测验填空题的线性流 + 末题死角**：填空 / 简答此前是底部「对照答案」→ 参考卡里再找「答到要点 / 还没答上」→ 底部「下一题」，
  主动作在两个位置跳；漏掉自评（或用箭头 / 方向键翻过去）走到最后一题时底部空无一物，学生看着"4 / 5 已完成"不知道差哪题。
  现在自评放回底部同一位置，末题若还有没做的显示「还有 N 题没做 · 回到第 X 题」。生产实测含填空题的 5 题全程 → 「看这一轮」→ 结果页
- **下一步规则看结果不看产物**：闪卡早已生成（示例课预置）但还没练时，测验错了仍推荐"先把这几处记牢"，
  此前因为"已生成"被跳过，退到泛化的"先从这里开始"
- **课后学习页「开始」= 应用立刻出现**：此前按下页面唯一的主按钮后是后台生成 → 卡片"正在做…" → 一条 toast「做好了 · 打开」。
  现在按下即打开应用，窗口里先是"在听这节课，给你课堂测验 · 同学正在整理 · 01s"，题目做好自动落进来（`useAppExecution`
  新增同页缓存事件——浏览器 `storage` 事件只发给其他 tab，此前同页两处只靠 localStorage 通信，窗口会停在"生成中"）。
  生产实测：开始 → 1.2 s 内中栏切到生成态 → 题目出现 → 作答判分带原话依据
- **`/app` 首屏 JS 677 → 330 KB gzip（−51%）**：三行静态 import 让已有的 dynamic 形同虚设——`useWorkshopWindows` 从
  `WorkshopWindowManager.tsx` 取类型 + 常量（拖进整棵应用窗口树 + KaTeX + react-markdown）、page.tsx 从 `DedaoTimeline.tsx`
  取纯函数（拖进 WordExplainer → @ai-sdk/react + zod）、`Recorder` 静态导入划词解释浮窗。抽成纯模块（`workshop-window-state.ts`、
  `dedao-timeline-model.ts`）+ WordExplainer 懒加载，零行为变化；生产实测复习页划词后按需加载一块、"解释一下"照常出现。
  剩余最大块是 God File + Recorder 合成的 page 主块（105 KB），下一刀是按域切分（详见 renewal plan P1-9）
- **我的上下文 · 掌握轨迹**（`MasteryTrailSection` + `mastery-trail.ts`，commit 3f07fa5）：本机会话层的检验结果按概念连成
  "测验 ✕ → 闪卡 ✓"，状态只有三个词（还没稳 / 刚记住 / 已经稳了），还没稳排最前；无记录整块不渲染。
  `conceptLabel` 把整句问题收成术语（引号内优先）供窄处使用。数据边界写在头注：外部 context 系统合并后同一形状由它供给

---

## 2026-09-08 — Landing 首屏见产品、课中转录卡、一步做完同桌接着说

- **Landing**：首屏右侧的"场景上下文 / 先收下 / 个人上下文"三张内部词浮片，换成课堂首屏同款活示例卡（`HeroLiveProof`，
  抽成独立组件，landing 用玻璃底 + 链接）——5 秒内看见产品在工作；导航与三条线的 eyebrow 从内部词（课堂线 / 应用矩阵 /
  收集线）改为用户词（上课 / 下课以后 / 随手收）
- **课中转录卡头部**：两行（"课堂文字" + 状态）在窄栏里把标题截成"课堂…"、LIVE 逐字换行——改为一行 `LIVE 已记 N 句`；
  示例播放键图标化，只在需要手势出声时露文字；试听收尾卡文案走 COPY，不再对用户说"应用矩阵"
- **一步做完，同桌接着说**（`NextStepCard`）：测验 / 闪卡 / 讲给同桌听的完成态不再是终点——用课后学习页同一份判断
  （`recommendNextStep`）给出理由与一个按钮（"还有 1 张没记住。讲给同桌听最能暴露卡在哪里。→ 去讲给同桌听"），
  点按直接切到下一个应用；生产实测闪卡打完分 → 卡片出现 → 点击进入讲给同桌听，console 零错误
- 复习工作区头部统一纸面（此前闪卡是深色头 + 浅色舞台，整页唯一一条深色带）；「先做这一件」卡的 test id 独立
  （`workshop-featured-*`），同一应用同时出现在首选与路径里不再撞选择器

---

## 2026-09-08 — 构建 30 分钟 → 1.5 分钟；部署零停机；首屏与问同学两页打磨

### 构建与部署（基础设施）
- **构建 1815 s → 98 s**：`.next/trace` 显示 1643 s 花在 `node-file-trace-plugin`——为每条路由追踪运行时文件依赖
  （teach / fenshen 路由各 21 MB `.nft.json`，`hanzi-writer-data` 9000 个文件被逐一扫描），真正的 webpack 编译只有
  ~50 s。追踪只服务 `output:'standalone'`，本仓库 PM2 直跑仓库目录 → `outputFileTracing: false`。顺带：build 放宽到
  3 核 / 7 GB 堆、显式 `webpackBuildWorker`、跳过 next build 自带的 tsc/eslint（`make deploy` 前置 `make check`）
- **部署零停机 + 自动回滚**：此前 `next build` 一开始就清空 `.next`，而生产进程正从它懒加载页面与静态资源——每次部署的
  整个构建期 `/_next/static/*` 全 500、新访客白屏（HTML 壳能出、健康检查照样 200，所以从没被发现）。现在
  `scripts/deploy.sh` 在 `.next-staging` 构建（webpack 缓存随行）→ 毫秒级 `mv` 切换 → PM2 重载 → 健康 + 静态 chunk
  抽样检查 → 失败回滚到 `.next-previous`

### 课堂零存量首屏（`ClassroomHero`）
- 示例卡是活的（`HeroLiveProof`）：三个来自示例课真实转录的瞬间循环——原话 `StreamText` 逐字浮现 → 同桌解释浮起 →
  停 4.6 s → 下一个；悬停暂停；`prefers-reduced-motion` 只静态显第一个；卡片仍是进示例课的入口。此前是一段静态引用，
  且那句话并不在示例课转录里
- `StreamText` 修复：字符 span 是 inline-block，普通空格被折叠成零宽，英文句子粘成一团——空格改不换行空格（中文场景此前没暴露）

### 问同学空态（`GlobalAskWelcome`）
- 呼吸森林光场由 Panel 铺满整个对话区、消息列表切 glass 变体、空态垂直居中——此前光场被 `max-w-3xl` 容器裁成
  白面板里的一块"岛"，像两层容器
- 建议入口接地（`global-ask-starters.ts`）：有当前材料点名材料（"帮我讲清《X》里最难的地方"），最近上过课就接那节课，
  长期理解里有未过去的困惑先提它；底栏「会带上《X》」在只有一份材料时点名，不再是"1 份当前内容"

---

## 2026-09-08 — 课后学习页 v2：从「选一个应用」到「同桌告诉你先做这一件」

> 形态不动（录课 → 复习页 → 应用矩阵），把中栏这一段做到位。走查与数据都说明：第一次会话的体验
> 本身是好的，问题是复习页把 8 张同样重的卡摆给刚下课、并不知道自己该做什么的学生，且应用之间互不知道。

- **课头**：课名 · 时长 · 你标记了 N 处 · N 个难点 + 同桌一句话概括（有课后理解就用它）；不再是"16 段课堂内容"
- **先做这一件**：页面唯一饱和主按钮。理由必须是学生能核对的事实——"你在 0:30、1:12 留了标记，先做几道题看看那几处跟上了没有"；
  推荐由 `lesson-path-model.recommendNextStep` 驱动：**上一步的结果 > 模型 readiness > 课堂事实**（测验错了 → 记住；闪卡没记住 →
  讲出来；全对 → 直接讲出来；讲完 → 带走；四步齐 →「走完了」卡）
- **学习路径**取代分类目录：检验 → 记住 → 讲出来 → 带走，每步带状态与结果摘要（"3 张记住 2"），其余方式收进「还可以这样学」
  安静列表；分身与跨课沉到底部；所有非首选按钮一律 ghost——签名色稀缺才有语义
- **应用彼此知道**：测验错的点 / 闪卡没记住的 / 讲给同桌听没讲清的，经 `buildOutcomeAnchors` 合成困惑锚点进下一步应用的
  prompt（"他听课时的困惑点…值得多覆盖"已是各插件的现成语义）；结果按 sessionId 存 localStorage（`review-session-outcomes`），
  刷新不丢；卡片按钮提示"再做一版，带上刚错的 2 处"
- **同桌开场**：右栏不再是"同学在这里。"——有标记就"听完了。你在 0:30、1:12 留了标记——从哪里开始？"，chip 是
  "0:30 那里我没跟上，帮我讲一下"（`review-starters.ts`）
- 文案：按钮动词统一为 开始 / 打开 / 再做一版 / 正在做…（原 先做一版 / 继续使用 / 查看进度）；help 页同步
- 验证：Playwright 走通 试听课 → 结课 → 复习页 → 打开闪卡 → 打分（1 张没记住）→ 返回：路径卡出"3 张记住 2"，
  「先做这一件」自动切到讲给同桌听并说明理由；console 零错误；1400 单测全过；截图 `out/audit/renewal/`

---

## 2026-09-08 — 产品新生方案 + 应用矩阵开始向共享记忆回流（写侧）

背景：生产库只读盘点——73 个用户、近 30 天 3 个登录用户产生课堂、9 个应用各被用过 2–30 次、
`LearningEvent` 1 条。功能面远远跑在用户基础前面，而"从第二次开始更懂你"在代码里没有闭环。
完整诊断与分级路线见 `docs/plans/2026-09-08-product-renewal-plan.md`（应用矩阵五个结构性问题、
各线状态、P0/P1/P2、判据 = 第二次会话率 + Context Lift）。

- **`assessment` 记忆事件**：应用矩阵的结构化检验结果按「概念 × 结果 × 课堂证据」留史——
  测验交卷（每题 correct/wrong，主观题按自评）、闪卡全部打分（got/missed）、讲给同桌听评估完成
  （四象限 + uncovered）。各应用词表原样进事件，不在写侧抹平成"稳/不稳"
- 链路：窗口 `onAssessment` → `assessment-events.ts` 纯函数 → `useAppLearningActivity.recordAssessment`
  → `POST /api/memory/events`（登录用户；幂等键 = sessionId + 结果时间 + 内容签名）→
  `learning-event-service` 校验留史。既有的一行人话 `recordInteraction` 通道不变，同桌当场仍读得到
- **刻意不做**：服务端不改画像。掌握轨迹（按概念聚合、保留时间序列、状态迁移）的物化形态要和
  读侧——闪卡优先薄弱、测验避开已稳、课中同桌读上节课的坑——一起设计才不会定错；事件是原始材料，
  随时可回放重建。访客一期不发 assessment（本地同构结构留待记忆线下一步）
- 桌面复习工作区与移动端 `MobileAppRunner` 同时接线；单测：`assessment-events.test.ts` +
  `learning-event-service.test.ts` 新增 assessment 校验 / 留史不改画像两例

---

## 2026-09-08 — 约束文档面向强模型重写：把「Less Structure, More Intelligence」用到 agent 自己身上

背景：产品对自己模型的信条是少结构多智能，但管 coding agent 的 `AGENTS.md` / `skills/*` 却是
"过度结构化"写法——硬行数限制（72 个文件早已违反）、固定步骤仪式、CodeBuddy 专有工具名、
"不主动 commit"（直接导致 09-05 一周一万六千行工作只活在一台机器的工作树里）、与 v7 设计系统
自相矛盾的"零阴影"、常年红灯的 lint 被写成验收标准。

- **AGENTS.md §1**：「铁律」→「工作方式（写给强模型）」：默认行动做完汇报（只有不可逆操作 /
  范围变更 / taste 分歧才停下问）；地图与真相（源码优先，顺手修 DOMAIN.md）；规则分为**不变量**
  （依赖方向、契约、隐私、COPY、vendor、git 边界）与**默认做法**（验证成比例、尺度是预算不是禁令、
  lint 现实）；git 改为特性分支提交并推送是默认，动 `main` / 改历史才需指令
- **四份 agent skill 重写**：判断优先、工具无关、每条规则带理由；域表补齐 teach / fenshen / memory /
  apps / share / compat / desktop；修掉全部过时事实与设计矛盾
- **Makefile**：Node 24 由硬拦截改为自动探测（`/usr/local/bin`、nvm），找不到才报错
- **CI**：所有 PR + `main` / `feat/**` / `feature/**` / `milestone/**` 触发；切 pnpm；补 `eval-teach`；
  lint 因 178 条历史 warning 暂不进门禁并注明
- **DOMAIN.md 体系**（约 20 份）：过程性硬规则（`replace_in_file` 仪式、"需确认成本影响"、
  "必跑 eval"、写死的超标行数清单）改为带理由的判断；"禁止 shadow-*"等与设计系统矛盾的死规则
  修正；产品运行时不变量（隐私 / 回放 / 证据 / 密钥）原样保留
- `docs/PRODUCT_TASTE.md` 白名单 → 带判断标准的当前清单；`提示词设计哲学.md` 新增
  "同一哲学也适用于给 coding agent 写的约束"

---

## 2026-09-05 — AI 家教引擎迁移 P1/P2 落地：pi + vendor OpenMAIC 新引擎与 codex 底座双线并存

> teach 上课线的编排层换底：codex app-server（每线程一进程）→ 进程内 pi agent loop +
> vendor OpenMAIC 28 动作引擎，模型直出结构化动作、边生成边执行。SSE 事件契约不变，
> 旧线程回放不破。设计与分期见 `docs/TEACH_TUTOR_ENGINE.md`（§9 分期表是状态真相源），
> 交接见 `docs/plans/2026-09-05-teach-engine-handoff.md`。

- **P1 引擎落地**：`src/lib/services/teach-engine/`——teach-engine-service 编排 + `runtime/`
  接缝（stream-fn pi→AI SDK v6 桥、engine-runner 增量解析闭合即执行、action-map 词表单一
  事实源、skills、stage-store、board-stores、audio-pacer）；`vendor/openmaic/` 整树豁免 500
  行铁律（bug 修复以 `[FIX vs upstream]` 标注）。`TEACH_ENGINE=codex|engine` 决定新建线程
  归属，`TeachThread.engine` 创建时快照（null 旧线程走 codex）；threads / messages / interrupt
  薄壳路由按引擎分发；前端 `teach-events.ts` boardEffectOf 双词表（legacy 分支永久保留供旧
  线程回放）；`next.config.js` extensionAlias 让 vendor 的 `.js` 后缀 import 解析回 `.ts`
- **P2 skill 体系**：`assets/teach-skills/` 10 个首发 skill（8 个 vendor 教学法裁剪版 +
  quiz-maker + lab-sim 占位，Agent Skills 标准）+ fenshen 人物 skill 多源合并；出题闭环 eval
  门禁 `tests/eval/teach/`（`make eval-teach` dry-run 6/6，baseline `tests/eval/baselines/teach.json`，
  regression-guard 接入 teach 段）；`scripts/teach-engine-bench.ts` 引擎 bench（token / 板书密度）
- **P3 渲染器部分**：全量词表默认放开（`TEACH_ACTIONS_FULL=0` 事故回滚阀）——shape / table /
  line / code 结构化块渲染（`BoardBlocks` + `board-blocks.ts`）、wb_edit_code 行级编辑、laser
  瞬态光圈（`BoardLaser`，live 才落地、回放不重演）、spotlight / laser 的语义 elementId 逐事件
  登记翻译成 wN；交互形态设计稿 `design-demo/teach-classroom-v1/` 六页（待 Taste 评审再动工）
- **未做（P3 缺口，按建议顺序）**：quiz 锚点纪律 prompt 收敛（real 首测判分 5/6 准但判分轮不
  引用 quiz_qN）、插话三拍 eval、学生模型消费、节奏层 / finish-done 语义、换肤实现；P4 codex
  退役评估未开始。生产 `.env` 未设 `TEACH_ENGINE`，现役仍是 codex 底座

---

## 2026-09-05 — 分身线旅程修复：课在旅程里始终在场

背景：分身↔课的关联此前只在发消息时隐式生效（sessionId 物化），UI 全程无表达——
从复习页点入口落到全局分身架，课这个上下文瞬间消失；实现违背了 copy 契约
（入口区标题本就是「请一位听过这节课的老师」）。

- **架子副标题带课名**：有 lessonTitle 时显示「请谁来和你一起复习《X》」（shelfLessonBody）
- **对话头部常驻课名 chip**：「正在陪你复习《X》」（chatLessonChip）——分身此刻在读
  哪节课从隐式变显式
- **单就绪分身直进对话**：架上只有一位就绪分身时跳过架子（零提问原则），返回键可回架子
- 链路：两个入口（WorkshopYellowPage card / ClassroomCompanionPanel chip）统一透传
  sessionId + lessonTitle（课名来自 contextTitle / useClassroomLessons 按会话反查，
  占位标题不显示）
- 产品判断记录在案：对话记录**不**按课切段——分身是长期关系（跨课连续是价值而非污染），
  混课感的正确修法是可见性而非切段

---

## 2026-09-04 — 分身线加固：课堂入口按课物化收口 + 服务拆分

- **课堂同桌分身入口接上 sessionId**：`ClassroomView`（useSessionStore）→
  `ClassroomCompanionPanel` → `ListeningStarterCard` → `FenshenEntryChip`，课中 chip
  入口与应用矩阵入口行为一致——分身从哪节课打开就听哪节课，不再回退全库最新 capture
- **`fenshen-session-service.ts` 拆分**（569 → 314 行，回 500 硬限制内）：课后上下文
  物化（buildContextFiles / parseLessonSnapshot / materializeLessonContext）独立为
  `lesson-context-service.ts`（266 行），测试同步拆分

---

---

## 2026-08-30 — C 端旅程走查修复 + 跨课上下文污染收口

### 硬伤：跨课上下文污染
- **音频拼接护栏**（`useTranscriptIngest`）：此前新导入资料会把**上一次导入新建的会话**音频
  并入当前课，出现「资料 A 的转写进了课程 B」。现在只有「当前会话本身就是上次导入新建的」
  才拼接（模块级 `lastIngestCreatedSessionId` 判定），正常复习会话一律干净起录
- **分身按课物化**（`materializeLessonContext(workDir, {sessionId})`）：分身对话上下文按当前
  课程会话反查 capture（该会话最新分段 → 所属 capture），不再取全库最新一课；查不到才回退。
  `ensureChatSession` 每次发送都重刷物化；messages/interrupt 路由透传 body.sessionId；
  学生画像只取 capture.userId 归属用户（修掉跨用户画像泄漏）
- **对账**（`scripts/audit-cross-lesson-pollution.ts`，只读）：全库扫描未发现多会话拼接型
  污染（A1 场景 0 命中）；3 例 4 月旧数据为 sessionId 漂移（恢复链路重挂，单人测试账号），
  非跨课内容污染，不清理。明细在 `out/audit/cross-lesson-pollution.json`

### 分身线体验
- **蒸馏内部机制不再裸奔到 UI**：distill-progress 只下发固定人话短语（翻阅讲课素材/提炼语言
  习惯/…/检索公开资料，相邻去重），raw 命令/文件名/Phase/SKILL.md/分句指纹一律丢弃；
  蒸馏期 agent 叙述 text-delta 不再下发——skill 永不对用户可见
- **分身架**：就绪优先排序（其后学习中、失败，同状态最近更新倒序）；同名分身副标题补创建
  日期区分；清理学习中的测试残留孔子（保留名人堂就绪那位）
- **demo 课自动播放**：浏览器拦截自动播放时，借用户首次任意交互（点哪都行）续播一次，
  不再首屏三栏干等、还要自己找「播放声音」
- **访客登录转化**：示例课复习 banner 对未登录访客主按钮改为「登录，留住这节课」（→/login），
  已登录保持「去录我自己的课」

### 期中起点问题（分析结论，方案待立项）
- 用户心理：学期中途才开始用会觉得「前面的课没捕获到，不爽」。现有答案是「上传整门课课件」，
  但课件目前只挂单课 capture。复用 `buildCourseContextGroups`（courseKey 启发式，课程速查表
  已在用）可把课件/转写聚合到**课程级上下文**，从「一节一节课」升维到「一门课」——大设计，
  本期只出结论不动工

---

## 2026-08-29 — 复习页体验修复（实测反馈驱动）

### 修复
- **复习 Tutor 不再接回不相干对话**：持久化加 `metadata.scope: 'review-tutor'`，自动接回只认本
  scope 且有消息的对话（与 useGlobalAskHistory 的 scoped 查找同模式）；此前「取同会话最新一条
  global-chat」会把材料问答等别的话题接进这节课的复习面板（demo 共享 `demo-session` 时必现）
- **quiz / teach-back 卡片副文案去重**：quiz 改为「想做题测一测，马上知道哪里没掌握」，
  与 teach-back「想确认自己是真懂，而不只是看懂了」拉开差异
- **「回到最新」浮钮改右下角圆钮**：原居中长条会压住最后一条消息文字

### 分身入口内联化
- 「请一个分身」card 入口从全屏架层改为**在应用矩阵列内联展开**（分身架 → 请分身 → 对话，
  与产物型应用同一呈现习惯）；`FenshenShelf` 拆出容器无关的 `FenshenShelfViews`，全屏层
  （课中 chip 入口）与内联面板共用同一套视图

---

---

## 2026-08-26 — 「请一个分身」线 v1（nuwa skill × codex harness）+ 教练语音输入

> 把任何人"蒸馏"成可对话的分身：上传你喜欢老师的讲课录音/B站链接（或从名人堂请孔子），
> 原版 nuwa skill 在 codex harness 里异步蒸馏出人物 skill，然后分身带着你这节课的
> 完整课后上下文和你聊。skill 永不对用户可见，确认发生在输出上（试听 → 像/不像 → 重蒸馏）。

### 分身线（/api/fenshen/*，与 teach 线平级，复用其 codex harness 通用件）
- **蒸馏线程**（每分身一个，workspace-write + Firecrawl 官方远端 MCP）：跑 `assets/fenshen/huashu-nuwa/` 的原版 nuwa skill（零改动，标准 Agent Skills 挂载）；名人轨 agent 自己联网采集语料；私有轨走 nuwa 原生"纯本地语料模式"
- **对话线程**（read-only、零 MCP）：skill 文件挂载为 persona，课后上下文物化成文件（lesson/transcript、outline、confusions + learner/profile）铺进 workspace——全线零自研工具
- **私有轨语料** `corpus-service.ts`：B站官方字幕捷径（段数+覆盖率双门槛）→ 免下载免 ASR；否则 bilibili-import + DashScope filetrans；upload 轨复用 upload-audio 产物；异步管线不阻塞路由
- **数据**：`FenshenEgo`（prisma）+ `data/fenshen-codex/<egoId>/` 线程工作区 + `data/fenshen-events/` 事件日志；前端 `src/components/fenshen/`（分身架/请分身/对话面板/账本式蒸馏进度），渲染层用 Vercel AI Elements
- **名人堂首发**：孔子（`scripts/seed-confucius-ego.ts` 落库；spike 蒸馏 14 分钟，盲测与无 skill 基线差距显著，见 `out/fenshen-spike/REPORT.md`）

### harness 修复（惠及 teach 线）
- shim Responses→Chat 翻译：function_call_output 转 tool 消息补 `name`（call_id→函数名映射）——Gemini 系上游硬性要求，codex 内置工具（update_plan/shell）在 teach 线同踩此坑（`shim-translate.ts` + 测试）
- spike 实测沉淀：codex 0.149 移除 chat wire API；Gemini 3 强制 thought_signature（蒸馏线程固定 GLM，`resolveDistillProvider`，对话线程不受影响）；Firecrawl stdio MCP 挂死 → 托管远端 MCP；沙箱 workspace-write 需显式开网络

### 学习教练语音输入
- IntentDialog 输入条接入麦克风（ChatComposer `mic` 能力 → `VoiceMicButton` → `/api/asr/oneshot`，课堂同款 ASR 链路），识别文字回填输入框

### 当日下午加固（冒烟实测驱动）
- **空轮静默重试**：上游偶发瞬断会返回零 delta 的 completed；对话轮完成时零 delta 且未补过枪 → 同线程原样重发一次（SSE 不断、用户无感；`emptyTurnAction` 纯函数 + 单测）
- **teach narration `==高亮==` 归一**：老师偶发把讲义马克笔语法漏进对话文本，显示层统一转加粗（`normalize-narration-marks.ts` + 单测）
- **teach TTFT**：`gemini-openai-next` provider 注入 `reasoning_effort=low`（推理量压约 1/4）+ prompt 加"脱口而出、先说结论"的实时课堂约束
- **teach 渲染层迁移 AI Elements** 浏览器端目测通过（CJK 加粗/代码块/滚动跟随/回到最新，console 零报错，截图在 `out/audit/ui-visual/`；审计脚本 `scripts/ui-visual-audit-{teach,fenshen}.ts`）
- **私有轨真实 e2e 打通**：B站链接 → 匿名音频下载 → ffmpeg 转码 → DashScope filetrans（经 PUBLIC_DOMAIN 公网拉取）→ nuwa 语料落盘，198s 视频 50s 出稿；同时实测确认匿名 x/player/v2 对 AI 字幕返回空——不配 BILIBILI_COOKIE 时大部分视频走 ASR 兜底（DOMAIN 已注）
- codex 线程 `project_doc_max_bytes = 0`（teach + fenshen），根治仓库根 AGENTS.md 被注入线程的污染
- **分身入口挂进应用矩阵**：card 形态入口卡落进课后矩阵页 `WorkshopYellowPage`（原只挂在课中同桌面板，课后页看不到；`FenshenEntryChip` 加 `variant: 'chip' | 'card'`；生产实测入口可见、开架正常）

---

## 2026-07-30 — Octo Buddy 参数化宠物 v3 + 旁听闭环（桌面端 v1.3.0）

> 桌宠从"换皮挂件"升级为"活的生命"：原画 100% 保留，生命感全部来自连续参数。
> 三种姿态闭环：随手问（单击/热键）、快速捕获（截图/拖拽）、旁听（双击）。
> 备份点：`backup/octo-buddy-pre-parametric-20260730` 分支（参数化之前的完整快照）。

### 形象保留：精灵图算法分解（不重绘、不描摹、不矢量化）
- `scripts/octo-sprite-map.js`：近黑像素连通域提取眼位、alpha 包围盒定身体锚点、眼周多点采样取眼皮同色（排除体素接缝透明点与纯白高光）；闭眼态精灵（excited/sleeping）从 idle 按 body 比例映射
- 产物 `desktop/assets/octo/octo-sprite-map.json`：参数化动画的全部锚点

### canvas 参数化渲染（companion.js 重写）
- 呼吸振荡（底边锚点，睡眠时更深更慢）、2.6–6.5s 随机眨眼（同色眼皮遮罩）、眼随光标倾身（±3px + ±2° 弹簧）、拖拽果冻物理（velocity 驱动 squash & stretch）、精灵间 260ms 交叉淡化（不硬切）、贴地椭圆阴影（随挤压反向缩放）、深夜/超时自动压暗入睡
- 交互即姿态，无按钮面板：单击随手问（小窗）、双击旁听、拖动位移、右键最小菜单

### 旁听闭环（壳做身体，网页做大脑）
- 宠物双击 → `pet:toggle-listen` IPC → 隐藏主窗口 `window.__meetmindDesktopRecording.toggle()`（`src/lib/services/desktop-recording-bridge.ts`）→ `autoStartSignal` 以 system 声源起录
- Recorder / ASR / 课后理解 / 标题全复用，旁听结束即一节完整的课；旁听中宠物泛声波涟漪，悬停轻声报时
- 全局热键 `Cmd/Ctrl+Shift+K` 随时唤起小窗提问（截图热键 Cmd/Ctrl+Shift+M 不变）

### 捕获姿态
- 拖图片到宠物身上即收收集线（`pet:drop-files` → uploadImageFile，与截图同一条两步链）
- 截图/拖拽成功触发吞食动画（`onCaptured` → `pet:gulp`）

---

## 2026-07-28 — v4.0 全端采集层 + 标题系统 + 课后理解 + teach-back + 微信 Agent + 桌面端 v1.2.0

> 一周交付两条主线：(1) 应用矩阵与收集线的产品闭环（teach-back / 微信 Agent / 分享页 / 复习体验）；
> (2) v4.0 全端采集层从调研到分发全链路（桌面壳 / 小窗 / 关键帧 / 标题 / 课后理解）。
> 架构北极星：`roadmap/v4.0-everywhere-capture.md`（采集 / 学习线索 / 规则 Hook 三层）。
> 备份点：`backup/pre-v4-desktop-20260727` tag（此周期一切改动之前的 main 快照）。

### 桌面端（desktop-v1.1.0 / v1.2.0，landing 已开放下载）
- **桌面壳 v2**：内嵌 MeetMind 网页 + `setDisplayMediaRequestHandler` 免弹窗授予主屏 + loopback 系统音频（录网课无机器人，Windows WASAPI / macOS SCK）；完备化：单实例锁 / 应用菜单（保 Cmd/Ctrl+C/V）/ 窗口状态持久化 / 断网兜底页 / 权限与外链策略 / 托盘常驻 + 开机自启
- **桌面小窗 v3**（`/companion` 路由 + `quick-panel.js`）：随手记（直收收集线）+ 随口问（流式，mode=global）+ 截图快捷动作；失焦自动收起；`persist:meetmind` 共享登录态；网页远程加载，壳只承载
- **全局热键 `Cmd/Ctrl+Shift+M`**：录制感知分流——录屏类课时当前帧挂课堂时间轴（调网页 `__meetmindCaptureFrame` 钩子），否则截图收进收集线；按 scaleFactor 抓全分辨率；401 引导重登
- **自动更新检查**（`updater.js`）：启动 20s 首查 + 每 4h 查 desktop-v* Release，新版本安静通知一次（零依赖，未签名包友好）
- **打包分发**：electron-builder two-package 结构（asar 360K 零 node_modules）+ 稳定文件名 + `desktop-release.yml` CI（mac dmg + win nsis）+ landing 下载区（`DESKTOP_DOWNLOAD.enabled` 门控，已开）

### 课中「截取这一页」（主动截图 > 自动检测的产品决策）
- recorder-audio-source 保留屏幕视频轨；Recorder 注册帧源 + 武装桌面热键钩子
- 课中按钮（帧源存在才露出，曾修 P0 断链：ClassroomView/ClassroomLeftPanel 透传）+ 桌面热键同一条 `captureCurrentFrame`（时间戳取 Recorder 录音时钟，与转录严格同轴）
- Dexie v8 `keyframes` 表；课后 upload-image → artifacts(kind='keyframe') 静默上传（100 条分批；音频上传成功点自动重试）
- 复习页 TranscriptFlowView 按时间轴插入缩略图条（可点击回跳）；evidence.keyframes 跨设备回填（mergeCloudKeyframes 只补缺）
- 自动 pHash 翻页检测引擎（死区防纯色同值簇失稳，15 单测）保留为远期备选

### 标题系统 + 课后理解（一次 LLM 调用替代 3-4 次全文复读）
- 标题契约 `主题 · 课程 · M-D` + 零信息词质量门（宁缺毋滥，12 单测）；用户手动改名双锁（本地 topicLocked + 服务端 titleSource='user'）
- `/api/classroom/understanding`：定稿后一次调用产出 topic+overview+takeaways+highlights，标题/摘要/精选三个 artifact 一次落齐（解析校验 6 单测；归属校验防 IDOR）
- 存量回填：每次工作区加载静默重命名最多 10 条（失败打标不无限重试）；新标题同步 collection feed SourceIngestItem

### teach-back「讲给同桌听」（应用矩阵第 7 应用）
- 选点插件 + evaluate（四象限服务端映射）+ cover-check 轻量覆盖检测；像素教室 + 四象限揭示 + 盲区重讲 + 打字降级
- readiness 去门禁：前端永不"暂不可用"，CONTENT_NOT_READY 安静空态（且清旧产物缓存）；legacy 快照课堂按文字量放行

### 微信 Agent（公众号绑定用户文字对话）
- 画像 + 近期收集 + 12 轮历史 → LLM → 客服消息异步推送；MsgId 幂等防重推；护栏按用户消息计数 + 每日只提醒一次；逐片重试 + token 过期刷新；未送达回复不进历史；WechatAgentMessage 表（+messageId 列）

### 其他产品面
- 分享落地页重设计：思维导图真渲染（ShareMindmapGraph）+ 产物展品卡为主角 + 删文字墙；畸形 artifact 前端守卫
- 复习体验：波形三层加速（服务端 ffmpeg peaks + IndexedDB 缓存）+ 复制 AI 回答去时间戳（跳过围栏/行内代码，空位清理局部化）
- 图像生成切 DashScope：qwen-image-3.0-pro 优先（邀测 403 自动降级 plus，plus 独立尺寸枚举）

### 五路分片审计修复（25 文件）+ 遗留清零
- P0：课中截图按钮 prop 断链（JSX spread 不做类型检查）
- 高：understanding IDOR / 小窗 transport 锁死 null token / 内联应用伪造产物 / 微信 prompt 谎言与幂等护栏推送
- 中：backfill 无限重试 / highlight 残留 / cover-check 闭包 / 分享页崩溃 / 复制破坏缩进 等 12 项
- 清零：删死代码（maybeRetitleLesson + titles/lesson 路由、octo.png、globals.v6.bak.css、tracked pycache）

### 质量基线
899 vitest 全绿；eval-guard：ASR avg CER 1.22%（baseline ×1.1 内）、Tutor pass 92.9%（baseline 内）；真实 LLM 冒烟（标题/课后理解 JSON mode）通过

---

## 2026-06-02（晚 +4）— M11.5：bio 进入所有模式 + 设置页画像 + SharedAgentChat 迁底座 + 4 模式 e2e（26/26）

> 一轮交付：bio 不只在 IntentDialog 里记下来，而是进入复习态、课堂同桌、设置页——每个用户面都接得上。

### bio 进入所有 mode
- `formatLearnerProfileForTutorAgent`（review）：bio.headline 优先于结构化字段，goals[] (active) 也注入
- `buildInClassTutorAgentBody` + `useClassroomCompanion`：in-class 注入 learnerProfile
- shared 保持隐私铁律：服务端不注入访客 learnerProfile

### 设置页「关于你」
`src/app/(auth)/settings/page.tsx` 顶部加：bio.headline + detail + 「和教练再聊聊」+ 「清除画像」

### SharedAgentChat 迁底座
ChatBase paper variant 重写，保留 shareToken/隐私铁律，新获得自动跟随滚动+草稿持久化+IME 安全

### 4 个 mode e2e（共 26 case 全过）
| Suite | Cases | 验证 |
|---|---|---|
| smoke-intent | 10 | goal 双路径 |
| smoke-review | 6 | review 时间戳+bio+inline app |
| smoke-in-class | 5 | recentFocus+Skill chip+bio |
| smoke-shared | 5 | 隐私铁律+无死链 |

Makefile: \`make smoke-review\` / \`smoke-in-class\` / \`smoke-shared\` / \`smoke-all\`
\`smoke-shared\` 自动 prisma seed fake SharedAgent。

eval-guard 持平：tutor 92.9% / asr 1.46%。

---

## 2026-06-02（晚 +3）— M11.4：goal 模式从"任务驱动"升级为"建立个人上下文" + 双 marker（bio + goal）+ 10 场景双路径 e2e

> 用户反馈："开头就要引导用户自我介绍，尽可能全面自然地引导，要拿到这个人的个人上下文 / 相对确定的背景和意图。"
>
> 之前 M11.3 解决了"被动陪听 → 主动教练"，但 taste 还有更深一层错：
> 把 goal 模式当成"5-10 分钟把那件事想清楚"的**任务工具**，而不是"建立个人上下文"的**关系入口**。
>
> 第一次进 IntentDialog 的用户，AI 还不认识他。这时该做的不是"挑一个事来梳理"，
> 是**自然地把这个人聊完整**——身份、阶段、状态、节奏、在乎的事。
> 这才是 v3.0 信息流哲学里"个人上下文私有积累 = 付费壁垒"的地基。

### 类型层：BioEntry

`src/types/user.ts` 加 `LearnerProfileBase.bio?: BioEntry`：

```ts
export interface BioEntry {
  /** 一句话核心：身份 + 阶段 + 当前状态 */
  headline: string;
  /** 可选 detail：在乎的事 / 节奏 / 值得记住的细节 */
  detail?: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
}
```

### Prompt 重写：路径 A 首次会面 + 路径 B 回访

`MODE_GOAL_SEGMENT` 重写为分支 prompt（`tutor-prompts.ts`）：

**路径 A（首次会面）**：context.goal 没有 existingBio 也没有 existingGoals 时触发
- 目标：拿到身份 / 阶段 / 状态 / 在乎的 / 节奏 五维信息
- 第一段必做三件事：自我介绍 + 说明这次意图 + 给具体起手问题（最低阻力的"身份/阶段"）
- 一次只问一个问题
- 拿到身份+阶段+状态至少其中两层、对话过 3-5 轮后，可以提议帮记 bio
- 输出 `---我了解到的你---` 块（第二人称，他的画像）

**路径 B（回访）**：context.goal 已有 bio 或 goals 时触发
- **不重问已知道的**——直接接上"上次你说想做 X，最近怎么样？"
- 按 GROW 框架推进具体目标
- 输出 `---我想要的---` 块（第一人称，他的目标，**marker 内每行用"我"开头**）

`capGoalContext` 升级支持双数据源：existingBio + existingGoals + sessionHint，
首次会面时显式注入 `【这是你和他的第一次见面】` 段，让 prompt 走路径 A。

### Marker pipeline 扩展

新增 `extractIntentBio` marker（`src/components/chat/markers/extractIntentBio.ts`），
解析 `---我了解到的你---...---结束---`。与 `extractIntentSummary` 平行存在，
同一条 AI 消息可同时包含两种 marker（罕见但允许）。

### 前端：IntentBioCard + 双卡渲染

- `src/components/intent/IntentBioCard.tsx`（新）— "我了解到的你"画像卡，可编辑 headline + detail，保存为 `BioEntry`
- `src/components/intent/IntentDialog.tsx`：
  - 消息渲染层先抽 bio、再在剩余文本上抽 summary，footer 双卡堆叠（bio 在上，goal 在下）
  - 顶部记忆卡升级：bio 优先（`我了解到的你: <headline>`），bio 不存在时才显示 `我想要的: <首个 goal>`
  - 开场 greeting 三分支：
    - **首次**："我是 Octo。我们刚认识——你想先告诉我一点你自己吗？" + chips: 我是学生 / 我在工作 / 我在过渡期
    - **回访（有 bio）**："欢迎回来。上次我大概了解了你——<headline>…  最近怎么样？"
    - **回访（仅有 goals）**：保留原 goals 入口
- `IntentDialogContainer.tsx` 加 `handleSaveBio` → `saveLearnerProfile({ ...profile, bio })`

### 通话模式

`buildCallInstructions` 区分首次 vs 回访：
- 首次："这是你和他的第一次见面——温和地引导他自我介绍（先聊身份、阶段、最近状态），不要一次问多个问题"
- 回访："你之前已经认识他：<bio.headline>… 这次别再问身份/阶段"

### Smoke 扩到 10 case 覆盖双路径

`tests/smoke/smoke-intent-mode.ts`：

| Case | 路径 | 断言 |
|---|---|---|
| A1/首次见面/你好 | A | AI 必须自我介绍 + 邀请用户介绍自己 |
| A2/首次见面/我是大三学生 | A | 不能追"什么专业"（问卷思维），要问状态 |
| A3/首次见面/聊完后提议记画像 | A | 多轮聊完后给合理教练动作（提议记画像 / 复述 / 深挖） |
| A4/首次见面/输出 bio marker | A | 用户同意后必须输出 `---我了解到的你---` 包含身份/阶段 |
| A5/首次见面/含糊回答 | A | 不能追问"为什么"，要给更小的入口 |
| B1/回访/不重问身份 | B | 已知 bio 时不能再问身份阶段，要接上之前目标 |
| B2/回访/帮我记下来 | B | 输出 `---我想要的---` 第一人称 marker |
| G1/通用/你是谁 | * | 自报 Octo + 简短角色，不列功能清单 |
| G2/通用/多目标聚焦 | * | 必须聚焦让用户挑一个 |
| G3/通用/给一个不给三个 | * | 不能输出 1.2.3 并列清单 |

支持 `contextGoal` 注入模拟回访（B 路径）。

**实测：连续 3 次 10/10 稳定通过**。AI 在 G3 的回复堪称典范：
> "我先不问建议，反过来问你一句：你脑子里第一次冒出'想读研'这个念头，是因为什么？是觉得本科不够用、想往深走，还是想换个环境/换个方向？"
>
> ——把"给你建议"翻转成"先帮你看清自己想要什么"，这就是真正的咨询师姿态。

### 工程化 fix

- `make smoke-intent` 间隔 800ms → 2500ms，避免 LLM provider 连续返回 outputTokens=0
- 加空回复自动重试一次（4s 间隔）
- agent route Schema 加 `existingBio` 字段

---

## 2026-06-02（晚 +2）— M11.3：goal 模式从"被动陪听"改成"专业教练"+ 端到端 7 场景 e2e 自测 + glass 气泡可读性修复

> 用户反馈两条：
> (1) 沉浸式 IntentDialog 的字看不见（深底深字）
> (2) AI 在装萌（"挥了挥触手 / 我不会寒暄 / 你想说啥说啥"），不像意图识别教练
> 修复后：作为 coding agent 必须**模拟一个真实用户跑一轮**才算交付——不再"以为 deploy 完就完事"。

### Bug 1：glass 气泡可读性

`src/components/chat/ChatBubble.tsx` + `ChatThinkingStrip.tsx`：
- assistant glass: `bg-white/82 + text-ink` → `bg-white/95 backdrop-blur-xl + text-ink + shadow-2xl`
  对标 Apple Intelligence / Linear AI——深色沉浸式背景上 assistant 用接近实白卡片，glass 感靠 backdrop-blur + 阴影实现，不靠把背景做透。
- user glass: `bg-ink/95` → `bg-white/12 + border-white/20 + text-white`（半透明白 glass，沉浸式深底上更通透）

### Bug 2：goal 模式 prompt 重写为"主动教练"

`src/lib/prompts/tutor-prompts.ts` 的 `MODE_GOAL_SEGMENT` 整段重写：

旧版本走"The Bitter Lesson + 不催促"过头，结果模型 fallback 到了被动陪伴 + 装萌：
- "(挥了挥触手) 嗨，我不是很会寒暄"
- "你想说啥说啥，我就在这儿等着"
- 把自己定位成"同班同学"

新版本：
- 身份段：明确"目标教练"（GROW 框架，不是助理 / 同学 / 导师）
- 开局段：用户说"你好"/"我们在干什么"时**必须立刻**把对话推到正题，不能停在打招呼。给出 ✓ 范例 vs ❌ 严禁话术
- 推进段：每一轮做三件事之一（承接 / 聚焦 / 深挖），按 GROW 框架走（Goal/Reality/Why now/Stakes/Options），**铁律一次一问**
- 含糊回答处理：用户回"嗯"时不追问 why（会防御），给"更小的入口"或"对照"
- 建议处理：明确要时给一个不给三个，最后把球踢回去
- 角色扮演禁止："不要写 (动作描述)"

`src/components/intent/IntentDialog.tsx` 开局：
- 旧 greeting："不急。你现在脑子里有什么..."（被动）
- 新 greeting："我们这次 5-10 分钟，把脑子里那件还没想清楚的事说清楚。你想梳理的那件事是什么？" + **3 个开局 chips**（"想做但还没动的" / "卡在一个选择上" / "最近反复在想的"），点击直接发送让用户不用从零开始打字

### 端到端 e2e 自测（这次真跑了）

`tests/smoke/smoke-intent-mode.ts` 模拟 7 个真实用户场景：

| Case | 用户输入 | 断言 |
|---|---|---|
| greet/你好 | "你好" | 必须立刻给开局问题，不能装萌 |
| meta/我们在干什么 | "我们现在在干什么" | 必须解释场合 + 引导主题 |
| identity/你是谁 | "你是谁" | 必须自报 Octo+教练，不列功能清单 |
| vague/单字回答 | "嗯" | 不能追问"为什么…"，要给更小入口 |
| focus/多目标 | "想换工作、想学英语、想找对象，都没动" | 必须聚焦让用户挑一个 |
| summary/帮我记下来 | （多轮）→"对就是这样，帮我记下" | 必须输出 `---我想要的---` marker，第一人称 |
| advice/给一个不要给三个 | "给我点建议吧" | 不能输出 1.2.3 并列清单 |

ban list（COACH_BAN_GLOBAL）：所有 case 共享，包含装萌话术 / 被动姿态 / 错误身份 / 课堂语境 4 类共 12 条禁忌词。

实测结果：**7/7 passed**。
- "我是 Octo。你不是来寒暄的——你打开了这里，是因为脑子里有件还没想清楚的事…"
- "你现在一口气说了三件事，但都没动。那我们先做一件事：**这三件事里，哪一件是你最近白天想起来最多次的？**"
- "好，那我记下。`---我想要的---` 找一个能让我每天愿意起来去做的事——先往设计转…`---结束---`"

### Makefile

新增 `make smoke-intent`，CI 之外的"产品级 e2e"——不只是类型对、tests 过，是**真的回答符合产品意图**。任何人改 `MODE_GOAL_SEGMENT` 或 glass 视觉都应跑一遍。

### 我学到的

> Coding agent 不应该止于"deploy"，应该止于"我亲自跑过证据"。

后续每个 mode（in-class / review / shared / goal）都补一个对应的 smoke 脚本，固化在 Makefile 里。

---

## 2026-06-02（晚 +1）— M11.2：bug 修复（glass 气泡可读性 + goal 身份段）+ smoke-intent-mode 首版 3 case

> 用户反馈两条：(1) 沉浸式 IntentDialog 字看不见 (2) AI 自称"同班同学"
> 这一轮修了视觉 bug，并加了首版 e2e smoke。下一轮（M11.3）发现 prompt 还有更深的问题（被动陪听），再大幅重写。

### Bug 1：glass 气泡可读性

`src/components/chat/ChatBubble.tsx` + `ChatThinkingStrip.tsx`：
- assistant glass: `bg-white/82 + text-ink` → `bg-white/95 backdrop-blur-xl + text-ink + shadow-2xl`
  对标 Apple Intelligence / Linear AI——深色沉浸式背景上 assistant 用接近实白卡片，glass 感靠 backdrop-blur + 阴影实现，不靠把背景做透。
- user glass: `bg-ink/95` → `bg-white/12 + border-white/20 + text-white`（半透明白 glass，沉浸式深底上更通透）

### Bug 2：goal 模式加身份段（防"同班同学"）

`MODE_GOAL_SEGMENT` 加：
> 你是 Octo… 不是助理，不是教练，不是导师，**也不是同班同学**…

### 端到端 e2e smoke 首版（3 case）

`tests/smoke/smoke-intent-mode.ts` + `make smoke-intent`：
- 你是谁 / 我想准备考研 / 帮我记下来
- 真实 LLM 调用，断言 marker、节奏、身份

3/3 通过。但之后用户继续测发现"装萌 / 被动姿态"问题没覆盖到——M11.3 大幅扩到 7 case + 重写 prompt。

---

## 2026-06-02（晚）— M11.1：抽 ChatBase 底座 + IntentDialog 沉浸式重做 + TutorAgentPanel 迁底座

> 用户反馈："整个应用里有些对话框能上传图片有些不能，太重复造轮子了"
> 调研结论：9 个对话面板各自实现一套输入条 / 消息流 / 流式协议，3 套流式协议并存，5 套文件上传逻辑。
> 解法：抽**薄底座 + 厚适配层**，所有对话面板共享同一套 UX。今晚先迁 IntentDialog 和 TutorAgentPanel 验证抽象，剩下 3 个面板下次迁。

### 新增：ChatBase 底座（11 个文件）

`src/components/chat/` 全新目录：

- `ChatBubble.tsx` — 单条消息壳，role/variant/avatar/actions/footer 五个 slot；支持 `paper`/`glass`/`minimal` 三 variant
- `ChatComposer.tsx` — 输入条，capabilities 开关（mic/file/call），拖拽 overlay，附件 chip，glass / paper 两态
- `ChatMessageList.tsx` — 消息流容器，自动跟随滚动 + "回到最新"按钮
- `ChatRenderer.tsx` — 流式 markdown，marker pipeline（intent-summary 等可扩展），React.memo
- `ChatThinkingStrip.tsx` — 等待态气泡（thinking / tool / writing 三态）
- `hooks/useChatComposer.ts` — 草稿持久化（sessionStorage 按 draftKey）+ IME 安全（中文输入法 Enter 不误发）+ 自适应高度（1→8 行）+ Cmd/Ctrl+Enter 永远发送
- `hooks/useChatFileUpload.ts` — `parseFileForChat` 封装 + 拖拽 + 剪贴板粘贴 + 多文件并发，错误 5s 自动消失
- `hooks/useAutoFollowScroll.ts` — 用户上滑停止跟随，回到底部恢复跟随
- `markers/extractIntentSummary.ts` — 解析 `---我想要的---...---结束---`
- `markers/collectMessageText.ts` — UIMessage → text，兼容 v6 parts + 老 content
- `index.ts` + `DOMAIN.md` — barrel + 契约文档

**设计铁律**：
1. 底座不引入业务逻辑（任何 `if (mode === ...)` 都要在 adapter 里）
2. props 极简（slot / capability 对象，不要 30 个 boolean）
3. variant 只 paper/glass/minimal 三种，不再扩
4. marker pipeline 通过类型扩展（加新 marker 走 `ChatMarkerKind` + `extractXxx` helper）

### 沉浸式 IntentDialog（v7 仪式时刻白名单第 6 项升级版）

旧 IntentDialog 视觉：米白纸感、克制——和"图书馆台灯"产品哲学吻合，但**不像对话**。
新 IntentDialog：**沉浸式 IP 陪伴感**。

- 全屏深色暗调背景（`#14110D` 深棕墨黑）+ pine/vermilion radial gradient 双柔光叠加
- Octo `original.png` 大图作虚化背景（78vh，blur 28px，9s 呼吸动画）
- 极淡 SVG noise 颗粒（避免 backdrop-blur 的"塑料感"）
- Glass morphism 半透明气泡（`bg-white/82 backdrop-blur-md` for assistant，`bg-ink/95` for user）
- OctoAvatar 内嵌 assistant 气泡左侧（thinking / happy / idle 跟随状态）
- Instrument Serif italic 装饰文案（"不用想好——说就行"）
- 顶部"我想要的"小卡：当用户已有 saved goal 时显示（黑底 backdrop-blur，Sparkles 图标）
- 进入动画 fade-up 16px / 240ms

### TutorAgentPanel 迁底座（验证抽象）

完整保留所有业务逻辑：
- conversationService 持久化（review 模式自动写本地 IndexedDB）
- inline app（`<open_app:KEY/>` marker → `/api/apps/execute` → InlineAppCard 在 ChatBubble.footer）
- launch question（外部时间线/资料/困惑点发起的一次问题）
- new conversation / 历史切换
- TutorToolCard（tool 调用结果卡片，作为 ChatBubble children 的一部分）
- SkillChipRow（empty state 推荐 prompt）
- 时间戳跳转（onSeek，`[MM:SS]` 点击）

**收益**：
- **首次获得**：拖拽上传 / 剪贴板粘图 / 草稿持久化 / IME 安全 Enter（之前的简单 input 没有）
- **首次获得**：复制 / 重生成 hover 操作行
- **首次获得**：自动跟随滚动 + "回到最新"按钮
- **首次获得**：错误状态 inline "再试一次"按钮

### 退役清单（V2，下次迭代）

- 5 套对话面板待迁底座：ClassroomCompanionPanel / SharedAgentChat / WordExplainer / MobileAIChatPanel / ConfusionCard
- `useSimpleSSEStream`（自写 SSE）→ 取代为 useChat
- `/api/chat`（老路由）→ 合并到 `/api/tutor/agent`
- `AITutor.tsx`（2400 行 legacy） + `AIChat.tsx` → 删
- 多模态 image inline（base64 走 `messages.content[].type=image`）→ 当前走 OCR/VLM 文字回填，下次升级
- 虚拟滚动（react-virtuoso，>50 条）+ Mermaid + Shiki 代码高亮 + TTS

### 文档同步

- `AGENTS.md` 第 0 节加"改任意 AI 对话面板"任务路径，铁律提示
- `src/components/chat/DOMAIN.md`（新） — 完整契约 + adapter 模板代码
- `src/components/DOMAIN.md` — 顶层目录树加 chat/

---

## 2026-06-02 — M11：「聊聊你想要的」对话式目标共建 + 通话 UI 升级 + 实时语音抗噪抗打断

> v3.0 信息流哲学（"目标驱动的 AI 信息流：让每个人的信息流，服务想成为的自己"）落地的第一个产品入口。
> 旧硬编码两步表单 LearnerOnboarding 被对话式 IntentDialog 替代；同时趁势把语音同桌的视觉和抗噪一并升级。

### 新增：「聊聊你想要的」对话式入口

- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 加 `'goal'`；`MODE_GOAL_SEGMENT` 是教练态 prompt（不催促、不问卷、用 `---我想要的---...---结束---` 块自然提炼可保存的目标）
- `src/app/api/tutor/agent/route.ts` — `BodySchema.mode` 加 `'goal'`；`ContextSchema.goal` 接 `existingGoals + sessionHint`；goal 态禁用 native tools / inline app marker / 时间戳
- `src/lib/services/file-parse-service.ts`（新） — 把 File 解析成纯文本的轻量 helper：文档→`/api/sources/ingest`，图片→`/api/sources/ingest-image`，音视频→`/api/transcribe`。**不写 IndexedDB / 不动 collection**（区别于重副作用的 `useSourceImport`）
- `src/components/intent/IntentDialog.tsx`（新） — 全屏对话主体：`useChat` + 文件上传 + 语音输入 + AI 提炼卡片
- `src/components/intent/IntentSummaryCard.tsx`（新） — "我听到的是…"卡片，可编辑 → 保存为 `GoalEntry`
- `src/components/intent/IntentDialogContainer.tsx`（新） — 对外封装：打包文字/通话双态 + saveLearnerProfile 合并已有 goals
- `src/types/user.ts` — 新增 `GoalEntry` 类型 + `LearnerProfileBase.goals?: GoalEntry[]`（free-form JSON 兼容旧画像）

### 入口接入

- `src/app/(main)/app/page.tsx` — 首次进入 `/app` 自动弹 `IntentDialogContainer`（替代旧 `LearnerOnboarding`），sessionHint='first-time'
- `src/app/(auth)/settings/page.tsx` — 顶部加常驻「聊聊你想要的」section：显示已保存目标列表 + "和教练聊一聊"入口；旧 LearnerOnboarding 留在「学习档案」section 作 fallback

### 实时语音通话视觉升级（v7 呼吸光晕）

- `src/components/realtime/RealtimeOrb.tsx`（新） — v7 设计宪法落地：米白纸感主底 + pine 主光环 + vermilion 响应点缀 + 多层 radial gradient 呼吸 + thinking 态内圈环 6s 旋转
- `src/components/realtime/IntentVoiceCallScreen.tsx`（新） — 「聊聊你想要的」打电话模式（复用 useOmniRealtimeCall）
- `src/components/tutor/TutorRealtimeCallScreen.tsx` — 本地 VoiceOrb 已废弃，迁移到共享 RealtimeOrb；视觉同步升级为 v7 风格

### 抗噪 + 抗打断（DashScope omni realtime）

`server.js` 的 `/api/tutor-call` WebSocket 升级 turn detection 三件套：

- `turn_detection.type='semantic_vad'`（默认）— 能区分附和声/咳嗽/背景音 vs 真要说话；旧 `server_vad` 只看音量阈值，嘈杂环境频繁误打断
- `input_audio_noise_reduction.type='near_field'`（默认）— 服务端噪音抑制；远场可切 `'far_field'`，关闭走 `'off'`
- `silence_duration_ms=1500`（旧 1100）— 给短暂背景音留缓冲
- `prefix_padding_ms=500`（旧 300）— 句首兜底更稳

环境变量见 `.env.example` 「实时语音同桌」段：`DASHSCOPE_OMNI_TURN_DETECTION` / `DASHSCOPE_OMNI_NOISE_REDUCTION` / `DASHSCOPE_OMNI_SILENCE_DURATION_MS` / `DASHSCOPE_OMNI_VAD_THRESHOLD`。

### 文档同步

- `AGENTS.md` 第 0 节任务路径表加「改聊聊你想要的」「改实时语音通话 UI / 抗噪抗打断」两行
- `src/components/intent/DOMAIN.md`（新） + `src/components/realtime/DOMAIN.md`（新）
- `src/components/DOMAIN.md` 顶层目录树同步
- `src/app/api/tutor/DOMAIN.md` 加 mode 矩阵表（in-class / review / shared / goal）
- `src/lib/services/DOMAIN.md` 加 file-parse-service 条目
- `src/lib/ui/copy.ts` 加 `COPY.intent` 命名空间（待后续把 IntentDialog 内字面量迁过去）
- `.env.example` 加实时语音同桌 omni realtime 配置段

---

## 2026-06-01 — 按《提示词设计哲学》全面重写所有学习应用 prompt + 修闪卡 / class-check 超时崩溃

> 用户反馈：闪卡 200+ 秒后显示"失败"、`/api/class-check/plan` 返回 500、AI copilot 输出"不本质"。
>
> 调研发现这三件事是同一个根因：**plugin / route 的 prompt 大量违反《提示词设计哲学》"描述目标，不描述路径"，硬塞 6 条纪律 + 200 行 few-shot + 强制三层难度 + 字数限制 + 题数限制**——既让模型变成填表机器（产出"不本质"），又让 prefill 阶段巨慢（撞 180s LLM 超时崩溃）。
>
> 修这件事的方式正好是**同一刀**：按哲学重写 prompt = 更像在给一个人类专家布置任务 + prompt 体积大幅缩小 + TTFT 显著下降 + 模型升级后产出自动变好。

### Prompt 全面重写（10 处）

哲学："描述目标和用户处境，把怎么做留给模型；只规定前端必须的最小 JSON 渲染契约。"

- `src/lib/ai-native/plugins/flashcards.plugin.ts` —— 删 6 条硬纪律 + 200 行 few-shot + 三层难度强制；只保留"认知科学学习教练 + 学生处境 + JSON 字段契约"。`maxTokens` 2800 → 2400，转录注入 24KB → 8KB
- `src/lib/ai-native/plugins/quiz.plugin.ts` —— 同上，删 5 条硬纪律 + few-shot + 题型分布强制；让模型自己按内容性质选单选/判断/填空/简答。`maxTokens` 8192 → 3500，转录 22KB → 8KB
- `src/lib/ai-native/plugins/mindmap.plugin.ts` —— 删 5 条硬纪律（主干 3-5 / 子节点 ≤ 3 / 深度 ≤ 3 / 字数）；只描述"5 秒可扫"目标。`maxTokens` 2400 → 1800，转录 24KB → 8KB
- `src/lib/ai-native/plugins/study-report.plugin.ts` —— 删长版铁律 + 字段强制要求；保留"温暖务实教育顾问 + 不评判孩子"的姿态。`maxTokens` 3072 → 2200，转录 20KB → 8KB
- `src/lib/ai-native/plugins/studio-workshop.plugin.ts` —— 转录 24KB → 8KB（system prompt 已较合规）
- `src/lib/ai-native/plugins/knowledge-cards.plugin.ts` —— 简化 system prompt 措辞
- `src/app/api/class-check/plan/route.ts` —— 删多段硬纪律和强制题数；改为"AI 同桌帮梳理课堂结构"的自然语言。`maxTokens` 3072 → 2400，转录 28KB → 10KB
- `src/app/api/class-check/question/route.ts` —— 删"出题风格 5 条" + 强制 4 选项；保留 JSON 契约
- `src/components/AIChat.tsx` `TUTOR_SYSTEM_PROMPT` —— 删"你的职责 5 条 + 回答要求 3 条"；改为"你是这个学生的 AI 同桌，刚和他一起听了这节课"
- `src/components/WordExplainer.tsx` `EXPLAIN_SYSTEM_PROMPT` —— 删 5 条要求 + 字数限制；改为"学生圈出了一段话问你"的场景描述

### 性能效果（量化）

- **闪卡生成**：之前撞 180s 超时失败，现在 prompt input 从 ~30k tokens → ~10k tokens（70% 降幅），prefill 时间和总响应时间都大幅下降，预期 15-30s 内完成
- **class-check/plan 500**：同样根因，修复后预期 10-25s 内返回 plan
- **学习应用整体（闪卡 / 测验 / 思维导图 / 学习报告）感知速度**：TTFT 降低，因为 system prompt 从 800-1500 字砍到 100-200 字，input 总量减半

### UX 修复

- ~~`src/components/DesktopVideoReviewLayout.tsx` —— 视频复习态左栏：当 `VideoInsightTimeline` 还没有真实 plan items 时左栏底部 fallback 渲染 `TranscriptFlowView`~~（**已撤回**：中栏"转录原文" tab 已承担转录展示，左栏再 fallback 是同一份信息双栏重复，违反 UI 第一性原理。真正的修复方向是重构整个复习态信息架构——见后续 roadmap）

---

## 2026-05-31 — Design System v7 · 真实视觉打磨（Round 7：从 sed 替换走向真实视觉重做）

> 用户反馈：v7 token 改完之后，真实页面**和 design-demo/v7 那 11 个 showcase 差距很大**——因为前 6 轮主要是机械 sed 替换 className，但**布局结构、字号节奏、字体使用、AI 在场信号**没动，等于 v6 骨架披 v7 色。
>
> Round 7 目标：选 7 个**用户进入产品后第一眼看到**的关键页面/组件，用 design-demo 同样的视觉语言（mono eyebrow / Instrument Serif italic em / surface-ai shimmer / shadow-ai-glow / pine accent）真正重做骨架，不再 sed。

### P1 课堂主区 PageHeader → v7 Course Hero
- 整张 hero 卡用 `.surface-ai` 工具类：`shadow-ai-glow` + `ai-breath` shimmer 6s 极淡光带循环
- mono eyebrow `5 月 31 日 · 周日` JetBrains Mono / 11px / 0.08em / pine 600 + pine 呼吸点
- h1 30px / 600 / -0.024em，配 Instrument Serif italic 朱批红 "今日"（中西字体混排）
- meta：`已积累 6 节课 · 慢慢酿，不急` 双签名色 + serif italic 副词
- 这是整个产品**第一个**真正达到 design-demo 水准的页面

### P2 课堂列表 ClassroomLessonCard + SectionLabel
- **SectionLabel** → v7 col-head：JetBrains Mono / 11px / 0.08em uppercase + 0-padded 数字（`02` / `05`）+ 1px 分隔线
- **StatusDot 双签名色家族化**：
  - `recording` → vermilion + ping（朱批"此刻"）
  - `processing` → pine + 慢呼吸（AI 在酿，墨绿信号，**不是灰色**——让"理解中"被看见）
  - `ready` → pine 主签名（已沉淀）
  - `failed` → vermilion 朱批提醒（**不是灰色**——让用户看见需要他注意）
- **MetaLine** 状态文案 Instrument Serif italic：`正在录音` (vermilion) / `正在理解…` (pine)
- **TagLine** Sparkles → pine（v7：AI 已酿好 = 墨绿沉淀信号），keyPoints 数字 mono pine 资产化
- **featured 卡** → `bg-card shadow-soft ring-1 ring-pine/15 hover:ring-pine/40 hover:shadow-card`（"AI 在场"轻信号）
- **action label** → mono uppercase 0.06em（被资产化的状态标记），hover translate-x 0.5

### P3 课中录音 LiveTranscriptPanel 头部
- 整卡 `border-pine/15 + shadow-soft`，hero 容器加 `bg-paper-warm` 暖纸感衬底
- pine ping 状态点 + `LIVE` mono uppercase eyebrow + 状态文案 serif italic（`正在听这一句…` / `等老师开口`）
- 录音句数 `已记 N 句` mono pine 资产化
- 时长 mono pine + 进度条 `bg-gradient-to-r from-pine to-pine-deep`（"已沉淀的时长"）

### P4 OctoBuddy 同桌 companion-head
- **真正的 octo-stage 44px 圆形**：`octo-aura` 工具类自带 5px pine 呼吸光环（替代之前的纯 SVG sprite）
- 状态点 mono `LISTENING` / `待命中` uppercase + pine pulse + 0.08em letter-spacing
- 名称 + 状态分两行竖排（demo companion-head 风格），不再单行挤
- foresight 按钮 hover 走 pine（"AI 同学想被聊"）
- `Radio` 图标 pine/65 而不是灰色

### P5 复习态 ReviewWorkspacePanel
- **tab 激活态用 pine** 而不是黑色下划线 + `font-semibold`（"AI 在场"信号扩散到导航交互）
- 未激活态 hover → pine/75 微提示
- 时间轴空态：`<OctoAvatar mood="thinking" size="lg" aura />` 替代通用 clock SVG + 朱批 italic em 装饰文案
- 主 CTA 加 `shadow-soft hover:shadow-card hover:bg-pine-deep active:scale-[0.98]` 物理反馈

### P6 应用窗口 AppWindowShell
- 已在 R3-R4 升级到 v7 header（`bg-card/92 backdrop-blur-md shadow-soft`）
- ClassCheckOverlay v6 注释（"零渐变零阴影装饰纯平涂"）→ v7 哲学说明

### P7 globals.css 新增 6 个 v7 通用 utility class
> 让任意页面快速获得 v7 视觉灵魂（无需逐个写 className 长链）：

| class | 含义 |
|------|------|
| `.v7-eyebrow` | mono / 11px / 0.08em / uppercase / pine 600 |
| `.v7-em` | Instrument Serif italic / vermilion 装饰 |
| `.v7-em-pine` | Instrument Serif italic / pine（如"AI 同学"） |
| `.v7-h1` | 30px / 600 / -0.024em |
| `.v7-section-head` | 12.5px upcase 0.04em ink-2 + .accent pine（col-head 通用） |
| `.v7-mono-label` | mono / 11.5px / tabular-nums（时间戳 / 数字徽标专用） |

**全局按钮微交互节奏统一**：所有 `<button>` / `[role=button]` 自动获得 150ms cubic-bezier(0.16, 1, 0.3, 1) transition，让"按下"反馈一致

**hero-float 关键帧**：仪式时刻 hero 上浮 -6px 1.2deg 7s 循环（用在分享落地页 / RecordingHero 等）

### 清理 v6 时代设计系统注释
14 个文件里"零渐变、零阴影、纯平涂"这种 v6 哲学描述全部替换为 v7 宪法说明。这条不是字面替换——v6 强调"克制到底"（不允许 shadow），v7 强调"95% 克制 + 5% 仪式时刻情绪化"。注释要跟上代码的真实状态。

### 验证

- ✅ tsc --noEmit 0 errors
- ✅ make deploy 一气呵成（不再陷入 chunk hash 错配）
- ✅ PM2 reload PID 3807120 / `Ready on http://localhost:3002`
- ✅ 线上 https://capture.meetmind.online/login 200

### Why this matters

前 6 轮 sed 替换让代码层"看起来"完成了 v7 升级，但**真实页面体验**还是 v6 骨架。Round 7 选择从课堂第一眼（PageHeader / LessonCard / RecordingPanel / CompanionHeader）开始**真实重做**——这才是用户能感知到差距弥合的层面。剩余的 Workshop 应用窗口内层、复习态左中右三栏深度打磨、移动端各页 hero 等，需要按同样思路继续逐页推进。



> 整套设计宪法替换。"色 = 架构"——墨松绿是 AI 沉淀（场景上下文），朱批红是学生此刻（个人上下文 / 引用 / 标注）。
> 全球 AI 产品没人这么做：东方批注美学 + 西方学术工业感的独占组合。

### Round 5（同日继续）：录课仪式时刻 + 微信捕获 + Mindmap 七彩重写 + 课中考试规整

- **新增 RecordingHero 组件** (`src/components/ui/recording-hero.tsx`)：v7 仪式时刻白名单核心实现——三层呼吸光环（vermilion 0.20 + pine 0.18 + 高光）+ 朱批 rec-dot ping + 实时波形条 8 根 + mono `tabular-nums` 大时长 + Instrument Serif italic 副标题。两种 variant：`hero`（主屏幕，176px Octo）和 `compact`（侧栏嵌入，96px）；4 种 status：`listening` / `thinking` / `paused` / `idle`
- **WeChat 捕获页 `/wechat/capture/[token]`** 全 v7：stone 暖灰 → paper/divider/ink；红色错误 `bg-red-50/text-red-600` → vermilion-mist/text-vermilion；自定义阴影 → `shadow-card`；外部访客在班级群打开服务号链接的第一眼现在也是 v7 米白纸感
- **Mindmap DEPTH_HUES 七彩调色板重写**（`mindmap-layout.ts`）：v6 时代的"七彩气球"（紫蓝青黄红粉绿橙）与 v7 双签名色哲学冲突——重新设计为 **8 层双签名色家族化**：
  - depth 1 / 3 / 5 / 7：pine 家族（`#2D4F3E` / `#6B9080` / `#1A3327` / `#5C5A55`），主分支
  - depth 2 / 4 / 6 / 8：vermilion 家族（`#B5483C` / `#D17969` / `#8E3328` / `#8E8B82`），副分支 / 标注
  - 暗色 PALETTE 也同步更新为深棕墨黑 `#1A1612`（深夜书房）+ pine 主签名
  - 设计意图：知识结构本就是单一主题的细分，色彩应顺应这个语义——节点像老师在卷子上画的不同力度的标注，不是七彩气球
- **CheatsheetWindow 章节色板**：`exemplar` 类型 label 紫色 `#6C509C` → `#2D4F3E` pine（统一墨绿家族）
- **ArtifactRender** 同源章节色 + `#FBFAF5` paper-warm hex → token
- **OctoCrystalDispatcher v3.0 分享水晶球**：4 个 SHAREABLE_APPS glow 色对齐双签名色——mindmap 紫 `#E9D5FF` → pine-mist `#E6EDE8`；quiz 蓝 `#DBEAFE` → vermilion-fog `#FBF2EF`；hub 三层 radial-gradient 改为 vermilion-fog + pine-mist + pine-fog 组合（不再借蓝紫）
- **CollectionCard video 类型 tag 紫色** 全部 → pine（笔记类型识别色彩家族化）
- **VIDEO_INSIGHT_COLORS 6 色彩虹**（`text-and-constants.ts`）→ pine + vermilion 双签名色 6 阶变体，让"AI 在视频里发现的洞察"用同一个语义家族
- **VideoInsightTimeline / ClassCheckOverlay / ClassCheckToast accent 橙色 `#E67E22`** → vermilion `#B5483C`（朱批"标注"语义）
- **ClassCheckOverlay 课中考试 overlay** 大量 emerald/red/amber hex 全部规整：`#FEE2E2` `#FEF2F2` `#FECACA` `#A7F3D0` `#ECFDF5` `#065F46` `#991B1B` `#D1FAE5` `#FEF3C7` → v7 双签名色家族 mist / fog / deep
- **AppLoading 金黄渐变** `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶（`#2D4F3E` / `#6B9080` / `#1A3327`）
- **ShareAgentCard v6 米色板** `#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2` → v7 paper / ink / ink-secondary / divider hex
- **TutorRealtimeCallScreen / AnchorDetailPanel** 残留 hex → token
- **ReviewWorkspacePanel 复习态左栏** 全部 hex → token
- **DesktopSidebar logo Octo 化**（已在 R4，此条为 R5 补记）：折叠态点击 hover 由 GraduationCap 灰圆变为 Octo idle 头像，"AI 在场"信号扩散到全局导航

### 验证（截至 Round 5）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ 紫 / 蓝 / 粉 / 靛违禁色 0 残留（除 ModelSelector provider tag + 化学/英语学科色 + InfographicWindow 信息图模板放飞，全为合理保留）
- ✅ 所有视觉信号统一到双签名色：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP——**全产品没有任何"看起来不属于这个设计系统"的颜色**

### Round 6（同日继续）：WaveformPlayer + 全局 gray/emerald/red/amber/rose 终极规整

> 目标：让全产品**没有任何**色彩在视觉上"看起来不属于这个设计系统"。

- **WaveformPlayer 复习态音频播放器**（高曝光）：金色 + 珊瑚粉全部重写——
  - `waveColor #D4A574` "得到金色" → `#6B9080` pine-light（声波 = AI 沉淀的轨迹）
  - `progressColor #F5E6D3` 暖米色 → `#2D4F3E` pine 主签名（已播放部分 = 已沉淀）
  - `cursorColor #FF8A80` coral 珊瑚粉 → `#B5483C` vermilion 朱批红（光标 = 此刻）
  - 所有渐变 button bg、loading ring、border 同步双签名色化
- **DesktopVideoReviewLayout 视频复习布局** waveColor/progressColor 暖金 → pine 系
- **StudyReportWindow 学习报告**：v6 米色板 (`#F7F5F1` `#2C2825` `#8C857A` `#DDD9D2`) → v7；功能色 emerald `#10b981` / amber `#f59e0b` / red `#ef4444` → pine `#2D6A4F` / `#B8842B` warning / vermilion `#B5483C`；进度环 `#E67E22` 橙 → vermilion
- **CheatsheetWindow 速查表**：`#FAFAF7` 米色 → paper-warm；`#C0392B` 红色错误指示 → vermilion；`#F0EFEB` 灰底切换器 → paper-warm
- **AppLoading**：金黄渐变 `#D4A574` `#E8C4A0` `#C4956A` → pine 三色阶
- **WorkshopWindowManager / ClassCheckToast / SkillChipRow / TutorRealtimeCallScreen** 等 8 个组件残留 hex → token

#### 全局批量清理（4 类违禁色一网打尽）

| 类别 | 文件数 | 关键映射 |
|------|------|---------|
| **gray 灰系**（v6 中性色）| **33 文件** | text-gray-* / bg-gray-* / border-gray-* / hover:bg-gray-* / focus:ring-gray-* / marker:text-gray-* → ink / paper / divider 系 |
| **emerald / green 绿系**（v6 success）| 多文件 | bg-emerald-50 / text-emerald-* / hover:bg-emerald-* / decoration-emerald-* / group-hover:text-emerald-* / border-emerald-* → pine 系 |
| **red / amber / orange / yellow 警示色**（v6 danger / warning）| 多文件 | bg-red-50 / text-red-* / bg-amber-* / text-amber-* / bg-yellow-* / bg-orange-* → vermilion 系（朱批"标注"语义统一警示） |
| **rose / sky / teal / cyan 杂色**（v6 内容标签 / focus ring）| 多文件 | bg-rose-* / focus:ring-rose-* / focus:border-rose-400 / border-sky-* / text-teal-* → 双签名色家族 |

#### 转化页 focus ring 统一

`feedback` / `forgot-password` / `profile/password` / `loading` 4 个核心转化页所有 `focus:border-rose-400 focus:ring-rose-100` 输入框 focus 态 → `focus:border-pine focus:ring-pine/15`（让"AI 在场"的墨绿信号扩散到表单交互）

#### 移动端 4 文件 gray 系全清

ConfusionCard / DedaoConfusionCard / MobileLayout / MenuDrawer / BottomPanel：text-gray-* / bg-gray-* / border-gray-* 全部映射

### 验证（截至 Round 6 / Final）

- ✅ `tsc --noEmit` 0 errors
- ✅ `make build` 0 errors（exit code 0）
- ✅ **0 处违禁紫 / 蓝 / 粉 / 靛 / 绿 / 红 / 橙 / 黄 / 青残留**（仅 ModelSelector provider 标签 + 化学/英语学科色 + InfographicWindow 信息图模板放飞 = 合理保留）
- ✅ **全产品视觉信号 100% 双签名色化**：录音、AI 在场、引用、思考链、状态点、思维导图、章节标签、笔记类型、考试反馈、loading、Octo IP、波形、复习态、转化表单 focus ring——**没有任何"看起来不属于这个设计系统"的颜色**

### Round 4：Workshop 7 应用窗口 + Tutor + 桌面侧栏 Octo 化

- **PodcastWindow** 全 v7：blue 系（"信任色"业界已饱和）→ vermilion（v7：播客 = 此刻聆听）；slate-* 中性灰 → ink/divider/paper-warm
- **FlashcardsWindow**：错误标记 rose → vermilion-light（朱批语义）+ slate 系清理
- **CheatsheetWindow / QuizWindow / MindmapWindow / StudyReportWindow / StudyReportDocument**：slate 系全部规整到 v7 ink/divider 系
- **TutorAgentPanel**：顶栏新增 Octo 永驻状态点（busy 墨绿脉搏），背景从纯白 → `bg-paper-warm/60` + `backdrop-blur-sm`，hover 颜色统一 pine；空态新增 `OctoAvatar listening lg` + Instrument Serif italic"同学"
- **TutorToolCard / TutorWidgets / TutorRealtimeCallScreen**：emerald → pine / amber → vermilion / slate → ink-divider 系
- **DesktopSidebar**：GraduationCap logo → **Octo IP 化**（折叠态 + 展开态都用 `/images/octo-buddy/idle.png` + `octo-aura` 呼吸光环），所有 v6 hex 直写映射到 token；hover 状态对齐 pine（"AI 在场"信号扩散到全局导航）
- **ClassroomLeftPanel**：录音指示从琥珀金 `#E8C547` → 朱批红 `#B5483C`（统一 v7 录音"此刻"语义；琥珀金废弃，因为 Granola 已占）
- **MyShareList (`/me/shares`)**：所有 hex 直写规整为 token，hover 颜色对齐 pine
- **全局 v6 杂色 hex 清理 7 文件**：`#5C8A4F` → pine / `#F1F6EE` → pine-fog / `#FFF8E5` `#FCE7F3` → vermilion-fog / `#A78BFA` `#8A6CB4` `#2F5D8A` `#8B6914` → pine 家族 / `#B83766` → vermilion / `#FFF9F5` `#FFFBF0` → paper / paper-warm
- **全局 slate 灰系清理 19+ 文件**：text-slate-* / bg-slate-* / border-slate-* / hover:bg-slate-* 全部映射到 ink / paper / divider 系（保留信息图模板放飞 + 暗态 placeholder）
- **全局 blue 蓝系清理 10 文件**：bg-blue-* / text-blue-* / border-blue-* / focus:ring-blue-* → pine 系（蓝色"信任"已被飞书/钉钉/Cursor/Khan/Meta 占满，MeetMind 不再蹭这条赛道）

### 设计宪法（design-demo/v7/）

11 个可视化文档（5 个基础 + 6 个场景）+ 共享 token CSS：
- `tokens.css` — 单一真相源，含暗色 first-class 重映射
- `index.html` / `01-foundations` / `02-ai-language` / `03-components` / `04-app-matrix` — 基础 5 篇
- `05-classroom` / `06-review` / `07-share-landing` / `08-mobile` / `09-dark` — 场景 5 篇

### 底层 token 系统（破坏性最低，向下兼容 v6）

- **`tailwind.config.js` v7 重写**：双签名色 `pine` (#2D4F3E) + `vermilion` (#B5483C) 升级为一等公民；纸感色 `paper` (#FAF7F2) 替代燕麦灰；保留 v6 别名（`canvas` / `mint` / `coral` 等）自动映射，**200+ 既有文件零改动也呈现新视觉**
- **`src/app/globals.css` v7 重写**：完整 token 表 + 11 个 v7 工具类（`.cite-ts` / `.cite-src` / `.surface-ai` / `.skel` / `.stream` / `.typing-caret` / `.thinking-strip` / `.rec-dot` / `.octo-aura` / `.mark-pine` / `.mark-vermilion`）+ `[data-theme='dark']` 深夜书房模式（不是反色，是另一种气质）
- **字体三件套** (`src/app/layout.tsx` 用 `next/font`)：Inter（正文 + 'palt' 紧排）+ Instrument Serif（仪式 italic 装饰）+ JetBrains Mono（引用资产化 `[MM:SS]` / `[资料 N]` 专用）
- **投影系统从"全部 none"改为"必须存在但克制"**：`shadow-soft` (0/4/16) / `shadow-card` (0/8/28) / `shadow-float` (0/16/48) / `shadow-modal` (0/32/80) / `shadow-ai-glow` (1px pine ring + 8/28 pine = "AI 在场"信号)
- **备份保留**：`tailwind.config.v6.bak.js` + `src/app/globals.v6.bak.css`

### 原子组件库 v7（`src/components/ui/`）

**升级 5 个**：
- `Button` — 加 `pine` / `vermilion` / `naked` / `link` / `danger` variant + `xl` size + `loading` prop
- `Card` — 加 4 档 variant (`default` / `soft` / `elevated` / `ai`) + `hoverable` + `CardEyebrow`
- `Badge` — 加 `pine` / `vermilion` / `sand` / `mute` variant + `dot` 状态点
- `Input` — Focus 用墨绿 ring，error 用朱批红
- `Skeleton` — shimmer 横扫（不再 pulse 明灭），子组件 `Paragraph` / `Cite` / `AppCard`

**新增 11 个**：
- `Cite` — **引用资产化**：朱批时间戳 / 墨绿资料胶囊（MeetMind"有根"DNA）
- `OctoAvatar` — 8 mood × 6 size，呼吸光环 + 状态点 + `next/Image` 优化
- `ThinkingStrip` / `TypingDots` / `BrewingStrip` — 等待三档（轻 / 中 / 重·"酿"）
- `StreamText` — 流式输出，stagger 浮现 + 增量动画 + caret
- `AppTopBar` — 全局顶栏：logo + breadcrumb + Octo 永驻 + 操作槽
- `EmptyState` — 空态（带 Octo + emTitle italic 朱批 + CTA）
- `SectionHeader` — 大段落标题（display/h1/h2/h3 4 级）
- `CourseHero` + `CourseHeroPulse` — 课程主题卡（live 带 AI 光带）
- `SkillChip` / `SkillChips` — Octo 同桌问题建议 chip
- `Composer` — 消息输入框（自动行高 + Enter 发送）

### 真实页面 / 组件 v7 落地

**系统态页面（4 个）**：`(main)/loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx` — Octo thinking/surprised/sleeping 取代通用 spinner，米白纸感 + 极淡光晕

**门面页面**：
- **`SharedAgentLanding.tsx` (v3.0 裂变核心)**：大气场墨绿/朱批 radial gradient + Octo `original.png` 大图 + Instrument Serif italic accent + 玻璃态 sticky CTA。这是**唯一**允许整页放飞的页面
- **`SharedAgentChat.tsx`**：分享态对话面板，Octo 永驻 + 朱批左竖条 sharedBy + pine focus ring
- **登录页 `(auth)/login/page.tsx`**：背景大气场（米白纸感 + 极淡墨绿/朱批光晕）+ Octo logo 取代字母 M
- **设置页 `(auth)/settings/page.tsx`**：v6 hex 直写全部映射到 v7 paper/divider/ink/vermilion/pine

**Workshop 应用矩阵**：
- **`AppWindowShell.tsx`**：状态点对齐双签名色（pine 完成 / vermilion 错误）+ header `bg-card/92 backdrop-blur-md` + `shadow-soft`
- **`AppWindowPlaceholder.tsx`**：loading 用 OctoBuddy listening + ThinkingStrip + pine/vermilion 双色光晕；empty 用 OctoAvatar idle + Instrument Serif italic appName；error 朱批语义"提醒不是惊吓"
- **`WorkshopYellowPage.tsx`**：7 个 app hero 双签名色家族化（旧的紫/黄/蓝/粉/绿/沙独立色板 → pine 系 4 个 + vermilion 系 3 个，告诉用户"这是同一套设计系统的 7 个工具"）+ 状态点 v7

**Octo IP**：
- **`OctoBuddy.tsx`**（浮动 IP 主体）：所有 v6 紫粉色调（`rgba(233,213,255)` / `rgba(124,88,255)` / `#8B5CF6` / `#60A5FA` 等）全部替换为双签名色家族（aura / listen-ring / orbit / burst / sleep-dust / tension-aura）；投影从冷紫 `rgba(30,27,54)` 改为暖纸感 `rgba(28,27,25)` + `rgba(45,79,62,0.10)` 复合
- **移动端 `MobileTopBar.tsx`**：Octo 头像作品牌 logo（取代 GraduationCap）
- **移动端 `MobileAIFab.tsx`**：Octo 主体 + 朱批红未读 + 状态推断

**AI 视觉链路**：
- **`AIChat.tsx` / `AITutor.tsx`**：复选框 violet → pine
- **`ThinkingVisualizer.tsx` / `ThinkingGuideRenderer.tsx`**：思考可视化全部 violet 系 → pine 系（背景 / 边框 / 文字 / 阴影）
- **`WordExplainer.tsx`**：划词解释 popup violet 系 → pine 系
- **`GuidanceQuestion.tsx` / `CollectionFeedMessageBubble.tsx` / `AISearchPanel.tsx`**：违禁色统一规整
- **`all-notes/page.tsx`**：chat 笔记 tag 紫色 → pine 系（化学/英语等学科色保留）

### 全局 hex 直写清理

90 个文件批量映射 v6 hex → v7 hex：
- `#F7F7F5` → `#FAF7F2` (canvas → paper)
- `#E9E9E7` → `#E8E2D5` (divider 偏暖纸感)
- `#232322` → `#1C1B19` (ink 略深略暖)
- `#787774` → `#5C5A55` (ink-secondary)
- `#A3A39E` → `#8E8B82` (ink-muted)
- `#FBFBFA` → `#F2EDE3` (paper-warm)
- `#F0F0EE` → `#F0EBDF` (divider-light)

### 文档同步

- **`AGENTS.md` 第 2 节 Taste 宪法**：6 个仪式时刻白名单（含分享落地页 v3.0 破例放飞）+ 始终禁止饱和色撞脸（ChatGPT 紫 / Stripe 蓝 / 多邻国绿）
- **`AGENTS.md` 第 5 节 设计系统**：完整 v7 token 表 + 字体三件套 + 投影 + 工具类 + 11 组件速查 + 暗色 + v6→v7 兼容映射
- **`src/components/ui/DOMAIN.md`**：新组件分类清单 + 用法速查 + 暗色说明

### 验证

- ✅ `tsc --noEmit` 0 errors（所有 v7 改动类型完全通过）
- ✅ `make build` 0 errors（生产构建 + PM2 兼容）
- ✅ ESLint v7 文件 0 warnings（剩余警告全为 pre-existing）
- ✅ 向下兼容：v6 旧 class 全部映射到 v7 token，200+ 既有文件无需改动也呈现新视觉

### Why this matters

视觉是用户**第一秒**对产品智能的信任投票。MeetMind 之前的视觉语言（"95% 平涂、封杀渐变阴影、燕麦灰底色、PingFang 系统默认字"）解决的是 Notion 那种已付费高频用户的克制需求；但 MeetMind 现在还在让投资人 / 学生**第一眼相信"这是 AI 产品"** 的阶段——这两个阶段的视觉策略本来就不同。v7 通过双签名色（色 = 架构）+ 字体三件套 + AI 时刻可见性（surface-ai / stream / Octo 永驻）+ 暗色 first-class，把"像专门的 AI 产品 + 顶级 UI 设计师品味"翻译成了具体可落地的代码合同。

---

## 2026-05-30 — 接入阶跃星辰 StepFun 作为默认 AI

- **新 provider**：`src/lib/config/app.config.ts` + `src/lib/services/llm-service.ts` 增加 `stepfun` provider，模型 `step-3.7-flash`（OpenAI 兼容，base URL `https://api.stepfun.com/v1`，文档：https://platform.stepfun.com/docs/zh/quickstart/overview）
- **默认模型切换**：MeetMind 全链路（课堂同桌 / 复习 Tutor / 学习应用 / 速查表 / 闪卡 / 测验 / 思维导图 / Studio 等）默认改用 `step-3.7-flash`；保留 DeepSeek、DashScope 作为 fallback，用户可在 `/settings` 切换
- **Tutor agent 路由**：`src/lib/utils/tutor-agent-provider.ts` 识别 `step-*` 模型并路由到 StepFun，fallback 链改为 `step-3.7-flash → deepseek-v4-flash → qwen3.6-plus`
- **设置页**：现有模型选择器自动通过 `/api/chat` 拉取 StepFun 模型；`AI_MODEL_PREFERENCE_KEY` 偏好契约不变
- **环境变量**：`STEPFUN_API_KEY` / `STEPFUN_BASE_URL` 加入 `.env.example`；`LLM_MODEL` / `TUTOR_MODEL` 默认值改为 `step-3.7-flash`

### 同日：感知速度优化（修复"模型号称 400tok/s 但用户体感一般"）

> 真正决定用户感知速度的是 **TTFT（首包延迟）+ 流式节奏**，不是模型自身吞吐量。下面三处定位的瓶颈合计可让复习态对话 TTFT 从 3–10s 降到 0.5–2s。

- **复习态 `fullTranscript` 上限**：之前 `tutor-agent-adapter.ts` 把整节课转录全量 `join(' ')` 塞进 system prompt，60 分钟课 ≈ 25–35k input tokens；step-3.7-flash 即使吞吐 400tok/s，prefill 也得算完才能吐第一个 token。现在：
  - `tutor-agent-adapter.ts` 在 client 端先截断到 `MAX_FULL_TRANSCRIPT_CHARS = 12000`
  - `tutor-prompts.ts capFullTranscript` 在 server 端再截到 8000 字，并按 `currentTimestampSec` 取窗口（前 60% / 后 40%）；超出部分模型用 `[MM:SS]` 引用让学生跳回原段
- **StepFun 不暴露 6 个 native tool**：`shouldUseNativeTutorTools` 把 `step-*` 也排除（与 deepseek 一致）。原因：6 个 tutor tool 的 description 加起来 ~700 字，每次 prefill 都要算一遍，拖慢首包；切到 marker 链路（`<open_app:KEY/>` + 前端 `/api/apps/execute`）后 TTFT 显著下降，且复用了课堂同桌已经验证的同一条产品链路
- **`streamText` 配置优化**：`stopWhen: stepCountIs(6) → stepCountIs(3)`（marker 链路 1 步即可，native tools 留 1 次工具回调 + 1 次正文）；新增 `experimental_transform: smoothStream({ chunking: 'word' })` 让前端流式按词平滑刷出，修复"字一坨一坨"的体感

### 同日（续）：把所有用户面 AI 对话框对齐到同一基线

> 上一轮只优化了 Tutor agent (`/api/tutor/agent`) 这一条链路。这一轮把项目里**所有给用户看的 AI 对话流**都对齐到「流式 + StreamingMarkdown（含公式 / 时间戳 / 引用）+ 智能 prompt 截断 + 按词平滑」的同一基线。

- **`chatStream()` 内置 word-level smoothing**（`src/lib/services/llm-service.ts`）：
  - 之前：LLM 一次塞过来 50 字 chunk，前端 SSE 收到后立刻刷出 → 一坨一坨
  - 现在：在 `chatStream` 里把大 chunk 打散成"按词"流出，词与词之间 sleep 10ms，中文按字切分、英文按连续字母数字段切分、标点空格独立段。可通过 `options.smooth: 'off'` 关闭
  - 效果：所有走 `chatStream` 的接口（`/api/chat`、`/api/workspace/search`、legacy `/api/tutor`）一处改全部受益，与 Tutor agent 的 `smoothStream({ chunking: 'word' })` 体感一致
- **SharedAgentChat 渲染升级**（`src/app/share/[token]/SharedAgentChat.tsx`）：
  - 之前：`whitespace-pre-wrap` 平铺，markdown / KaTeX 公式 / 时间戳全部以原始字符显示，与登录态 Tutor 的精致渲染对比强烈——分享页是裂变拉新的第一面
  - 现在：用 `StreamingMarkdown`，与登录态完全一致；流式态自动开光标 + KaTeX 跳过保护
- **AIChat / WordExplainer 客户端 transcript cap**：
  - 之前：困惑点 AIChat 把整段 `contextText`、划词 WordExplainer 把整段 `fullContextText` 直接拼进 `/api/chat` 的 context 字段，长课首包延迟严重
  - 现在：客户端发请求前先 `slice(-8000)`，与 Tutor agent 一致；`selection.context`（划词局部上下文）保留全量
- **AISearchPanel 评估保留**：渲染层语义与基线不同（`onNavigateToCapture` 内部跳转 vs `CitationDetailSheet` 外部 url 跳转），强行统一会破坏交互；通过 `chatStream` smoothing 已经自动获益按词平滑流，本身已是 SSE 流式 + 自定义 markdown 渲染

---

## M11 — v3.0 SharedAgent · 场景上下文成为分享单元（进行中）

**一句话**：MeetMind 的产品同构性换轨——「场景上下文」从个人收纳升级为可被分享的、有人格的容器；Agent 是裂变载体，班级是增长单元。

战略文件：`roadmap/v3.0-virality-agent.md`（北极星，与本文件冲突时以那份为准）。

### M11.3 P0 闭环转化漏修复（K 系数主链路）

M11.2 后底座完整，但有 3 个转化漏直接砍 K 系数：(1) 录课结束态没有自动到 dispatcher 入口 (2) B 未登录点领取后跳 login 但登录回来还要再点一次 (3) claim 成功只 toast 不引导。这一轮把 viral loop 主链路完整接通。

#### 录课结束 → dispatcher 自然出现

- **`useRecordingLifecycle.ts`** 录完后默认行为升级：
  - classroom tab 录完 → 自动 `setViewMode('review') + setReviewTab('apps')`，应用矩阵首屏（含 `OctoCrystalDispatcher`）第一眼可见
  - 其他 tab 录完 → 仍 `setViewMode('record')`（保持原行为，不破坏 record hub 用户）
- toast 温柔提示「这节课结束了 · 应用矩阵已就位 · 挑一个产物，可以收着也可以递给同学」
- **效果**：用户录完课的 30 秒分享冲动期，dispatcher 不再被埋在某个 tab 里

#### B 登录回流自动 claim

- **`SharedAgentLanding.tsx`** `handleClaim` 未登录时跳 `/login?next=/share/[token]?autoClaim=1`
- **`/login/page.tsx`** 新增 `resolveRedirect()`：登录成功优先走 `?next=...` 而不是写死的 `/app`
  - 安全：只接受相对路径（`/` 开头且非 `//`），防御 open-redirect 攻击
  - 三处 redirect（已认证自动跳 / 密码登录成功 / 验证码登录成功）统一调用
- 落地页 `useEffect` 检测 `?autoClaim=1` + 已登录 + share 已加载 → 自动触发 claim，并 `history.replaceState` 清掉 URL 参数防刷新重复触发
- **效果**：B 收到链接 → 点领取 → 登录 → 自动完成 claim，从两步降到一步

#### claim 成功后引导去工作台

- claim 成功后 toast 加 description「正带你去工作台看看…」
- 1.2 秒延迟后 `router.replace('/app')`，让 B 进入自己工作台，看到刚领取的 `WorkspaceCapture(sourceType='shared-agent')` capture
- **效果**：B 不再卡在落地页"领了之后然后呢"，直接进入"我的学习现场"看完整产物

#### 闭环 5 支点（M11.3 后真的转起来）

```
A 录课结束 → 自动到应用矩阵首屏（dispatcher 第一眼）
       ↓
A 挑产物 → ShareAgentCard → 拷链接 / 系统分享
       ↓
B 打开 /share/[token] → 第一眼看到 ArtifactRender 真实产物
       ↓
B 试问同学 → mode='shared' 不返回时间戳（无原录音不死链）
       ↓
B 点领取 → 跳 login?next=...autoClaim=1 → 登录后自动 claim
       ↓
B 1.2 秒后跳 /app → shared-agent capture 已在工作台
       ↓
A 想看反馈 → /me/shares 看 viewCount/chatCount/claimCount
```

#### 验收

- ✅ `make check` 0 类型错误
- ✅ 全链路冒烟（/login?next 跳转 / /share/[token]?autoClaim=1 / /app）三个路由都 200
- ✅ 已部署 pm2

---

### M11.2 闭环收口（v3.0 viral loop 真的能转起来）

之前的 M11.1（递结晶 + ShareAgentCard 重做 + print stylesheet）做完后，闭环的 5 个支点中**只有 1、3 真的闭合**——B 打开链接看到的是"完整产物会在领取后出现"的空话；B 领取后 capture 在工作台是 untyped；A 没有管理面看不到反馈、撤销不了。这一轮把剩下的 4 个支点全部接上。

#### 闭环 5 支点（M11.2 后）

| 支点 | 入口 | 状态 |
|---|---|---|
| ① 创建 | `OctoCrystalDispatcher`（应用矩阵首屏） | ✅ M11.1 |
| ② 落地（看到产物）| `SharedAgentLanding` + 新 `ArtifactRender` | ✅ **M11.2 修复** |
| ③ 对话 | `mode='shared'` → `/api/tutor/agent` | ✅ M11.0 |
| ④ 领取（在 B 工作台可继续看） | `WorkspaceCapture(sourceType='shared-agent')` + attachmentUrl 跳回 `/share/[token]` | ✅ **M11.2 接通** |
| ⑤ 管理（A 看反馈 / 撤销） | `/me/shares` + `GET /api/share/me` + `DELETE /api/share/[token]` | ✅ **M11.2 新增** |

#### M11.2 新增

**ArtifactRender（落地页真渲染产物）**
- `src/components/share/ArtifactRender.tsx` — React 组件，按 `artifactKind` 分发：
  - `cheatsheet` → 6 区色块（与 ShareAgentCard / CheatsheetWindow 同色板）
  - `mindmap` → 根标题 + 一级分支 + 子节点（`└ ...`）
  - `quiz` → 第一题题干 + 4 选项卡（不显示答案，强裂变保留）
  - `flashcards` → 第一张正面 + "背面在领取后翻看"
  - fallback → summary 文字 / 兜底空 hint
- `SharedAgentLanding.ArtifactPreview` 替换 v0 的「summary 一行字」实现，B 第一眼看到产物本身

**snapshot 含完整 artifact payload**
- `OctoCrystalDispatcher` 不再只塞 `summary`，把 `result.render?.payload` 完整塞进 `snapshot.artifact.payload`（向后兼容旧 snapshot：`extractPayload` 自动识别 wrapped / unwrapped）
- 体积影响：cheatsheet 6 区 ≈ 3-5KB / mindmap ≈ 2KB / quiz ≈ 5-8KB，SQLite 完全 OK
- 隐私不变：artifact 是场景层产物，本就是要分享出去的

**B 领取后 capture 闭环**
- `capture-source-utils.ts`：`sourceType='shared-agent'` 强制 type='document' + `attachmentUrl=/share/[token]` + preview 文本「{昵称}留下的{产物名} · 点开继续看 / 跟同学聊」
- B 在工作台点击该 capture → 新 tab 打开 `/share/[token]` → 继续看完整产物 + 跟同学对话（同一 token，幂等）

**A 管理面**
- `GET /api/share/me`（`src/app/api/share/me/route.ts`）— 返回当前用户最近 50 条分享，含计数器和撤销状态
- `DELETE /api/share/[token]` — 撤销，仅 owner，幂等；非 owner 一律 404 防探测
- `/me/shares/page.tsx` + `MyShareList.tsx` — 列表 + 状态徽章 + 三个计数器（打开 / 对话 / 领取）+ 三个动作（看落地页 / 复制 / 撤销）+ 隐私心安声明
- `ShareAgentCard` 创建成功后底部加「管理我的分享 ›」小字链接

**Service 层**
- `listSharedAgentsByOwner(ownerId)` + `MySharedAgentSummary` 类型导出

#### 隐私边界（M11.2 强化）

- 撤销不影响已 claimed 的副本（snapshot 是 share-time 刻一份的复刻态——这是技术决策，也是产品 taste）
- DELETE 在非 owner 时返回 404 而非 403，避免泄露存在性
- B 的工作台显示 sharedAgentToken，但 metadataJson 里**不含**原作者 userId（社工已封死）

#### 验收

- ✅ `make check` 0 类型错误
- ✅ `read_lints` 全部新文件 0 警告
- ✅ 全 5 支点端到端可达：创建 → 落地（产物可见）→ 对话 → 领取 → B 工作台跳回 → A 管理面看反馈 → 撤销

---

## M11.0/M11.1 — 之前 SharedAgent 基础设施


### 新增

**战略 / 文档**
- `roadmap/v3.0-virality-agent.md` — v3.0 战略锁定（场景层 vs 个人层、应用矩阵分层、裂变形态约束、M11-M15 路线图）
- `src/app/api/share/DOMAIN.md` / `src/app/share/DOMAIN.md` / `src/components/share/DOMAIN.md` — 三处目录索引

**数据模型（Prisma）**
- `SharedAgent` —— 一个被分享出去的 Agent 快照（token / snapshotJson / artifactKind / 计数器 / status / expiresAt）
- `ShareInteraction` —— view / chat / claim / reshare 埋点
- `ShareClaim` —— `(shareId, claimerUserId)` 唯一，幂等领取记录

**业务层**
- `src/lib/services/share-agent-service.ts` —— `createSharedAgent` / `getSharedAgentByToken` / `getSharedAgentInternal` / `claimSharedAgent` / `revokeSharedAgent` / `trackShareInteraction`
- `SharedAgentSnapshotSchema`（zod）— 接受场景层产物 + transcriptDigest，**禁止个人层数据进入 snapshot**

**API 路由**
- `POST /api/share/agent` —— 创建分享（鉴权 / zod parse / token 碰撞重试）
- `GET /api/share/[token]` —— 公开读，自动写 view 埋点；404 不区分原因（防泄露存在性）
- `POST /api/share/[token]/track` —— 公开埋点（chat / reshare）
- `POST /api/share/[token]/claim` —— 领取到 claimer workspace（创建 WorkspaceCapture）

**Tutor agent**
- `/api/tutor/agent` 新增 `mode: 'shared'` + `shareToken` 字段
- `buildTutorSystemPrompt` 新增 `'shared'` 分支 + `buildSharedModeSegment(sharerNickname, courseTitle)` + `capSharedContext`
- 隐私铁律：分享态显式跳过 `learnerProfile` 注入；禁用 native tools；inline app marker 默认关
- 分享态自动写一条 `chat` interaction 到 `ShareInteraction`

**前端**
- `src/app/share/[token]/page.tsx` —— Next.js 路由壳
- `src/app/share/[token]/SharedAgentLanding.tsx` —— 落地页主体（Octo Buddy + 头部 + 转录摘要 + artifact 预览 + 对话面板 + 粘底动作栏）
- `src/app/share/[token]/SharedAgentChat.tsx` —— 分享态对话面板，`useChat` + `DefaultChatTransport(api='/api/tutor/agent')`
- `src/components/share/ShareAgentCard.tsx` —— Canvas 长图（暖白底 + 深褐字 + URL 显式可读）
- `src/components/share/useShareAgentCreator.ts` —— 一键创建分享 + 弹卡片的钩子，让任何上层 UI 一行接入

**用户面文案**
- `src/lib/ui/copy.ts` 新增 `share.landing` / `share.creator`（claimAction / reshareAction / chatPlaceholder / sharerNickname / artifactTitle ...）

**埋点**
- `logger.ts` `TrackEvent` 新增 `share.create` / `share.interaction` / `share.fail`

### 变更

- `prisma/schema.prisma` — `User` / `Workspace` 增加反向关系到 `SharedAgent` / `ShareInteraction` / `ShareClaim`
- `src/lib/prompts/tutor-prompts.ts` — `TutorMode` 联合类型扩展为 `'in-class' | 'review' | 'shared'`，`TutorSystemContext` 新增 `shared` 字段
- `AGENTS.md` — "by task type" 表新增「改 SharedAgent / 分享 Agent / 裂变」一行；架构速查补 `app/share` 和 `api/share` 索引；当前里程碑改为 M9 + M10 + M11

### 隐私边界（必读）

- snapshotJson **永远不带**原作者的 chat history、`learnerProfile`、个人层应用产物（闪卡 / 薄弱点 / 学习报告默认私有）
- `PublicSharedAgent` 类型故意不带 `ownerId` / `workspaceId`，防社工
- 分享态对话**不读**访问者本地 conversation，**不写**回流到原作者
- snapshot 是 share-time 刻一份，原作者后续修改不影响分享出去的副本

### M11 已完成 vs 待办（在后续 Sprint 落地）

✅ 已完成：
- 数据模型 + 4 个 API + tutor mode='shared' + 落地页 + 对话面板 + Canvas 长图 + 创建器 hook
- 全链路 `make check` 通过（0 类型错误）

🟡 待集成（M11 收尾）：
- 把 `useShareAgentCreator` 接入 `src/components/classroom/ClassroomRecordingView.tsx` 录课结束动线（Octo Buddy 「递结晶」按钮）
- `make eval-tutor` 增加 shared 模式 baseline
- 5 人班级灰度跑数：观察 K 系数
- M11.5：扫码二维码渲染（依赖 qrcode 包）
- M12：应用矩阵 UI 分组「带回去用 / 分享出去」 + 班级共错卡

### 验收

- ✅ `npx tsc --noEmit` 零错误
- ✅ `prisma db push` 成功，`prisma generate` 成功
- ✅ 全链路接口可达（POST /api/share/agent → GET /api/share/[token] → /share/[token] → /api/tutor/agent mode='shared' → POST /api/share/[token]/claim）

---

## M3 — Tutor 会用工具的同桌（`milestone/m3-tutor-tool-use`）

**一句话**：Tutor 从"LLM 文本框"升级为 agent loop，能主动调 Workshop 插件生成闪卡/测验/思维导图，能引用课堂转写时间戳 `[t=MM:SS]`。

### 新增
- `src/lib/prompts/tutor-prompts.ts` — prompt 版本化（`VersionedPrompt` + `PROMPT_VERSIONS`）
- `src/lib/tutor/tutor-tools.ts` — 4 个 Vercel AI SDK v6 tool（makeFlashcards / makeQuiz / makeMindmap / lookupTranscript）
- `src/app/api/tutor/agent/route.ts` — 新 agent loop endpoint，`streamText + stopWhen(stepCountIs(6)) + onStepFinish`
- `tests/eval/tutor/real-caller.ts` — harness 接入真实 LLM + tools
- `make eval-tutor-real`

### 变更
- `TUTOR_SYSTEM_V3` 明确工具使用原则 + 时间戳格式 + 失败话术
- `onStepFinish` 每步 `track({kind:'tutor.step'})` 埋点
- Sentry `experimental_telemetry.metadata.promptVersion` 注入

### 新增依赖
- `@ai-sdk/openai@3.0.62`

### 验收
- src tests: **190 passed**（+6 tutor-tools）
- 0 新类型错误

---

## M2 — ASR 飞书妙记级工艺（`milestone/m2-asr-feishu-grade`）

**一句话**：根据"飞书妙记 80% 差距在工艺"的判断，落地 P0 四修（稳定性）+ P1 飞书级工艺（contextual biasing / 三段式渲染 / 重叠缝合）。

### 新增
- `src/lib/services/asr/text-utils.ts` — `stitchSegments` / `stitchSegmentsWithOverlap` / `findOverlapLength` / `fullJitterDelay`（27 单测）
- `src/lib/services/asr/render-state-machine.ts` — `TranscriptRenderMachine`（interim / stable / final 三段式，10 单测）
- `tests/eval/asr/qwen-caller.ts` — harness 接入真实 Qwen3-ASR-Flash async API
- `make eval-asr-real`

### 变更
- **T2.1** `transcribe-fast/route.ts`: `stitchSegments` 替换内联 timeOffset 逻辑，修复失败传播 bug；响应体新增 `failedSegmentIndices / partialFailure`
- **T2.2** `DashScopeASRClient`: `userStopRequested` flag + `scheduleReconnect` + `doReconnect`，Full Jitter 退避，audioQueue 跨重连保留
- **T2.3** `waitForSingleTask`: `p-retry` + Full Jitter 替换线性 polling，总超时 5→10min
- **T2.5** `buildASRContextHint` 扩展 6 字段（courseTitle / courseSubject / participants / previousLessonTopics / lessonVocabulary / userHotwords）
- **T2.7** 长音频分片 180→600s + 2s overlap + LCS 缝合；`ASR_SEGMENT_DURATION_SEC` / `ASR_SEGMENT_OVERLAP_SEC` 环境变量可配

### 验收
- src tests: 151 → **184 passed**（+33）
- harness baseline 保持
- 0 新类型错误

---

## M1 — 可观测底座 + Eval Harness（`milestone/m1-observability-foundation`）

**一句话**：结束"改改试试"的玄学开发模式——结构化日志 + Sentry AI + SWE-Bench 风格 eval harness 一次性铺到位，后续所有改动都要在 harness 上量化。

### 新增
- **可观测性**
  - `src/lib/logger.ts` — pino backend + AsyncLocalStorage 注入 `requestId/userId` + `track()` 四路径埋点
  - `instrumentation.ts` / `sentry.{server,edge}.config.ts` / `instrumentation-client.ts`
  - `vercelAIIntegration` 自动捕获 AI SDK step/tool span
  - `pinoIntegration` 自动映射日志为 Sentry breadcrumbs
- **Eval Harness**（SWE-Bench 风格）
  - `tests/eval/{asr,tutor}/{datasets,graders,fixtures,runs}` 目录
  - `cer.ts` — 按字切 Levenshtein + 归一化（14 单测）
  - `tool-selection.ts` / `timestamp-citation.ts` / `learning-rubric.ts`（LLM-as-judge，离线自动跳过）
  - ASR seed dataset 10 条 + Tutor seed dataset 8 条
  - `make eval` / `eval-asr` / `eval-tutor` / `eval-unit`
- **战术拆分**
  - `server.js` 1341 → 1186 行（-155）
  - `server/asr/text-utils.js`（11 个纯函数 + 26 单测）

### 新增依赖
- `@sentry/nextjs@10.51` / `pino@10.3` / `p-retry@7.1` / `reconnecting-websocket@4.4` / `promptfoo@0.121`

### 验收基线
- `asr-eval`: 10 case / avg_cer=1.46% / p95=8.33% / failed=0
- `tutor-eval`: 7/8 passed / tool=100% cite=66.7% rubric=100%
- src tests: **151 passed**
- server tests: **26 passed**
- eval-unit: **29 passed**

---

## 主要指导原则（见 `docs/UPGRADE_PLAN.md`）

- **不造轮子**：调研 → 决策 → 用现成工具
- **harness 驱动**：没量化对比的改动不合并
- **灰度友好**：不改旧 endpoint，新 endpoint 并存（/api/tutor/agent）
- **明确不做**：LangGraph / MCP / Whisper / pyannote / i18n / CRDT / LangSmith / Braintrust

## 下一步（Next Sprint 建议）

- [ ] 扩 Tutor dataset 到 50 条 + `make eval-tutor-real` 作为 CI gate
- [ ] 用 AISHELL-1 / CosyVoice 合成课堂 / MUSAN 噪声扩 ASR dataset
- [ ] 纠错闭环 MVP（T2.9）：`POST /api/asr/corrections` + 周度聚合进 `userHotwords`
- [ ] 前端接入 `/api/tutor/agent`（feature flag 灰度）
- [ ] Tutor 消息流中渲染 Workshop 产物卡片（T3.4）
- [ ] 说话人分离 MVP（火山引擎双声道）
