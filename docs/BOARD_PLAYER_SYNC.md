# 板书播放器音画同步架构（v9）——权威参考映射

> 本文回答一个问题：板书精讲播放器的「音画同步」设计不是拍脑袋，每个机制都对应一条
> 被工业界或学界验证过的成熟路线。分两层：**主干机制**（有标准/论文/工业惯例背书）
> 与**工程参数**（我们的实测调参，无权威来源，允许修改）。

## 0. 问题定义

音画不同步在板书场景有三种可感知形态，必须分别解决：

1. **内容错位**——嘴在讲 B，板上还在写 A（漂移跨段累积）；
2. **节奏失调**——字写得飞起但老师还没念到 / 念完了字才慢悠悠开始写（书写速度与朗读无关）；
3. **启动滞后**——念到这个词了，手才开始写这个词（真人恰恰相反：念到时已写完）。

## 1. 五条权威路线 → 我们的机制

### 1.1 媒体播放器主时钟惯例：音频是唯一主时钟，画面派生于它

**依据**：ffplay/FFmpeg 的音视频同步以音频时钟为主时钟，视频帧按主时钟计算
delay 决定立即显示/延时/丢弃（`compute_target_delay`）；MPEG 系统层用单一 STC
（System Time Clock）+ 各流 PTS（Presentation Time Stamp）对齐到同一支时间。
这是所有成熟播放器（ffplay、Chromium media pipeline、ExoPlayer）的共同选择：
音频断续人耳立刻感知，画面早/晚几十毫秒不易感知，所以**音频不等人，画面追音频**。

**落地**：`segment-clock.ts` 的 `SegmentClock` 是唯一时钟源。AudioClock 以
`AudioContext.currentTime` 为基准，把真实音频进度映射回时间轴
（`elapsedMs` + 字级 `charIndex`）；板上一切事件（动作触发、书写速度、段末推进）
都是这个时钟的派生物，画面侧**没有任何自由运行的计时器能决定内容节奏**。

### 1.2 Forced Alignment / EPUB 3 Media Overlays：字级对齐表驱动视觉事件

