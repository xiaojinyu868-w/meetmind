"use strict";(()=>{var e={};e.id=749,e.ids=[749],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},75686:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>G,patchFetch:()=>J,requestAsyncStorage:()=>B,routeModule:()=>H,serverHooks:()=>W,staticGenerationAsyncStorage:()=>Q});var i={};r.r(i),r.d(i,{POST:()=>z});var n=r(88255),a=r(75657),s=r(37391),o=r(43955),l=r(76018),c=r(58261),u=r(30357),p=r(75441),d=r(73548),m=r(2854);let h=(0,u.hu)("feed-retrieval");async function f(e,t={}){let r=function(e){if(e.strategy&&"auto"!==e.strategy)return e.strategy;let t=process.env.FEED_SEARCH_MODE?.trim().toLowerCase();return"direct"===t?"direct":"dashscope"===t?"dashscope":e.dashscopeApiKey||process.env.DASHSCOPE_API_KEY?.trim()?"dashscope":"direct"}(t),i=t.dashscopeApiKey||process.env.DASHSCOPE_API_KEY?.trim()||"",n=e.slice(0,3),a="dashscope"===r&&i?await Promise.all(n.map(e=>w(e,i,t.timeoutMs))):await Promise.all(n.map(async e=>{let t=[g(e)];return e.contentKinds.includes("paper")&&t.push(y(e)),e.contentKinds.includes("book")&&t.push(b(e)),(await Promise.allSettled(t)).flatMap(e=>"fulfilled"===e.status?e.value:[])})),s=new Set,o=a.flat().filter(e=>e.title&&e.snippet&&v(e.url)).sort((e,t)=>e.preRanked&&t.preRanked&&(e.retrievalRank??99)-(t.retrievalRank??99)||t.sourceScore-e.sourceScore).filter(e=>{let t=function(e){try{let t=new URL(e);return t.hash="",["utm_source","utm_medium","utm_campaign","utm_content"].forEach(e=>t.searchParams.delete(e)),t.toString().replace(/\/$/,"")}catch{return e}}(e.url);return!s.has(t)&&(s.add(t),!0)}).slice(0,24);return h.info("external retrieval completed",{strategy:r,discoveries:n.length,candidates:o.length}),o}async function g(e){return(await (0,m.gd)(e.query,{maxResults:8,language:"zh-CN",market:"zh-CN"})).map(t=>({title:t.title,url:t.url,snippet:t.snippet??"",sourceLabel:$(t.url),contentKind:k(t.url),discovery:e,sourceScore:x(t.url)}))}async function y(e){let t=e.academicQuery||e.query,r=new URL("https://api.semanticscholar.org/graph/v1/paper/search");r.searchParams.set("query",t.slice(0,180)),r.searchParams.set("limit","6"),r.searchParams.set("fields","title,url,abstract,authors,year,publicationDate,venue,openAccessPdf,citationCount");let i=await fetch(r,{signal:AbortSignal.timeout(1e4)});if(!i.ok)throw Error(`Semantic Scholar ${i.status}`);return((await i.json()).data??[]).flatMap(t=>{if(!t.title||!t.url)return[];let r=(t.authors??[]).map(e=>e.name??"").filter(Boolean).slice(0,4),i=[t.venue,t.year?String(t.year):void 0].filter(Boolean).join(" \xb7 ");return[{title:t.title,url:t.openAccessPdf?.url||t.url,snippet:(t.abstract||i||"论文目录记录").slice(0,520),sourceLabel:t.venue||"Semantic Scholar",contentKind:"paper",authors:r,publishedAt:t.publicationDate||(t.year?String(t.year):void 0),discovery:e,sourceScore:8+Math.min(2,Math.log10((t.citationCount??0)+1))}]})}async function b(e){let t=new URL("https://openlibrary.org/search.json");t.searchParams.set("q",(e.bookQuery||e.query).slice(0,180)),t.searchParams.set("limit","6"),t.searchParams.set("fields","key,title,author_name,first_publish_year,cover_i,subject,edition_count");let r=await fetch(t,{headers:{"user-agent":"MeetMind/1.0 (learning information discovery)"},signal:AbortSignal.timeout(1e4)});if(!r.ok)throw Error(`Open Library ${r.status}`);return((await r.json()).docs??[]).flatMap(t=>{if(!t.key||!t.title)return[];let r=(t.author_name??[]).slice(0,4),i=(t.subject??[]).slice(0,3).join("、");return[{title:t.title,url:`https://openlibrary.org${t.key}`,snippet:i||"图书目录记录",sourceLabel:"Open Library",contentKind:"book",authors:r,publishedAt:t.first_publish_year?String(t.first_publish_year):void 0,coverUrl:t.cover_i?`https://covers.openlibrary.org/b/id/${t.cover_i}-M.jpg`:void 0,discovery:e,sourceScore:7+Math.min(2,Math.log10((t.edition_count??1)+1))}]})}async function w(e,t,r){let i=r??Number.parseInt(process.env.FEED_SEARCH_TIMEOUT_MS||"",10),n=Number.isFinite(i)?Math.min(2e4,Math.max(3e3,i)):12e3,a=new AbortController,s=setTimeout(()=>a.abort(),n),o=[],l="";try{let r=await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",{method:"POST",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json","X-DashScope-SSE":"enable"},body:JSON.stringify({model:process.env.FEED_SEARCH_MODEL?.trim()||"qwen-plus",input:{messages:[{role:"user",content:`搜索“${e.query}”。只从真实搜索结果中选择 3-4 条与查询最相关、可直接打开的资料。输出 JSON：{"items":[{"index":1,"summary":"基于搜索内容的一句事实简介"}]}。index 必须对应搜索结果序号，不要生成新链接。`}]},parameters:{enable_search:!0,incremental_output:!0,result_format:"message",max_tokens:700,search_options:{search_strategy:"turbo",enable_source:!0,prepend_search_result:!0}}}),signal:a.signal});if(!r.ok||!r.body)throw Error(`DashScope native search ${r.status}`);let i=r.body.getReader(),n=new TextDecoder,s="";for(;;){let{done:e,value:t}=await i.read(),r=(s+=n.decode(t??new Uint8Array,{stream:!e})).split(/\r?\n/);for(let t of(s=e?"":r.pop()??"",r)){if(!t.startsWith("data:"))continue;let e=JSON.parse(t.slice(5));if(e.code)throw Error(`${e.code}: ${e.message||"search failed"}`);let r=e.output?.search_info?.search_results??[];0===o.length&&r.length>0&&o.push(...r),l+=e.output?.choices?.[0]?.message?.content??""}if(e)break}}catch(t){h.warn("DashScope native search failed",{query:e.query,sourceCount:o.length,error:t instanceof Error?t.message:String(t)})}finally{clearTimeout(s)}let c=(0,d.QW)(l),u=c?.items??[],p=new Map(u.filter(e=>Number.isInteger(e.index)&&e.summary?.trim()).map(e=>[e.index,e.summary.trim()])),m=function(e,t){let r=new Set(t.filter(e=>Number.isInteger(e.index)&&e.summary?.trim()).map(e=>e.index));if(0===r.size)return e.slice(0,4);let i=e.filter(e=>r.has(e.index??-1));return(i.length>0?i:e).slice(0,4)}(o,u);return h.info("DashScope native search completed",{sourceCount:o.length,summaryCount:p.size,selectedCount:m.length}),m.flatMap((t,r)=>t.title&&t.url&&v(t.url)?[{title:t.title,url:t.url,snippet:p.get(t.index??-1)||t.title,sourceLabel:t.site_name||$(t.url),contentKind:k(t.url),discovery:e,sourceScore:x(t.url),preRanked:!0,qualityReason:e.reason,retrievalProvider:"dashscope-search",retrievalRank:r}]:[])}function x(e){let t=$(e).toLowerCase(),r=2;return/\.(edu|ac)\.|\.edu$|\.ac$|\.gov\.|\.gov$|\.org$/.test(t)&&(r+=3),/(doi\.org|arxiv\.org|nature\.com|science\.org|ieee\.org|acm\.org|pubmed|jstor\.org|openlibrary\.org|semanticscholar\.org)/.test(t)&&(r+=4),/(^|\.)docs\.|developer\.|github\.com/.test(t)&&(r+=2),r}function k(e){let t=e.toLowerCase();return/(doi\.org|arxiv\.org|semanticscholar\.org|pubmed|\/paper\/)/.test(t)?"paper":/(openlibrary\.org|books\.google\.|goodreads\.com)/.test(t)?"book":/(\.gov|\/reports?\/|\/research\/|\.pdf($|\?))/.test(t)?"report":"web"}function $(e){try{return new URL(e).hostname.replace(/^www\./,"")}catch{return"外部资料"}}function v(e){try{return["http:","https:"].includes(new URL(e).protocol)}catch{return!1}}let S=c.HA.feed.defaultModel,q=c.HA.feed.maxItems,_=c.HA.feed.maxProbes,P=(0,u.hu)("feed-cross-course"),A=["summary","probe-near","probe-lateral","probe-bridge","confusion-link"],C=["jump-timestamp","make-flashcard","ask-tutor","review-prev"],j=["summary","probe-near","probe-lateral","probe-bridge"],T=["open-capture","ask-tutor"],L=["baijiahao.baidu.com","sohu.com","163.com","blog.csdn.net"];function I(e){return e.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-–—:：|｜_·•]+/g,"")}async function R(e,t,r){if(0===e.length)return[];if(e.every(e=>e.preRanked))return function(e){let t=[],r=new Set,i=new Set;for(let n of e){let e=`${n.discovery.perspective}:${n.discovery.query}`;if(!i.has(e)&&(i.add(e),t.push(n),r.add(n),t.length>=4))break}for(let i of e){if(t.length>=4)break;r.has(i)||t.push(i)}return t.map(e=>({candidate:e,qualityReason:e.qualityReason||e.discovery.reason}))}(e);let i=[...(t.learnerProfile?.goals??[]).slice(0,3).map(e=>e.title),...t.learningContext?.activeThread?.title?[t.learningContext.activeThread.title]:[]].join("、")||"未设置",n=(t.feedback??[]).slice(0,10).map(e=>`${"up"===e.rating?"有用":"不相关"}：${e.title}${e.whyForYou?`（${e.whyForYou}）`:""}`).join("\n")||"暂无",a=e.map((e,t)=>`[${t}] ${e.title}
类型：${e.contentKind}
来源：${e.sourceLabel}
作者：${e.authors?.join("、")||"未标注"}
出版：${e.publishedAt||"未标注"}
摘要：${e.snippet}
视角：${e.discovery.perspective}
推荐线索：${e.discovery.reason}`).join("\n\n"),s=`<task>
<role>你是 MeetMind 的信息编辑。你只在真实搜索候选中做选择，不生成新链接。</role>
<context>
用户当前目标：${i}
用户过去反馈：
${n}
</context>
<criteria>
  <item>选 3-4 条，可以一条都不选；如果候选质量足够，至少包含 1 条 paper 或 book</item>
  <item>必须包含 1 条 perspective=counterpoint 的候选，除非所有 counterpoint 候选都明显低质或不相关</item>
  <item>先判断对这次收藏上下文是否有新信息，再判断来源是否配得上这个问题</item>
  <item>研究问题优先原始论文、大学、机构或方法文档；人文问题优先原始文本、档案、出版机构和有编辑责任的长文；实用问题优先官方文档和可验证实例</item>
  <item>拒绝 SEO 内容农场、无来源转载、只重复已知内容的浅摘要</item>
  <item>反馈“有用”表示延续其信息增量和来源类型，不是机械重复标题；反馈“不相关”的具体材料不得再次选择，也不要用同义标题换壳</item>
  <item>qualityReason 用一个短句说明这个来源带来的增量，不要宣称没有证据的权威性</item>
</criteria>
<candidates>
${a}
</candidates>
<output>只返回 JSON：{"selected":[{"index":0,"qualityReason":"增量理由"}]}</output>
</task>`;try{let t=await (0,l.W6)([{role:"user",content:s}],r,{temperature:.1,maxTokens:700,responseFormat:"json_object"}),i=(0,d.QW)(t.content),n=new Set;return(i?.selected??[]).filter(t=>Number.isInteger(t.index)&&t.index>=0&&t.index<e.length).filter(e=>!n.has(e.index)&&(n.add(e.index),!0)).slice(0,4).map(t=>({candidate:e[t.index],qualityReason:t.qualityReason?.slice(0,80)}))}catch(t){return P.warn("external ranking failed",t),e.filter(e=>e.sourceScore>=4).slice(0,4).map(e=>({candidate:e}))}}function E(e){let t=["web","paper","book","report"],r=(e.contentKinds??[]).filter(e=>t.includes(e));return{query:e.query.slice(0,180),academicQuery:e.academicQuery?.slice(0,180),bookQuery:e.bookQuery?.slice(0,180),reason:e.reason.slice(0,180),perspective:["deepen","adjacent","counterpoint"].includes(e.perspective??"")?e.perspective:"adjacent",contentKinds:r.length>0?r:["web","paper","book"],sourceCaptureIds:e.sourceCaptureIds,goalLabel:e.goalLabel}}let M={generateFeed:async function(e,t,r={}){if(0===t.length)throw Error("转录内容为空");let i=r.model??S,n=function(e,t){let r=(0,p.r0)(e),i=[];t.learnerProfile?.bio?.headline&&(i.push(`这个人：${t.learnerProfile.bio.headline}`),t.learnerProfile.bio.detail&&i.push(t.learnerProfile.bio.detail));let n=(t.learnerProfile?.goals??[]).filter(e=>!e.summary||"completed"!==e.summary).slice(0,3);n.length>0&&(i.push("他正在追的事："),n.forEach(e=>{i.push(`  \xb7 ${e.title}${e.summary?`（${e.summary.slice(0,50)}）`:""}`)}));let a=i.length>0?i.join("\n"):"（还没有明确的个人上下文或目标）",s=(t.notes??[]).length>0?t.notes.slice(0,8).map(e=>`  \xb7 ${e.text}`).join("\n"):"（这节课没有笔记）",o=(t.confusions??[]).length>0?t.confusions.map(e=>`  \xb7 ${e.text}${e.timestampLabel?` [${e.timestampLabel}]`:""}`).join("\n"):"（没有标记困惑）",l=t.sessionInfo?.subject||t.sessionInfo?.topic?`${t.sessionInfo.subject??""}${t.sessionInfo.topic?` \xb7 ${t.sessionInfo.topic}`:""}`:"（未知课程）";return`<task>
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从这节课里挑出对他重要的部分，再给出他可能想接着看的方向。</role>
<context>
这是「${l}」的一节课。

【这个人】
${a}

【他在这节课记的笔记】
${s}

【他标记的困惑】
${o}
</context>
<goal>生成一份信息流，不是全量总结。只根据用户明确提供的目标、笔记、困惑和课堂证据做取舍。</goal>
<instructions>
  <step name="个人化总结（1条，type=summary）">
    <description>2-3句话概括这节课的核心，但要从「对他」的角度写——基于他的目标/阶段/困惑，说这节课里哪些部分对他重要。</description>
    <example>你今天学了不定积分。换元法那段你标了困惑，而这恰好是考研高频题型——值得重点搞懂。</example>
  </step>
  <step name="延伸探针（${_}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于当前目标、笔记、困惑和课堂内容，给出可能值得接着看的方向。</description>
    <types>
      <item>probe-near：同主题的下一步（如这节课讲了积分，下一步是定积分）</item>
      <item>probe-lateral：相关方向（如基于考研目标，积分的应用题）</item>
      <item>probe-bridge：跨界关联（如编程里的数值积分）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须引用明确目标、笔记或困惑；没有根据就省略，不要编造。</criteria>
  </step>
  <step name="困惑关联（如有困惑标记，1-2条，type=confusion-link）">
    <description>把他标记的困惑点和课堂内容或前置知识关联起来，给他一个可以着手的下一步。</description>
    <example>你在换元法处标了困惑——这节课[15:30]老师讲了选 u 的技巧，可以先跳回去重听这段。</example>
  </step>
</instructions>
<qualityControl>
  <item>总条数不超过 ${q} 条</item>
  <item>每条 body 控制在 2 句话以内</item>
  <item>时间戳必须对应转录里的真实时刻</item>
  <item>不要面面俱到——省略对他不重要的部分</item>
  <item>不要用"建议""应该"这种指令语气——像旁边同学递话</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象：
{
  "items": [
    {
      "type": "summary" | "probe-near" | "probe-lateral" | "probe-bridge" | "confusion-link",
      "title": "标题（不超过12字）",
      "body": "2句话以内的说明",
      "timestamps": ["MM:SS"],
      "actionLabel": "动作按钮文案（如"跳回去听"、"做成闪卡"）",
      "actionType": "jump-timestamp" | "make-flashcard" | "ask-tutor" | "review-prev",
      "whyForYou": "为什么现在对他有用（必须有真实上下文根据）"
    }
  ]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
<transcript><![CDATA[
${r}
]]></transcript>
</task>`}(t,r),a=await (0,l.W6)([{role:"user",content:n}],i,{temperature:.4,maxTokens:1500,responseFormat:"json_object"}),s=(0,d.QW)(a.content);if(!s||!Array.isArray(s.items))throw Error("无法解析信息流响应");return{items:s.items.filter(e=>e.title&&e.body&&A.includes(e.type)).map(e=>{let t={type:e.type,title:e.title.slice(0,20),body:e.body};return Array.isArray(e.timestamps)&&e.timestamps.length>0&&(t.timestamps=e.timestamps.slice(0,2)),e.actionLabel&&(t.actionLabel=e.actionLabel.slice(0,12)),e.actionType&&C.includes(e.actionType)&&(t.actionType=e.actionType),e.whyForYou&&(t.whyForYou=e.whyForYou),t}).slice(0,q)}},generateCrossCourseFeed:async function(e,t={}){let r=!!(t.learningContext?.activeThread?.title||t.learningContext?.memories?.length||t.learnerProfile?.goals?.length);if(0===e.length&&!r&&!t.learnerProfile?.goals?.length)throw Error("还没有可用于生成情报的学习上下文");let i=t.model??S,n=function(e,t){let r=e.slice(0,12).map((e,t)=>{let r=(e.normalizedText??"").slice(0,800),i=e.occurredAt?`（${e.occurredAt.slice(0,10)}）`:"",n=[e.source?.platformLabel,e.source?.author].filter(Boolean).join(" \xb7 "),a=e.source?.contentState==="complete"?"正文完整":e.source?.contentState==="partial"?"只有摘要":e.source?.contentState==="link-only"?"只有原链接":e.source?.contentState==="failed"?"正文读取失败":e.source?.contentState==="extracting"?"正文仍在读取":"",s=n||a?`来源：${n||"未标注"}${a?`；${a}`:""}`:"";return`【收集${t+1}】[id=${e.id}] ${e.title}${i}
${s}${s?"\n":""}${r||"（没有可验证正文，只能使用标题和来源，不能推断文章观点）"}`}).join("\n\n"),i=[];t.learnerProfile?.bio?.headline&&(i.push(`这个人：${t.learnerProfile.bio.headline}`),t.learnerProfile.bio.detail&&i.push(t.learnerProfile.bio.detail));let n=(t.learnerProfile?.goals??[]).filter(e=>!e.summary||"completed"!==e.summary).slice(0,3);n.length>0&&(i.push("他正在追的事："),n.forEach(e=>{i.push(`  \xb7 ${e.title}${e.summary?`（${e.summary.slice(0,50)}）`:""}`)}));let a=i.length>0?i.join("\n"):"（还没有明确的个人上下文或目标）",s=[];if(t.learningContext?.activeThread?.title){let e=t.learningContext.activeThread;s.push(`正在继续：${e.title}`),e.intent&&s.push(`目标：${e.intent}`),e.lastSummary&&s.push(`已经对齐：${e.lastSummary}`),e.nextStep&&s.push(`下一步：${e.nextStep}`)}for(let e of t.learningContext?.memories?.slice(-8)??[])s.push(`长期线索：${e.title}${e.detail?`（${e.detail.slice(0,100)}）`:""}`);for(let e of t.learningContext?.recentActivities?.slice(-6)??[])s.push(`最近做过：${e.title}${e.detail?`（${e.detail.slice(0,100)}）`:""}`);let o=s.length>0?s.join("\n"):"（还没有持续学习线索）",l=(t.notes??[]).length>0?(t.notes??[]).slice(0,10).map(e=>`  \xb7 ${e.text}`).join("\n"):"（还没有笔记）",c=(t.feedback??[]).length>0?(t.feedback??[]).slice(0,12).map(e=>`  \xb7 ${"up"===e.rating?"有用":"不相关"}：${e.title}${e.whyForYou?`（${e.whyForYou}）`:""}`).join("\n"):"（还没有信息流反馈）";return`<task>
<role>你是 MeetMind 的同学。你不做面面俱到的总结——你基于对「这个人」的了解，从他的学习线和最近收集里挑出重要方向，再给出他可能想接着看的下一步。即使暂时没有新收藏，只要他刚确认了明确目标，也可以从那条学习线出发寻找真实资料。</role>
<context>
这个人最近有 ${e.length} 条可用收集；同时保留了他正在推进的学习线。

【这个人】
${a}

【正在形成的学习线】
${o}

【他跨课程记的笔记】
${l}

【他对过去推荐的反馈】
${c}

【他最近的收集】
${r||"（还没有收集内容）"}
</context>
<goal>生成一份跨课程信息流，不是每条收集的复述。从真实收藏、明确目标、学习活动和过去反馈中判断现在值得关注的方向。</goal>
<instructions>
  <step name="跨课程沉淀（1条，type=summary）">
    <description>2-3句话，概括他最近收集的整体走向——从他的目标/阶段角度，说这些内容合在一起在指向什么。不要逐条复述。</description>
    <example>你最近收的这几节课都在讲积分技巧，加上那篇换元法的文章——你在啃考研数学的硬骨头。</example>
  </step>
  <step name="延伸探针（${_}条，type=probe-near / probe-lateral / probe-bridge）">
    <description>基于明确目标、收藏内容和反馈，给出现在值得接着看的方向。</description>
    <types>
      <item>probe-near：同主题的下一步</item>
      <item>probe-lateral：相关方向</item>
      <item>probe-bridge：跨界关联（如编程/物理里对应的概念）</item>
    </types>
    <criteria>不要给泛泛的"多做题"——要具体到知识点。whyForYou 必须指回某条真实收藏、目标或反馈；没有根据就省略。</criteria>
  </step>
</instructions>
<qualityControl>
  <item>总条数不超过 ${q} 条</item>
  <item>每条 body 控制在 2 句话以内</item>
  <item>不要面面俱到——省略对他不重要的收集</item>
  <item>不要用"建议""应该"这种指令语气——像旁边同学递话</item>
  <item>不要输出时间戳——这是跨课程信息流，没有统一时间轴</item>
  <item>actionType 只用 open-capture（让用户跳回某条收集）或 ask-tutor；不要用 jump-timestamp</item>
  <item>同时生成 3 个用于外部检索的检索计划，不要直接编造外部内容：至少 1 个 deepen，至少 1 个 counterpoint</item>
  <item>不要把用户归类成固定人群。查询必须同时来至这次真实收藏上下文和用户当前目标</item>
  <item>counterpoint 不是随机猎奇：它要与当前问题共享事实基础，但提供不同学科、不同方法或不同立场，帮助用户检验原有判断</item>
  <item>contentKinds 从 web / paper / book / report 中选 1-3 种；学术问题优先包含 paper，人文与长期理解优先包含 book</item>
  <item>academicQuery 使用适合论文数据库的英文主题词；bookQuery 使用适合图书目录的主题、作者或经典书名线索。没有必要时可以省略</item>
  <item>尊重过去反馈：延续“有用”内容的价值类型，避免与“不相关”内容重复选题，但不要由一次反馈永久封闭一个主题</item>
  <item>禁止心理诊断和隐性动机推断：不要使用“焦虑投射”“强迫”“安全感”等缺少用户明确表达的心理归因。只描述可见的收藏、目标和行为</item>
  <item>有真实收藏时，每个查询返回 1-3 个 sourceCaptureIds；没有收藏但有明确学习线时，sourceCaptureIds 允许为空，必须把查询落到真实 activeThread / memory，并用对应标题作为 goalLabel</item>
  <item>优先使用“正文完整”的收藏形成结论；“只有摘要”只能支持有限判断；“只有原链接/读取失败”的内容不得据此概括原文观点</item>
  <item>来源平台和作者只是可信度线索，不代表内容一定正确；推荐理由仍要落到实际正文和用户目标</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象：
{
  "items": [
    {
      "type": "summary" | "probe-near" | "probe-lateral" | "probe-bridge",
      "title": "标题（不超过12字）",
      "body": "2句话以内的说明",
      "actionLabel": "动作按钮文案（如"看这条收集"、"问同学"）",
      "actionType": "open-capture" | "ask-tutor",
      "captureId": "若 actionType=open-capture，填对应收集的 id；否则省略",
      "whyForYou": "为什么现在对他有用（必须有真实上下文根据）"
    }
  ],
  "externalDiscoveries": [
    {
      "query": "可直接交给搜索引擎的精确查询，包含主题、内容类型与必要的来源限定",
      "academicQuery": "适合论文数据库的英文关键词，可省略",
      "bookQuery": "适合图书目录的中英文关键词，可省略",
      "reason": "它与用户哪条收藏或哪个目标相关",
      "perspective": "deepen | adjacent | counterpoint",
      "contentKinds": ["web", "paper", "book", "report"],
      "sourceCaptureIds": ["上下文中真实的收藏 id"],
      "goalLabel": "上下文中真实的目标标题，无匹配时省略"
    }
  ]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
</task>`}(e,t),a=await (0,l.W6)([{role:"user",content:n}],i,{temperature:.4,maxTokens:2400,responseFormat:"json_object"});P.info("generation completed",{responseChars:a.content.length,usage:a.usage});let s=(0,d.QW)(a.content);if(!s||!Array.isArray(s.items))throw P.error("response parse failed",{responseChars:a.content.length}),Error("无法解析信息流响应");let o=s.items.filter(e=>e.title&&e.body&&j.includes(e.type)).filter(e=>{var t;return t=`${e.title} ${e.body} ${e.whyForYou??""}`,!/焦虑投射|细节强迫症|零容忍心态|寻找.{0,8}安全感|消除.{0,8}不确定性/.test(t)}).map(e=>{let t={type:e.type,title:e.title.slice(0,20),body:e.body};e.actionLabel&&!/^暂?无|不操作|无需/.test(e.actionLabel)&&(t.actionLabel=e.actionLabel.slice(0,12));let r=e.actionType;return r&&T.includes(r)&&(t.actionType=r),e.whyForYou&&(t.whyForYou=e.whyForYou),e.captureId&&(t.captureId=String(e.captureId)),t}).slice(0,q),c=[];try{let r={query:o.filter(e=>"summary"!==e.type).slice(0,2).map(e=>e.title).join(" ")||e[0]?.title||t.learningContext?.activeThread?.title||t.learningContext?.memories?.at(-1)?.title||t.learnerProfile?.goals?.[0]?.title||"学习方法",reason:e.length>0?"延伸你最近收集的主题":"沿着你正在推进的学习目标补充真实资料",perspective:"deepen",contentKinds:["web","paper","book"],sourceCaptureIds:e.slice(0,2).map(e=>e.id),goalLabel:t.learningContext?.activeThread?.title||t.learnerProfile?.goals?.[0]?.title},n=(s.externalDiscoveries??[]).filter(e=>e.query&&e.reason).slice(0,3),a=(n.length>0?n:[r]).map(E),l=function(e,t){let r=new Map;for(let e of t??[]){if("web-recommend"!==e.type&&"bili-recommend"!==e.type)continue;let t=I(e.title);t&&!r.has(t)&&r.set(t,e.rating)}let i=new Set([...r.entries()].filter(([,e])=>"down"===e).map(([e])=>e));return 0===i.size?e:e.filter(e=>!i.has(I(e.title.slice(0,100))))}((await f(a)).filter(e=>(function(e){try{let t=new URL(e).hostname.replace(/^www\./,"");return!L.some(e=>t===e||t.endsWith(`.${e}`))}catch{return!1}})(e.url)),t.feedback);c=(await R(l,t,i)).map(({candidate:r,qualityReason:i})=>{let{discovery:n}=r;return{type:"web-recommend",title:r.title.slice(0,100),body:r.snippet.slice(0,360),contentUrl:r.url,upName:r.sourceLabel,coverUrl:r.coverUrl,contentKind:r.contentKind,authors:r.authors,publishedAt:r.publishedAt,perspective:n.perspective,actionType:"open-external",actionLabel:"打开原文",whyForYou:(i||n.reason).slice(0,120),sourceCaptureIds:function(e,t){let r=new Set(t.map(e=>e.id));return[...new Set(e??[])].filter(e=>r.has(e)).slice(0,3)}(n.sourceCaptureIds,e),goalLabel:function(e,t){if(!e)return;let r=(t??[]).find(t=>t.title===e);return r?.title.slice(0,60)}(n.goalLabel,[...t.learnerProfile?.goals??[],...t.learningContext?.activeThread?.title?[{title:t.learningContext.activeThread.title}]:[]])}})}catch(e){P.warn("external discovery failed",e)}return{items:[...o,...c]}}};var D=r(39498),F=r(45457),N=r(37462);let U=/^\[feed:([^:]+):/;function K(e){try{let t=JSON.parse(e.content);if("intelligence-feed"!==t.mode||"up"!==t.rating&&"down"!==t.rating||"string"!=typeof t.messageText)return null;let r=t.messageText.split("\n")[0]?.trim().slice(0,120),i=e.title.match(U);if(!r||!i?.[1])return null;let n=t.messageText.split("\n");return{type:i[1],title:r,whyForYou:n[2]?.trim().slice(0,160)||void 0,rating:t.rating,createdAt:e.createdAt.toISOString()}}catch{return null}}async function Y(e){return(await N.Z.feedback.findMany({where:{userId:e,type:"message-rating",content:{contains:'"mode":"intelligence-feed"'}},orderBy:{createdAt:"desc"},take:40,select:{title:!0,content:!0,createdAt:!0}})).map(K).filter(e=>null!==e)}let O=(0,u.hu)("api/feed");async function z(e){let t=await (0,D.Iy)(e,"generateSummary");if(t)return t;try{let t=await e.json(),r=t.mode??"cross-course";if("cross-course"===r){if(!t.workspaceId)return o.NextResponse.json({success:!1,error:"缺少 workspaceId"},{status:400});let r=!!(t.learningContext?.activeThread?.title||t.learningContext?.memories?.length||t.learnerProfile?.goals?.length);if((!t.captures||0===t.captures.length)&&!r)return o.NextResponse.json({success:!1,error:"还没有可用于生成情报的学习上下文"},{status:400});let i=function(e){let t=e.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||e.cookies.get("accessToken")?.value;return t?F.O.verifyToken(t)?.sub??null:null}(e),n=i?await Y(i):[],a=function(e,t){let r=[],i=new Set;for(let n of[...e??[],...t??[]]){if(!n||"up"!==n.rating&&"down"!==n.rating||!n.title)continue;let e=`${n.type}:${n.title}`;if(!i.has(e)&&(i.add(e),r.push({type:n.type,title:n.title.slice(0,120),whyForYou:n.whyForYou?.slice(0,160),rating:n.rating,createdAt:n.createdAt}),r.length>=20))break}return r}(t.feedback,n),s=await M.generateCrossCourseFeed(t.captures??[],{learnerProfile:t.learnerProfile,notes:t.notes,feedback:a,learningContext:t.learningContext});return o.NextResponse.json({success:!0,items:s.items})}if(!t.sessionId)return o.NextResponse.json({success:!1,error:"缺少 sessionId"},{status:400});if(!t.transcript||0===t.transcript.length)return o.NextResponse.json({success:!1,error:"缺少转录内容"},{status:400});let i=t.transcript.map((e,r)=>({id:e.id?parseInt(e.id):r,sessionId:t.sessionId,userId:"anonymous",text:e.text,startMs:e.startMs,endMs:e.endMs,confidence:1,isFinal:!0})),n=await M.generateFeed(t.sessionId,i,{learnerProfile:t.learnerProfile,notes:t.notes,confusions:t.confusions,sessionInfo:t.sessionInfo});return o.NextResponse.json({success:!0,items:n.items})}catch(t){O.error("生成信息流失败:",t);let e=t instanceof Error?t.message:"生成失败";return O.warn("生成信息流失败详情:",e),o.NextResponse.json({success:!1,error:t instanceof Error?t.message:"生成失败"},{status:500})}}let H=new n.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/feed/route",pathname:"/api/feed",filename:"route",bundlePath:"app/api/feed/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/feed/route.ts",nextConfigOutput:"",userland:i}),{requestAsyncStorage:B,staticGenerationAsyncStorage:Q,serverHooks:W}=H,G="/api/feed/route";function J(){return(0,s.patchFetch)({serverHooks:W,staticGenerationAsyncStorage:Q})}},2854:(e,t,r)=>{r.d(t,{gd:()=>s,wW:()=>m});let i=(0,r(30357).hu)("web-search"),n=process.env.BING_SEARCH_API_KEY,a=process.env.SERP_API_KEY;async function s(e,t={}){let r=[];for(let s of[{name:"Bing",fn:()=>o(e,t),available:!!n},{name:"SerpAPI",fn:()=>l(e,t),available:!!a},{name:"DuckDuckGo HTML",fn:()=>u(e,t),available:!0},{name:"DuckDuckGo Instant",fn:()=>c(e,t),available:!0}])if(s.available)try{if((r=await s.fn()).length>0)break}catch(e){i.warn(`[WebSearchExact] ${s.name} failed:`,e)}return r.filter(e=>e.title&&e.url&&e.snippet).map((e,t)=>({id:`web-exact-${Date.now()}-${t}`,title:e.title,url:e.url,snippet:e.snippet,source_type:"web"}))}async function o(e,t={}){if(!n)throw Error("Bing API Key not configured");let{maxResults:r=5,market:i="zh-CN"}=t,a=new URL("https://api.bing.microsoft.com/v7.0/search");a.searchParams.set("q",e),a.searchParams.set("count",r.toString()),a.searchParams.set("mkt",i),a.searchParams.set("responseFilter","Webpages");let s=await fetch(a.toString(),{headers:{"Ocp-Apim-Subscription-Key":n},signal:AbortSignal.timeout(1e4)});if(!s.ok)throw Error(`Bing search failed: ${s.status}`);let o=await s.json();return(o.webPages?.value||[]).map(e=>({title:e.name||"",url:e.url||"",snippet:e.snippet||"",displayUrl:e.displayUrl}))}async function l(e,t={}){if(!a)throw Error("SerpAPI Key not configured");let{maxResults:r=5}=t,i=new URL("https://serpapi.com/search");i.searchParams.set("q",e),i.searchParams.set("api_key",a),i.searchParams.set("num",r.toString()),i.searchParams.set("hl","zh-CN"),i.searchParams.set("gl","cn");let n=await fetch(i.toString(),{signal:AbortSignal.timeout(1e4)});if(!n.ok)throw Error(`SerpAPI search failed: ${n.status}`);return((await n.json()).organic_results||[]).map(e=>({title:e.title||"",url:e.link||"",snippet:e.snippet||"",displayUrl:e.displayed_link}))}async function c(e,t={}){let{maxResults:r=5}=t,n=new URL("https://api.duckduckgo.com/");n.searchParams.set("q",e),n.searchParams.set("format","json"),n.searchParams.set("no_html","1"),n.searchParams.set("skip_disambig","1");try{let t=await fetch(n.toString(),{signal:AbortSignal.timeout(1e4)});if(!t.ok)throw Error(`DuckDuckGo search failed: ${t.status}`);let i=await t.json(),a=[];if(i.AbstractText&&i.AbstractURL&&a.push({title:i.Heading||e,url:i.AbstractURL,snippet:i.AbstractText}),i.RelatedTopics)for(let e of i.RelatedTopics.slice(0,r-a.length))e.FirstURL&&e.Text&&a.push({title:e.Text.split(" - ")[0]||e.Text.slice(0,50),url:e.FirstURL,snippet:e.Text});return a}catch(e){return i.warn("DuckDuckGo search failed:",e),[]}}async function u(e,t={}){let{maxResults:r=5}=t,n=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(e)}`;try{let e=await fetch(n,{headers:{"user-agent":"Mozilla/5.0 (compatible; MeetMind/1.0)"},signal:AbortSignal.timeout(1e4)});if(!e.ok)throw Error(`DuckDuckGo HTML search failed: ${e.status}`);let t=(await e.text()).split(/<div[^>]+class="result results_links[^>]*>/i).slice(1),i=[];for(let e of t){let t=e.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i),n=e.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);if(!t||!n)continue;let a=function(e){try{let t=new URL(e.startsWith("//")?`https:${e}`:e,"https://duckduckgo.com");return t.searchParams.get("uddg")||t.toString()}catch{return""}}(d(t[1]));if(a&&(i.push({title:p(t[2]),url:a,snippet:p(n[1])}),i.length>=r))break}return i}catch(e){return i.warn("DuckDuckGo HTML search failed:",e),[]}}function p(e){return d(e.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim())}function d(e){return e.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")}async function m(e,t={}){let r=function(e){let t=[];for(let r of[/(?:二次函数|一次函数|抛物线|顶点|对称轴|开口方向|系数|根|零点)/g,/(?:方程|不等式|因式分解|配方法|求根公式)/g,/(?:力|速度|加速度|功率|能量|动量|电流|电压|电阻)/g,/(?:原子|分子|化学键|离子|氧化还原|酸碱|化学方程式)/g,/(?:定理|公式|定义|性质|特点|规律|原理|定律)/g]){let i=e.match(r);i&&t.push(...i)}return[...new Set(t)].slice(0,5)}(e),s=r.length>0?`${r.slice(0,3).join(" ")} 知识点 讲解`:e.replace(/[【】\[\]{}()（）]/g," ").replace(/\s+/g," ").trim().slice(0,100),p=[];for(let e of[{name:"Bing",fn:()=>o(s,t),available:!!n},{name:"SerpAPI",fn:()=>l(s,t),available:!!a},{name:"DuckDuckGo HTML",fn:()=>u(s,t),available:!0},{name:"DuckDuckGo Instant",fn:()=>c(s,t),available:!0}])if(e.available)try{if((p=await e.fn()).length>0)break}catch(t){i.warn(`[WebSearch] ${e.name} failed:`,t)}return 0===p.length?function(e,t){let r=[],i={quadratic:t.some(e=>["二次函数","抛物线","顶点","对称轴"].includes(e))||e.includes("二次函数")||e.includes("抛物线"),linear:t.some(e=>["一次函数","斜率","截距"].includes(e))||e.includes("一次函数"),equation:t.some(e=>["方程","求解","根"].includes(e))||e.includes("方程"),geometry:e.includes("几何")||e.includes("三角形")||e.includes("圆"),physics:e.includes("物理")||e.includes("力")||e.includes("运动"),chemistry:e.includes("化学")||e.includes("原子")||e.includes("分子")};if(i.quadratic&&r.push({id:`edu-${Date.now()}-1`,title:"二次函数的图像与性质 - 中考数学知识点",url:"https://www.zhihu.com/search?type=content&q=二次函数",snippet:"二次函数 y = ax\xb2 + bx + c (a≠0) 的图像是抛物线。当 a > 0 时开口向上，a < 0 时开口向下。顶点坐标为 (-b/2a, (4ac-b\xb2)/4a)，对称轴为 x = -b/2a。",source_type:"web"},{id:`edu-${Date.now()}-2`,title:"二次函数三种形式详解 - B站数学教程",url:"https://search.bilibili.com/all?keyword=二次函数",snippet:"二次函数的一般式 y=ax\xb2+bx+c、顶点式 y=a(x-h)\xb2+k、交点式 y=a(x-x₁)(x-x₂) 各有特点，选择合适的形式可以简化计算。",source_type:"web"}),i.linear&&r.push({id:`edu-${Date.now()}-3`,title:"一次函数基础知识总结",url:"https://www.zhihu.com/search?type=content&q=一次函数",snippet:"一次函数 y = kx + b (k≠0) 的图像是直线，k 称为斜率，b 称为截距。k > 0 时直线从左下到右上，k < 0 时从左上到右下。",source_type:"web"}),i.equation&&r.push({id:`edu-${Date.now()}-4`,title:"方程求解方法大全 - 数学技巧",url:"https://www.zhihu.com/search?type=content&q=方程求解",snippet:"常见的方程求解方法包括：直接开方法、配方法、公式法、因式分解法、换元法等。选择合适的方法可以事半功倍。",source_type:"web"}),i.physics&&r.push({id:`edu-${Date.now()}-5`,title:"物理学习资源汇总",url:"https://www.zhihu.com/search?type=content&q=初中物理",snippet:"物理学习的关键是理解概念、掌握公式、多做实验。力学、热学、电学、光学各有侧重点。",source_type:"web"}),0===r.length){let i=t.length>0?t.join("+"):encodeURIComponent(e.slice(0,30));r.push({id:`edu-${Date.now()}-generic-1`,title:"在知乎搜索相关知识",url:`https://www.zhihu.com/search?type=content&q=${i}`,snippet:"知乎上有大量优质的学习内容和问答，可以帮助你深入理解这个知识点。",source_type:"web"},{id:`edu-${Date.now()}-generic-2`,title:"在 B 站搜索教学视频",url:`https://search.bilibili.com/all?keyword=${i}`,snippet:"B 站有丰富的教学视频资源，通过视频讲解可以更直观地理解知识点。",source_type:"web"})}return r}(e,r):p.map((e,t)=>({id:`web-${Date.now()}-${t}`,title:e.title,url:e.url,snippet:e.snippet,source_type:"web"}))}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[6662,9811,523,3219,7914,8261,6682,8367,5457,6018,1990],()=>r(75686));module.exports=i})();