"use strict";exports.id=6580,exports.ids=[6580],exports.modules={50074:(e,t,n)=>{n.d(t,{CD:()=>u,M9:()=>y,OC:()=>i,Po:()=>b,SL:()=>p,ZI:()=>l,Zg:()=>o,di:()=>f,e5:()=>m,k5:()=>a,kC:()=>c,kV:()=>s,l8:()=>d,ny:()=>S});var r=n(51242);let a={flashcards:"app-flashcards-v1",quiz:"app-quiz-v1",mindmap:"app-mindmap-v1",cheatsheet:"app-cheatsheet-v1",audioOverview:"app-audio-overview-v1",teachBack:"app-teach-back-v1"};function i(e){let t=e.lessonSources.length>0?e.lessonSources.map((e,t)=>`${t+1}. ${e.title}（sourceId=${e.sessionId}）`).join("\n"):"当前课程单元",n=e.exam?.pastPapers?.filter(e=>e.content?.trim()).map((e,t)=>`真题来源 sourceId=past-paper:${t} \xb7 ${e.title}
${e.content.trim().slice(0,8e3)}`).join("\n\n"),r=[e.exam?.name?`考试：${e.exam.name}`:"",e.exam?.mode==="open-book"?"考试方式：开卷，可携带纸面资料":"",e.exam?.mode==="closed-book"?"考试方式：闭卷，速查表仅用于考前复习":"",e.exam?.syllabus?.trim()?`考试大纲 sourceId=exam-syllabus：
${e.exam.syllabus.trim().slice(0,8e3)}`:"",n||""].filter(Boolean).join("\n");return{contextTier:e.contextTier,lessonCount:e.lessonSources.length||1,sourceSummary:t,...r?{examScope:r}:{}}}function o(){return"你是一位深谙认知科学和间隔重复理论的学习教练。学生刚上完一节课，需要通过主动回忆来真正记住核心知识，而不仅仅是机械背诵。把这节课的内容转化为一组让他“看到题就能在脑子里把答案重建出来”的闪卡。"}function s(e){return`${e.goalIntent?`他的学习目标：${e.goalIntent}

`:""}${e.anchorContext?`他听课时的困惑点（这些地方更容易出问题，值得多覆盖）：
${e.anchorContext}

`:""}课堂原文：
${e.transcriptContext}

输出 JSON：
{
  "deckTitle": string,
  "overview": string,
  "cards": [
    { "question": string, "answer": string, "startMs": number, "endMs": number, "hint"?: string, "difficulty"?: "core"|"challenge"|"transfer" }
  ]
}

质量合同：
- 共 8 张左右；以核心概念为主，保留 1-2 张需要比较、推理或迁移到新情境的卡
- 一张卡只检验一个认知动作；题面脱离原文也能读懂，不问“老师讲了什么”“这段主要说什么”
- answer 用 1-3 句话给出可核对的最小完整答案，不把整段转录搬过来
- hint 只能给思考方向，不能直接泄露答案关键词
- 困惑点优先覆盖，但没有课堂证据的内容宁可不出
- startMs/endMs 必须指向真正支持答案的原文位置，不能按卡片顺序平均分配

只输出 JSON，不解释。${(0,r.OU)(e.terminologyHint)}`}function l(){return"你是一位经验丰富的命题研究员，擅长设计能区分“真懂”和“以为自己懂”的测试题。学生刚上完一节课，想检验自己对课堂内容的理解程度。题目类型可以是单选、判断、填空、简答任意组合，由你按内容性质决定哪种最合适。单选题的每个干扰项都必须来自课堂内容里真实存在的、似是而非的理解偏差或易混淆概念，写成具体、自洽、有信息量的陈述；严禁出现“该片段主要讨论了X”“跳过了这个话题”“仅做了简单引用，未做实质分析”这类与具体知识无关、一眼就是模板的空话选项。如果一道题凑不出 3 个有内容的干扰项，就把它出成简答题而不是硬凑选择题。题目会显示在三栏学习界面的中间窄区，阅读成本必须低：每题只检验一个判断；中文题干尽量不超过 32 字，英文题干尽量不超过 24 个词；中文选项尽量不超过 24 字，英文选项尽量不超过 16 个词。不要反复写“根据上下文”“Based on the context”等无信息铺垫，直接提问。通常生成 4-6 道互不重复的题，内容不足时宁可少出。题面与选项优先沿用课堂原文的主要语言，explanation 使用简体中文帮助复盘。"}function c(e){return`${e.goalIntent?`他的学习目标：${e.goalIntent}

`:""}${e.anchorContext?`他听课时的困惑点（这些地方更容易出问题，值得重点检验）：
${e.anchorContext}

`:""}课堂原文：
${e.transcriptContext}

输出 JSON：
{
  "title": string,
  "strategy": string,
  "questions": [
    {
      "stem": string,
      "type": "single" | "judge" | "fill" | "short",
      "options": string[],
      "answer": string,
      "explanation": string,
      "startMs": number,
      "endMs": number
    }
  ]
}

只输出 JSON，不解释。${(0,r.OU)(e.terminologyHint)}`}function u(){return"你是一位深谙认知科学的知识架构师。你帮一位刚听完课的学生整理一张“扫一眼就能看出这节课讲了什么、几个大块”的结构图——不是详尽的课后笔记，是他余光扫到就能定位自己在课里哪一段的轻量地图。每个节点要像地图标签，用能区分含义的短语命名，不要把解释句、应用建议或多个事实塞进一个节点；完整解释留在原课堂和后续问答里。直接输出 Markdown 大纲（# 根主题 + - 子节点缩进），不要 JSON。"}function d(e){return`${e.goalIntent?`他的目标：${e.goalIntent}

`:""}${e.anchorContext?`他听课时的困惑点（这些主题值得在主干层出现）：
${e.anchorContext}

`:""}课堂原文：
${e.transcriptContext}${(0,r.OU)(e.terminologyHint)}`}function m(){return"你是考试速查表内容编辑器，不是考题预测器。把多节课堂与明确考试范围压成可打印的高密度参考页；每条必须能被原始材料支持。没有大纲、真题或老师明确措辞时，禁止写“必考、高频、一定考”。只输出 JSON。"}function p(e){return`学习目标：${e.goalIntent||"把课程内容压缩成考前可快速定位的参考页"}
学习对象：${"exam"===e.contextTier?"一门考试":"一个课程单元"}
课堂来源（共 ${e.lessonCount||1} 节）：
${e.sourceSummary}
${e.examScope?`
考试范围证据：
${e.examScope}
`:""}
应用场景：学生会打印或导出 PDF；可能在开卷考试中带入考场，也可能用于考前最后压缩。内容必须便于纸面扫读和快速定位。

请生成考试速查表内容草案，分成 4-8 个语义区块，每区块 3-10 条目。页数、纸张和排版由前端根据用户约束处理。
区块 key 从下列枚举中选（label 会在前端被映射成中文，但 key 必须是英文小写）：
  - definition   核心定义（术语 → 一句话释义）
  - formula      关键公式（含推导/条件，如有 LaTeX 写到 latex 字段）
  - process      流程步骤（有顺序的方法/算法）
  - contrast     关键对比（A vs B 的差异，一行一对）
  - pitfall      易错点（选择题/判断题常踩的坑）
  - exemplar     例题套路（只有课堂例题、练习或真题明确支持时才输出）

并非所有课堂都包含全部六类——只输出真有内容的区块。

最小输出契约：
{
  "title": "一句话标题（≤14 字，像'机器学习基础 \xb7 考试速查'）",
  "overview": "这张卡最适合的用法（一句话，≤40 字）",
  "sections": [
    {
      "key": "definition",
      "items": [
        { "term": "术语", "body": "支持 Markdown 的紧凑解释", "emphasis": "normal", "sourceId": "课堂 sessionId", "startMs": 12000, "endMs": 21000 }
      ]
    },
    {
      "key": "formula",
      "items": [
        { "term": "公式名", "body": "描述/条件", "latex": "E = mc^2", "emphasis": "strong", "startMs": 60000, "endMs": 72000 }
      ]
    }
  ]
}

质量要求：
- 默认每条 item 的 body 必须极简——通常一句话、约 60 字内，没空写废话
- body 用电报式短句：省略主语和“是 / 的 / 了”等虚词，可以用 →、⇒、vs、∴、≠ 等符号代替文字连接；单行能说完就不要换行，只有列表或小表格明显更快扫读时才用多行
- body 支持 GFM Markdown：粗体、列表、引用、代码和表格；只有对比关系用 2-5 行小表格会明显更快时才使用表格
- 流程 / 因果 / 层级或小规模数据对比只有在文字更难扫读时，才可在 body 中放一个 mermaid 代码块；仅限 flowchart / pie / xychart-beta，流程图最多 6 个节点，图中数值必须直接来自证据，禁止装饰性图表
- 公式优先写入 latex 字段；body 只补变量含义、成立条件或易错边界，不重复抄公式
- 富文本仍必须适合 2-4 栏纸面：禁止长段落、宽表格、超过 6 个节点的流程图、代码长清单
- term 是短标签（2-8 字），便于扫读
- 跨课先去重，再保留定义的适用条件、公式变量、易混对比和可执行步骤；不要把每节课摘要简单拼接
- emphasis 字段：只有老师明确“反复强调 / 划重点 / 一定考 / 这是必考点”，或真题/大纲直接支持的，标 "strong"；
  其他常规要点标 "normal"。每个 section 内 strong 不超过 1/3，否则失去“标重点”的信号意义
- 避免“嗯/呃/这个”等口头禅
- 用 startMs/endMs 指向课堂证据（毫秒）
- sourceId 必须从上面的课堂 / 大纲 / 真题来源中选择；引用大纲或真题时可省略时间
- 全部输出都必须基于下面的课堂原文，不允许编造

课堂原文：
${e.transcriptContext}

${e.anchorContext?`学习者关注点：
${e.anchorContext}
`:""}${(0,r.OU)(e.terminologyHint)}`}let g=/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,$=/\b(startMs|endMs)\s*=\s*\d+\b/gi,x=/片段\s*\d+/g;function h(e){return e.replace($," ").replace(x," ").replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g," ").replace(g," ").replace(/\s+/g," ").trim()}function f(e,t=48e3){let n=(0,r.d1)(e,{maxChars:2*t,includeIndex:!1,includeTimestamp:!1,minCharsPerSegment:56,truncationNotice:!1}).text.split("\n").map(e=>h(e)).filter(Boolean).join("\n");if(n.length<=t)return n;let a=Math.max(0,Math.floor((t-3)*.6)),i=Math.max(0,t-3-a);return`${n.slice(0,a)}...${n.slice(n.length-i)}`}function y(e){return(0,r.d1)(e,{maxChars:8e3,includeIndex:!0,includeTimestamp:!0,minCharsPerSegment:56}).text}function b(){return"你是一位严谨的中文教育音频总编导。把一节课重构成自然的双人理解型音频：围绕因果链、概念边界或方法逻辑推进，不朗读课堂摘要，不为热闹强行玩梗。只使用课堂证据，只输出 JSON。"}function S(e){return`输出 JSON：
{
  "title": "播客标题",
  "opening": "直接进入主题的开场",
  "keyTakeaways": ["听完应带走的理解"],
  "learnerProfile": "这次音频服务的学习目标",
  "structure": [{ "title": "章节标题", "focus": "本章推进什么理解", "startMs": 0, "endMs": 60000 }],
  "tone": "与学科匹配的节奏说明",
  "script": [{ "speaker": "Host A", "text": "台词" }, { "speaker": "Host B", "text": "台词" }]
}

应用目标：${h(e.goalIntent||"用走路或通勤时间重新理解这节课")}

教育价值合同：
- 音频不是逐段摘要；先找出支撑全课的因果链、概念对比或方法逻辑，再围绕它推进
- 类比只有在准确且确实降低理解门槛时使用，并同时交代类比失效的边界
- 保留课堂中的条件、不确定性和相互竞争的观点，不把复杂结论说成口号
- 双人对话每一轮都要完成提问、澄清、例子、反例或综合中的一个动作；禁止假寒暄、空夸奖和轮流念要点
- script.text 使用自然简体中文，只允许 Host A / Host B；不得出现时间戳、片段号、startMs/endMs 或制作说明
- 内容不足时宁可做更短的音频；通常控制在 6-10 分钟、约 900-1500 个汉字，不为凑时长重复
- structure 由内容决定 2-6 章，覆盖主要推进；startMs/endMs 只能从下方“章节定位证据”中选择，不能从无时间的朗读语料猜测

可朗读课堂语料（只用于脚本内容，不含定位信息）：
${e.narrationCorpus}

章节定位证据（只用于 structure 的毫秒时间，不得读进 script）：
${e.chapterEvidenceContext}

${e.anchorContext?`学习者关注点：
${e.anchorContext}
`:""}${(0,r.OU)(e.terminologyHint)}`}},51242:(e,t,n)=>{function r(e){let t=Math.max(0,Math.floor(e/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function a(e){return e.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g," ").replace(/\s+/g," ").trim()}function i(e,t){return e.length<=t?e:t<=1?e.slice(0,Math.max(0,t)):`${e.slice(0,t-1)}…`}function o(e,t={}){let n=Math.max(2e3,t.maxChars??24e3),o=t.includeIndex??!0,s=t.includeTimestamp??!1,l=Math.max(24,t.minCharsPerSegment??48),c=e.map((t,n)=>{let i=a(t.text||"");if(!i)return null;let l=[];return o&&l.push(`段${String(n+1).padStart(3,"0")}`),s&&l.push(`[${r(t.startMs)}-${r(t.endMs)}]`),t.sourceItemId&&(0===n||e[n-1]?.sourceItemId!==t.sourceItemId)&&l.push(`【来源：${a(t.sourceTitle||t.sourceItemId)}】`),{prefix:l.length>0?`${l.join(" ")} `:"",text:i}}).filter(e=>!!e);if(0===c.length)return{text:"",totalSegments:e.length,usedSegments:0,truncated:!1};let u=c.map(e=>`${e.prefix}${e.text}`).join("\n");if(u.length<=n)return{text:u,totalSegments:e.length,usedSegments:c.length,truncated:!1};let d=c.reduce((e,t)=>e+t.prefix.length+1,0),m=Math.max(l*c.length,n-d),p=Math.max(l,Math.floor(m/c.length)),g=c.map(e=>`${e.prefix}${i(e.text,p)}`).join("\n"),$=t.truncationNotice??!0?"（说明：以下转录为控制长度经过逐段压缩，每段只保留开头，“…”表示该段后续内容被省略；段号与时间戳仍是原始定位。请基于保留的内容作答，引用原话时不要把“…”前的残句当作完整原话。）\n":"";return{text:`${$}${i(g,Math.max(200,n-$.length))}`,totalSegments:e.length,usedSegments:c.length,truncated:!0}}function s(e,t=12){return e.filter(e=>!e.cancelled).slice(0,Math.max(1,t)).map((e,t)=>{let n=e.resolved?"已解决":"待澄清",r=a(e.note||"");return`${t+1}. ${n}：${r||"课堂中出现理解阻塞，请解释原因并给出应用建议。"}`}).join("\n")}function l(e){return e?.trim()?`
关键术语表（请在输出中使用正规写法，避免 ASR 误识别变体）：
${e.trim()}`:""}n.d(t,{OU:()=>l,d1:()=>o,eF:()=>s})},49607:(e,t,n)=>{n.d(t,{JX:()=>i,Ju:()=>o,SP:()=>s,gL:()=>a,y5:()=>l});var r=n(51242);function a(){return"你是一位经验丰富的学习诊断师。学生刚听完一节课，准备把这节课讲给同桌听——能讲出来的才算真的懂。你的任务是从课堂真实内容里选出 3-5 个他「应该能亲口讲出来」的目标点。选点标准：核心概念的定义与边界、因果机制（为什么会这样）、容易讲错的易混点。要选能展开讲 1-2 分钟的点，不要碎事实（年代、人名、孤立数字）。目标点必须全部来自课堂原文，不得编造原文没有的内容；每个目标都要附上你依据的原文片段。"}function i(e){return`${e.goalIntent?`学习目标：${e.goalIntent}

`:""}${e.anchorContext?`他听课时的困惑点（这些位置值得优先选）：
${e.anchorContext}

`:""}课堂原文：
${e.transcriptContext}

输出 JSON：
{
  "targets": [
    { "point": string, "why"?: string, "anchorText": string }
  ]
}

质量合同：
- 3-5 个目标，按课堂重要性排序；point 是一句话的行动目标（如「讲清楚为什么需要三次握手」），不是知识点名词
- why 用一句话说这个点为什么值得讲（可选）
- anchorText 必须是支撑这个目标的课堂原文片段（ verbatim 摘录，供系统锚定证据位置），不得改写或虚构
- 困惑点优先，但没有原文依据的点宁可少选

只输出 JSON，不解释。${(0,r.OU)(e.terminologyHint)}`}function o(e){let t=e.targets.map((e,t)=>`${t+1}. ${e.point}`).join("\n");return`你是坐在旁边听同学讲这节课的学生。${e.lessonTitle?`这节课是「${e.lessonTitle}」。`:""}${e.subject?`学科：${e.subject}。`:""}你没听过这节课，对内容一无所知，只能靠他的讲述来理解。

你的行为准则：
- 大部分时候安静听。他讲完一段，你最多用「嗯」「原来如此」「懂了」这类很短的话回应，不打断他的节奏。
- 只有两种情况才开口提问：
  (a) 你真的跟不上——他讲的东西前后矛盾、跳得太快、或用了没解释过的概念，你就老实说「这里我没跟上，为什么……？」
  (b) 他讲完了（或明显开始收尾），但下面还有目标没被讲到，你用自然的话追问，比如「那……是怎么回事？」一次只问一个，不念清单。
- 绝不讲课、绝不补充知识点、绝不纠正他（哪怕他讲错了也不纠正——他的错误稍后由系统对照课堂原声核对，不是你的事）。
- 不夸他，不评价「讲得好不好」。
- 第一句话只需请他开始讲，比如「我没听这节课，你给我讲讲吧。」

他希望讲完后能覆盖这些目标（只在你心里，不要念出来）：
${t||"（由你边听边判断这节课的核心内容）"}

全程使用简体中文，口语化，像旁边真实的同学。`}function s(){return"你是一位严谨的学习诊断师。学生把一节课讲给了同桌听，你手里有两份材料：课堂的真实转录（带时间戳，是唯一的正确性依据），和学生讲述的记录。你的任务是对照课堂转录，逐个核对每个讲述目标，判断两件事：他讲没讲对（coverage），以及他讲的时候自不自信（confidence）。判断纪律：正确性只以课堂转录为准，不用你自己的知识替他加分或扣分；confidence 只看他的措辞——「可能」「大概」「我觉得」「是不是」「应该是吧」、自我修正、含糊带过，都是不确定的信号；讲得流畅肯定才是自信；note 只写基于证据的事实核对结论（如「把 A 说成了 B」「漏掉了 C 条件」），严禁给学习建议，严禁「如果」「应该」「建议」「可以」这类措辞；他没讲到的目标一律 missed，不要推测他「可能懂」。"}function l(e){let t=e.targets.map(e=>`- ${e.id}: ${e.point}`).join("\n");return`讲述目标：
${t}

学生的讲述记录（「学生：」是他本人，「同桌：」是听讲的 AI 学生，提问仅作上下文）：
${e.teachingText}

课堂真实转录（带时间戳，是正确性的唯一依据）：
${e.transcriptContext}

输出 JSON：
{
  "headline": string,
  "items": [
    {
      "targetId": string,
      "coverage": "explained" | "partial" | "missed",
      "confidence": "confident" | "uncertain",
      "note": string,
      "anchorText"?: string
    }
  ]
}

质量合同：
- 每个目标都要有一条 item，targetId 必须原样复用输入的 id
- coverage：explained=讲到了且与课堂内容一致；partial=讲到了但有错误或重大遗漏；missed=没讲到
- confidence：confident / uncertain，只依据他讲述时的措辞
- note：一句事实核对结论；missed 时写「没有讲到这个点」即可
- anchorText：你下判断所依据的课堂原文片段（verbatim 摘录），供系统锚定证据位置；missed 时可省略
- headline：一句话总结这次讲述的整体情况，事实陈述，不给建议

只输出 JSON，不解释。`}},58279:(e,t,n)=>{n.d(t,{B7:()=>g,GD:()=>m,j4:()=>p,tz:()=>s,y2:()=>l});var r=n(87561),a=n(49411),i=n.n(a),o=n(51242);let s="app-infographic-v2-skill",l={style:"hand-drawn-edu",layout:"bento-grid",orientation:"landscape",aspectRatio:"landscape 16:9 (1280x720)",language:"Simplified Chinese (简体中文)",stylePresetLabel:"手绘教育信息图,马卡龙色块,米白纸张质感"},c=i().join(process.cwd(),"assets","infographic","baoyu-infographic"),u=null;function d(){return u||(u={basePromptTemplate:(0,r.readFileSync)(i().join(c,"references","base-prompt.md"),"utf8"),styleGuide:(0,r.readFileSync)(i().join(c,"references","styles",`${l.style}.md`),"utf8"),layoutGuide:(0,r.readFileSync)(i().join(c,"references","layouts",`${l.layout}.md`),"utf8")})}function m(){let e=d();return`你是一位教育信息设计师。把一节课提炼成"一张图带走"的横版信息图:先判断这节课最值得被看见的一个中心命题,再用极少文字呈现支撑它的结构。严格基于课堂证据,不编造老师金句、数字或关系。

视觉设计严格遵循以下设计手册(画风与版式已定,不要更换):

## 版式定义(固定使用)
${e.layoutGuide}

## 画风定义(固定使用)
${e.styleGuide}

只输出 JSON,不解释。`}function p(e){return`应用目标:${e.goalIntent||"生成一张图带走这节课"}
应用场景:学生复习时扫一眼,也可能投屏或分享到班级群;横版 16:9,视觉上先看到中心命题,再看到支撑要点。

输出 JSON:
{
  "title": "结果标题",
  "summary": "一句话摘要",
  "cards": [{ "title": "模块标题", "body": "模块正文", "bullets": ["要点"] }],
  "infographic": {
    "title": "信息图标题(≤14 字)",
    "subtitle": "副标题(≤28 字)",
    "keyPoints": ["3-5 个关键点,每条 ≤22 字"],
    "contentOutline": "图上每个格子的内容安排:hero 格放中心命题,其余格各放一个支撑要点(含一句≤40 字的说明);按系统提示的版式/画风定义描述每格配什么小插图",
    "textLabels": ["图上允许出现的全部中文文字,逐字列出:标题、副标题、每个关键点、每格说明"],
    "stylePreset": "${l.stylePresetLabel}",
    "suggestedScene": "class-take-away",
    "suggestedOrientation": "landscape",
    "suggestedDetailLevel": "standard"
  }
}

质量合同:
- 只保留一个中心命题和 3-5 个真正支撑它的要点;不要把整节课摘要塞进一张图
- textLabels 里的每一条都必须逐字来自课堂证据的提炼,图上除此之外不允许出现任何其他文字
- 老师原话只有在课堂原文有可核对措辞时才能作为引语;否则改写为知识陈述,不加引号
- 没有数值证据时不得编造数据图表;没有顺序或因果证据时不得编造流程
- 全部输出都必须基于下面的课堂原文,不允许编造

${e.anchorContext?`学习者关注点:
${e.anchorContext}

`:""}课堂原文:
${e.transcriptContext}${(0,o.OU)(e.terminologyHint)}`}function g(e){let t=d(),n=e.keyPoints.filter(Boolean),r=(e.textLabels.length>0?e.textLabels:[e.title,e.subtitle,...n]).filter(Boolean).map((e,t)=>`${t+1}. ${e}`).join("\n"),a=[`Main title: ${e.title}`,e.subtitle?`Subtitle: ${e.subtitle}`:"",n.length>0?`Key points:
${n.map((e,t)=>`${t+1}. ${e}`).join("\n")}`:"",`Cell-by-cell plan:
${e.contentOutline}`].filter(Boolean).join("\n\n");return t.basePromptTemplate.replace("{{LAYOUT}}",l.layout).replace("{{STYLE}}",l.style).replace("{{ASPECT_RATIO}}",l.aspectRatio).replaceAll("{{LANGUAGE}}",l.language).replace("{{LAYOUT_GUIDELINES}}",t.layoutGuide).replace("{{STYLE_GUIDELINES}}",t.styleGuide).replace("{{CONTENT}}",a).replace("{{TEXT_LABELS}}",r)+"\n\n硬性要求:图上文字必须逐字来自上方 Text labels 清单,禁止新增任何文字、禁止伪造数字、禁止密集小字。"}}};