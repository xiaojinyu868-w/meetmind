# 清华讲演 PPT 生成（thu-slide-deck）

一个符合 Agent Skills 标准（SKILL.md 清单格式）的技能包。任意智能体加载本技能后获得"清华讲演 PPT 生成"能力：为讲解而设计——先和用户确认场合与时长，产出 AST 形态的讲演骨架（论断式标题 + 观众状态转移意图 + 视觉锚点 + 口播要点）供确认，再按 DSL 写成 slides.txt，一键生成**单文件 HTML 讲演 deck**（瑞士国际主义风格、清华紫、七种页型、零依赖离线放映），口播稿进演讲者控制台；生成后用 check_deck.py 做讲演体检，全绿才交付。需要 PowerPoint/WPS 二次加工时可选用 make_pptx.py 导出 .pptx。

## 功能简介

- **先讲后做**：先产 AST 讲演骨架（观众状态转移弧）给用户确认，再生成文件，不做黑箱一键出稿
- **论断式标题**：内容页标题是一句完整结论（Assertion-Evidence 结构）
- **意图声明**：`~ ` 行声明本页观众状态转移（不渲染），写不出意图的页往往是不必要的页
- **讲演体检**：`check_deck.py` 确定性检查标题论断 / 要点密度 / 口播稿 / 意图 / 节奏配比 / 章节结构，给出"能否上台"总评，有 ERROR 退出码 1
- **单文件 HTML deck（v5 主交付）**：`make_html.py` 输出一个 HTML 文件，所有 CSS/JS 内联，零 CDN、零网络、零构建，浏览器直接打开即可放映
- **演讲者模式**：按 `P` 当前窗口变深色控制台（16:9 页预览 + 本页口播稿 + 意图 + 下一页预告 + 计时器），同时弹出干净观众屏并同步翻页（BroadcastChannel + postMessage 双通道），退出时观众屏显示「演示已结束」——slide 给听众看，notes 给讲者看
- **七种页型**：封面 / 章节过渡 / 强调（高桥流整页单句）/ 内容（两级要点）/ 数据（2-4 个 KPI stat 列）/ 对比（左右两半中缝竖线）/ 结尾（左紫右白 takeaway 闭环）
- **瑞士国际主义视觉**：直角、无阴影、无渐变、无圆角；装饰只允许 1px 发丝线与小色块；主题固定清华紫 `#660874`；全系统字体栈，教室离线可放映
- **放映交互**：←/→、Home/End、滚轮防抖、触屏滑动、直角导航点、ESC 总览、URL hash 跳页（`#3`）、B 键静态模式（localStorage 记忆）、尊重 prefers-reduced-motion
- **结构自检**：生成后自动校验 data-layout 白名单、data-slide-id 唯一、SPEAKER_NOTES 数 == 页数、HTML 标签配平；失败非零退出
- **可选 pptx 导出**：`make_pptx.py` 生成最小合法 .pptx（含 notesSlide 讲者备注），供 PowerPoint/WPS 二次加工

## 运行环境

- 智能体本体：任意支持 Agent Skills（SKILL.md）标准的 Agent 运行时
- 附带脚本：**Python ≥ 3.8，纯标准库，零第三方依赖**（无需 pip install）
- 放映端：任意现代浏览器（Chrome / Edge / Firefox / Safari），无需联网

## 目录结构

```
thu-slide-deck/
├── SKILL.md                     # 技能清单：触发条件、AST 工作流、DSL 规则、体检要求、边界
├── README.md                    # 本文件
├── scripts/
│   ├── make_html.py             # slides.txt → 单文件 HTML 讲演 deck（v5 主交付，含演讲者模式）
│   ├── make_pptx.py             # slides.txt → 清华紫 16:9 .pptx（可选导出，含 notesSlide）
│   └── check_deck.py            # 讲演体检：六类确定性检查 + "能否上台"总评（有 ERROR 退出码 1）
├── references/
│   └── design-guide.md          # 讲演方法论 + HTML 视觉系统（token / 双阶梯 / 瑞士纪律 / 演讲者模式契约）
└── examples/
    ├── slides.txt               # 样例：论断式标题 + 意图声明 + 口播备注 + 数据页/对比页的组会汇报
    ├── sample-deck.html         # 由样例生成的 HTML deck（12 页，自检通过，浏览器直接打开放映）
    └── sample-deck.pptx         # 由样例生成的 pptx（可选导出形态，体检全绿）
```

