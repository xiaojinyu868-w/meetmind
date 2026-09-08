"use strict";(()=>{var e={};e.id=6518,e.ids=[6518],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},50791:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>f,patchFetch:()=>h,requestAsyncStorage:()=>x,routeModule:()=>d,serverHooks:()=>y,staticGenerationAsyncStorage:()=>q});var s={};t.r(s),t.d(s,{OPTIONS:()=>l,POST:()=>m});var i=t(88255),o=t(75657),n=t(37391),a=t(43955),u=t(99974),p=t(39498);let c=(0,t(30357).hu)("generate-summary");async function m(e){let r=await (0,p.Iy)(e,"generateSummary");if(r)return r;try{let r=await e.json();if(!r.sessionId)return a.NextResponse.json({success:!1,error:"缺少 sessionId"},{status:400});if(!r.transcript||0===r.transcript.length)return a.NextResponse.json({success:!1,error:"缺少转录内容"},{status:400});let t=r.transcript.map((e,t)=>({id:e.id?parseInt(e.id):t,sessionId:r.sessionId,userId:"anonymous",text:e.text,startMs:e.startMs,endMs:e.endMs,confidence:e.confidence??1,isFinal:e.isFinal??!0})),s=await u.lK.generateSummary(r.sessionId,t,{sessionInfo:r.sessionInfo});return a.NextResponse.json({success:!0,summary:{id:s.id,overview:s.overview,takeaways:s.takeaways,keyDifficulties:s.keyDifficulties,structure:s.structure}})}catch(e){return c.error("生成摘要失败:",e),a.NextResponse.json({success:!1,error:e instanceof Error?e.message:"生成失败"},{status:500})}}async function l(){return new a.NextResponse(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}})}let d=new i.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/generate-summary/route",pathname:"/api/generate-summary",filename:"route",bundlePath:"app/api/generate-summary/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/generate-summary/route.ts",nextConfigOutput:"",userland:s}),{requestAsyncStorage:x,staticGenerationAsyncStorage:q,serverHooks:y}=d,f="/api/generate-summary/route";function h(){return(0,n.patchFetch)({serverHooks:y,staticGenerationAsyncStorage:q})}},99974:(e,r,t)=>{t.d(r,{lK:()=>c});var s=t(76018),i=t(58261),o=t(75441),n=t(73548);let a=i.HA.summary.defaultModel,u=i.HA.summary.minTakeaways,p=i.HA.summary.maxTakeaways,c={generateSummary:async function(e,r,t={}){if(0===r.length)throw Error("转录内容为空");let i=t.model??a,c=function(e,r){let t=(0,o.r0)(e);return`<task>
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
    <description>提取 ${u}-${p} 个核心要点。</description>
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
${t}
]]></transcript>
</task>`}(r,0),m=await (0,s.W6)([{role:"user",content:c}],i,{temperature:.3,maxTokens:2e3}),l=(0,n.QW)(m.content);if(!l)throw Error("无法解析摘要响应");let d=new Date().toISOString();return{id:crypto.randomUUID(),sessionId:e,overview:l.overview||"暂无概要",takeaways:(l.takeaways||[]).filter(e=>e.label&&e.insight).map(e=>({label:e.label.slice(0,20),insight:e.insight,timestamps:Array.isArray(e.timestamps)?e.timestamps.slice(0,2):[]})).slice(0,p),keyDifficulties:l.keyDifficulties||[],structure:l.structure||[],createdAt:d,updatedAt:d}},generateShortSummary:function(e){let r=[];if(e.overview&&r.push(e.overview),e.takeaways.length>0){let t=e.takeaways.slice(0,3).map(e=>`• ${e.label}`).join("\n");r.push(`
主要知识点：
${t}`)}return e.keyDifficulties.length>0&&r.push(`
重点难点：${e.keyDifficulties.slice(0,2).join("、")}`),r.join("\n")}}}};var r=require("../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),s=r.X(0,[6662,9811,523,3219,7914,8261,6682,8367,5457,6018,1990],()=>t(50791));module.exports=s})();