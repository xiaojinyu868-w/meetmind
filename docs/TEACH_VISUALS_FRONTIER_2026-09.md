# 教学画面的前沿调研：最优秀的系统怎么做、用什么模型、我们有哪些路线（2026-09-13）

> 起因：上课舞台（teach-live）四轮之后，画面"离真实课堂仍有差距"，且目前全部是代码驱动（公式 / 几何 / 动画）。问题是：要不要上图像驱动、视频驱动？延时与成本怎么解？本文是回答这三个问题前的调研——学界系统、业界产品、可用模型、学习科学证据——最后给出映射到我们架构的路线。数字均标注来源与日期；生成模型的价格与延时变化很快，引用时看日期。
>
> 结论先行（细节见 §7）：**(1) 实时课堂的主画面，学界与业界一致收敛在"代码 / DSL 驱动的动态板书 + 语音"，我们方向对；差距在"板子像不像板子"（手、笔迹、空间、镜头），不在模态。(2) 图像该上，用"检索真图 + 快模型生成 + 概念缓存 + 图上作画"，成本可忽略。(3) 像素视频不上实时关键路径——物理保真度与教学评测都不支持；用"库 + 检索 + 离线生成"三种方式获得视频，Gemini Omni（会写板书的视频模型）是离线情境片的候选。(4) 实时数字人：学习增益证据弱、单项成本等于全部价格预算，不做。**

---

## 1. 我们要的到底是什么

"像真实课堂"拆开是三层，各有不同的解法与成本：

| 层 | 真课堂有、我们缺 | 解法类型 | 成本 / 延时 |
|---|---|---|---|
| **表达层**（板子像板子） | 手写、公式一个符号一个符号出现、一块板被写满、圈划擦、镜头跟随重点 | 代码 / 前端渲染 | 零 |
| **模态层**（世界的质感） | 真的桥、真的细胞、真的钟摆在摆、历史场景 | 图像 / 视频（检索或生成） | 元级 / 秒级～分钟级 |
| **存在层**（有个人在教） | 手、身体、眼神、语气 | 手（代码）/ 数字人（视频） | 零 / ¥40–100 每小时 |

硬约束：首响 ≤ 1–2 s、口播与画面同步、每小时成本 ≤ 真人一对一的 1/4（一线城市 ¥200–400/h → ¥50–100/h）、**正确性**（教学画面错了比没有更糟）。

---

## 2. 学界：系统与结论

### 2.1 代码驱动的教学视频（Manim 一族）

