"use strict";(()=>{var e={};e.id=8736,e.ids=[8736],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},11612:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>C,patchFetch:()=>F,requestAsyncStorage:()=>w,routeModule:()=>A,serverHooks:()=>v,staticGenerationAsyncStorage:()=>O});var s={};r.r(s),r.d(s,{OPTIONS:()=>$,POST:()=>k});var n=r(88255),i=r(75657),o=r(37391),a=r(43955),l=r(76018),d=r(75441),u=r(73548),c=r(30357),p=r(84578),m=r(58261);let x=m.HA.highlights.defaultModel,g=m.HA.highlights.fastModel,h=m.HA.highlights.chunkMaxCandidates,f=m.HA.highlights.maxTopics,q=m.HA.highlights.minTopics;function M(e,t,r){let s=(0,d.FV)(e.text).length;if(0===s)return{startMs:e.startMs,endMs:e.endMs};let n=(e.endMs-e.startMs)/s;return{startMs:e.startMs+t*n,endMs:e.startMs+r*n}}let I=(0,c.hu)("highlight"),T={generateTopics:async function e(e,t,r={}){let s;if(0===t.length)return{topics:[],modelUsed:""};let n=r.mode??"fast",i=r.model??("smart"===n?x:g),o=r.maxTopics??f,a=t[t.length-1].endMs,c=a<=18e5,m=[];if("smart"===n||c){let e=function(e,t){let r=(0,d.r0)(e),s=t.maxTopics??f,n=t.minTopics??q,i=t.theme?`<themeFilter>只选择与"${t.theme}"相关的内容</themeFilter>`:"";return`<task>
<role>你是一位专业的内容策划师，负责从音视频转录中提取精华片段。</role>
<context>
这是一段录音的转录文本。
</context>
<goal>从转录文本中提取 ${n}-${s} 个最有价值的片段。根据实际内容自行判断主题，找出值得回顾的重点。</goal>
<instructions>
  <step name="识别主题">
    <description>分析整个转录文本，找出最有价值的内容片段。</description>
    <criteria>
      <item>重要概念：核心定义、关键信息</item>
      <item>关键对话：重要的问答或讨论</item>
      <item>实例说明：生动的例子或具体案例</item>
      <item>方法技巧：实用的方法或建议</item>
      <item>总结要点：重点强调或总结性内容</item>
    </criteria>
  </step>
  <step name="选择片段">
    <description>为每个主题选择最能说明问题的片段。</description>
    <criteria>
      <item>片段应该是连续的，时长约 10-60 秒</item>
      <item>必须是原文逐字引用，不能改写或省略</item>
      <item>片段应该能独立理解，有完整的上下文</item>
    </criteria>
  </step>
</instructions>
<qualityControl>
  <item>每个片段标题简洁有力，不超过15个字</item>
  <item>片段之间不应有内容重叠</item>
  <item>片段应分布在录音的不同时间段</item>
  <item>必须返回至少1个片段，即使内容较短</item>
</qualityControl>
${i}
<outputFormat>
返回严格的 JSON 数组，格式如下：
[
  {
    "title": "片段标题",
    "quote": {
      "timestamp": "[MM:SS-MM:SS]",
      "text": "原文引用内容（必须与转录完全一致）"
    }
  }
]
不要包含任何 markdown 标记或其他说明文字。如果转录有内容，必须返回至少1个片段。
</outputFormat>
<transcript><![CDATA[
${r}
]]></transcript>
</task>`}(t,r);try{let t=await (0,l.W6)([{role:"user",content:e}],i,{temperature:.3,maxTokens:4e3});m=(0,u.QW)(t.content)??[]}catch(e){throw I.error("[highlightService] LLM 调用失败:",e),e}}else{let e=(0,d.Cw)(t);if((s=function(e){let t=new Set;return e.filter(e=>{let r=e.quote.timestamp+e.title.slice(0,10);return!t.has(r)&&(t.add(r),!0)})}((await Promise.all(e.map(async(e,t)=>{let s=function(e,t,r){let s=(0,d.r0)(e.segments),n=`${(0,p.i$)(e.startMs)} - ${(0,p.i$)(e.endMs)}`,i=r?`<item>只关注与"${r}"相关的内容</item>`:"";return`<task>
<role>你是一位内容策划师，正在审阅录音转录的一部分。</role>
<context>
片段时间范围: ${n}
</context>
<goal>从这段转录中找出最多 ${t} 个值得标记的重点内容。</goal>
<instructions>
  <item>只使用本片段中的内容。如果没有突出内容，返回空数组。</item>
  <item>每个重点需要一个简洁的标题（不超过15字）和一段连续的原文引用（约10-60秒）。</item>
  <item>引用必须与转录完全匹配，不能改写。</item>
  <item>使用 [MM:SS-MM:SS] 格式的绝对时间戳。</item>
  ${i}
</instructions>
<outputFormat>返回严格的 JSON 数组：[{"title":"string","quote":{"timestamp":"[MM:SS-MM:SS]","text":"原文引用"}}]</outputFormat>
<transcriptChunk><![CDATA[
${s}
]]></transcriptChunk>
</task>`}(e,h,r.theme);try{let t=await (0,l.W6)([{role:"user",content:s}],g,{temperature:.3,maxTokens:1e3});return((0,u.QW)(t.content)??[]).map(t=>({key:`${e.chunkIndex}-${t.title.slice(0,10)}`,title:t.title,quote:t.quote}))}catch(e){return I.error(`[highlightService] 块 ${t} 处理失败:`,e),[]}}))).flat().filter(e=>e.quote))).length>o){let e=function(e,t){let r=e.map((e,t)=>`${t+1}. 标题: ${e.title}
   时间: ${e.quote.timestamp}
   引用: ${e.quote.text.slice(0,100)}...`).join("\n\n");return`<task>
<role>你是一位内容编辑，负责整理最终的精华片段列表。</role>
<context>
你有 ${e.length} 个候选片段。
</context>
<goal>从中选择最优质、最有代表性的 ${t} 个片段。</goal>
<instructions>
  <item>选择最有价值、最独特的片段。</item>
  <item>如果两个候选内容重叠，保留更好的那个。</item>
  <item>可以优化标题使其更清晰，但必须保持原有的引用文本和时间戳。</item>
  <item>返回格式：[{"candidateIndex": 数字, "title": "优化后的标题"}]，索引从1开始。</item>
</instructions>
<candidates><![CDATA[
${r}
]]></candidates>
</task>`}(s,o),t=await (0,l.W6)([{role:"user",content:e}],i,{temperature:.2,maxTokens:1e3}),r=(0,u.QW)(t.content);m=r?r.filter(e=>e.candidateIndex>0&&e.candidateIndex<=s.length).map(e=>({title:e.title,quote:s[e.candidateIndex-1].quote})):s.slice(0,o).map(e=>({title:e.title,quote:e.quote}))}else m=s.map(e=>({title:e.title,quote:e.quote}))}let T=new Date().toISOString();return{topics:m.filter(e=>!!e.quote).map((r,s)=>{let n=function(e,t){let r,s,n;if(!t.text||t.text.length<3)return[];let i=(0,p.PH)(t.timestamp);i?0===(r=e.filter(e=>e.endMs>=i.startMs-3e4&&e.startMs<=i.endMs+3e4)).length&&(r=e):r=e;let o=[];for(let s=0;s<r.length;s++){let n=r[s],i=(0,d.tI)(t.text,n.text),a=e.indexOf(n);o.push({segments:[n],startIdx:a,endIdx:a,similarity:i,combinedText:n.text})}for(let s=0;s<r.length-1;s++){let n=r[s],i=r[s+1],a=e.indexOf(n),l=e.indexOf(i);if(l!==a+1)continue;let u=n.text+i.text,c=(0,d.tI)(t.text,u);o.push({segments:[n,i],startIdx:a,endIdx:l,similarity:c,combinedText:u})}for(let s=0;s<r.length-2;s++){let n=r[s],i=r[s+1],a=r[s+2],l=e.indexOf(n),u=e.indexOf(i),c=e.indexOf(a);if(u!==l+1||c!==u+1)continue;let p=n.text+i.text+a.text,m=(0,d.tI)(t.text,p);o.push({segments:[n,i,a],startIdx:l,endIdx:c,similarity:m,combinedText:p})}if(o.sort((e,t)=>t.similarity-e.similarity),0===o.length||o[0].similarity<.2)return[];let a=o[0],l=function(e,t,r=.6){let s=(0,d.FV)(e),n=(0,d.FV)(t);if(0===s.length||0===n.length)return null;let i=s.indexOf(n);if(-1!==i)return{startIdx:i,endIdx:i+n.length,matchedText:n};let o={start:0,length:0};for(let e=Math.min(n.length,s.length);e>=Math.floor(n.length*r);e--){for(let t=0;t<=n.length-e;t++){let r=n.slice(t,t+e),i=s.indexOf(r);if(-1!==i&&e>o.length){o={start:i,length:e};break}}if(o.length>0)break}return o.length>=Math.floor(n.length*r)?{startIdx:o.start,endIdx:o.start+o.length,matchedText:s.slice(o.start,o.start+o.length)}:null}(a.combinedText,t.text);if(l&&1===a.segments.length){let e=M(a.segments[0],l.startIdx,l.endIdx);s=e.startMs,n=e.endMs}else if(l&&a.segments.length>1){let e=0,t=0,r=l.startIdx;for(let s=0;s<a.segments.length;s++){let n=(0,d.FV)(a.segments[s].text).length;if(e+n>l.startIdx){t=s,r=l.startIdx-e;break}e+=n}e=0;let i=a.segments.length-1,o=l.endIdx;for(let t=0;t<a.segments.length;t++){let r=(0,d.FV)(a.segments[t].text).length;if(e+r>=l.endIdx){i=t,o=l.endIdx-e;break}e+=r}let u=M(a.segments[t],r,(0,d.FV)(a.segments[t].text).length),c=M(a.segments[i],0,o);s=u.startMs,n=c.endMs}else s=a.segments[0].startMs,n=a.segments[a.segments.length-1].endMs;return[{start:Math.max(0,s-2e3),end:n,text:a.combinedText,startSegmentIdx:a.startIdx,endSegmentIdx:a.endIdx,confidence:a.similarity}]}(t,r.quote),i=n.length>0?n[0].end-n[0].start:0;return{id:crypto.randomUUID(),sessionId:e,title:r.title,importance:function(e,t){if(0===e.length)return"medium";let r=e[0].end-e[0].start,s=e[0].start/t;return r>6e4||s<.1||s>.85?"high":"medium"}(n,a),duration:i,segments:n,quote:r.quote,createdAt:T,updatedAt:T}}).filter(e=>e.segments.length>0).sort((e,t)=>(e.segments[0]?.start??0)-(t.segments[0]?.start??0)),candidates:s,modelUsed:i}}};var y=r(39498);let S=(0,c.hu)("generate-topics");async function k(e){let t=await (0,y.Iy)(e,"generateTopics");if(t)return t;try{let t=await e.json();if(t.transcript&&t.transcript.length>0&&(t.transcript.slice(0,3).forEach((e,t)=>{}),t.transcript.filter(e=>!e.text||""===e.text.trim()).length,t.transcript.reduce((e,t)=>e+(t.text?.length||0),0)),!t.sessionId)return a.NextResponse.json({success:!1,error:"缺少 sessionId"},{status:400});if(!t.transcript||0===t.transcript.length)return a.NextResponse.json({success:!1,error:"缺少转录内容"},{status:400});let r=t.transcript.map((e,r)=>({id:e.id?parseInt(e.id):r,sessionId:t.sessionId,userId:"anonymous",text:e.text,startMs:e.startMs,endMs:e.endMs,confidence:e.confidence??1,isFinal:e.isFinal??!0})),s=await T.generateTopics(t.sessionId,r,{mode:t.mode,maxTopics:t.maxTopics,theme:t.theme,sessionInfo:t.sessionInfo,excludeTopicKeys:t.excludeTopicKeys?new Set(t.excludeTopicKeys):void 0});0===s.topics.length&&S.warn("[generate-topics] 警告：未生成任何主题！");let n={success:!0,topics:s.topics.map(e=>({id:e.id,title:e.title,importance:e.importance,duration:e.duration,segments:e.segments.map(e=>({start:e.start,end:e.end,text:e.text})),quote:e.quote})),modelUsed:s.modelUsed};return t.includeCandidatePool&&s.candidates&&(n.candidates=s.candidates),a.NextResponse.json(n)}catch(e){return S.error("[generate-topics] 错误:",e),a.NextResponse.json({success:!1,error:e instanceof Error?e.message:"生成失败"},{status:500})}}async function $(){return new a.NextResponse(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}})}let A=new n.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/generate-topics/route",pathname:"/api/generate-topics",filename:"route",bundlePath:"app/api/generate-topics/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/generate-topics/route.ts",nextConfigOutput:"",userland:s}),{requestAsyncStorage:w,staticGenerationAsyncStorage:O,serverHooks:v}=A,C="/api/generate-topics/route";function F(){return(0,o.patchFetch)({serverHooks:v,staticGenerationAsyncStorage:O})}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[6662,9811,523,3219,7914,8261,6682,8367,5457,6018,1990],()=>r(11612));module.exports=s})();