**依据**：ReadBeyond 的 [aeneas](https://github.com/ReadBeyond/aeneas/) 把音频与文本
做字/词级 forced alignment，产出 sync map 驱动 EPUB 3 Media Overlays（IDPF/W3C
标准，SMIL 血统）的朗读高亮——「音频里有每个词的时间戳，视觉元素按时间戳激活」
是有声书、字幕、卡拉 OK 行业的标准做法。

**落地**：DashScope CosyVoice 返回字级 timings（等价于 aeneas 的 sync map），
`charIndexAtMs` 插值出当前朗读字下标；BoardScript 的 cue（`[aN]` 内联锚点，
charIndex 坐标系）= sync map 上的视觉激活点。没有 cue 的动作退化为时间轴均分
（等价于无对齐表时的线性估算，是降级不是常态）。

### 1.3 课堂笔迹采集与同步回放：Classroom 2000 / eClass

**依据**：Georgia Tech 的 [Classroom 2000 / eClass](https://sites.cc.gatech.edu/fce/eclass/pubs/aaai98/index.html)
（Abowd et al., IBM Systems Journal 1999；Brotherton & Abowd,
[ACM TOCHI 2004](http://gtubicomp.pbworks.com/w/file/fetch/46380407/p121-a_brotherton.pdf)
被引 400+）验证了「白板逐笔笔顺 + 时间戳记录，与课堂音频同步回放」对学生复习
真实有效——笔迹按时间戳逐一重现，音频与板书天然同步，因为笔迹本就诞生于那支时间。

**落地**：我们是 eClass 的镜像：它记录真人笔迹的时间戳回放，我们让 LLM 生成
「板书动作脚本」，再按同一时间戳模型播放。`buildPageTimeline` 就是笔迹时间戳的
生成器；逐字严格串行书写链（任何时刻全板最多一个字在动画中）= 真人书写的
单通道约束（一只手一次只能写一笔）。

### 1.4 共同语手势的语音同步规则：stroke 与共表达言语共现（Kendon / McNeill）

**依据**：手势研究的经典结论——Kendon (1980) 的 **phonological synchrony rule**：
手势的 stroke 相「先于共表达的语音结束，绝不滞后」；McNeill (2005) 的表述更直接：
*"Strokes rarely if ever follow their co-expressive speech."*（Nobe 2000 等的实测：
90% 的 stroke 与共表达言语同步或超前。）真人老师「念到这个词时，这个词刚好写完」
不是巧合，是言语-手势系统的固有 timing。

**落地（v20 修正）**：`board-model.ts` 的 cue 微提前（`anticipateCharsFor`）——write
只提前一个起笔量 `ceil(300ms / msPerChar)` 字，标注提前 `ceil(500ms / msPerChar)` 字，
词首 clamp 到 0。**嘴上开始讲这部分内容，笔开始落；书写过程与它的共表达言语共现**。
v9 曾按书写总时长倒排（念到 cue 词时已写完）——那是对 Kendon 的误读：共表达言语是
整个相关短语，不是 cue 那一个词；全量倒排让手在讲上一句时就写下一行，正是用户实测
"一个人在讲、另一个人在写"的成因（2026-08-19）。修正后反而更忠于原规则。

### 1.5 AmIWrite（CHI '26）：co-speech handwriting 家教系统

**依据**：[AmIWrite](https://dl.acm.org/doi/10.1145/3772318.3790935)（Liu et al., CHI 2026）
是同赛道最新的学术标杆：LLM 家教在数字画布上边讲边写。它的架构：反馈文本内联
手写 function tags（`[write; text, coord]` / `[line]` / `[circle]` / `[arrow]` / `[check]` /
`[cross]` / `[break]`）；TTS 词级时刻用「时长启发式 + 波形能量局部极小值修正」**预测**；
渲染侧用**虚拟手**模拟真人运笔引导视觉注意。用户研究（n=40，组内对照
ChatGPT 式文本家教）：学习收益相当，但注意力切换负担显著更低（Q4, p<0.01）、
NASA-TLX 心智/体力负荷显著更低、SUS 78.4（"Good"）——co-speech handwriting
的价值有实证背书。

**落地对照**：

| AmIWrite | 我们 | 关系 |
|---------|------|------|
| 内联 function tags（tag 位置=语音位置） | narration 内联 cue `[aN]`（词级 charIndex） | 同构，我们坐标系更精确 |
| 词级时刻**预测**（启发式+能量修正） | DashScope TTS 原生字级时间戳 | 我们更准：无需预测，TTS 直接给 |
| grid 绝对坐标空间引用（论文自认准确度是头号 future work） | wN 相对引用 + 播放器排版权 | 我们绕开了这个坑 |
| `[break]` 理解确认 | checkpoint 段（三阶段渐进放手 + 三级 hints） | 对齐（hint 轮次同为 3 级） |
| **虚拟手引导视觉注意** | v10 粉笔手光标（`writeTipPosition` → `BoardCanvas` 粉笔光标，手到→圈到） | 已实现 |
| Lecture / Guidance / Practice 三场景（GRR 渐进放手） | Lecture + checkpoint ≈ Guidance；**Practice（学生板演 → AI 看笔迹 → in-situ 勾叉批改）缺 AI 感知闭环** | 已知差距，见 §4 |

触发时机上我们曾与论文有一点自觉的分歧，v20 起收敛：AmIWrite 在语音**到达**标注词时
触发动画（"simultaneously or immediately after"），v9 的我们认为这太迟、按书写总时长
提前；v20 认清共表达言语是整个短语后，采用"到达即起笔、书写与讲解共现"——与
AmIWrite 同向，与 Kendon/McNeill 的原意也更一致（stroke 与共表达言语共现、不滞后）。



## 2. 工程参数（无权威背书，实测调参，允许修改）

| 参数 | 值 | 位置 | 说明 |
|------|-----|------|------|
| 书写变速区间 | 0.7× ~ 1× | `PACE_SCALE_LIMIT` | 预算制变速（`paceScaleFor`）：时间窗紧加快（0.7 是观感边界，再快像快闪）；**v19 起宽裕不再放慢**——匀速慢放填充窗口是"机器人写字"感的根源，改为按自然节奏写完抬笔休息，窗口剩余留给讲解 |
| 书写自然节奏 | 抖动 0.82~1.25× + 停顿谱 | `buildWritePaceForTokens` | **v19 人性化节奏（单一来源）**：每 token 耗时带确定性 hash 抖动；token 间抬笔停顿——词间 70~140ms、标点 150~270ms（全角标点按字符判定）、CJK 每 4~6 字换气 190~340ms、字间微顿 25~70ms。`estimateWriteMs` = 书写+停顿总时长（时间窗预算/变速共用同一来源）。实测探针：`scripts/board-token-rhythm-probe.ts`（字间间隔非匀速、≥150ms 停顿可检出）。依据：真人板书"小组快写+抬笔换气"的观察（用户洞察 2026-08-19）；渲染不是手写，字可以出得快，不必匀速 |
| 老师基础语速 | 0.9× | `SPEECH_BASE_RATE`（segment-clock） | cosyvoice v3 实测不支持 `speech_rate`（静默忽略）且指令只认官方固定格式（追加"语速稍慢"= InvalidParameter）；播放层 `playbackRate` 天然保同步（charIndex 走音频媒体时间轴插值，与速率无关）。实际时钟速率 = 用户倍速 × 0.9（`effectiveRate` 统一折算：起播 / setRate / actionBudgets 除数） |
| write 起笔提前量 | 300ms 等值字数 | `anticipateCharsFor` | **v20 嘴手一体**：嘴上开讲 = 落笔开始，书写与对应讲解共现（边写边念、手追嘴）。不按总时长倒排——那是"一个人在讲、另一个人在写"的成因 |
| 标注提前量 | 500ms 等值字数 | `anticipateCharsFor` | 圈点勾画动画短，落在"看这里/这个很关键"等指涉词上 |
| 段末闸门轮询 | 400ms | `useBoardPlayer.handleEnd` | 段末硬同步：已触发 write 全部写完才播下一段。**宁音等画，不画等音**——与 ffplay「视频落后就丢帧」相反，因为板书丢字不可接受；等待表现为老师写完字的自然停顿 |
| 看门狗链 | 4s/8s/9s/12s | 各处 | 任何一环挂起都不许冻住黑板，与同步语义无关，纯健壮性 |

## 3. 机制 ↔ 失调形态 对照

| 失调形态 | 机制 | 依据 |
|---------|------|------|
| 内容错位（漂移跨段） | 段末硬同步闸门：drain 才前进 | ffplay 主时钟收敛思想 × SMIL seq 容器语义（前元素结束才播下一个） |
| 节奏失调 | 预算制书写变速 `paceScaleFor` | 主时钟派生（§1.1）的工程实现 |
| 启动滞后 / 讲写分离 | cue 微提前 `anticipateCharsFor`（write 300ms 起笔量）+ prompt 嘴手一体契约（写的时候嘴里说的就是手上写的，纯讲解时段不排动作） | Kendon/McNeill 语音-手势同步规则（§1.4，v20 修正：共表达言语 = 整个短语） |
| 词级内容对位 | cue charIndex 触发 | forced alignment / Media Overlays（§1.2）+ AmIWrite 内联 tags（§1.5） |
| 注意力引导 | v10 粉笔手光标（手到 → 写到/圈到） | AmIWrite virtual hand（§1.5，Q2 定位 referenced content 6.12 vs 4.35, p<0.001） |

## 4. 已知偏差（诚实清单）

- **非 cue 动作仍按线性估算对齐**：它们没有字级锚点，靠时间轴均分 + 段末闸门
  收敛。想更准，方向是让 LLM 给更多 cue（或生成后对 narration 全量 forced
  alignment），而不是调参数。
- **1.5x 倍速下书写不加速**：~~音频加快、书写常速，段末闸门吸收差额（段间停顿变长）。~~
  **已修（2026-08 v13）**：`actionBudgets` 按 `budgetMs / speed` 折算，书写随倍速同步加速（clamp 吸收）。
- **首段机器人音（自动播放策略）**：无手势进页时 AudioContext suspended。
  ~~已修（v13）：首段等手势最多 5s~~ **再修（2026-08-19）**：5s 倒计时到点照样
  降级机器人音，是"一开始机械音、后面正常"的成因。改为**手势门无限等待**——
  没有手势就没有声音（"点一下黑板，听老师开讲"是明确的开始门，不是冻住），
  看门狗在手势拿到后才武装；机械音只在 TTS 真失败时出现。
- **暂停/恢复音画错位（2026-08-19 三连根修，用户实测"板书写到 30 秒、人声从头开始"）**：
  ① **主因**：`status` 在主循环 deps 里——pause 的 setStatus 触发 effect cleanup
  `cancel()` 销毁 clock，play 时为同一段新建 clock 从 0 秒重播；黑板的
  triggered/书写接力却在原位。修法：status 移出 deps，暂停/恢复只走
  `clock.pause()/resume()` 直控，重起 clock 走 `runId` 信号。
  ② **安全定时器/看门狗不感知暂停**：暂停中超时照样触发——finish 会在暂停中
  翻段（`handleEnd` 已加 playing 守卫兜底），看门狗会在暂停中触发降级，而降级
  新建的 fallback clock 没人 pause，在暂停中自由跑完 → 恢复后 resume 一个
  已完结的 clock = 人声彻底消失只剩板书在写（事件流实证）。修法：两类定时器
  全部 arm/freeze/rearm 暂停感知 + fallback 继承暂停态。
  ③ 冷启动预热：脚本到达即 `prefetchBoardTts` 首页前两段，首段不再现取合成
  撞 15s 看门狗。验证：`scripts/board-pause-resume-probe.ts`。
- **渲染层 update-depth 死循环（两处，2026-08 修复）**：① BoardWrite 的 onCursor/layout
  进 effect deps（父组件每帧新引用）→ 改 ref 持有；② BoardCanvas 默认参数数组字面量
  （RefInterlude 不传）+ instant effect 必返新 Set → 模块级空数组常量 + 无变化回原引用。
  教训：**deps 里的引用类型必须稳定，setState 无变化必须回原引用**。
- **TTS 限流与降级竞态（2026-08-18 修复，两处）**：① cosyvoice 免费档 QPS 极低，
  预取突发（首屏+跨页+checkpoint 十几条）吃 428 惩罚性限流 → 整段降级机器人音。
  服务端并发闸收紧到 1 路串行 + 1s/2s/4s 退避重试 3 次（实测 8 段并发 8/8 全 200）；
  客户端 fetch 超时 15s → 45s（串行闸下队尾请求等待变长，15s 会误杀判死刑）。
  ② **双音重合竞态**：`onUnavailable` 降级起 speechSynthesis 时原 AudioClock 未 cancel，
  在飞的 fetch 到 wav 后叠播 → 两个声音同时响。修复：降级前先 `clock.cancel()`
  （主段与 checkpoint 段两处），checkpoint 段清理也补上了 `clockRef.current?.cancel()`。
  ③ **安全超时语速错配（v15 之后出现）**：speech 时钟安全超时按 v15 校准后的
  150ms/字时间轴估，但机器人音真实语速 ~280ms/字——超时早于 utterance 念完
  触发 finish()，下一段 TTS 起播时机器人还在念（双音轨复现）。修复：安全超时
  按 `max(estimatedMs, 字数 × 280)` 估（`robotEstimatedMs`）；BlackboardPlayer
  ad-hoc 朗读（hint/answer/点评）补上同款 cancel。
- **v15 科学节奏（2026-08-18，节奏诊断驱动，scripts/board-rhythm-audit.ts）**：
  诊断实测发现估算语速 280ms/字 vs cosyvoice 真实 137-163ms/字，整条时间轴稀释
  ~1.8 倍（写板被迫慢放、非 cue 动作拖在语音后、节奏"两张皮"）。四处修复：
  ① `MS_PER_CHAR` 标定 150（复测 est/actual ratio 从 1.7-2.0 收敛到 1.03-1.09）；
  ② **消灭双时间轴**：所有动作（含无 cue、pause）统一锚定讲稿字位，字级时间戳
  驱动一切，微提前起笔对全部动作生效；段长 = 朗读估算（不再被书写撑长，书写超出
  由预算自适应 + 闸门吸收）；③ **段间呼吸**：页内 400ms / 翻页 1200ms 确定性停顿
  （原段间静默最小 0s；闸门已等够不叠加）；④ **checkpoint wait time**：提问念完
  按钮延迟 2s 出现（Rowe 1974：等待时间 ≥3s 显著提升回答质量，防"不过脑点看解析"）。
  ⑤ 冷启动宽限：首页首段看门狗 9s→15s（TTS 预取与播放并发，引擎冷时合成 10s+，
  9s 误杀会把第一耳朵判成机器人音 + 7.2s 闸门——复测唯一的节奏污点）。
- **v17 体验修正与少结构多智能（2026-08-18，用户实测反馈驱动）**：
  ① 字幕第二行被黑板下沿裁半——`maxHeight` 32px < 两行真实高度 37.8px，改 40px
  并同步分隔线位置；② **标注光标在书写中乱跳**（"笔在黑板上乱动"根因）——v15
  全量 cue 后标注可能在目标 write 未写完时触发，光标在笔尖与标注目标间往返；
  修复：有 write 在写时不移动标注引导光标（笔只能在一个地方）；③ 节奏整体放慢：
  段间呼吸默认 400/1200 → **700/1600ms**，书写速度上限 clamp 0.55 → **0.7×**
  （紧预算下书写更从容，超出由闸门音等画吸收）；④ **少结构多智能**：explainer /
  photo 的 system prompt 删掉全部微管理（页结构配方、密度数字、字数上限、节奏
  数值表、"硬指标"清单），只留输出契约 + 品味宪法 + 引用铁律（机械防线）——
  依据 `项目开发文档/提示词设计哲学.md` 与 Bitter Lesson：节奏不像真人的问题
  属于语义智能，不属规则。主模型向 Kimi K3 收敛（百炼开通后
  `BOARD_PHOTO_ONESHOT_MODEL` / `BOARD_EXPLAINER_MODEL` 一键切换）。
- **v16 原生 token 排版（2026-08-18，"单词连写/先连后跳/括号错位"三连修的根修）**：
  渲染最小单元从逐字改为 token（CJK 逐字 / 英文按词 / 标点逐字 / 空格抬笔），
  词内字距、词间距、基线全部交给字体本身——空格 white-space:pre 原生宽度
  （废弃 0.35/0.55em 人工补宽），行内一律 baseline 对齐（废弃按类型手动
  --mm-y 偏移，它正是括号内外错位的根因），未写 token 占位与真实渲染完全同构
  （行零 reflow，"先连写后跳开"消失）；`wrapText` 拉丁词中间不断行；
  箭头标签垂直居中在箭头缝里（原 -24 偏移会把标签压进目标文字）。
  哲学：真实老师一词一词写、字体自然连字，排版引擎不做字体该做的事。
- **v18 流式讲解单元（Skeleton-of-Thought）**：拍题链路从"整份一次生成"
  改为"大纲（宏观把控：title+解题思路+单元计划）→ 单元并行生成（内部把控、
  逐单元 sanitize）→ SSE 有序下发"，`/api/board/photo-explain-stream`；
  播放器支持增量脚本（`isGenerating` + waiting 态 + `notifyScriptGrown` 续播），
  实测首单元 25s 可开播（整份 one-shot 38s、K3 7min 的对比下这是体验底线解法）。
- **v16 导演 pass（2026-08-18，节奏标注 LLM 化）**：编剧（内容生成）与导演（节奏设计）
  分离——第二次 LLM 调用只做：① 全量 cue（每个动作的字位锚点，消灭"无 cue 均分"
  的节拍器感）；② 段后 breathMs（关键结论/揭晓后 800-1500ms，上限 2500，每页至多
  两段长停顿）。模型只产出语义锚点，毫秒对时仍归播放层字级时间戳（Bitter Lesson
  分工）。依据：AmIWrite（LLM 标注+确定性回放同构）、SSML 韵律标注（MOS 3.20→3.87）、
  VideoDirectorGPT、Self-Refine。实现：`board-director-service.ts`（按页并行 +
  单页超时降级保留原节奏 + `parseDirectorResponse` 纯函数校验），默认模型 kimi-k3
  （Moonshot provider；DeepSeek 替身机制验证通过：cue 覆盖 7→21/21，breath 布点
  400/800/1000/1200 分层合理）。接入：explainer（离线 15s/页）、拍题（实时 8s/页）。
  注意：DeepSeek V4 thinking 默认开启已三处咬人（拍题生成/explainer 主生成/导演
  标注 finish_reason=length），调用 V4 一律显式 thinking:false。
- **段末闸门造成的静默**是设计选择（老师写完字的停顿），不是 bug；若某页 write
  密度过高导致停顿频繁，应该在脚本层减少 write 粒度，而不是去掉闸门。
- **v19 人性化书写节奏（2026-08-19，用户洞察"字不必匀速出"）**：书写从节拍器改为
  真人节奏——每 token 耗时带确定性 hash 抖动（0.82~1.25×），token 间抬笔停顿
  （词间/标点/短语换气/字间微顿，`buildWritePaceForTokens` 单一来源）；预算宽裕
  不再拉伸书写填满窗口（`paceScaleFor` clamp 0.7~1，只快不慢），写完抬笔休息把
  窗口剩余留给讲解。全角标点原被 tokenizer 归为 cjk 不触发标点停顿，一并修。
  语音侧：`SPEECH_BASE_RATE` 0.9 基础语速（cosyvoice v3 实测 speech_rate 静默忽略、
  自由格式指令 InvalidParameter，播放层 playbackRate 保同步地放慢，降级链同系数）。
- **v20 嘴手一体（2026-08-19，用户洞察"现在像一个人在讲、另一个人在写"）**：
  真人老师嘴手只有三种状态——边写边念（嘴快半拍、手追嘴）、写完指着讲、纯讲
  不动笔；任何瞬间听到的和手上做的指向同一个东西。① 调度层：write 的 cue 从
  "按总时长倒排、念到已写完"改为只提前 300ms 起笔量——嘴上开讲=落笔开始，
  书写与对应讲解共现（v9 的倒排正是"两个人"成因，也是对 Kendon 的误读：共表达
  言语是整个短语而非 cue 词）；② 脚本层：explainer/photo/stream/director 四处
  prompt 的讲写同步契约改为嘴手一体目标描述（写的时候嘴里说的就是手上写的；
  纯讲解时段不排书写动作；cue 锚在"开始讲述该内容"的词上）；③ checkpoint
  契约补"指向的黑板内容必须已写在板上"（qwen3.7-plus 实测仍会违例，K3 待验证）；
  ④ `extractCues` 兼容模型偷懒写法 `[N]`（不只 `[aN]`）。
- **v21 checkpoint 标记泄露与字幕体验（2026-08-19，用户实测三连）**：① answer 里的
  [aN] 此前不做提取——TTS 逐字念"a 零"、字幕外露。修法：schema 加 `answerDisplay`/
  `answerCues`（指向 demoActions），sanitize 提取并剥除，hints/question.text 的标记
  一并剥除；answer 阶段示范随 answerCues 渐进上板（解析念到哪示范写到哪，与正段
  同规则）。② 字幕省略号吃掉正在讲的内容：K3 段讲稿 115-222 字远超两行。修法：
  `windowSubtitle` 卡拉 OK 窗口——按子句跟随朗读字位滑动（窗口 ~44 字两行，
  超长单子句按字滑窗），讲到的必然可见。③ 字幕挡板书：布局底部预留 0.075→0.1
  （字幕区实际占 ~46px > 40.5px，最底行板书探进字幕顶部）。
- **v22 板书章法与粉笔色板（2026-08-19，用户要求对齐"好老师的板书"）**：调研
  板书设计三方法五原则六禁忌（分区/主次分明/少而精/忌空满乱散潦草）后双向落地——
  ① 渲染层色彩体系：`chalkColorFor(role)` 粉笔色板——term 暖黄 `#EFD694`
  （黄粉笔 = 必须记住的重点，含 hanzi-writer strokeColor 同步）、title/step 白、
  note 白 74%、圈划朱砂（既有）；Caveat 拉丁放大 1.18→1.12（笔画粗重压同行鸿雷）；
  全角冒号显示层转半角后 `--mm-y` -0.22em 上提（Caveat 双点贴基线夹 CJK 间读作
  句号，标题实拍根修）。② 脚本层【板书成品】契约进 explainer/拍题 staged/one-shot/
  流式单元四处 prompt（结果导向、不限定过程）：课题置顶+写完画线、并列要点序号
  分点、每行值得拍照、一页正文 ≤6 行、最重要 1-2 处圈划、term 黄粉笔契约写进
  role 语义；staged 密度规则"饱满 6-12 write"改"疏朗有型 4-8 write"（与六忌"满"
  对齐）。K3 重生成 demo 全部落地（标题下划线、铁律1/2 序号、圈划重点，实拍验证）。
  ③ 实拍顺带抓到 extras 布局两 bug 并根修：右栏起点只避页级 write（越过中线的
  宽 extras 被右栏新内容同行撞车）+ 换栏按单行高判定（多行 extra 溢出压字幕）——
  右栏改从栏顶向下排、垂直避撞所有已放置内容，换栏/缩字号按折行后真实高度
  （回归测试锁死：任意两 write 矩形不相交、不侵字幕区）。④ 页末 checkpoint
  遗物成双：'done' 入 cpArtifacts 后 advance 无下一段、checkpoint 态不消失，
  cpArtifacts + activeArtifacts 两源叠加让题目/示范写两遍——加守卫：已入遗物
  的 segment 不再拼 active 份。
- **v24 超载页布局与字幕防漂移（2026-08-19，用户拍题实拍"板书重叠、排版乱、
  字幕同一句话不停换位置"）**：探针复刻确认两个机制——extras 在左栏缝隙
  weave（乱）+ 越界硬塞进字幕区与字幕文字双影。根修三层：① 分区——页级
  内容写满上半板时 extras 优先进右栏从栏顶向下排（功能区固定，板书章法）；
  ② 双栏候选——每个 extra 在左右栏各评估候选位（右栏避撞+缩字号），取字号
  更大者落位；两栏都满先 clamp 底边进字幕区上沿，clamp 位仍相撞则弃写
  （dropped 零尺寸占位，串行链/渲染跳过，内容照常说——黑板写满时真人老师
  也不再往上写）；③ 字幕左缘固定 7% + textAlign left（原居中渲染窗口长度
  每变一次整行就漂）。回归测试锁死：超载 5-extras 场景任意两 write 矩形
  不相交、不侵字幕区、弃写 ≤1 且零尺寸。验证设施：demo 页 `?script=` 加载
  替代脚本 + `scripts/board-overload-capture.ts` 超载页实拍（checkpoint 两
  级提示+看解析全量 extras 上板抓拍）。
- **v25 板面密度与单字渲染排查（2026-08-19，用户两连：「下/月有一个字
  渲染有问题」+「板书密度太小，像低质量草稿本」）**：① 缺笔画排查——
  复刻用户场景（demo 第 2 页 checkpoint 暂停）DOM 探针证明终态笔画完整
  （下 18 paths / 月 24 paths，全部描边在）；用户截到的是动画中间态
  （dev 环境 HMR 重挂载会让多个笔顺字同时从头重写——串行接力下绝不可能
  两字同时半写，是唯一自洽解释；生产无 HMR 无此问题）。加固：笔画数据
  降级守卫 4s→8s（dev 下 hanzi 路由冷编译首字常超 4s，过早降级让同一行
  笔顺细字与字体粗字风格打架）。② 密度根修——主字号整体上抬 ~15%
  （title 0.12 / term 0.092 / step 0.066 / note 0.052，写满页面由收缩
  路径兜底不溢出）+ 稀疏放大（内容不足可用高 80% 按比例放大字号撑满
  黑板，上限 1.5×，重折行后装得下才采用）。注意：渐进书写中段的
  "半空板"是布局为整页内容预留位置的自然结果，真人老师写一半时
  黑板也是半空的。
- **v27 表层观感根修（2026-08-20，用户裁决"浅表的美观性、语音的协调性
  还没做好"）**：① 粉笔光标拆除——v10/v14 双路笔尖追踪（token 级
  `writeTipPosition` + 笔画级 `penTipAt`）多轮迭代后实拍仍可见偏移
  （粉笔头停在词右缘外，与正在写的笔画错位），用户裁决"跟不上就去掉"：
  渲染层/状态/标注引导全部移除，`onCursor`/`penTipAt` 保留为未接线的
  可选能力；逐字逐笔动画本身即视线引导。② 全角标点收紧——`，、。；？！`
  渲染盒压 0.55em + 左拉 0.12em（DOM 实测：盒宽压完字形自带左轴承仍
  余 ~6px 空），pending 占位同宽同左拉保零 reflow。③ TTS 磁盘缓存
  （`data/board-tts-cache/` 200 条 FIFO）+ 退避 1/2/4/8/16s——机械音的
  第一来源是合成失败降级 speechSynthesis，demo 重播与 dev 重启从此零
  重合成。④ 情感指令实测：cosyvoice-v3 的 instruct 只接受官方固定
  「场景+情感枚举」格式（neutral/happy 可用且时间戳保留；中文情感词与
  自由指令被引擎以 InvalidParameter 拒绝，错误码 428 与限流同码，注意
  区分）——happy vs neutral 试听样本在 `public/demo/tts-samples/`。
- **v26 一口气一段·小讲解单元（2026-08-19，用户判断"音画协调处理不好是
  架构问题，应该定义更小的讲解单元"——方向正确）**：旧粒度一个 segment
  = 100-200 字长讲稿 + 一串动作，音画协调全靠运行时补救（书写变速、
  背压 hold、段末闸门）——把架构问题当调参问题解。改为生成契约层定义
  小单元：一个 segment = 一口气（一两句完整的话 15-45 字 + 0-2 个板书
  动作，写东西的那口气说的就是它；纯讲的口气 actions 为空；上百字长
  讲稿明文禁止）。嘴手配合在单元内天然成立，单元边界成为天然同步点，
  背压/闸门从日常补救降级为保险丝。落地：四处 prompt 契约（explainer /
  拍题 staged / one-shot / 流式单元）统一加【一口气一段】原则段 +
  breathMs 换气指引（300-600 换气 / 800-1500 关键处）；播放器 TTS 预取
  深度 1→2 段（小单元段短变密，合成延迟不能在新边界露头）。K3 重生成
  demo：4 页 23 个小单元（13-45 字为主，0-2 动作），长段只剩「」原话
  朗读（纯讲、手停，契约允许）。AmIWrite 的词级内联 tags 本质也是
  短语级交错——这次是把粒度收缩对齐到论文的原生粒度。
  节奏诊断实测：零降级、段间静默 p50 1.1s、闸门都是短节拍（0.4-1.6s）；
  仅剩 2 次背压全是强制放行（笔顺 title/term 自然书写 ~4.5s 超过 3.5s
  上限）——`MAX_INK_HOLD_MS` 3500→5000 标定（hold 期间学生看笔写字，
  speech 绝不提前脱钩）。
- **v23 讲写联合调度·反向背压（2026-08-19，用户实测"板书写到这里，嘴讲的比
  板书快"）**：v20 把 cue 触发做成了 speech→ink 的正向联动，但段内联动只有
  一半——语音永远是主时钟，cue 一到新动作就触发，笔的串行队列却在积压
  （多个 write 的总书写时长超过对应口播时长时，0.7 变速下限也追不上），嘴讲
  到 N+1 笔还在写 N，漂移只能等段末闸门一次吸收。补上 ink→speech 的另一半：
  嘴到新动作的 cue 时笔仍有未写完的板书（BoardCanvas 经 `onInkBacklog` 上报
  串行队列积压数）→ 该动作延后触发，同时 `clock.pause()` 在词边界把音频 hold
  住——真人老师"写完才开口讲下一句"的自然停顿；hold 只冻声音链不动 status，
  黑板书写接力照常跑（音等画的生效方式）；笔追上（backlog=0，180ms 轮询）即
  放行，被延后的动作在放行后首个进度事件补触发——嘴手互相等待，漂移不跨
  内容边界累积。防死锁：`MAX_INK_HOLD_MS` 3500ms 超时强制放行（把已达到 cue
  的动作立即补上，残余漂移交段末闸门），且本段不再背压；pause（静默拍）与
  ref（自带插播暂停）不背压；用户暂停期间背压到点不越过用户暂停擅自出声；
  降级 fallback clock 继承 hold 态。打点 `ink-hold` / `ink-hold-release` /
  `ink-hold-forced` 进 board:timing 通道，节奏诊断脚本可直接观测。
  实拍两根修（2026-08-19 节奏诊断）：① 误 hold——已触发动作仍参与背压
  判定，最后一个 write 在写、后面没有新动作时每个进度事件都误判 needsHold，
  把本该边写边念的共现讲段冻住（修法：deferral 检查先跳过已入 triggered 的
  动作）；② 冷启动看门狗 15s 仍误杀首段（15.1s 被判机器人音），上调 30s——
  第一耳朵必须是真人音色。另注：headless 无交互时 Chromium rAF 节流到 ~1Hz
  会让书写爬行（全撞 12s 看门狗），诊断脚本已加防节流启动参数。已知边界：
  checkpoint answer/demo 的示范 write 走 extras 链、由 adhoc 朗读驱动，不在
  本次背压范围（主时钟此时不在跑）。
- **预算变速的下限 clamp 值（0.7）未经用户研究标定**，后续可做 A/B。
- **Practice 场景闭环（v12 已实现 v1）**：学生板演 →「写完了」→ 笔迹叠 6×4 网格
  栅格化 → qwen3.7-plus 多模态批改（网格 cell 引用换定位可靠性，正是 AmIWrite
  的 grid referencing 思路）→ 勾叉落在 cell 旁 + 龙安培口头点评。与 AmIWrite
  的差距：它逐步骤逐步反馈（每步确认再下一步），我们是课后一次性批改；
  逐步引导式 practice 留给下一阶段。
- **粉笔手光标**：**已拆除（2026-08-20 v27）**——v14 笔画级驱动后实拍仍有
  可感偏移，用户裁决"跟不上就去掉"，光标层整体移除（`penTipAt` 保留未接线）。

## 5. 一句话总结

> 音频是唯一主时钟（ffplay/MPEG 惯例），字级对齐表驱动视觉激活（forced
> alignment/Media Overlays，与 AmIWrite 内联 tags 同构），笔迹按时间戳串行回放
> （eClass），书写与讲解共现、起笔微提前（Kendon/McNeill，v20 修正），段内
> 音画互相等待的反向背压联合调度（v23）——被验证的路线拼出板书播放器的
> 同步架构；粉笔手光标（AmIWrite virtual hand）试过并拆除（v27：追踪精度
> 达不到"无干扰"门槛时，没有笔比有一支跟不上的笔好）。
> 剩下 0.7/300ms 之类的数字是我们的调参，不是理论。