## 脚本用法示例

```bash
# 1. 生成 HTML deck（主交付）
python3 scripts/make_html.py examples/slides.txt 我的汇报.html

# 2. 讲演体检（生成后必跑，全绿才交付）
python3 scripts/check_deck.py examples/slides.txt

# 3. 可选：导出 pptx 供二次加工
python3 scripts/make_pptx.py examples/slides.txt 我的汇报.pptx
```

输出示例：

```
已生成: 我的汇报.html（31745 字节，12 页，HTML 自检通过）
```

```
讲演体检报告：examples/slides.txt
==============================================
（未发现问题）
==============================================
总评：12 页（内容页 6 · 章节页 3）· 0 WARN · 0 ERROR
能否上台：可以——论断、密度、口播稿、意图、节奏全部达标。
```

放映：双击 HTML → ←/→ 翻页 → 按 `P` 进演讲者模式（观众屏自动弹出并同步）→ ESC 总览跳页 → 再按 `P` 或 ESC 退出，观众屏显示「演示已结束」。

## DSL 速查

```
%title 封面标题              ← % 元信息（title/subtitle/author/date）构成封面页
%duration 10                ← 汇报时长（分钟）：体检节奏配比 + 演讲者模式计时预算
# 论断句标题                 ← 开一页新幻灯片；标题写一句完整结论
~ 观众状态转移意图           ← 本页要把观众从哪带到哪；不渲染，供体检 + 演讲者控制台
- 一级要点                  ← 紫色 8×8 方块 marker
  - 二级要点                ← 行首两个空格 + "- "，灰 en-dash
>> 讲者备注（口播稿）         ← 当前页口播内容，可多行；只在演讲者控制台/演示者视图
# 章节：章节名               ← 章节过渡页
# 强调：一句话                ← 强调页（整页紫底超大字单句）
# 数据：论断标题              ← KPI 数据页；要点行：- 数字 | 标签 | 注释（2-4 列）
# 对比：论断标题              ← 左右对比页；要点行：- 左侧文本 | 右侧文本
# 谢谢聆听                  ← 结尾页；带 - 要点 → 右半白底 takeaway（第 3 条紫色）
// 注释行                   ← 空行与 // 行被忽略
```

标题中可用 `*强调字*` 标记斜体强调。特殊字符（`& < > "`）原样写，脚本统一转义。完整规则见 `SKILL.md`。

## 限制说明

- 脚本**不联网**，不发起任何网络请求；生成的 HTML 也不依赖任何 CDN / webfont（全系统字体栈，教室离线可放映）
- 脚本**只读取用户显式指定的输入文件、只写入用户显式指定的输出路径**，不读写技能包目录以外的任何文件
- **纯文字排版**：不生成图片、图表、表格；数据图请用户自行制作（HTML deck 用 `# 数据：` 页承载关键数字，pptx 可在 PowerPoint/WPS 中插图）
- **不含官方素材**：校徽、校名标准字等受 VI 规范约束的素材需用户按学校规范自行添加
- 演讲者模式的观众屏同步依赖 BroadcastChannel / postMessage，观众屏需由演讲者模式弹出（或被允许弹窗）；`>> `/`~ ` 内容只进控制台，不进观众屏渲染
- pptx 导出为最小合法 pptx（单一母版 + 版式 + 可选备注），如需复杂排版请用 PowerPoint/WPS 二次加工；pptx 字体为微软雅黑，macOS/Linux 缺该字体时回退系统字体
- 论断句的内容以用户提供的材料为准，智能体不硬编数字与结论

## Reference（理念来源）

- **humanize-ppt**（MIT，https://github.com/LearnPrompt/humanize-ppt）——AST（Audience State Transition，观众状态转移）的命名与"演讲体检"思想
- **Michael Alley**（Penn State），《The Craft of Scientific Presentations》——Assertion-Evidence 结构（论断句标题）
- **Guy Kawasaki**——10/20/30 法则（页数 / 时长 / 字号下限）
- **高桥流**（Takahashi Method）——强调页（整页超大字单句）
- **guizang-ppt-skill**（AGPL-3.0）——HTML 视觉系统的设计参数参考（仅吸收参数，代码全部原创）
- **anthropics/skills** 官方 pptx skill——明暗三明治 / 字号层级 / NEVER 清单

## License

本技能包由**清华大学参赛队**开发，用于清华清小搭 Skill 赛道参赛。许可证归属清华大学参赛队。
