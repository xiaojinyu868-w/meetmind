"use strict";(()=>{var e={};e.id=9088,e.ids=[9088],e.modules={20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},85861:e=>{e.exports=require("node:sqlite")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},95383:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>m,patchFetch:()=>g,requestAsyncStorage:()=>c,routeModule:()=>d,serverHooks:()=>h,staticGenerationAsyncStorage:()=>x});var o={};t.r(o),t.d(o,{POST:()=>l});var s=t(88255),n=t(75657),i=t(37391),p=t(43955),a=t(76018);let u=(0,t(30357).hu)("classroom/foresight");async function l(e){try{let{recentText:r,lessonTitle:t,priorLabels:o}=await e.json();if(!r||r.trim().length<40)return p.NextResponse.json({foresights:[]});let s=r.trim().slice(-1200),n=o&&o.length>0?`
已经给过以下预感，不要重复：${o.slice(-6).join("、")}`:"",i=t?`
当前课程：${t}`:"",l=`你是这个学生的同桌，和他一起坐在教室里。你们刚刚一起听老师讲到这里——

${i?i.trim()+"\n\n":""}你手里有老师最近一段话的转录。你要做的一件事是：**预判这个学生此刻可能想伸手问你的一个小问题**。

注意：你的输出会出现在他对话框上方的 chip 上，他点一下就把这条 chip 当作问题发给你。所以这条 chip 必须是**他能直接发给你**的那个问题——不是你写给他看的小提示。

合格的（学生视角，第一人称问句 / 短问题）：
- "这个和刚才的 X 是同一个吗？"
- "为什么是 LC 不是 Transformer？"
- "这一步反例呢？"
- "三维下还成立吗？"

不合格的（你写给他看的小总结/旁白）：
- "接下来多半会推广到三维"  ← 这是预测，不是他想问的
- "这里和极限定义容易搞混"  ← 这是提示，不是他要问的
- "或许"、"大概"、"我觉得" 这种虚的开头

宁可不出（学生此刻没什么明显该问的就保持安静），不要凑。

${n?n.trim()+"\n\n":""}技术要求（前端会按 JSON 字段渲染，所以这部分是硬的）：
- 输出 JSON：{"foresights":[{"label":"...","text":"..."}]}，最多 2 条，没内容就返回 {"foresights":[]}
- label 是一个短标签（2-6 字），方便用户瞥到知道大概，例如：可能问 / 这个呢 / 反例呢 / 联系到 / 接得上
- text 是这条问题本身——他能直接点了发给你的形式，问号收尾。不要 Markdown、不要时间戳、不要加引号

仅输出 JSON，不要多说一个字。`,d=`最近这段课堂转录（你要在它之后做预感）：
${s}`;try{let e=await (0,a.W6)([{role:"system",content:l},{role:"user",content:d}],"qwen3.7-plus",{temperature:.7,maxTokens:240,responseFormat:"json_object"}),r=JSON.parse(e.content),t=Array.isArray(r)?r:r.foresights??r.items??[],o=Date.now(),s=t.filter(e=>"string"==typeof e?.label&&"string"==typeof e?.text).map((e,r)=>({id:`fs-${o}-${r}`,label:String(e.label).trim().slice(0,8),text:String(e.text).replace(/\s+/g," ").trim().slice(0,50)})).filter(e=>e.label.length>0&&e.text.length>0).slice(0,2);return p.NextResponse.json({foresights:s})}catch(e){return u.warn("[foresight] LLM error, returning empty",e),p.NextResponse.json({foresights:[]})}}catch(e){return u.error("[foresight] Request error:",e),p.NextResponse.json({foresights:[]},{status:200})}}let d=new s.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/classroom/foresight/route",pathname:"/api/classroom/foresight",filename:"route",bundlePath:"app/api/classroom/foresight/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/classroom/foresight/route.ts",nextConfigOutput:"",userland:o}),{requestAsyncStorage:c,staticGenerationAsyncStorage:x,serverHooks:h}=d,m="/api/classroom/foresight/route";function g(){return(0,i.patchFetch)({serverHooks:h,staticGenerationAsyncStorage:x})}}};var r=require("../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),o=r.X(0,[6662,9811,3219,8261,6018],()=>t(95383));module.exports=o})();