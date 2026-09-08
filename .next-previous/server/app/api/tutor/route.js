"use strict";(()=>{var e={};e.id=8837,e.ids=[8837],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},16153:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>U,patchFetch:()=>L,requestAsyncStorage:()=>T,routeModule:()=>C,serverHooks:()=>E,staticGenerationAsyncStorage:()=>O});var n={};r.r(n),r.d(n,{POST:()=>j});var i=r(88255),o=r(75657),s=r(37391),a=r(43955),l=r(76018);function u(e){let t=Math.floor(e/1e3);return`${Math.floor(t/60).toString().padStart(2,"0")}:${(t%60).toString().padStart(2,"0")}`}var c=r(30357);let p=(0,c.hu)("dify");class d{constructor(e){this.config={timeout:3e4,...e}}async runWorkflow(e){let t=`${this.config.baseUrl}/v1/workflows/run`,r={inputs:{timestamp:e.timestamp.toString(),context:e.context,subject:e.subject||"",enable_guidance:e.enable_guidance?"true":"false",enable_web:e.enable_web?"true":"false",selected_option_id:e.selected_option_id||"",student_question:e.student_question||""},response_mode:"blocking",conversation_id:e.conversation_id||"",user:"student-user"};try{let e=await fetch(t,{method:"POST",headers:{Authorization:`Bearer ${this.config.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(r),signal:AbortSignal.timeout(this.config.timeout)});if(!e.ok){let t=await e.json().catch(()=>({}));throw new f(`Dify API error: ${e.status}`,e.status,t)}let n=await e.json();return this.parseWorkflowOutput(n)}catch(e){if(e instanceof f)throw e;throw new f(`Dify request failed: ${e instanceof Error?e.message:"Unknown error"}`,0)}}async *runWorkflowStream(e){let t=`${this.config.baseUrl}/v1/workflows/run`,r={inputs:{timestamp:e.timestamp.toString(),context:e.context,subject:e.subject||"",enable_guidance:e.enable_guidance?"true":"false",enable_web:e.enable_web?"true":"false",selected_option_id:e.selected_option_id||"",student_question:e.student_question||""},response_mode:"streaming",conversation_id:e.conversation_id||"",user:"student-user"},n=await fetch(t,{method:"POST",headers:{Authorization:`Bearer ${this.config.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(r)});if(!n.ok)throw new f(`Dify API error: ${n.status}`,n.status);let i=n.body?.getReader();if(!i)throw new f("No response body",0);let o=new TextDecoder,s="";try{for(;;){let{done:e,value:t}=await i.read();if(e)break;let r=(s+=o.decode(t,{stream:!0})).split("\n");for(let e of(s=r.pop()||"",r))if(e.startsWith("data: ")){let t=e.slice(6);if("[DONE]"===t)return;try{let e=JSON.parse(t);yield e}catch{}}}}finally{i.releaseLock()}}parseWorkflowOutput(e){let t,r;let n=e.data?.outputs??{};if(n.guidance_question)try{let e="string"==typeof n.guidance_question?JSON.parse(n.guidance_question):n.guidance_question;e&&"object"==typeof e&&(t=e)}catch{p.warn("Failed to parse guidance_question")}if(n.citations)try{let e="string"==typeof n.citations?JSON.parse(n.citations):n.citations;Array.isArray(e)&&(r=e)}catch{p.warn("Failed to parse citations")}return{answer:"string"==typeof n.answer?n.answer:"",guidance_question:t,option_followup:"string"==typeof n.option_followup?n.option_followup:void 0,citations:r||[],conversation_id:e.conversation_id,metadata:{model:"string"==typeof n.model?n.model:"unknown",total_tokens:"number"==typeof n.total_tokens?n.total_tokens:0,workflow_run_id:e.workflow_run_id||""}}}}class f extends Error{constructor(e,t,r){super(e),this.statusCode=t,this.details=r,this.name="DifyError"}}let m=null;var h=r(39498),g=r(99974),y=r(2854);let w=new Map;function x(e,t){let r=(e||"").replace(/\s+/g," ").trim();return r?r.length<=t?r:`${r.slice(0,t-1)}...`:""}function _(e,t){if(!e||0===t.length)return[];let r=function(e){let t=new Set;for(let r of e.matchAll(/\[资料\s*(\d+)\]/g)){let e=Number.parseInt(r[1]||"",10);Number.isFinite(e)&&e>0&&t.add(e)}return Array.from(t).sort((e,t)=>e-t)}(e);if(0===r.length)return[];let n=new Map(t.map(e=>[e.index,e])),i=[];for(let e of r){let t=n.get(e);t&&i.push({id:`support-${e}`,title:t.title||`导入资料 ${e}`,url:`about:blank#support-${e}`,snippet:t.snippet,source_type:"knowledge_base"})}return i}function $(e,t){let r=[],n=new Set,i=e=>{for(let t of e||[]){if(!t)continue;let e=`${t.source_type}:${t.title}:${t.url}`.toLowerCase();n.has(e)||(n.add(e),r.push(t))}};return i(e),i(t),r.length>0?r:void 0}function b(e){let{mergedCitations:t,supportReferences:r,questionHint:n}=e;return 0===r.length||(t||[]).some(e=>"knowledge_base"===e.source_type)||!function(e,t){let r=(e||"").trim();if(!r||0===t.length)return!1;if(r&&/(文档|资料|讲义|课件|pdf|docx|ppt|pptx|导入|上传|参考|引用|source|document|material)/i.test(r))return!0;let n=function(e){let t=(e||"").toLowerCase().trim();return t?Array.from(new Set([...Array.from(t.matchAll(/[a-z0-9]{3,}/g)).map(e=>e[0]),...Array.from(t.matchAll(/[\u4e00-\u9fff]{2,}/g)).map(e=>e[0]).flatMap(e=>{if(e.length<=4)return[e];let t=[];for(let r=0;r<e.length-1;r+=1)t.push(e.slice(r,r+2));return t})])).slice(0,32):[]}(r);if(0===n.length)return!1;let i=t.map(e=>`${e.title} ${e.snippet}`.toLowerCase()).join("\n"),o=0,s=0;for(let e of n)if(e&&!(e.length<2)&&i.includes(e)&&(o+=1,s=Math.max(s,e.length),o>=3))break;return o>=2||o>=1&&s>=6}(n,r)?t:$(t,function(e,t=2){return e.slice(0,t).map(e=>({id:`support-${e.index}`,title:e.title||`导入资料 ${e.index}`,url:`about:blank#support-${e.index}`,snippet:x(e.snippet,220),source_type:"knowledge_base"}))}(r))}var k=r(78697);let q=(0,c.hu)("tutor-guidance"),v=["concept","procedure","calculation","comprehension","application"];async function S({context:e,modelId:t,studentQuestion:r,selectedOptionId:n}){try{let i=await M({context:e,modelId:t,studentQuestion:r,selectedOptionId:n});if(i)return i}catch(e){q.error("[Tutor API] Guidance generation fallback:",e)}return function(e,t){let r=e.split("\n").filter(e=>e.trim()),n=[];for(let e of r){let t=e.match(/\[(\d{1,2}:\d{2}-\d{1,2}:\d{2})\]\s*(.+)/);t&&n.push({time:t[1],text:t[2]})}let i=n.map(e=>e.text).join(" ").toLowerCase();if(i.includes("name")||i.includes("bond")||i.includes("jane")||i.includes("hello")||i.includes("nice to meet"))return{id:"guidance-english-name",question:"听到这段对话时，你是在哪个环节感到困惑的？",type:"single_choice",options:[{id:"opt-1",text:'不理解为什么名字会重复说两遍（如 "Jane, Jane Bond"）',category:"comprehension"},{id:"opt-2",text:"分不清昵称（first name）和全名（full name）的区别",category:"concept"},{id:"opt-3",text:"听不清具体发音，不确定说的是什么词",category:"comprehension"},{id:"opt-4",text:"不理解这种自我介绍的文化背景或语法结构",category:"application"}],hint:"选择最接近你困惑的选项，帮助我精准定位问题"};if(i.includes("公式")||i.includes("=")||i.includes("\xb2")||i.includes("函数")||i.includes("方程"))return{id:"guidance-math-formula",question:"关于这个数学内容，你具体卡在哪个环节？",type:"single_choice",options:[{id:"opt-1",text:"不理解公式中字母/符号的含义",category:"concept"},{id:"opt-2",text:"不知道这个公式是怎么推导出来的",category:"procedure"},{id:"opt-3",text:"公式我懂，但不知道什么情况下该用它",category:"application"},{id:"opt-4",text:"代入计算时总是出错",category:"calculation"}],hint:"选择最接近你困惑的选项"};if(i.includes("图像")||i.includes("图形")||i.includes("抛物线")||i.includes("开口")||i.includes("坐标"))return{id:"guidance-graph",question:"关于图像这部分，你是在哪里卡住了？",type:"single_choice",options:[{id:"opt-1",text:"不理解图像和公式之间的对应关系",category:"concept"},{id:"opt-2",text:"不知道怎么根据条件画出图像",category:"procedure"},{id:"opt-3",text:"看不懂图像上各个点/线的意义",category:"comprehension"},{id:"opt-4",text:"不理解参数变化对图像的影响",category:"concept"}],hint:"选择最接近你困惑的选项"};if(i.includes("实验")||i.includes("反应")||i.includes("现象")||i.includes("能量")||i.includes("力"))return{id:"guidance-experiment",question:"关于这个知识点，你具体在哪里感到困惑？",type:"single_choice",options:[{id:"opt-1",text:"不理解基本概念或原理",category:"concept"},{id:"opt-2",text:"不知道实验步骤或操作方法",category:"procedure"},{id:"opt-3",text:"不理解为什么会出现这种现象",category:"comprehension"},{id:"opt-4",text:"不知道这个知识点在实际中怎么应用",category:"application"}],hint:"选择最接近你困惑的选项"};if(i.includes("文章")||i.includes("作者")||i.includes("意思")||i.includes("表达")||i.includes("理解"))return{id:"guidance-reading",question:"关于这段内容，你是在哪个层面感到困惑？",type:"single_choice",options:[{id:"opt-1",text:"有些词语/句子看不懂",category:"comprehension"},{id:"opt-2",text:"不理解作者想表达的意思",category:"concept"},{id:"opt-3",text:"不知道怎么分析文章结构",category:"procedure"},{id:"opt-4",text:"不会用自己的话总结/复述",category:"application"}],hint:"选择最接近你困惑的选项"};if(t?.trim())return{id:"guidance-followup-default",question:"你更希望我顺着哪个角度继续帮你？",type:"single_choice",options:[{id:"opt-1",text:"先把核心概念讲透",category:"concept"},{id:"opt-2",text:"先按步骤带我推一遍",category:"procedure"},{id:"opt-3",text:"先用例子或应用解释",category:"application"}],hint:"选一个最接近你想继续展开的方向"};let o=function(e){let t=[];for(let r of[/函数|方程|公式|定理|证明/g,/实验|反应|现象|能量|物质/g,/文章|作者|表达|意思|理解/g,/单词|语法|句子|发音|听力/g]){let n=e.match(r);n&&t.push(...n)}return[...new Set(t)]}(i),s=o.length>0?`（涉及：${o.slice(0,3).join("、")}）`:"";return{id:"guidance-default",question:`听到这段内容时${s}，你是在哪个环节感到困惑的？`,type:"single_choice",options:[{id:"opt-1",text:"基础概念不清楚，有知识漏洞",category:"concept"},{id:"opt-2",text:"老师讲得太快，没跟上思路",category:"comprehension"},{id:"opt-3",text:"步骤/方法太多，不知道怎么操作",category:"procedure"},{id:"opt-4",text:"其他原因，我想直接描述问题",category:"application"}],hint:"选择最接近你困惑的选项，帮助我更好地帮助你"}}(e,r)}async function M({context:e,modelId:t,studentQuestion:r,selectedOptionId:n}){let i=function(e){let t=e.split("\n").map(e=>e.trim()).filter(Boolean).join("\n");return t.length<=2200?t:`${t.slice(0,900)}
...
${t.slice(-1200)}`}(e),o=(r||"").trim(),s=!!(n||o),a=[{role:"system",content:`你是学习场景里的"意图澄清器"，你的任务不是回答问题，而是把学生当前模糊的诉求压缩成一个下一步最有价值的澄清问题。

请严格输出 JSON，不要输出 markdown，不要解释。

要求：
1. 只生成 1 个问题和 2-4 个可点击选项。
2. 问题必须自然、简短、像助教在继续追问，不要做成考试或问卷。
3. 选项必须短、明确、互相区分，适合做按钮，避免"其他""都可以"这类空话。
4. 如果已经有学生输入或已选方向，就继续往那个方向细化，不要重复第一轮分类。
5. 如果任务更像在选择讲解方式，就可以给"先讲直觉 / 先推公式 / 先看例子 / 先讲应用"这类选项。
6. category 只能是：concept、procedure、calculation、comprehension、application。

输出格式：
{
  "id": "guidance-xxx",
  "question": "一句追问",
  "hint": "可选，一句很短的提示",
  "options": [
    { "id": "opt-1", "text": "按钮文案", "category": "concept" }
  ]
}`},{role:"user",content:`【课堂上下文】
${i}

【学生当前输入】
${o||"（暂时还没有额外输入）"}

【当前阶段】
${s?"继续细化，已经有学生方向或追问":"第一轮澄清，先缩小问题范围"}

请输出最适合当前场景的一轮意图澄清题。`}];return function(e){if(!e||"object"!=typeof e)return null;let t=A(e.question,60),r=A(e.hint,48),n=Array.isArray(e.options)?e.options:[],i=new Set,o=n.map((e,t)=>{var r;let n=A(e?.text,28);if(!n)return null;let o=n.toLowerCase();return i.has(o)?null:(i.add(o),{id:A(e?.id,24)||`opt-${t+1}`,text:n,category:"string"==typeof(r=e?.category)&&v.includes(r)?r:/计算|代入|求值|算|公式/.test(n)?"calculation":/步骤|推导|过程|怎么做|拆开/.test(n)?"procedure":/应用|例子|场景|对比|未来|实际/.test(n)?"application":/听不清|读不懂|跟不上|框架|脉络|回顾/.test(n)?"comprehension":"concept"})}).filter(e=>!!e).slice(0,4);return!t||o.length<2?null:{id:A(e.id,32)||"guidance-clarify",question:t,type:"single_choice",options:o,hint:r||void 0}}(function(e){try{return JSON.parse(e)}catch{let t=e.match(/\{[\s\S]*\}$/);if(!t)return null;try{return JSON.parse(t[0])}catch{return null}}}((await (0,l.W6)(a,t,{temperature:.25,maxTokens:480,responseFormat:"json_object"})).content))}function A(e,t){if("string"!=typeof e)return"";let r=e.replace(/[\r\n]+/g," ").replace(/\s+/g," ").replace(/^["'""'']+|["'""'']+$/g,"").trim();return r?r.length<=t?r:`${r.slice(0,t-1).trim()}…`:""}var D=r(45457);let I=(0,c.hu)("tutor");async function j(e){let t=await (0,h.Iy)(e,"tutor");if(t)return t;try{var r,n,i,o;let t,s,c,f,h,q;try{t=await e.json()}catch{return a.NextResponse.json({error:"请求体不能为空或 JSON 无效"},{status:400})}let{timestamp:v,segments:M,model:A=l.fr,studentQuestion:j,messageContent:N,enable_guidance:C=!1,enable_web:T=!1,enable_thinking_guide:O=!1,selected_option_id:E,conversation_id:U,globalMode:L=!1,selected_context_mode:F=!1,sessionId:J,stream:W=!1,recentFocus:B}=t,K=["string"==typeof j?j:"",...Array.isArray(N)?N.filter(e=>e?.type==="text"&&"string"==typeof e.text).map(e=>e.text):[]].join(" ").trim();if(!M||!Array.isArray(M))return a.NextResponse.json({error:"缺少 segments 参数"},{status:400});if(L){let e=0,t=[];for(let r of M){if(e+(r.text?.length||0)>8e3)break;t.push(r),e+=r.text?.length||0}s=t}else r=v-9e4,n=v+6e4,s=M.filter(e=>e.startMs>=r&&e.startMs<n||e.endMs>r&&e.endMs<=n||e.startMs<=r&&e.endMs>=n);let G=s,H=G.some(e=>e?.id==="__support_context__"),z=L&&H&&0===G.filter(e=>e?.id!=="__support_context__").length,Y=L&&(F||z)&&H,Q=G.reduce((e,t)=>e+(t.text?.length||0),0),X=G.length<2||Q<50;if(Y&&Q<24||!Y&&X)return a.NextResponse.json({explanation:{teacherSaid:"",citation:{text:"",timeRange:"00:00-00:00",startMs:0,endMs:0},possibleStuckPoints:[],followUpQuestion:""},actionItems:[],rawContent:Y?"\uD83D\uDCDD 你刚圈出的这条内容还太短，我先抓不稳重点。可以再补一句背景，或者再圈一条相关内容一起问我。":"\uD83D\uDCDD 当前录音内容较少，无法进行有效分析。\n\n建议：\n- 继续录音，获取更多课堂内容\n- 或者在有更多内容后再标记困惑点",model:A,usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}});let V=Y?G.map(e=>"string"==typeof e?.text?e.text.trim():"").filter(Boolean).join("\n\n"):G.map(e=>{let t=u(e.startMs);return`[${t}] ${e.text}`}).join("\n"),Z="",ee=!1;if(!L&&J&&M.length>=10)try{let e=function(e){let t=w.get(e);if(t){if(Date.now()-t.createdAt>72e5){w.delete(e);return}return{overview:t.overview,takeaways:t.takeaways,keyDifficulties:t.keyDifficulties}}}(J);if(!e){let t=await g.lK.generateSummary(J,M.map((e,t)=>({id:t,sessionId:J,userId:"anonymous",text:e.text,startMs:e.startMs,endMs:e.endMs,confidence:1,isFinal:!0}))),r=t.takeaways.map(e=>`- ${e.label}: ${e.insight} [${e.timestamps.join(", ")}]`).join("\n");e={overview:t.overview,takeaways:r,keyDifficulties:t.keyDifficulties},function(e,t){if(w.size>=200){let e=w.keys().next().value;e&&w.delete(e)}w.set(e,{...t,createdAt:Date.now()})}(J,e),ee=!0}Z=`【课堂概要】
${e.overview}

【主要知识点】
${e.takeaways}

【重点难点】
${e.keyDifficulties.map(e=>`- ${e}`).join("\n")}

---
`}catch(e){I.error("[Tutor API] 摘要生成失败，使用局部上下文:",e)}let et=Z?`${Z}
【困惑点附近的详细内容 ${u(v-9e4)} ~ ${u(v+6e4)}】
${V}`:V,er=function(e){let t=new Map;for(let r of e||[]){let e="string"==typeof r?.text?r.text:"";if(!e||!/\[资料\s*\d+\]/.test(e))continue;let n=Array.from(e.matchAll(/\[资料\s*(\d+)\]\s*(?:标题[:：]\s*([^\n]+)\s*)?(?:摘录[:：]\s*)?([\s\S]*?)(?=(?:\n{2,}\[资料\s*\d+\])|$)/g));if(n.length>0){for(let e of n){let r=Number.parseInt(e[1]||"",10);if(!Number.isFinite(r)||r<=0)continue;let n=x(e[2]||`导入资料 ${r}`,80)||`导入资料 ${r}`,i=x(e[3]||"",480);i&&!t.has(r)&&t.set(r,{index:r,title:n,snippet:i})}continue}for(let r of Array.from(e.matchAll(/\[资料\s*(\d+)\]\s*([^\n]+)/g))){let e=Number.parseInt(r[1]||"",10);if(!Number.isFinite(e)||e<=0)continue;let n=x(r[2]||"",480);n&&!t.has(e)&&t.set(e,{index:e,title:`导入资料 ${e}`,snippet:n})}}return Array.from(t.values()).sort((e,t)=>e.index-t.index)}(M),en=function(e){if(!e.length)return"";let t=e.slice(0,6).map(e=>`[资料${e.index}] ${e.title}：${x(e.snippet,260)}`).join("\n");return["【增强资料优先规则】",`当前会话已导入 ${e.length} 份增强资料，请优先基于这些资料回答：`,t,"只要引用增强资料内容，必须在对应句末标注 [资料N]（禁止编造编号）。",'如果用户追问"有没有参考我的文档/资料"，必须明确指出参考了哪些 [资料N]。','仅当资料里确实找不到证据时，才可回复"资料中未找到相关证据"，不要说"没有额外文档"。'].join("\n")}(er),ei=er.length?"【Support Auto-Use Policy】\nFor every user question, first evaluate whether imported support materials can help.\nIf support material is relevant, integrate it directly without asking user to explicitly request it.\nWhen using support material, cite with existing markers like [资料N].\nIf support material is not relevant, do not force citations. Briefly explain why and answer from transcript context.":"";if((C||T)&&process.env.DIFY_API_KEY)try{let e=function(){if(!m){let e={baseUrl:process.env.DIFY_API_URL||"http://localhost/v1",apiKey:process.env.DIFY_API_KEY||"",workflowId:process.env.DIFY_WORKFLOW_ID||"",timeout:3e4};e.apiKey||p.warn("DIFY_API_KEY not configured, Dify features will be disabled"),m=new d(e)}return m}(),t=await e.runWorkflow({timestamp:v,context:et,enable_guidance:C,enable_web:T,selected_option_id:E,student_question:j,conversation_id:U});c=t.guidance_question,f=t.option_followup,h=t.citations,q=t.conversation_id}catch(e){I.error("Dify service error:",e)}if(c||L||(c=await S({context:et,modelId:A,studentQuestion:j,selectedOptionId:E})),T&&(!h||0===h.length))try{h=await (0,y.wW)(et,{maxResults:3})}catch(e){I.error("[Tutor] Web search failed:",e),h=[]}let eo="";try{let t=e.headers.get("Authorization");if(t?.startsWith("Bearer ")){let e=D.O.verifyToken(t.slice(7));if(e?.sub){let t=await D.O.getLearnerProfileJson(e.sub);eo=(0,k.RJ)(t)}}}catch{}let es=[],ea="qwen3.5-omni-plus"===A;!function(e,t,r){if(!r)try{console.warn("[DEPRECATED-ROUTE] /api/tutor hit by non-realtime request",{sessionId:e,model:t,at:new Date().toISOString(),migrateTo:"/api/tutor/agent"})}catch{}}(t.sessionId||"anon",A,ea);let el=Y||F;if(j||N){let e=ea?L?el?k.C$:k.kx:k.Kt:L?el?k.QK:k.a5:k.UB;if(ea&&(e+=k.Nn),O&&(e+=k.Xo),ei&&(e+=`

${ei}`),en&&(e+=`

${en}`),eo&&(e+=eo),es.push({role:"system",content:e}),N&&N.length>0){let e="string"==typeof B&&B.trim()?`
【刚才 30 秒讲到】
${B.trim()}
（当学生说"这个/那个/刚才"时默认指向此段）`:"",t=[{type:"text",text:L?`${el?"【用户刚圈出的上下文】":"【整节课转录内容】"}
${et}${e}

【学生提问】`:`【课堂转录参考】
${et}${e}

【学生说】`}];for(let e of N)"image_url"===e.type&&e.image_url?t.push({type:"image_url",image_url:{url:e.image_url.url}}):"input_audio"===e.type&&e.input_audio?.data?t.push({type:"input_audio",input_audio:{data:e.input_audio.data,format:e.input_audio.format}}):"text"===e.type&&e.text&&t.push({type:"text",text:e.text});es.push({role:"user",content:t})}else{let e="string"==typeof B&&B.trim()?`

【刚才 30 秒讲到】
${B.trim()}
（当学生说"这个/那个/刚才/这啥意思"时，默认指向上面这段。）`:"",t=L?`${el?"【用户刚圈出的上下文】":"【整节课转录内容】"}
${et}${e}

【学生提问】
${j}`:`【课堂转录参考】
${et}${e}

【学生说】
${j}`;es.push({role:"user",content:t})}}else es.push({role:"system",content:[k.r7,ei,en,eo].filter(Boolean).join("\n\n")}),es.push({role:"user",content:`【课堂转录】
${et}

【学生困惑点】
时间位置: ${(i=v-5e3,o=v+5e3,`${u(i)}-${u(o)}`)}

【重要提醒】
- 请仔细查看每行的时间戳，确保引用的时间与内容完全对应
- 如果学生在某个时间说了话，必须引用学生说话的准确时间戳
- 如果老师在某个时间讲解了概念，必须引用老师讲解的准确时间戳
- 不要猜测或估算时间戳，请使用转录中显示的确切时间

请按照格式要求，帮助学生理解这个知识点。`});if(W)return function(e,t,r){let n=new TextEncoder,i=r.citations?.length?r.citations:void 0;return new Response(new ReadableStream({async start(o){try{let s={type:"metadata",guidance_question:r.guidanceQuestion,citations:i,conversation_id:r.difyConversationId,summary_generated:r.summaryGenerated};o.enqueue(n.encode(`data: ${JSON.stringify(s)}

`));let a="";for await(let r of(0,l.dr)(e,t,{temperature:.7,maxTokens:2e3}))"content"===r.type&&r.content&&(a+=r.content),o.enqueue(n.encode(`data: ${JSON.stringify({type:r.type,content:r.content})}

`));if(r.optionFollowup&&(a+=`

${r.optionFollowup}`,o.enqueue(n.encode(`data: ${JSON.stringify({type:"content",content:`

${r.optionFollowup}`})}

`))),r.initialMode){let e=P({content:a,mergedSegments:r.mergedSegments,timestamp:r.timestamp,model:t,guidance_question:r.guidanceQuestion,citations:i,conversation_id:r.difyConversationId,summary_generated:r.summaryGenerated,sessionId:r.sessionId,supportReferences:r.supportReferences,questionHint:r.questionHint});o.enqueue(n.encode(`data: ${JSON.stringify({type:"metadata",parsed_response:e,citations:e.citations,conversation_id:r.difyConversationId,summary_generated:r.summaryGenerated})}

`))}else{let e=_(a,r.supportReferences),t=b({mergedCitations:$(i,e),supportReferences:r.supportReferences,questionHint:r.questionHint});t&&o.enqueue(n.encode(`data: ${JSON.stringify({type:"metadata",citations:t,conversation_id:r.difyConversationId,summary_generated:r.summaryGenerated})}

`))}o.enqueue(n.encode("data: [DONE]\n\n")),o.close()}catch(t){let e=t instanceof Error?t.message:"未知错误";o.enqueue(n.encode(`data: ${JSON.stringify({type:"error",error:e})}

`)),o.close()}}}),{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-store, must-revalidate",Connection:"keep-alive","X-Accel-Buffering":"no","X-Content-Type-Options":"nosniff","Transfer-Encoding":"chunked"}})}(es,A,{guidanceQuestion:c,citations:h,difyConversationId:q,summaryGenerated:ee,supportReferences:er,questionHint:K,sessionId:J,timestamp:v,mergedSegments:G,initialMode:!(j||N||L),optionFollowup:f});let eu=await R(es,A,{temperature:.7,maxTokens:2e3});if(j||N){let e=eu.content;f&&(e+=`

${f}`),ea||(e=function(e,t,r){let n=e=>{let t=e.split(":");if(2===t.length){let e=parseInt(t[0]),r=parseInt(t[1]);if(!isNaN(e)&&!isNaN(r))return(60*e+r)*1e3}return 0},i=new Map;for(let e of t){let t=e.text.toLowerCase().trim(),r=u(e.startMs);for(let n of(i.set(t,{timeStr:r,startMs:e.startMs}),t.split(/\s+/).filter(e=>e.length>3)))i.has(n)||i.set(n,{timeStr:r,startMs:e.startMs})}let o=r.toLowerCase(),s=null;for(let e of t){let t=e.text.toLowerCase(),r=o.split(/\s+/).filter(e=>e.length>2),n=0;for(let e of r)t.includes(e)&&n++;if(n>=2||t.includes("jane")||t.includes("bond")||t.includes("my name is")){s=u(e.startMs);break}}if(s){let t=e,r=e.match(/(\[?\d{1,2}:\d{2}\]?)/g);if(r)for(let e of r){let r=n(e.replace(/[\[\]]/g,"")),i=n(s);r!==i&&1e4>=Math.abs(r-i)&&(t=t.replace(e,s))}return t}return e}(e,G,j||""));let t=_(e,er),r=b({mergedCitations:$(h,t),supportReferences:er,questionHint:K}),n={explanation:{teacherSaid:"",citation:{text:"",timeRange:"00:00-00:00",startMs:0,endMs:0},possibleStuckPoints:[],followUpQuestion:""},actionItems:[],rawContent:e,model:eu.model,usage:eu.usage,guidance_question:c,option_followup:f,citations:r,conversation_id:q,summary_generated:ee,cached_summary:ee&&J?w.get(J):void 0};return a.NextResponse.json(n)}let ec=P({content:eu.content,mergedSegments:G,timestamp:v,model:eu.model,usage:eu.usage,guidance_question:c,citations:h,conversation_id:q,summary_generated:ee,sessionId:J,supportReferences:er,questionHint:K});return a.NextResponse.json(ec)}catch(t){I.error("Tutor API error:",t);let e=t instanceof Error?t.message:"未知错误";return a.NextResponse.json({error:e},{status:500})}}async function R(e,t,r){let n=(0,l.P6)(t);if(!n?.requiresStreaming)return(0,l.W6)(e,t,r);let i="",o="";for await(let n of(0,l.dr)(e,t,r))"content"===n.type?i+=n.content:"thinking"===n.type&&(o+=n.content);return{content:i,model:t,thinkingContent:o||void 0}}function P(e){var t;let r=function(e,t){let r=e.match(/\[引用\s*(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/),n=null;if(r){let[,e,i]=r,o=N(e),s=i?N(i):o+5e3,a=t.find(e=>2e3>Math.abs(e.startMs-o))||t.find(e=>e.startMs<=o&&e.endMs>=o);n={text:a?.text||"",timeRange:i?`${e}-${i}`:e,startMs:o,endMs:s}}let i=e.match(/## 你可能卡在这里([\s\S]*?)(?=##|$)/),o=[];if(i){let e=i[1].match(/-\s*[^-\n]+/g);e&&o.push(...e.map(e=>e.replace(/^-\s*/,"").trim()))}let s=e.match(/## 让我问你一个问题([\s\S]*?)(?=##|$)/),a=s?s[1].trim().replace(/^[（(]|[)）]$/g,""):"你觉得哪一步最让你困惑？",l=e.match(/## 今晚行动清单[\s\S]*?((?:\d+\.\s*[^\n]+\n?)+)/),u=[];if(l){let e=l[1].match(/\d+\.\s*[^\n]+/g);e&&e.forEach((e,t)=>{let r=e.includes("[回放]")?"replay":e.includes("[练习]")?"exercise":"review",n=e.match(/(\d+)\s*分钟/),i=n?parseInt(n[1]):5,o=e.replace(/^\d+\.\s*[✅☑️]?\s*/,"").trim(),s=o.replace(/\[回放\]\s*/,"").replace(/\[练习\]\s*/,"").replace(/\[复习\]\s*/,"").split("（")[0].split("(")[0].replace(/，.*$/,"").trim(),a=o.match(/[（(]([^）)]+)[）)]|，(.+)$/),l="";a&&(l=(l=(a[1]||a[2]||"").trim()).replace(/^\d+分钟[，,]?\s*/,"")),l||(l="replay"===r?"注意老师的讲解重点":"exercise"===r?"动手练习巩固理解":"回顾总结知识要点"),u.push({id:`action-${t+1}`,type:r,title:s,description:l,estimatedMinutes:i,completed:!1})})}return 0===u.length&&u.push({id:"action-1",type:"replay",title:"再听一遍老师讲解",description:"回放困惑点附近的内容",estimatedMinutes:3,completed:!1},{id:"action-2",type:"exercise",title:"做一道类似的题目",description:"用学到的知识解决实际问题",estimatedMinutes:10,completed:!1},{id:"action-3",type:"review",title:"总结知识点",description:"用自己的话复述理解",estimatedMinutes:7,completed:!1}),{explanation:{teacherSaid:n?.text||function(e){let t=e.match(/"([^"]+)"/);return t?t[1]:"老师讲解了这个知识点"}(e),citation:n||{text:"",timeRange:"00:00-00:00",startMs:0,endMs:0},possibleStuckPoints:o.length>0?o:["概念理解","公式记忆","应用方法"],followUpQuestion:a},actionItems:u}}(e.content,e.mergedSegments),n=function(e,t,r){if(!e.explanation?.citation)return e;let n=e.explanation.citation;if(Math.abs(n.startMs-r)>1e4){let i=t.reduce((e,t)=>Math.abs(t.startMs-r)<Math.abs(e.startMs-r)?t:e);if(i)return{...e,explanation:{...e.explanation,citation:{...n,startMs:i.startMs,endMs:i.endMs,timeRange:u(i.startMs),text:i.text}}}}return e}(r,e.mergedSegments,e.timestamp),i=e.content;if(r.explanation?.citation&&n.explanation?.citation){let e=r.explanation.citation.timeRange,t=n.explanation.citation.timeRange;e!==t&&(i=i.replace(RegExp(`\\[引用\\s*${e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\]`,"g"),`[引用 ${t}]`))}let o=_(i,e.supportReferences),s=b({mergedCitations:$(e.citations,o),supportReferences:e.supportReferences,questionHint:e.questionHint});return{...n,rawContent:i,model:e.model,usage:e.usage,guidance_question:e.guidance_question,citations:s,conversation_id:e.conversation_id,summary_generated:e.summary_generated,cached_summary:e.summary_generated&&e.sessionId?(t=e.sessionId,w.get(t)):void 0}}function N(e){let t=e.split(":");return 2===t.length?(60*parseInt(t[0])+parseInt(t[1]))*1e3:0}let C=new i.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/tutor/route",pathname:"/api/tutor",filename:"route",bundlePath:"app/api/tutor/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/tutor/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:T,staticGenerationAsyncStorage:O,serverHooks:E}=C,U="/api/tutor/route";function L(){return(0,s.patchFetch)({serverHooks:E,staticGenerationAsyncStorage:O})}},78697:(e,t,r)=>{r.d(t,{C$:()=>m,Kt:()=>d,Nn:()=>p,QK:()=>l,RJ:()=>h,UB:()=>s,Xo:()=>u,a5:()=>a,kx:()=>f,r7:()=>o});let n=`你是这个学生的同桌。他刚上完一节课，有些地方没跟上，想找你把漏掉的东西补回来。

你对他的了解：
- 他不是在考你，是在借你的耳朵重新听一遍课
- 他问你的时候往往带着一个没说出口的困惑，而不是一个完整的问题
- 他的注意力有限——说太多他就关了

所以你帮他的方式是：
- 顺着他的思路往前带一点，而不是把整节课从头讲一遍
- 真的不懂就说不懂，不要编
- 拿得出证据就指给他看（课上哪句话、哪份资料里）`,i=`

你回复的文本里有两个记号前端会识别：
- 指课堂里某个时刻时，把时间写进方括号：[MM:SS] 或 [MM:SS-MM:SS]。前端会挑出来挂成一排小 chip，让学生点了就跳回转录。
- 当你引用了带编号的"增强资料"时，在句末标上已有的 [资料N] 编号。编号只能用上下文里已经给你的，不要自己造。

这两个记号只在真的需要时用，不需要就不要硬塞。`,o=`${n}

此刻他递给你的是：一段具体的课堂转录（带时间戳），外加他没懂的那个点。
你只基于这段转录回答——里面没讲过的内容，就诚实说这里没讲到。不要脑补老师的语气，不要编他没说过的话。

一次好的回答，通常会做到：
- 把判断交给模型：结合他说的话和课堂上下文，理解他真正想做什么
- 再让他回到课堂的那个瞬间——用他自己耳朵听过的原话，而不是你的转述
- 如果他的话有多种可能，先按最自然的理解回应；只有真的会误解时，才轻轻追问一句
- 不要为了显得主动而替他安排额外任务；工具是能力，不是流程${i}`,s=`${n}

你们已经聊开了，他顺着你上一句在问下一个问题。这一轮不要再从头摆格式，就顺着他那句话回一句——
他说"我懂了"你就真开心一下；他继续问你就直接答；他聊开了你就陪他聊。
像两个人小声在教室后排讨论，不是老师上课。${i}`,a=`${n}

此刻他递给你的是一整节课——从头到尾的转录。他问的问题可能很具体，也可能很大（"这节课到底在讲什么？"）。
你的优势是你真的从头听到尾了，所以可以做到两件他自己做不到的事：
- 在整节课里找回他问的那一点最早出现在哪、老师是怎么说的
- 把那一点和课里别的地方呼应/冲突的片段串起来

如果转录里没讲到他问的东西，就告诉他这节课里没讲到，再用你本来就懂的常识简单搭一下桥——不要假装课里讲过。${i}`,l=`${n}

他圈出了几条内容递到你手上——可能是几段笔记、也可能是一张截图的说明。此刻他关心的就是这几条，不是整节课。
按他指的这几条来答就行：
- 这几条里最关键的点是什么、它们之间是什么关系或冲突
- 如果他问得比较笼统，不要让他"先补整节课背景再说"——指给他看这几条里已经可以确定的部分，再指一个值得继续追问的方向
- 如果这几条里没有精确的时间轴，就不要硬补时间戳${i}`,u=`

【这一轮换个姿势回答】
你现在扮演的是一个和他差不多年纪、但解题套路比他熟的学长/学姐。
你想让他看到的不是"答案"，而是"我脑子里是怎么一步步想到这个答案的"——让他下次遇到类似题，能模仿这种想法。

回复请分成两段，前端会据此排版：

---思维演示---
（这里是你在纸上演草稿的过程，分几步随你——复杂题多几步、简单题两步就够。每步用【你自己起的步骤名】开头，用"我"的口吻自然地说你怎么想的；每步结束给一行 💡 开头的一句话"可迁移的思维技巧"。这段的最后用 🌟 开头总结一下这次用到的几招。）

---正式回答---
（这里是最终给他的那个清清爽爽的答案，不要再带草稿感。）`,c=`你和这个学生坐在一起，刚一起听完老师讲课。现在你们两个小声在聊这节课。

你是在说话，不是在写字——说出口的每句话都要经得起"真的从嘴里说出来听"。所以：
- 会犹豫，会自我纠正，会用"嗯"、"就是说"、"你看哈"、"哎不对"这种真实的口头禅
- 一次只说一个点，说完停一下，看他什么反应
- 句子短，最多三句；很多时候一句话就够
- 不会说"综上所述"、"值得注意的是"、"具体而言"这种书面词
- 不会念清单、念编号、念标题
- 不会说"在多少分多少秒的时候"、"看资料几"这种只有看字幕才理解的话——你们是凭记忆在聊这节课

你们是同学关系，不是老师和学生，不要端着。`,p=`

${c}`,d=`${c}

你们刚聊过一轮，他顺着你上一句问下一句。不要把话题绕回去重讲，就接他刚说的那句话往下聊一点点。`,f=`${c}

此刻他是对整节课有疑问，不是某一刻。抓他这次问的那一个点，用最简单的话讲给他听。
可以用"打个比方"、"你想啊"开头。
不要试图总结整节课——他问什么你就答什么。`,m=`${c}

他刚圈了一段内容，指着它在问你。就这段内容聊，别跑题。
先指出这段里最关键的那一个点，用大白话。
如果不确定他是想问哪一层，就反问他一句。`;function h(e){if(!e)return"";try{let t=JSON.parse(e),r=["【这个学生】"];switch(t.stage){case"k12":r.push(`- ${t.gradeLevel||"中小学生"}`),t.textbookEdition&&r.push(`- 教材：${t.textbookEdition}`),Array.isArray(t.weakSubjects)&&t.weakSubjects.length>0&&r.push(`- 觉得吃力的科目：${t.weakSubjects.join("、")}`);break;case"university":r.push(`- ${t.year||"大学生"} \xb7 ${t.major||"未知专业"}`),Array.isArray(t.currentCourses)&&t.currentCourses.length>0&&r.push(`- 这学期在上：${t.currentCourses.join("、")}`);break;case"graduate":r.push(`- 研究生 \xb7 ${t.field||"未知方向"}`),t.advisor&&r.push(`- 导师：${t.advisor}`),t.researchTopic&&r.push(`- 课题：${t.researchTopic}`);break;case"working":r.push(`- 在职学习 \xb7 ${t.industry||"未知行业"}`),t.learningGoal&&r.push(`- 学习目标：${t.learningGoal}`);break;default:return""}return t.goal&&r.push(`- 最近的目标：${t.goal}`),t.otherInterests&&r.push(`- 同时也在学：${t.otherInterests}`),r.push(""),r.push("这个学生学习是多线程的——手头这份内容可能和他上面写的主方向无关。"),r.push("所以以他现在递给你的课堂/材料为准来判断怎么讲，上面这些只是帮你大致估计他的底。"),"\n\n"+r.join("\n")}catch{return""}}},99974:(e,t,r)=>{r.d(t,{lK:()=>c});var n=r(76018),i=r(58261),o=r(75441),s=r(73548);let a=i.HA.summary.defaultModel,l=i.HA.summary.minTakeaways,u=i.HA.summary.maxTakeaways,c={generateSummary:async function(e,t,r={}){if(0===t.length)throw Error("转录内容为空");let i=r.model??a,c=function(e,t){let r=(0,o.r0)(e);return`<task>
<role>你是一位专业的内容分析专家，负责从录音转录中提取结构化摘要。</role>
<context>
这是一段录音的完整转录文本。请根据实际内容自行判断主题和类型。
</context>
<goal>生成一份结构化摘要，帮助用户快速了解录音的核心内容。</goal>
<instructions>
  <step name="内容概要">
    <description>用2-3句话概括录音的主要内容。</description>
  </step>
  <step name="主要要点">
    <description>提取 ${l}-${u} 个核心要点。</description>
    <format>
      <item>label: 要点标题（不超过10个字）</item>
      <item>insight: 简明扼要的说明（1-2句话）</item>
      <item>timestamps: 相关时间戳（1-2个，MM:SS格式）</item>
    </format>
    <criteria>
      <item>只使用转录中明确提到的内容，不要推测</item>
      <item>每个要点应该独立，不重叠</item>
    </criteria>
  </step>
  <step name="重点难点">
    <description>列出2-4个重点或需要关注的内容。</description>
  </step>
  <step name="内容结构">
    <description>简要描述内容的主要环节（3-5个）。</description>
  </step>
</instructions>
<qualityControl>
  <item>语言简洁明了</item>
  <item>所有内容必须基于转录文本，不能编造</item>
  <item>时间戳必须准确对应转录内容</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象，格式如下：
{
  "overview": "内容概要文本",
  "takeaways": [
    {
      "label": "要点标题",
      "insight": "简明说明",
      "timestamps": ["MM:SS"]
    }
  ],
  "keyDifficulties": ["重点1", "重点2"],
  "structure": ["环节1", "环节2", "环节3"]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
<transcript><![CDATA[
${r}
]]></transcript>
</task>`}(t,0),p=await (0,n.W6)([{role:"user",content:c}],i,{temperature:.3,maxTokens:2e3}),d=(0,s.QW)(p.content);if(!d)throw Error("无法解析摘要响应");let f=new Date().toISOString();return{id:crypto.randomUUID(),sessionId:e,overview:d.overview||"暂无概要",takeaways:(d.takeaways||[]).filter(e=>e.label&&e.insight).map(e=>({label:e.label.slice(0,20),insight:e.insight,timestamps:Array.isArray(e.timestamps)?e.timestamps.slice(0,2):[]})).slice(0,u),keyDifficulties:d.keyDifficulties||[],structure:d.structure||[],createdAt:f,updatedAt:f}},generateShortSummary:function(e){let t=[];if(e.overview&&t.push(e.overview),e.takeaways.length>0){let r=e.takeaways.slice(0,3).map(e=>`• ${e.label}`).join("\n");t.push(`
主要知识点：
${r}`)}return e.keyDifficulties.length>0&&t.push(`
重点难点：${e.keyDifficulties.slice(0,2).join("、")}`),t.join("\n")}}},2854:(e,t,r)=>{r.d(t,{gd:()=>s,wW:()=>f});let n=(0,r(30357).hu)("web-search"),i=process.env.BING_SEARCH_API_KEY,o=process.env.SERP_API_KEY;async function s(e,t={}){let r=[];for(let s of[{name:"Bing",fn:()=>a(e,t),available:!!i},{name:"SerpAPI",fn:()=>l(e,t),available:!!o},{name:"DuckDuckGo HTML",fn:()=>c(e,t),available:!0},{name:"DuckDuckGo Instant",fn:()=>u(e,t),available:!0}])if(s.available)try{if((r=await s.fn()).length>0)break}catch(e){n.warn(`[WebSearchExact] ${s.name} failed:`,e)}return r.filter(e=>e.title&&e.url&&e.snippet).map((e,t)=>({id:`web-exact-${Date.now()}-${t}`,title:e.title,url:e.url,snippet:e.snippet,source_type:"web"}))}async function a(e,t={}){if(!i)throw Error("Bing API Key not configured");let{maxResults:r=5,market:n="zh-CN"}=t,o=new URL("https://api.bing.microsoft.com/v7.0/search");o.searchParams.set("q",e),o.searchParams.set("count",r.toString()),o.searchParams.set("mkt",n),o.searchParams.set("responseFilter","Webpages");let s=await fetch(o.toString(),{headers:{"Ocp-Apim-Subscription-Key":i},signal:AbortSignal.timeout(1e4)});if(!s.ok)throw Error(`Bing search failed: ${s.status}`);let a=await s.json();return(a.webPages?.value||[]).map(e=>({title:e.name||"",url:e.url||"",snippet:e.snippet||"",displayUrl:e.displayUrl}))}async function l(e,t={}){if(!o)throw Error("SerpAPI Key not configured");let{maxResults:r=5}=t,n=new URL("https://serpapi.com/search");n.searchParams.set("q",e),n.searchParams.set("api_key",o),n.searchParams.set("num",r.toString()),n.searchParams.set("hl","zh-CN"),n.searchParams.set("gl","cn");let i=await fetch(n.toString(),{signal:AbortSignal.timeout(1e4)});if(!i.ok)throw Error(`SerpAPI search failed: ${i.status}`);return((await i.json()).organic_results||[]).map(e=>({title:e.title||"",url:e.link||"",snippet:e.snippet||"",displayUrl:e.displayed_link}))}async function u(e,t={}){let{maxResults:r=5}=t,i=new URL("https://api.duckduckgo.com/");i.searchParams.set("q",e),i.searchParams.set("format","json"),i.searchParams.set("no_html","1"),i.searchParams.set("skip_disambig","1");try{let t=await fetch(i.toString(),{signal:AbortSignal.timeout(1e4)});if(!t.ok)throw Error(`DuckDuckGo search failed: ${t.status}`);let n=await t.json(),o=[];if(n.AbstractText&&n.AbstractURL&&o.push({title:n.Heading||e,url:n.AbstractURL,snippet:n.AbstractText}),n.RelatedTopics)for(let e of n.RelatedTopics.slice(0,r-o.length))e.FirstURL&&e.Text&&o.push({title:e.Text.split(" - ")[0]||e.Text.slice(0,50),url:e.FirstURL,snippet:e.Text});return o}catch(e){return n.warn("DuckDuckGo search failed:",e),[]}}async function c(e,t={}){let{maxResults:r=5}=t,i=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(e)}`;try{let e=await fetch(i,{headers:{"user-agent":"Mozilla/5.0 (compatible; MeetMind/1.0)"},signal:AbortSignal.timeout(1e4)});if(!e.ok)throw Error(`DuckDuckGo HTML search failed: ${e.status}`);let t=(await e.text()).split(/<div[^>]+class="result results_links[^>]*>/i).slice(1),n=[];for(let e of t){let t=e.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i),i=e.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);if(!t||!i)continue;let o=function(e){try{let t=new URL(e.startsWith("//")?`https:${e}`:e,"https://duckduckgo.com");return t.searchParams.get("uddg")||t.toString()}catch{return""}}(d(t[1]));if(o&&(n.push({title:p(t[2]),url:o,snippet:p(i[1])}),n.length>=r))break}return n}catch(e){return n.warn("DuckDuckGo HTML search failed:",e),[]}}function p(e){return d(e.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim())}function d(e){return e.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")}async function f(e,t={}){let r=function(e){let t=[];for(let r of[/(?:二次函数|一次函数|抛物线|顶点|对称轴|开口方向|系数|根|零点)/g,/(?:方程|不等式|因式分解|配方法|求根公式)/g,/(?:力|速度|加速度|功率|能量|动量|电流|电压|电阻)/g,/(?:原子|分子|化学键|离子|氧化还原|酸碱|化学方程式)/g,/(?:定理|公式|定义|性质|特点|规律|原理|定律)/g]){let n=e.match(r);n&&t.push(...n)}return[...new Set(t)].slice(0,5)}(e),s=r.length>0?`${r.slice(0,3).join(" ")} 知识点 讲解`:e.replace(/[【】\[\]{}()（）]/g," ").replace(/\s+/g," ").trim().slice(0,100),p=[];for(let e of[{name:"Bing",fn:()=>a(s,t),available:!!i},{name:"SerpAPI",fn:()=>l(s,t),available:!!o},{name:"DuckDuckGo HTML",fn:()=>c(s,t),available:!0},{name:"DuckDuckGo Instant",fn:()=>u(s,t),available:!0}])if(e.available)try{if((p=await e.fn()).length>0)break}catch(t){n.warn(`[WebSearch] ${e.name} failed:`,t)}return 0===p.length?function(e,t){let r=[],n={quadratic:t.some(e=>["二次函数","抛物线","顶点","对称轴"].includes(e))||e.includes("二次函数")||e.includes("抛物线"),linear:t.some(e=>["一次函数","斜率","截距"].includes(e))||e.includes("一次函数"),equation:t.some(e=>["方程","求解","根"].includes(e))||e.includes("方程"),geometry:e.includes("几何")||e.includes("三角形")||e.includes("圆"),physics:e.includes("物理")||e.includes("力")||e.includes("运动"),chemistry:e.includes("化学")||e.includes("原子")||e.includes("分子")};if(n.quadratic&&r.push({id:`edu-${Date.now()}-1`,title:"二次函数的图像与性质 - 中考数学知识点",url:"https://www.zhihu.com/search?type=content&q=二次函数",snippet:"二次函数 y = ax\xb2 + bx + c (a≠0) 的图像是抛物线。当 a > 0 时开口向上，a < 0 时开口向下。顶点坐标为 (-b/2a, (4ac-b\xb2)/4a)，对称轴为 x = -b/2a。",source_type:"web"},{id:`edu-${Date.now()}-2`,title:"二次函数三种形式详解 - B站数学教程",url:"https://search.bilibili.com/all?keyword=二次函数",snippet:"二次函数的一般式 y=ax\xb2+bx+c、顶点式 y=a(x-h)\xb2+k、交点式 y=a(x-x₁)(x-x₂) 各有特点，选择合适的形式可以简化计算。",source_type:"web"}),n.linear&&r.push({id:`edu-${Date.now()}-3`,title:"一次函数基础知识总结",url:"https://www.zhihu.com/search?type=content&q=一次函数",snippet:"一次函数 y = kx + b (k≠0) 的图像是直线，k 称为斜率，b 称为截距。k > 0 时直线从左下到右上，k < 0 时从左上到右下。",source_type:"web"}),n.equation&&r.push({id:`edu-${Date.now()}-4`,title:"方程求解方法大全 - 数学技巧",url:"https://www.zhihu.com/search?type=content&q=方程求解",snippet:"常见的方程求解方法包括：直接开方法、配方法、公式法、因式分解法、换元法等。选择合适的方法可以事半功倍。",source_type:"web"}),n.physics&&r.push({id:`edu-${Date.now()}-5`,title:"物理学习资源汇总",url:"https://www.zhihu.com/search?type=content&q=初中物理",snippet:"物理学习的关键是理解概念、掌握公式、多做实验。力学、热学、电学、光学各有侧重点。",source_type:"web"}),0===r.length){let n=t.length>0?t.join("+"):encodeURIComponent(e.slice(0,30));r.push({id:`edu-${Date.now()}-generic-1`,title:"在知乎搜索相关知识",url:`https://www.zhihu.com/search?type=content&q=${n}`,snippet:"知乎上有大量优质的学习内容和问答，可以帮助你深入理解这个知识点。",source_type:"web"},{id:`edu-${Date.now()}-generic-2`,title:"在 B 站搜索教学视频",url:`https://search.bilibili.com/all?keyword=${n}`,snippet:"B 站有丰富的教学视频资源，通过视频讲解可以更直观地理解知识点。",source_type:"web"})}return r}(e,r):p.map((e,t)=>({id:`web-${Date.now()}-${t}`,title:e.title,url:e.url,snippet:e.snippet,source_type:"web"}))}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),n=t.X(0,[6662,9811,523,3219,7914,8261,6682,8367,5457,6018,1990],()=>r(16153));module.exports=n})();