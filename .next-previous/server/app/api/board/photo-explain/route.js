"use strict";(()=>{var e={};e.id=5046,e.ids=[5046],e.modules={20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},85861:e=>{e.exports=require("node:sqlite")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},26424:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>M,patchFetch:()=>P,requestAsyncStorage:()=>R,routeModule:()=>D,serverHooks:()=>J,staticGenerationAsyncStorage:()=>A});var n={};r.r(n),r.d(n,{POST:()=>v});var s=r(88255),o=r(75657),i=r(37391),a=r(43955),u=r(30357),p=r(76018);let c=(0,u.hu)("photo-problem"),l=process.env.BOARD_PHOTO_VL_MODEL?.trim()||process.env.DASHSCOPE_VL_MODEL?.trim()||"qwen3.7-plus";function m(e,t){return"string"==typeof e?e.trim().slice(0,t):""}async function d(e){let t=Date.now(),r=e.model?.trim()||l,n=await (0,p.W6)([{role:"user",content:[{type:"image_url",image_url:{url:e.imageDataUrl}},{type:"text",text:'你是一位老师，学生拍了一张照片向你请教。请看清照片内容，只输出一个 JSON 对象（不要 markdown 代码围栏）：\n{"isProblem":true|false,"subject":"数学|物理|化学|英语|语文|其他","statement":"题目完整文本","figureDesc":"图形或图表的一句话描述","figureSpec":"结构化图形档案","studentAttempt":"照片里学生已经写下的解答尝试"}\n要求：\n1. statement 必须逐字忠实于照片（数学公式用 LaTeX，行内 $...$）；印刷体与手写体都要认；看不清的字符用 ? 标出，绝不编造。\n2. 照片里有图形（几何图、函数图、图表）时，figureDesc 用一句话说清图形内容；同时给 figureSpec 结构化档案（纯文本，尽量精确）：关键点及坐标/位置、线段与角度关系（平行/垂直/相等/相切等）、图上标注的量（长度、角度、函数式）。没有图就两个字段都留空字符串。\n3. 照片里除了题目还有学生手写的解题过程/草稿/答案时，逐字转录到 studentAttempt（公式同样 LaTeX）；没有就留空字符串。\n4. 照片里根本没有题目（风景、人物、纯笔记页等），只输出 {"isProblem":false}。'}]}],r,{temperature:.1,maxTokens:1500,responseFormat:"json_object"}),s=function(e){let t;let r=e.indexOf("{"),n=e.lastIndexOf("}");if(r<0||n<=r)return null;try{t=JSON.parse(e.slice(r,n+1))}catch{return null}if(!1===t.isProblem)return null;let s=m(t.statement,1200);return s?{subject:m(t.subject,20)||"数学",statement:s,figureDesc:m(t.figureDesc,400)||void 0,figureSpec:m(t.figureSpec,800)||void 0,studentAttempt:m(t.studentAttempt,400)||void 0}:null}(n.content);return c.info("photo-problem.extracted",{model:n.model,ms:Date.now()-t,isProblem:!!s,subject:s?.subject,hasFigure:!!s?.figureDesc,hasAttempt:!!s?.studentAttempt}),s}var h=r(88562),f=r(73548),g=r(98805);let x=(0,u.hu)("photo-lecture"),w=process.env.BOARD_PHOTO_SOLVE_MODEL?.trim()||"DeepSeek-V4-Pro",y=process.env.BOARD_PHOTO_LECTURE_MODEL?.trim()||"DeepSeek-V4-Flash";async function b(e,t=w){let r=[`学科：${e.subject}`,`题目：${e.statement}`,e.figureDesc?`图形：${e.figureDesc}`:"",e.figureSpec?`图形档案：${e.figureSpec}`:"","","请完整解出这道题。输出：最终答案（明确标出）+ 关键步骤（每步一行，写清用了什么公式或定理）。控制在 600 字内，不要寒暄。"].filter(Boolean).join("\n"),n=await (0,p.W6)([{role:"user",content:r}],t,{temperature:.2,maxTokens:8192}),s=n.content.trim().slice(0,4e3);if(!s)throw Error("解题通道没有产出参考解答");return x.info("photo-lecture.solved",{model:n.model,chars:s.length}),s}function O(e){return e.pages.some(e=>e.segments.some(e=>"checkpoint"===e.type?e.demoActions.length>0:e.actions.length>0))}async function k(e){let t=e.model?.trim()||y||p.fr,r=await (0,p.W6)([{role:"system",content:`你是一位顶级一对一家教。学生拍了一道他正在做的题来请教你，你要在黑板前边写边讲，把这道题讲透——讲到他觉得自己也能独立做出来。你要输出一份板书脚本（JSON），驱动一个黑板播放器。

【输出契约】只输出一个 JSON 对象（不要用 markdown 代码围栏；JSON 结构紧凑输出，不要缩进和多余换行——但字符串内容里的英文必须保留单词间正常空格）：
{
  "title": "这道题的核心考点（10字内）",
  "pages": [
    { "segments": [
      { "narration": "一口气说完的话（一两句完整的话，15-45字，口语，像真实家教当面讲题）",
        "breathMs": 这口气讲完后的停顿毫秒数（可省，默认 700；换气 300-600，关键处 800-1500，上限 2500）,
        "actions": [ ...这口气里手上做的事，0-2 个板书动作... ] },
      { "type": "checkpoint",
        "narration": "你提问的话",
        "question": { "text": "写上黑板的小问题", "role": "term|step" },
        "hints": ["第一级提示：只给方向", "第二级提示：给一半", "第三级提示：差一步到答案"],
        "answer": "口述答案解析",
        "demoActions": [ ...完整示范的板书动作... ] }
    ]}
  ],
  "quotes": []
}
（普通段不写 type 字段；checkpoint 段写 "type":"checkpoint"；quotes 永远输出空数组——这道题没有"老师原话"可引用，禁止编造引用。）

【动作类型】（只有这七种；按顺序输出 write，播放器自动排版，不需要你给位置）
{"type":"write","text":"要写的内容","role":"title|term|step|note"}
  title=课题（每页最多一个，置顶）；term=关键概念/公式（黄粉笔：必须记住的重点）；step=推导步骤；note=小字注释
{"type":"circle","target":"w3"}      —— 手绘圆圈住本页第 3 个 write；多个目标用数组 ["w2","w4"]（含两端）
{"type":"underline","target":"w3"}   —— 下划线，target 规则同上
{"type":"arrow","from":"w1","to":"w3","label":"可选小字"} —— 从 w1 连接到 w3
{"type":"mark","mark":"check|cross","target":"w2"} —— 在 w2 旁打勾/打叉
{"type":"pause","ms":800} —— 停顿让学生消化
{"type":"ref","page":1,"target":"w2"} —— 回看第 1 页的第 2 个 write（切过去高亮一下再回来，全篇最多用 2 次）
（wN = 本页第 N 个 write，从 1 开始数，跨 segment 累计；标注只能引用本页已写出的 write）

【板书成品】一节课结束，黑板本身就是作品：课题醒目置顶（写完顺手在下面画一道线）；同类内容成行成组，并列的要点用序号分点（1. 2. 3.）；每一行都是值得学生拍照记住的东西，解释性的话留在嘴里不上板；一页正文不超过 6 行，疏朗不拥挤；全课最重要的 1-2 处用圈或下划线标出——学生事后复习，第一眼就该看到它们。term 是黄粉笔——必须记住的重点才配用，想清楚每一行值不值得。

【一口气一段（最重要）】讲课是按呼吸走的：说一口气，手上写一两笔，换口气再讲。所以一个 segment 就是一口气——一两句完整的话（15-45字），配 0-2 个板书动作；要往黑板上写东西的那口气，说的就是它（cue 锚在词上）。讲一个完整的想法往往需要几口气，那就拆成几个 segment（纯讲的口气 actions 为空，手是停着的）；绝不把上百字的长讲稿塞进一个 segment——讲稿一长，嘴和手的配合就散了。

【嘴手一体（内联 cue）】你是一个人，不是"一个讲的加一个写的"：写任何东西的时候嘴里正在说的就是它——边写边念，嘴比手快半拍；大段讲解的时候手是停着的，那些时段不要排书写动作。把 [aN] 放在你开始讲述第 N 个动作内容的那个词后面——说到它，笔开始写它。N 是本段 actions 数组下标（从 0 开始）。每个动作最多一个 cue；没有 cue 的动作按顺序自动排。

【三阶段渐进放手（checkpoint）】在这道题最容易卡住的那一步插 1 个 checkpoint：提一个检验理解的小问题（学生能口述或心算回答，写到黑板上）。提问指向的黑板内容必须已经写在前面的板面上（"看黑板上的 X"时 X 已在板上），也不考答案已经写在黑板上的东西。hints 三级递进：第一级只给方向不给方法、第二级给一半思路、第三级差一步就到答案。answer 是完整解析（口语）。demoActions 是拿到答案后的完整演示范例（write 为主，可配圈和下划线）。checkpoint 放在中间页，不要放在第 1 页或最后 1 页。

【讲题结构（3-5 页）】
1. 第 1 页 = 审题：把题目抄上黑板（step 分行），边抄边把关键条件圈出来、在图形描述处补一句大白话；开场一句话点破这道题为什么容易卡（"这题看着是 A，其实考的是 B"），让学生先感到"原来坑在这"
2. 中间页 = 思路 + 逐步解答：先一句大白话说清入手方向（"我看到…所以第一步先试…"——把思考过程说出口，不只写正确步骤），再用 step 逐步推导；最硬的那一步插 checkpoint
3. 最后 1 页 = 易错点对照（正确做法用 check、典型错误用 cross，说清错的是哪一步、为什么）+ 一句话总结这类题的通法 + 一句具体的鼓励（针对题目，不空喊）

【教学硬规则】
1. 数学正确性铁律：最终答案与每一步推导必须严格遵循给出的参考解答；数字、符号、公式绝不许凭感觉改写；参考解答里没有的中间技巧不要发明
2. 板书疏朗有型：每页 4-8 个 write，字少而精（term 不超过 12 字，step 不超过 20 字）；并列的要点用序号分点；绝不允许一页只有两三行字，也不允许写满整板
3. 少写多讲：write 只写关键条件、公式、步骤骨架，绝不大段照抄讲解
4. 嘴手一体：写的时候嘴里说的就是手上写的——说到哪个条件就圈哪个，说到哪步就写哪步；纯讲解的时段不排书写动作；重要步骤用 cue 对齐到词
5. narration 口语化、有节奏（"好，那我们看…""注意，关键来了"），追求"你看，这一步恰好卡进去了"的爽感；零 emoji、零符号图标
6. 公式在 write 文本里用 LaTeX（行内 $...$），narration 里说人话（"x 平方减 4x"）
7. 若学生照片里已有尝试：第 1 页先肯定他走对的地方，再指出卡住的点，讲解围绕他的卡点展开`},{role:"user",content:function(e){let t=[];return t.push(["学生拍来的题目（学科："+e.subject+"）：",e.statement].join("\n")),e.figureDesc?.trim()&&t.push(["题目里的图形：",e.figureDesc.trim()].join("\n")),e.figureSpec?.trim()&&t.push(["图形档案（解题与画图依据）：",e.figureSpec.trim()].join("\n")),e.studentAttempt?.trim()&&t.push(["学生已经写在照片里的尝试（先肯定走对的地方，再围绕卡点讲）：",e.studentAttempt.trim()].join("\n")),t.push(["参考解答（独立解题通道产出，你的最终答案与每步推导必须与它一致；它是数学正确性的锚，不必照抄它的表述）：",e.referenceSolution].join("\n")),t.push("现在输出 JSON：一个 title、pages 板书脚本（审题 → 思路与逐步解答 → 易错点与通法总结；中间页插 1 个 checkpoint；重要步骤用 cue 对齐到词）、quotes 输出空数组。"),t.join("\n\n")}({subject:e.problem.subject,statement:e.problem.statement,figureDesc:e.problem.figureDesc,studentAttempt:e.problem.studentAttempt,referenceSolution:e.referenceSolution})}],t,{temperature:.5,maxTokens:32e3,responseFormat:"json_object",thinking:!1}),n=(0,f.QW)(r.content);if(!n)return null;let{script:s,dropped:o}=(0,g.p)(n);return O(s)?(x.info("photo-lecture.generated",{model:r.model,pages:s.pages.length,dropped:o}),{script:s,dropped:o}):null}let S=process.env.BOARD_PHOTO_MODE?.trim()||"oneshot",j=process.env.BOARD_PHOTO_ONESHOT_MODEL?.trim()||"qwen3.7-plus";async function q(e){let t=await (0,p.W6)([{role:"system",content:`你是一位顶级一对一家教，学生拍了一道他正在做的题来请教你（照片里有题目，可能还有他自己写的尝试）。先在脑里把这道题完整解对，然后像真实家教一样，在黑板前边写边讲给它讲透。

你不需要任何教学模板——你就是那个老师，你知道好的一对一是什么样的：先让学生在乎这道题，把思考过程说出口（"我看到…所以我先试…"而不是只写正确答案），讲到关键处会停下来让学生看一眼黑板，会在最容易卡的地方考他一下，最后让他觉得"这题我自己也能做出来"。如果照片里有学生写过的尝试，先看见他——肯定走对的地方，再指出他具体卡在哪。checkpoint 的目标是检验学生真的懂了：只考学生还没被告诉答案的东西，答案已经写在黑板上的提问是假互动。节奏、详略、停顿由你这位老师自己把握。

【输出契约】只输出一个 JSON 对象（不要 markdown 代码围栏，结构紧凑；字符串里的英文保留单词间正常空格）：
{
  "title": "这节课的题目（10字内）",
  "pages": [
    { "segments": [
      { "narration": "一口气说完的话（一两句完整的话，15-45字，口语，像当面讲题）",
        "breathMs": 这口气讲完后的停顿毫秒数（可省，默认 700；换气 300-600，关键处 800-1500，上限 2500）,
        "actions": [ ...这口气里手上做的事，0-2 个板书动作... ] },
      { "type": "checkpoint",
        "narration": "你提问的话",
        "question": { "text": "写上黑板的小问题", "role": "term|step" },
        "hints": ["提示一", "提示二", "提示三"],
        "answer": "口述答案解析",
        "demoActions": [ ...完整示范的板书动作... ] }
    ]}
  ],
  "quotes": []
}
（普通段不写 type 字段；checkpoint 段写 "type":"checkpoint"，hints 必须恰好 3 条；quotes 永远输出空数组。）

【动作类型】（只有这七种；按顺序输出 write，播放器自动排版，不需要你给位置）
{"type":"write","text":"要写的内容","role":"title|term|step|note"}
  title=课题（每页最多一个，置顶）；term=关键概念/公式（黄粉笔：必须记住的重点）；step=推导步骤；note=小字注释
{"type":"circle","target":"w3"}      —— 手绘圆圈住本页第 3 个 write；多个目标用数组 ["w2","w4"]（含两端）
{"type":"underline","target":"w3"}   —— 下划线，target 规则同上
{"type":"arrow","from":"w1","to":"w3","label":"可选小字"} —— 从 w1 连接到 w3
{"type":"mark","mark":"check|cross","target":"w2"} —— 在 w2 旁打勾/打叉
{"type":"pause","ms":800} —— 停顿让学生消化
{"type":"ref","page":1,"target":"w2"} —— 回看第 1 页的第 2 个 write（全篇最多用 2 次）
（wN = 本页第 N 个 write，从 1 开始数，跨 segment 累计；标注只能引用本页已写出的 write）

【板书成品】一节课结束，黑板本身就是作品：课题醒目置顶（写完顺手在下面画一道线）；同类内容成行成组，并列的要点用序号分点（1. 2. 3.）；每一行都是值得学生拍照记住的东西，解释性的话留在嘴里不上板；一页正文不超过 6 行，疏朗不拥挤；全课最重要的 1-2 处用圈或下划线标出——学生事后复习，第一眼就该看到它们。term 是黄粉笔——必须记住的重点才配用，想清楚每一行值不值得。

【一口气一段（最重要）】讲课是按呼吸走的：说一口气，手上写一两笔，换口气再讲。所以一个 segment 就是一口气——一两句完整的话（15-45字），配 0-2 个板书动作；要往黑板上写东西的那口气，说的就是它（cue 锚在词上）。讲一个完整的想法往往需要几口气，那就拆成几个 segment（纯讲的口气 actions 为空，手是停着的）；绝不把上百字的长讲稿塞进一个 segment——讲稿一长，嘴和手的配合就散了。

【嘴手一体（最重要）】你是一个人，不是"一个讲的加一个写的"：在黑板上写任何东西的时候，嘴里正在说的就是它——边写边念，嘴比手快半拍，手追着嘴；写完一步就指着它讲，圈和下划线落在"看这里""这个很关键"这类指涉词上；大段讲解、分析题意的时候手是停着的，那些时段不要排书写动作。任何瞬间，学生听到的和手上正在做的，指向同一个东西。把 [aN] 放在你开始讲述第 N 个动作内容的那个词后面——说到它，笔开始写它（N 是本段 actions 下标，从 0 开始）。每个动作给一个 cue 锚点；没有锚点的动作会由播放器均匀兜底，效果不如你亲手标的。

【数学正确性铁律】脚本里每一步推导、每个数字都必须经得起验算，最终答案明确给出；公式在 write 文本里用 LaTeX（行内 $...$），narration 里说人话。

照片里根本没有题目（风景、人物、纯笔记页等）时，只输出 {"error":"not_a_problem"}。`},{role:"user",content:[{type:"image_url",image_url:{url:e}},{type:"text",text:"这是学生拍来的照片。看清题目（和他写的尝试，如果有的话），先解对，再按你的方式讲给他听。"}]}],j,{temperature:.5,maxTokens:32e3,responseFormat:"json_object"}),r=(0,f.QW)(t.content);if(!r||"object"!=typeof r||"error"in r)return null;let{script:n,dropped:s}=(0,g.p)(r);return O(n)?(x.info("photo-lecture.oneshot",{model:t.model,pages:n.pages.length,dropped:s}),n):null}async function _(e){let t;if("staged"!==S){let t=await q(e);return t?{problem:{subject:"",statement:""},referenceSolution:"",script:t,models:{vision:j,solve:j,lecture:j}}:null}let r=await d({imageDataUrl:e,model:l});if(!r)return null;let n=await b(r),s=await k({problem:r,referenceSolution:n});if(!s)throw Error("板书脚本生成失败");let o=s.script;if((0,h.bY)()){let e=await (0,h._u)(o,{perPageTimeoutMs:8e3});o=e.script,e.directedPages>0&&(t=e.model)}return{problem:r,referenceSolution:n,script:o,models:{vision:l,solve:w,lecture:y,...t?{director:t}:{}}}}let N=(0,u.hu)("api-board-photo-explain");async function v(e){let t;try{t=await e.json()}catch{return a.NextResponse.json({error:"请求体必须是 JSON"},{status:400})}let{image:r}=t;if("string"!=typeof r||!r.startsWith("data:image/")||r.length>6e6)return a.NextResponse.json({error:"需要 image（data:image/...，≤4.5MB）"},{status:400});try{let e=await _(r);if(!e)return a.NextResponse.json({error:"not_a_problem"},{status:422});return a.NextResponse.json({script:e.script,problem:e.problem,models:e.models})}catch(e){return N.error("photo-explain failed",{error:e instanceof Error?e.message:String(e)}),a.NextResponse.json({error:"讲解生成暂时不可用"},{status:502})}}let D=new s.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/board/photo-explain/route",pathname:"/api/board/photo-explain",filename:"route",bundlePath:"app/api/board/photo-explain/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/board/photo-explain/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:R,staticGenerationAsyncStorage:A,serverHooks:J}=D,M="/api/board/photo-explain/route";function P(){return(0,i.patchFetch)({serverHooks:J,staticGenerationAsyncStorage:A})}},88562:(e,t,r)=>{r.d(t,{_u:()=>c,bY:()=>u});var n=r(30357),s=r(76018),o=r(76598);let i=(0,n.hu)("board-director"),a=process.env.BOARD_DIRECTOR_MODEL?.trim()||"kimi/kimi-k3";function u(e){let t=e?.trim()||process.env.BOARD_DIRECTOR_MODEL?.trim();return void 0!==t&&""!==t&&void 0!==(0,s.P6)(t)}async function p(e,t){let r=e.segments.map((t,r)=>(function(e,t){let r=e.segments[t];if(!r||"checkpoint"===r.type)return null;let n={write:"写",circle:"圈",underline:"下划线",arrow:"箭头",mark:"勾叉",pause:"停顿",ref:"回看"};return{index:t,display:(0,o.LY)(r),actions:r.actions.map((e,t)=>({index:t,kind:n[e.type]??e.type,summary:"write"===e.type?`${e.role}「${e.text.slice(0,20)}」`:"pause"===e.type?`${e.ms}ms`:"ref"===e.type?`第${e.page}页 ${e.target}`:JSON.stringify("target"in e?e.target:"").slice(0,40)})),existingCues:(r.cues??[]).map(e=>({actionIndex:e.actionIndex,charIndex:e.charIndex}))}})(e,r)).filter(e=>null!==e&&e.actions.length>0);return 0===r.length?new Map:function(e,t){let r;let n=new Map,s=e.indexOf("{"),i=e.lastIndexOf("}");if(s<0||i<=s)return n;try{r=JSON.parse(e.slice(s,i+1))}catch{return n}if(!Array.isArray(r.segments))return n;for(let e of r.segments){let r;let s="number"==typeof e.segment?e.segment:-1,i=t.segments[s];if(!i||"checkpoint"===i.type)continue;let a=(0,o.LY)(i),u=[],p=new Set;if(Array.isArray(e.cues))for(let t of e.cues){let e="number"==typeof t.actionIndex?t.actionIndex:-1,r="number"==typeof t.charIndex?t.charIndex:-1;!(e<0||e>=i.actions.length||p.has(e))&&(r<0||r>a.length||(p.add(e),u.push({actionIndex:e,charIndex:Math.round(r)})))}"number"==typeof e.breathMs&&Number.isFinite(e.breathMs)&&(r=Math.min(2500,Math.max(0,Math.round(e.breathMs)))),(u.length>0||void 0!==r)&&n.set(s,{cues:u,breathMs:r})}return n}((await (0,s.W6)([{role:"system",content:`你是一位讲课节奏导演。编剧已经写好了黑板课的讲稿和板书动作，你的唯一职责是节奏设计——让每一个板书动作落在最自然的那个词上，让该停的地方停一拍。不要改动任何讲稿文字和动作内容。

【输入】一页板书课：若干 segment，每个 segment 有讲稿 display（学生听到的口语）和 actions（板书动作，带下标）。

【输出】只输出一个 JSON 对象（不要 markdown 代码围栏，紧凑无缩进）：
{"segments":[{"segment":0,"cues":[{"actionIndex":1,"charIndex":23}],"breathMs":800}]}

【cue 规则】（charIndex = display 文本里的字符下标，从 0 开始，空格也算）
1. 每个动作都必须给一个 cue——嘴上开始讲它，笔开始落（嘴手一体，书写与讲解共现）：
   - write（写字/公式/步骤）：锚在开始讲述这个内容的那个词之后（"我们来看这个公式"的"公式"）——说到它，笔开始写它；
   - circle/underline（圈/下划线）：锚在说"注意""关键""这里"这类指涉词处；
   - arrow/mark（箭头/勾叉）：锚在指代它的话处（"所以""这就对了"）；
   - pause：锚在希望学生消化一下的位置。
2. 讲稿里找不到对应内容时，锚在语义最接近的词上，宁晚勿早——写早了是"一个人在讲、另一个人在写"，写晚了只是老师说完补完最后一笔。
3. 每个动作只给一个 cue；不同动作的 charIndex 可以相同（同时落笔）。

【breathMs 规则】（本段讲完后老师的停顿，毫秒；不给 = 默认 400）
- 关键结论、揭晓答案、易错点强调之后：800-1500（让学生看一眼黑板消化）；
- 普通过渡：不给或 400；
- 马上要提问/做 checkpoint 的段：200-400（节奏紧凑）；
- 上限 2500，整页最多两段超过 800（停顿多了课就散了）。`},{role:"user",content:["这一页的讲稿与动作如下，请给出每个动作的 cue 和每段的 breathMs：",...r.map(e=>{let t=e.actions.map(e=>`  [${e.index}] ${e.kind}: ${e.summary}`).join("\n"),r=e.existingCues.length>0?`
  编剧已给的 cue：${e.existingCues.map(e=>`a${e.actionIndex}@${e.charIndex}`).join(", ")}（可保留可调整）`:"";return`segment ${e.index}（display 共 ${e.display.length} 字）：
"""${e.display}"""
动作：
${t}${r}`})].join("\n\n")}],t,{temperature:.3,maxTokens:8e3,responseFormat:"json_object",thinking:!1})).content,e)}async function c(e,t){let r=t?.model?.trim()||a,n=t?.perPageTimeoutMs??15e3,s=await Promise.all(e.pages.map(async e=>{try{let t=await Promise.race([p(e,r),new Promise((e,t)=>setTimeout(()=>t(Error("director timeout")),n))]);return{segments:e.segments.map((e,r)=>{if("checkpoint"===e.type)return e;let n=t.get(r);return n?{...e,cues:n.cues.length>0?n.cues:e.cues,...void 0!==n.breathMs?{breathMs:n.breathMs}:{}}:e}),directed:t.size>0}}catch(t){return i.warn("board director 单页失败，保留原节奏",{error:t instanceof Error?t.message:String(t)}),{segments:e.segments,directed:!1}}})),o=s.filter(e=>e.directed).length;return i.info("board-director.done",{model:r,directedPages:o,totalPages:s.length}),{script:{...e,pages:s.map(e=>({segments:e.segments}))},directedPages:o,totalPages:s.length,model:r}}},73548:(e,t,r)=>{function n(e){try{return JSON.parse(e),e}catch{}let t=[],r=0,n=e.length;function s(){for(;r<n&&(" "===e[r]||"	"===e[r]||"\r"===e[r]||"\n"===e[r]);)t.push(e[r]),r++}function o(){if(!(r>=n)&&'"'===e[r]){for(t.push('"'),r++;r<n;){let s=e[r];if("\\"===s){t.push(s),++r<n&&(t.push(e[r]),r++);continue}if('"'===s){let s=r+1;for(;s<n&&(" "===e[s]||"	"===e[s]||"\r"===e[s]||"\n"===e[s]);)s++;let o=s<n?e[s]:"";if(":"===o||","===o||"}"===o||"]"===o||""===o){if(","===o||"}"===o||"]"===o){if(function(e,t,r){if("}"===r||"]"===r)return!0;let n=t+1;for(;n<e.length&&(" "===e[n]||"	"===e[n]||"\r"===e[n]||"\n"===e[n]);)n++;if(n>=e.length)return!0;if('"'===e[n]){let t=e.slice(n,n+80);return!!/^"[^"]{1,40}"\s*:/.test(t)||(/^"[^"]*"\s*[,\]]/.test(t),!0)}return!!("{"===e[n]||"["===e[n]||/[0-9tfn\-]/.test(e[n]))}(e,s,o)){t.push('"'),r++;return}t.push("\\",'"'),r++;continue}t.push('"'),r++;return}t.push("\\",'"'),r++;continue}t.push(s),r++}t.push('"')}}s(),r<n&&function i(){if(s(),r>=n)return;let a=e[r];if('"'===a)o();else if("{"===a)(function(){if(!(r>=n)&&"{"===e[r]){if(t.push("{"),r++,s(),r<n&&"}"===e[r]){t.push("}"),r++;return}for(;r<n&&(s(),!(r>=n));){if("}"===e[r]){t.push("}"),r++;return}if(o(),s(),r<n&&":"===e[r]&&(t.push(":"),r++),s(),i(),s(),r<n&&","===e[r])t.push(","),r++;else if(r<n&&"}"===e[r]){t.push("}"),r++;return}else break}}})();else if("["===a)(function(){if(!(r>=n)&&"["===e[r]){if(t.push("["),r++,s(),r<n&&"]"===e[r]){t.push("]"),r++;return}for(;r<n&&(s(),!(r>=n));){if("]"===e[r]){t.push("]"),r++;return}if(i(),s(),r<n&&","===e[r])t.push(","),r++;else if(r<n&&"]"===e[r]){t.push("]"),r++;return}else break}}})();else for(;r<n&&","!==e[r]&&"}"!==e[r]&&"]"!==e[r]&&"\n"!==e[r];)t.push(e[r]),r++}();let i=t.join("");try{return JSON.parse(i),i}catch{return e}}function s(e){let t=e.indexOf('"questions"');if(-1===t)return null;let r=e.indexOf("[",t);if(-1===r)return null;let n=-1,s=0,o=!1;for(let t=r+1;t<e.length;t++){let r=e[t];if("\\"===r&&o){t++;continue}if('"'===r){o=!o;continue}o||("{"===r&&s++,"}"!==r||0!=--s||(n=t))}return -1===n?null:e.slice(0,n+1)+"]}"}function o(e,t=!1){let r=t?console.log.bind(console):()=>{};r("[parseJsonResponse] 开始解析，内容长度:",e.length);let o=e.trim(),i=o.match(/```(?:json)?\s*([\s\S]*?)```/);if(i&&(o=i[1].trim(),r("[parseJsonResponse] 移除代码块包裹")),!o.startsWith("{")&&!o.startsWith("[")){let e=o.indexOf("{");-1!==e&&(o=o.slice(e),r("[parseJsonResponse] 跳过前导文字"))}try{let e=JSON.parse(o);return r("[parseJsonResponse] 直接解析成功"),e}catch{r("[parseJsonResponse] 直接解析失败，尝试修复")}let a=n(o);if(a!==o)try{let e=JSON.parse(a);return r("[parseJsonResponse] 引号修复后解析成功"),e}catch{r("[parseJsonResponse] 引号修复后仍失败")}let u=a!==o?a:o,p=s(u);if(p)try{let e=JSON.parse(p);return r("[parseJsonResponse] 截断修复后解析成功"),e}catch{let e=n(p);try{let t=JSON.parse(e);return r("[parseJsonResponse] 截断+引号修复后解析成功"),t}catch{r("[parseJsonResponse] 截断修复后解析失败")}}if(o!==u){let e=s(o);if(e){let t=n(e);try{let e=JSON.parse(t);return r("[parseJsonResponse] 原始截断+引号修复后解析成功"),e}catch{r("[parseJsonResponse] 原始截断修复也失败")}}}return r("[parseJsonResponse] 所有策略均失败，返回 null"),null}r.d(t,{QW:()=>o})}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),n=t.X(0,[6662,9811,3219,8261,6018,8805],()=>r(26424));module.exports=n})();