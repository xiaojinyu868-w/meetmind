# 套磁邮件·案例库（机构模板 v2）

> 本文档是 `cold-email-draft` skill 的载入资源。
> 当你（agent）需要一个具体"开头 / fit 段 / 结尾"的风格参考时，读这份。
> **注意**：这些是**过去成功案例的拆解**，不是现成模板。直接照抄会被学生一眼看穿。

## 案例 1 · CMU NLP PhD（录取）

**背景**：学生 UCLA 本科 CS，NLP lab RA 1.5 年，一篇 ACL Student Workshop 一作。目标导师 Prof. A，方向 multimodal alignment。

**开头（学术严谨型）**：
> Dear Prof. A,
>
> Your 2024 EMNLP paper on cross-modal retrieval raised a question I've been stuck on in my own work: when the vision encoder is frozen and the text tower drifts, the joint space collapses on long-tail concepts. In our NLP lab at UCLA we ran a similar drift-and-recover experiment on CLIP, and I kept finding ...

**为什么这开头能打**：第一句不是"我读了你的 paper"，是"你 paper 里某个具体主张 → 我在自己工作里遇到的具体问题"。对方读到会觉得"这个学生真的读懂了"。

---

## 案例 2 · Stanford MS EE（录取 + 两个月后获 RA offer）

**背景**：学生清华本科 EE，3 段硬件实习，目标导师 Prof. B，方向低功耗 edge inference。

**Fit 段（直接型）**：
> In my last internship at <company>, I shipped a quantization-aware training pipeline that cut a MobileNetV3 from 1.2M to 380K params while keeping top-1 within 0.4%. I'd love to understand whether the next bottleneck for your lab's work on <his latest paper topic> is on the compiler side or the memory-hierarchy side — my intuition says compiler but I haven't seen a clean benchmark.

**为什么这段能打**：(1) 具体数字 `1.2M → 380K, 0.4% acc drop`，不是"I worked on quantization"；(2) 主动提出一个技术假设（`compiler vs memory hierarchy`），邀请对方 correct/confirm。

---

## 案例 3 · Toronto ML PhD（录取）

**背景**：学生 IC 本科数学，跨申 ML，简历硬伤是没有正式 ML 科研经历，靠 Kaggle + 一个开源贡献。

**结尾**：
> I know my background is light on traditional ML coursework, but I've been reimplementing recent causal-inference papers on my spare time (notebooks at <github-link>). If you'd have 15 minutes in the next two weeks, I'd love to hear which direction in your group you think would be hardest for an incoming student to ramp into — I'd rather start somewhere I'll actually push.

**为什么这结尾能打**：(1) 诚实承认自己的弱点，反而建立信任；(2) 请求不是"你看我合适吗"，是"你觉得哪个方向最难" — 把对方放在专家位置，降低回复门槛；(3) `"in the next two weeks"` 是个具体但温和的时限。

---

## 通用决策树

| 学生 tone_preference | 开头模式 | Fit 段模式 | 结尾模式 |
|---|---|---|---|
| `academic` | 引用 paper 的具体 claim，提出技术质疑 | 用对称技术经验回应 | 提议 research statement 发过去 |
| `direct` | 一句话说我想做什么 | 用数字/成果说话 | 请求 15 分钟视频或回信确认 |
| `warm` | 欣赏他的某一类工作（不只单篇） | 用故事/动机切入 | 提议寒假/暑假做志愿 RA |

## 红线（写作时绝不出现的东西）

- "I am writing to express my sincere interest in..." （开头模板化）
- "I have read many of your papers and find them very inspiring" （零信息）
- "I believe I would be a strong fit for your lab because of my passion and dedication" （自我标榜）
- "Please find my CV attached" （学生很可能不带 CV 附件，邮件里别提）
- "Looking forward to hearing from you soon" （结尾空话）
- 任何超过 300 字的开头段
- 在一封邮件里同时问"能否做 RA + 能否申博 + 能否参观"（多问 = 对方不知道回哪个 = 不回）