| 系统 | 做法 | 关键数字 | 对我们的含义 |
|---|---|---|---|
| **TheoremExplainAgent**（ACL 2025，[链接](https://aclanthology.org/2025.acl-long.332/)） | Planner + Coder 两 agent 写 Manim，生成 5–10 分钟定理讲解视频；TheoremExplainBench 240 题、5 项自动指标 | o3-mini 成功率 93.8%、总分 0.77；**无 agent 只能出 20 秒**；主要缺陷是元素重叠（Element Layout 最低） | 规划是长视频的前提；布局是头号顽疾 |
| **Code2Video**（NUS ShowLab，2025-10，[链接](https://arxiv.org/abs/2510.01174)） | Planner–Coder–Critic；Visual Anchor Prompting（6×6 格子替代像素坐标）；ScopeRefine 局部修复；MMMC 基准（3Blue1Brown 语料）；**TeachQuiz**（让 VLM 遗忘后看视频再答题） | 表 1：**像素视频模型（Veo3 / Wan2.2 / OpenSora）Element Layout = 0、Logic Flow = 0、TeachQuiz 0–2.5**；直接让 LLM 写代码 ≈ 33–38 分；Code2Video + Claude Opus 4.1 美学 87.9 / TeachQuiz 86.0，人做的 3B1B 99.7 / 97.1；代价 13.8 分钟 / 43K token 一题；去掉并行 15.4 → 86.6 分钟 | 这是"代码驱动 vs 像素驱动做教学"最硬的对照：像素模型在教学维度上接近零分。代码路线可以逼近人类，但离线、分钟级 |
| **ManimTrainer / ManimAgent**（2026-04，[链接](https://arxiv.org/abs/2604.18364)） | 对 17 个 <30B 开源模型做 SFT + GRPO（代码 + 视觉融合奖励）+ 渲染器在环（RITL / RITL-DOC） | Qwen3-Coder-30B + GRPO + RITL-DOC：渲染成功 94%、视觉相似 85.7%，**超过 GPT-4.1**；SFT 提代码质量，GRPO 提视觉、提自纠能力 | 教学绘图能力可以训进小模型；我们的 `<draw>` API 若积累了真课脚本 + 报错 + 修复，就是现成的训练数据 |
| **Paper2Video / PaperTalker**（NUS，2025-10，[链接](https://arxiv.org/abs/2510.05096)） | 论文 → LaTeX 幻灯片（Tree Search Visual Choice 选布局）→ 字幕 → TTS → **光标定位**（UI-TARS 找视觉焦点 + WhisperX 对齐词级时间戳）→ 说话人视频（Hallo2） | 逐页并行提速 6×；**说话人视频是最慢环节，几分钟视频要数小时 GPU**；推荐 A6000 48G | 光标 = 我们的激光笔（我们已按句对齐）；数字人是延时黑洞 |

### 2.2 Generative UI（Google，2025-11 发布，论文 2026-04 版，[链接](https://arxiv.org/abs/2604.09577)）

模型不产出 markdown，直接生成完整交互网页（Gemini 3 "Dynamic View"）。人评 **83% 偏好**生成界面胜过文本；与人类专家作品相比 44–50% 可比。实现三件套：**暴露工具**（生图 / 搜索，结果可直达浏览器）、**详细系统指令**、**一组后处理器**修常见错误。局限：**生成 1–2 分钟**，流式渐进渲染可减半；能力是"随新模型涌现"的。

→ 与我们同构：标签流 = 流式渐进；`<draw>` 运行时 + critic + 自愈 = 工具 + 后处理器。他们也证明了"越新的模型越会用代码画画"，支持我们不用规则给模型设上限。

### 2.3 学习科学：什么样的"存在感"真的有用

| 证据 | 结论 | 效应量 |
|---|---|---|
| Fiorella & Mayer 2016（J. Educ. Psych.，[链接](https://doi.org/10.1037/edu0000065)） | 看老师**用手**画图 > 看画好的图；**看不见手的逐笔动画无显著效果**（d = −0.16）；电脑模拟"逐笔长出"不显著（d = 0.33, n.s.） | 手可见 d = 0.35–0.58 |
| Fiorella 等 2019（[链接](https://psycnet.apa.org/record/2018-58542-001)） | 动态画图 d = .54；**老师露脸本身没有增益**；有眼神接触的透明白板（learning glass）d = .54 | |
| Castro-Alonso 等 2021 元分析（[链接](https://doi.org/10.1007/s10648-020-09587-1)） | 教学代理（on-screen agent）总体小效应 g = 0.20；**2D 代理 0.38 > 3D 代理 0.11**；动作、声音、非语言特征大多不是调节变量 | |
| 手势老师元分析 2024（[链接](https://link.springer.com/article/10.1007/s10648-024-09910-0)） | 会做手势（尤其指示性手势）的屏上老师：记忆 g = 0.28、迁移 g = 0.31；对照组老师不可见时效应更大 | |
| 白板动画研究 2023（[链接](https://doi.org/10.1186/s40561-023-00258-6)；[链接](https://doi.org/10.1016/j.heliyon.2023.e13229)） | **渐进画出**与叙事嵌入稳定提升学习相关变量；画图的手提高内在动机，但在该研究中未提高成绩 | |
| Learn Your Way（Google，2025-09；Frontiers 2026，[链接](https://doi.org/10.3389/frai.2026.1783117)） | 60 名学生 RCT：多表征生成式教材 vs 数字课本，即时 +9、3–7 天后 +11 个百分点（78% vs 67%）；**用更多模态的学生成绩没有显著更高**（探索性分析，样本小） | |

→ 稳的结论：**同步于讲解的渐进画出**是有效成分；**手**在多数研究里有帮助（至少动机），成本为零；**露脸 / 3D 数字人**证据最弱；"模态越多越好"没有证据。

### 2.4 像素视频的可靠性

- **Physics-IQ**（WACV 2026，[链接](https://openaccess.thecvf.com/content/WACV2026/html/Motamed_Do_Generative_Video_Models_Understand_Physical_Principles_WACV_2026_paper.html)）："视觉真实 ≠ 物理理解"，原榜最高 29.5%（满分 100 = 真实录像的自然方差）；2026-09 的 Physics-IQ Verified 榜最高 Cosmos3 Super 42.7%，Sora 2 26.5%（[榜单](https://physics-iq-verified.anates.ai/)）。
- Code2Video 表 1：像素模型做教学视频 Element Layout 0、TeachQuiz ≈ 0。
- NotebookLM Cinematic 实测（Lifehacker，2026-03）：图表复制正确，但"画在纸上""汉诺塔叠块"这类需要物理 / 过程正确的镜头出错。

→ 对"有真值"的内容（几何、函数、力、周期），生成视频**逼真但可能错**，比示意图更糟；它适合"没有真值只要氛围"的内容（历史场景、文学情境、生物质感）。

---

## 3. 业界产品（2026-09）

| 产品 | 实时线怎么做 | 视频怎么做 | 备注 |
|---|---|---|---|
| **豆包爱学「豆包老师」**（字节，2025-09；豆包 App「AI 老师」2026-01） | **语音 + 动态板书 + 实时渲染**，"边画图边讲"，会问"你理解了吗"，字幕可展开；**未设数字人**（[多知](http://www.duozhi.com/industry/insight/2025091517689.shtml)） | **「豆包课堂」**（2026-05）PGC 精品课用 Seedance 生成历史情境视频 + 板书 + 图片 + 小测；**UGC 定制课暂无 AI 视频**（[多知](http://www.duozhi.com/industry/insight/2026052718523.shtml)） | 国内投入最大的一家，实时线与我们同构，视频只在离线 PGC |
| **千问智学（原夸克学习 / 夸克老师）**（阿里，2025-06 → 2025-12 改名） | "在类似电子白板的容器里，以老师口吻配合讲解"，数形结合，可追问（[多知](http://www.duozhi.com/opentalk/2025090817668.shtml)） | 早期靠人工讲题视频库，AI 后大幅缩减该成本 | 同构 |
| **VideoTutor**（美，YZi Labs / 百度风投；TikTok 5000 万播放，2026-05） | LLM → **Manim 渲染管线** + 自研 Layout Manager + LLM 容错循环；可中途打断追问；宣称"秒级"（[新闻稿](https://www.globenewswire.com/news-release/2026/05/01/3285655/0/en/)） | 即视频本身 | 投资人的评语：扩散视频模型处理不了公式与图表，所以选 Manim。服务端渲染，延时细节未公开 |
| **Khanmigo**（可汗学院 × Google.org，2026-08） | 原本纯文本；现在 Gemini 判断"此刻一张图有帮助"就**生成可交互的图**（图表 / 几何 / 平行坐标），**学生拖动顶点或线段，老师据此调整讲解**；早期数据：参与度与"下一题正确率"上升（[Khan 博客](https://blog.khanacademy.org/new-ai-tools-bring-interactive-diagrams-and-targeted-practice-thanks-to-khan-academys-partnership-with-google-org/)） | 无 | 与我们的 `param` / `widget` 同向，多出"学生操作 → 老师响应"闭环 |
| **Synthesis Tutor**（美，K-5 数学） | 人工设计的可操作教具（manipulatives）+ 语音 + 自适应 | 无 | 不生成画面，靠精心手作的教具库；说明"好教具 + 语音"本身就够 |
| **NotebookLM Video Overviews**（Google） | 非实时：Explainer = 讲述 + 幻灯片 + Nano Banana 插图，约 15 分钟生成；**Cinematic**（2026-03）= Gemini 3 当导演 + Nano Banana Pro 出图 + Veo 3 动起来，**50 分钟生成 7 分钟视频**，Ultra 专属（[Google](https://blog.google/innovation-and-ai/products/notebooklm/generate-your-own-cinematic-video-overviews-in-notebooklm/)） | 即视频 | 离线产物的上限参考；物理过程镜头出错 |
| **Learn Your Way**（Google Labs，LearnLM） | 非实时：课本 → 沉浸文本 / 小测 / 讲述幻灯 / 音频课 / 思维导图 | 无 | +11 分 RCT（§2.3） |
| **Gemini Dynamic View**（Google，2025-11） | 每个提问现场生成交互网页，1–2 分钟 | 无 | §2.2 |

归纳：**所有实时产品的主画面都是代码 / DSL 驱动的板书 + 语音；没有一家在 K12 实时线用数字人；视频只出现在离线 PGC 内容。** 我们的差距不在架构选择，在表达层的打磨与模态层的补齐。

---

## 4. 模型与工具选型（按用途）

### 4.1 教学大脑（写标签流 / 写 `<draw>`）
- 现用 GLM-5.3-Flash（`reasoning_effort=low`，TTFT ~0.9 s，¥0.8/M 入 ¥2.8/M 出，每轮 ¥0.006–0.008）。
- Code2Video 的横向：写 Manim 的能力 Claude Opus 4.1 > GPT-5 ≈ GPT-4.1 > Gemini 2.5 Pro；但那是离线 13 分钟一题的设定。实时线上"首响 1 秒 + 便宜"仍是第一约束，Flash 档 + 更宽容的运行时 + 自愈是对的组合。
- 中期选项：ManimTrainer 证明 30B 级开源模型 + GRPO + 渲染器在环可超 GPT-4.1——我们的真课脚本 / 报错 / 修复日志（`teach-live-repair.reported` + `draw-fix` 事件）就是数据集雏形。

### 4.2 图像

| 用途 | 首选 | 延时 | 成本 / 张 | 说明 |
|---|---|---|---|---|
| 实物长什么样（桥、细胞、器官、历史照片） | **检索**：Wikimedia Commons / Openverse（CC） | ~0.5 s | 0 | 真图可信；教学里可信 > 好看 |
| 带标注的示意图 / 信息图（有文字） | **GPT-image-2**（~3 s，文字准确率 ~99%，小字与公式更稳）；**Nano Banana Pro**（Gemini 3 Pro Image，$0.134，10–30 s，可联网 grounding，文字 ~94%）；**Nano Banana 2**（Gemini 3.1 Flash Image，$0.067@1K，~15 s）；**Qwen-Image**（$0.035，中文文字渲染强） | 3–30 s | ¥0.25–1 | 第三方对比见 [Apiyi](https://help.apiyi.com/en/gpt-image-2-vs-nano-banana-pro-scientific-diagram-text-rendering-en.html)、[HokAI](https://hokai.io/hub/models/gemini-3-pro-image)（非官方基准，取趋势不取小数）。Google 自己也说信息图要核对数据 |
| 氛围 / 场景 / 比喻画 | **FLUX.1 schnell**（fal，1–2 s，$0.003/MP）、Seedream fast（2–4 s，$0.015）、百炼 wan2.6-t2i（¥0.2） | 1–8 s | ¥0.02–0.2 | 够快到藏进口播 |
| 现用 qwen-image-3.0-pro | — | **81 s（2026-09-13 实测一次）** | ¥0.25 | 只留给离线建库 |

关键：**标注类图最好的做法是"图当底 + 代码在上面画"**（一张真桥的照片，`<draw>` 画力的箭头），把文字与几何交给我们的运行时，图像模型只负责质感——这样连 94% vs 99% 的文字准确率之争都绕开了。

### 4.3 视频

| 模型 | 价格 | 长度 / 延时 | 与教学的关系 |
|---|---|---|---|
| **Gemini Omni Flash**（Google，2026-05-19 发布，API 公测 2026-06-30，`gemini-omni-flash-preview`；Omni 1.1 Flash 2026-08-27） | **$0.10/秒**（$17.5/M 视频输出 token，10 秒 ≈ $1.01） | 3–10 秒，720p–4K；延时未见官方数字 | 泄露与发布演示都是"教授在黑板上写三角恒等式证明"，**板书文字渲染是明确卖点**（"perfectly accurate text remains challenging"）；是"会写字的视频模型"，做离线情境片 / 名师风格片段的候选（[Google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-omni/)，[TechCrunch](https://techcrunch.com/2026/05/19/googles-gemini-omni-turns-images-audio-and-text-into-video-and-thats-just-the-start/)） |
| Kling 3.0 | $0.084–0.112/秒 | 15–30 s 生成 | 通用 |
| Veo 3.1 | $0.05–0.20/秒 | 15–25 s | 原生音频 |
| Seedance 2.0（豆包课堂用） | ~$0.09/秒 | ~45 s+ | 字节自家 |
| 百炼 wan2.6-t2v / i2v | ¥0.6/秒（720p）、¥1/秒（1080p） | 30–60 s | 国内合规最顺 |
| 百炼 wan2.2-i2v-flash | **¥0.1/秒** | 快 | 离线建库的性价比选项（图 → 6 秒循环 ≈ ¥0.6） |
| Sora 2 API | — | — | 2026-09-24 关停，不要依赖 |
| 实时世界模型（Genie 3 仅 Project Genie 订阅、无 API；Odyssey-2 20 fps 流式，API "coming soon"） | — | 实时 | 只跟踪。Physics-IQ 说明保真度不够做教学 |

### 4.4 手写与"手"
- **DiffInk**（ICLR 2026，[链接](https://openreview.net/forum?id=XKOEQFKFdL)）：文本 → 在线笔迹轨迹的整行潜扩散；**DiffMath**（2026-06，[链接](https://arxiv.org/abs/2606.19939)）：**LaTeX → 手写数学表达式笔迹**（RelAST 结构先验，无需位置标注）。两者都是"给公式一条真实的书写轨迹"的现成研究，可作为板书手写化的第二阶段（第一阶段用字体 / 描边动画近似即可）。
- 手本身：2D 手随笔迹移动是零成本代码（白板动画产品 VideoScribe 一类二十年前就在做）；开源参考 Felttip（LLM 出 ScenePlan JSON → 本地确定性渲染，笔领着讲述走）与 Revideo + Rough.js 方案——思路与我们相同：**模型出结构，渲染确定性、本地、免费**。

### 4.5 SVG 生成模型
- StarVector（CVPR 2025，8B，SVG-Diagrams 子集 DinoScore 0.959）、OmniSVG（NeurIPS 2025）：专用 SVG 模型，但基准偏图标 / 插画，**没有面向科学示意图的 2026 专用模型**；通用 LLM 写 SVG 已足够，且我们的 `<draw>` 把几何真值交给了运行时。不引入专用模型。

### 4.6 数字人
- 实时数字人（HeyGen LiveAvatar $0.10–0.25/min、Anam、Tavus、D-ID、LemonSlice ~$0.16/min，端到端 500 ms–1.2 s）：**¥40–100 / 小时，单项等于全部价格预算**；证据侧露脸不增益、2D 优于 3D（§2.3）。不做；若要"存在感"，做 2D 的手与眼神级别的极简形象。

---

## 5. 延时与成本的通用解法（不依赖模型变快）

1. **到达 / 演出两条时间轴**（已有）：任何媒体在块到达那一刻请求、老师念到才展示。口播通常领先 10–40 s，2–8 s 的生成完全隐藏。Generative UI 的经验：流式渐进渲染把可感知等待减半。
2. **分镜预取**：一轮开头让模型顺口说出这一页要用的画面（`<plan>` 或 image 块前置），媒体请求提前到讲解之前；开课那一刻按题目投机预生成封面图。
3. **按真值需求分级取源**：有真值（几何 / 函数 / 力）→ 代码；实物长相 → 检索；不存在的画面 → 快模型生成；视频 → 检索或库，**永不在轮内按需生成**。
4. **概念级缓存 = 共享素材库**：勾股定理、单摆这些题目反复出现；第一个学生付一次（或课后离线补），之后所有人免费。素材库随用户增长变厚，是产品资产。
5. **预算作为上下文而非规则**：每课媒体预算（沿用 `liveCostCny`）告诉模型，让它自己权衡——与 Less Structure 一致。

### 一小时课的成本模型（2026-09 价格）

| 项 | 每小时 | 说明 |
|---|---|---|
| 教学大脑（GLM-5.3-Flash，40 轮） | ¥0.3 | 实测每轮 ¥0.006–0.008 |
| TTS | 元级 | 按字符计费 |
| 图像 10 张（检索为主 + 快模型） | ¥0.2–2 | |
| 示意图 2 张（GPT-image-2 / Nano Banana Pro） | ¥1–2 | |
| 离线库视频摊薄 | ¥0.1–1 | i2v flash 6 秒 ¥0.6，跨用户复用 |
| **合计** | **≈ ¥3–8** | 预算 ¥50–100 |
| （对照）轮内按需生成视频 6 段 | ¥20–40 | 且等 30–90 s、物理可能错 |
| （对照）实时数字人 | ¥40–100 | 单项吃满预算 |

---

## 6. 映射到我们的架构

| 前沿做法 | 我们已有 | 缺口 |
|---|---|---|
| Planner–Coder–Critic（Code2Video） | 标签流即边规划边执行；`<draw>` 运行时；代码版 critic（文字重叠）；自愈 | 文字压线的 critic；VLM 事后审只用于离线库 |
| Visual Anchor（6×6 格） | `<svg>` prompt 已有格子；`<draw>` 自动取景 | — |
| 光标 / 激光笔按句对齐（PaperTalker） | Director 按句节奏 + `<point>` | 手（跟随笔迹的 2D 手）、镜头（跟随 / 放大） |
| 手写渐进（Fiorella；白板动画研究） | 逐笔描画、rough 手绘、公式逐行 | **公式逐符号手写**（先字体 / 描边，后 DiffMath 类轨迹）；一块板"写满"的空间感 |
| 交互图 + 学生操作反馈（Khanmigo） | `param` 滑块、`widget`、点图引用 | 拖动 / 改参数事件回传老师（boardNote 已有通道） |
| 生图工具 + 后处理器（Generative UI） | `<image>` 异步块（81 s） | 三源（检索 / 快模型 / 缓存）+ 预取 + **图上作画** |
| 离线 PGC 视频（豆包课堂 / NotebookLM） | 无 | 课后"酿"里按概念建库（i2v flash / Omni），VLM 审核，下一位学生直接有 |
| TeachQuiz 式评测（Code2Video） | eval-teach（出题闭环） | live 线 eval：首笔时刻 / 表现形式覆盖 / draw 报错率 / 重叠率 / **VLM 学后测** |

---

## 7. 建议路线（按收益 / 成本排序）

1. **表达层（零成本、证据最硬）**：跟随笔迹的手；公式改为随手写逐符号出现（KaTeX 排版不变，揭示方式变；后续可接 DiffMath 类真实轨迹）；板面空间性（写满一块板再翻页，而非文档流）；圈、划、擦；镜头跟随 / 放大重点。
2. **图像三源 + 缓存 + 预取 + 图上作画**：把 `<image>` 从"81 秒、少用"变成"0.5–8 秒、随手用、真图优先"，prompt 同步放开；标注类图一律"图当底 + `<draw>` 在上"。
3. **交互闭环**：学生拖动 `param` / 点图 → 老师响应（Khanmigo 路线），通道已有。
4. **视频**：`<clip>` 真视频嵌入（B 站 / CC，按时间戳）；课后离线建库（wan2.2-i2v-flash 起步，Omni Flash 做情境片试点），VLM 审核后入库；课堂线永不等待。
5. **评测与数据**：live eval 五指标 + VLM 学后测；自愈日志与 `draw-fix` 事件当训练数据积累，为 30B 级自训教学绘图模型留路。
6. **只跟踪不建设**：实时世界模型（Genie 3 / Odyssey-2）、实时数字人。

---

## 参考（按出现顺序）

- TheoremExplainAgent — Ku et al., ACL 2025. https://aclanthology.org/2025.acl-long.332/
- Code2Video — Chen et al., 2025-10. https://arxiv.org/abs/2510.01174 · 基准 MMMC https://huggingface.co/datasets/YanzheChen/MMMC
- Training and Agentic Inference Strategies for LLM-based Manim Animation Generation, 2026-04. https://arxiv.org/abs/2604.18364
- Paper2Video / PaperTalker — Zhu, Lin, Shou, 2025-10. https://arxiv.org/abs/2510.05096
- Generative UI: LLMs are Effective UI Generators — Google Research. https://arxiv.org/abs/2604.09577 · 博客 https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/
- Fiorella & Mayer 2016, J. Educ. Psych. https://doi.org/10.1037/edu0000065 · Fiorella et al. 2019 https://psycnet.apa.org/record/2018-58542-001
- Castro-Alonso et al. 2021 元分析 https://doi.org/10.1007/s10648-020-09587-1 · 手势老师元分析 2024 https://link.springer.com/article/10.1007/s10648-024-09910-0
- 白板动画的手 2023 https://doi.org/10.1186/s40561-023-00258-6 · 渐进画出与叙事 2023 https://doi.org/10.1016/j.heliyon.2023.e13229
- Learn Your Way — Google Research 博客 https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/ · Frontiers in AI 2026 https://doi.org/10.3389/frai.2026.1783117
- Physics-IQ — Motamed et al., WACV 2026 · Physics-IQ Verified 榜 https://physics-iq-verified.anates.ai/
- NotebookLM Cinematic Video Overviews（2026-03）https://blog.google/innovation-and-ai/products/notebooklm/generate-your-own-cinematic-video-overviews-in-notebooklm/ · 实测 https://au.lifehacker.com/ai/117820/feature/how-notebooklms-new-cinematic-video-tool-works
- 豆包老师（多知，2025-09）http://www.duozhi.com/industry/insight/2025091517689.shtml · 豆包课堂（多知，2026-05）http://www.duozhi.com/industry/insight/2026052718523.shtml
- 夸克学习 / 千问智学（多知，2025-09）http://www.duozhi.com/opentalk/2025090817668.shtml
- VideoTutor（2026-05 新闻稿）https://www.globenewswire.com/news-release/2026/05/01/3285655/0/en/
- Khanmigo 交互图（2026-08）https://blog.khanacademy.org/new-ai-tools-bring-interactive-diagrams-and-targeted-practice-thanks-to-khan-academys-partnership-with-google-org/
- Nano Banana Pro https://blog.google/innovation-and-ai/products/nano-banana-pro/ · 定价与对比（第三方）https://hokai.io/hub/models/gemini-3-pro-image · https://help.apiyi.com/en/gpt-image-2-vs-nano-banana-pro-scientific-diagram-text-rendering-en.html
- FLUX.1 schnell（fal）https://fal.ai/models/fal-ai/flux/schnell · 百炼 wan2.6 定价 https://help.aliyun.com/zh/model-studio/wan2-6-t2v · qwen-image 定价 https://www.alibabacloud.com/help/zh/model-studio/qwen-image
- 视频 API 价格汇总（2026）https://www.cometapi.com/ai-video-api-pricing/ · https://aivideogenerationapi.com/
- Gemini Omni https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-omni/ · API 文档 https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/omni-flash-preview
- DiffInk（ICLR 2026）https://openreview.net/forum?id=XKOEQFKFdL · DiffMath（2026）https://arxiv.org/abs/2606.19939
- StarVector（CVPR 2025）https://starvector.github.io/ · OmniSVG（NeurIPS 2025）https://github.com/OmniSVG/OmniSVG
- 实时数字人成本 https://gofranz.com/blog/real-time-ai-avatars-what-they-actually-cost/ · HeyGen LiveAvatar https://help.heygen.com/en/articles/12758516-introducing-liveavatar
- Genie 3 https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/ · Odyssey-2 https://odyssey.ml/introducing-odyssey-2
