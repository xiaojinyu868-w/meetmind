"use strict";(()=>{var e={};e.id=206,e.ids=[206],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},28384:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>k,patchFetch:()=>H,requestAsyncStorage:()=>R,routeModule:()=>I,serverHooks:()=>E,staticGenerationAsyncStorage:()=>T});var n={};r.r(n),r.d(n,{POST:()=>D});var a=r(88255),i=r(75657),o=r(37391),s=r(43955),u=r(89234),l=r(30357),p=r(51242),c=r(72866),d=r(49607),m=r(73548),h=r(76018),g=r(66605);let f=(0,l.hu)("teach-back-eval");function x(e,t){return("string"==typeof e?e.replace(/\s+/g," ").trim():"").slice(0,t)}async function y(e){let t=e.targets.slice(0,8),r=e.teachingTurns.map(e=>`${"user"===e.role?"学生":"同桌"}：${x(e.text,600)}`).join("\n").slice(0,8e3),n=e.teachingTurns.some(e=>"user"===e.role&&e.text.trim().length>0);if(0===t.length)throw Error("TEACH_BACK_TARGETS_REQUIRED");if(!n)return{headline:"这次还没有听到你讲。",items:t.map(e=>({targetId:e.id,point:e.point,coverage:"missed",confidence:"uncertain",quadrant:null,note:"没有讲到这个点。",evidence:e.evidence}))};let a=(0,p.d1)(e.transcript,{maxChars:48e3,includeIndex:!1,includeTimestamp:!0});try{let n=[{role:"system",content:(0,d.SP)()},{role:"user",content:(0,d.y5)({targets:t,teachingText:r,transcriptContext:a.text})}],i=null;for(let r=0;r<2;r+=1)try{let r=await (0,h.W6)(n,g.R7.workshop,{temperature:.2,maxTokens:2e3,responseFormat:"json_object"}),a=(0,m.QW)(r.content);if(!a)throw Error("TEACH_BACK_EVAL_PARSE_FAILED");return function(e,t,r){let n=e??{},a=Array.isArray(n.items)?n.items:[],i=new Map;for(let e of a){let t=x(e?.targetId,60);t&&!i.has(t)&&i.set(t,e)}let o=t.map(e=>{var t;let n=i.get(e.id),a="explained"===(t=n?.coverage)||"partial"===t||"missed"===t?t:"missed",o="confident"===n?.confidence?"confident":"uncertain",s=x(n?.note,240)||("missed"===a?"没有讲到这个点。":""),u=e.evidence,l=x(n?.anchorText,600);if(l){let e=(0,c.c)(l,r);e.supported&&e.segment&&(u={startMs:e.segment.startMs,endMs:e.segment.endMs,snippet:x(e.segment.text,120)})}return{targetId:e.id,point:e.point,coverage:a,confidence:o,quadrant:"missed"===a?null:"explained"===a?"confident"===o?"mastery":"productive-struggle":"confident"===o?"blind-spot":"aware-gap",note:s,evidence:u}});return{headline:x(n.headline,200),items:o}}(a,t,e.transcript)}catch(e){i=e,f.warn("teach-back eval attempt failed",{attempt:r+1,message:e instanceof Error?e.message.slice(0,240):String(e).slice(0,240)}),0===r&&await new Promise(e=>setTimeout(e,1500))}throw i instanceof Error?i:Error("TEACH_BACK_EVAL_FAILED")}catch(e){throw f.warn("teach-back evaluation failed",{message:e instanceof Error?e.message.slice(0,240):String(e).slice(0,240)}),e}}var M=r(39498);let $=(0,l.hu)("teach-back-eval"),v=u.object({startMs:u.number().nonnegative(),endMs:u.number().nonnegative(),snippet:u.string().max(600)}).nullable(),w=u.object({id:u.string().min(1).max(60),point:u.string().min(1).max(120),why:u.string().max(200).optional(),evidence:v}),q=u.object({role:u.enum(["user","assistant"]),text:u.string().max(2e3)}),b=u.object({text:u.string().max(2e3),startMs:u.number().nonnegative(),endMs:u.number().nonnegative()}).passthrough(),S=u.object({targets:u.array(w).min(1).max(8),teachingTurns:u.array(q).min(1).max(200),transcript:u.array(b).min(1).max(2e3),metadata:u.object({title:u.string().max(200).optional(),subject:u.string().max(120).optional()}).optional()});async function D(e){let t=await (0,M.Iy)(e,"appsExecute");if(t)return t;try{let t=S.safeParse(await e.json());if(!t.success)return s.NextResponse.json({ok:!1,error:"请求内容不完整"},{status:400});let r=await y({targets:t.data.targets,teachingTurns:t.data.teachingTurns,transcript:t.data.transcript,metadata:t.data.metadata});return s.NextResponse.json({ok:!0,evaluation:r})}catch(e){return $.error("teach-back evaluation failed",e),s.NextResponse.json({ok:!1,error:"这次没能完成核对"},{status:500})}}let I=new a.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/apps/teach-back/evaluate/route",pathname:"/api/apps/teach-back/evaluate",filename:"route",bundlePath:"app/api/apps/teach-back/evaluate/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/apps/teach-back/evaluate/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:R,staticGenerationAsyncStorage:T,serverHooks:E}=I,k="/api/apps/teach-back/evaluate/route";function H(){return(0,o.patchFetch)({serverHooks:E,staticGenerationAsyncStorage:T})}},72866:(e,t,r)=>{function n(e){let t=e.replace(/[\u0000-\u001f]+/g," ").replace(/\s+/g," ").trim().toLowerCase(),r=new Set;for(let e of t.match(/[\p{L}\p{N}]{2,}/gu)??[])r.add(e);let n=t.replace(/[^\p{L}\p{N}]+/gu,"");for(let e=0;e<n.length-1;e+=1)r.add(n.slice(e,e+2));return r}function a(e,t,r){let a;if(0===t.length)return{supported:!1,score:0,overlap:0,method:"none"};let i=n(e),o=0,s=0;for(let e of t){let t=function(e,t){if(0===e.size||0===t.size)return{overlap:0,score:0};let r=0;for(let n of e)t.has(n)&&(r+=1);return{overlap:r,score:r/Math.max(1,Math.min(e.size,t.size))}}(i,n(e.text||""));(t.score>o||t.score===o&&t.overlap>s)&&(a=e,o=t.score,s=t.overlap)}let u=i.size<=5?1:2;if(a&&s>=u&&o>=.16)return{segment:a,supported:!0,score:o,overlap:s,method:"text"};let l=function(e,t){if("number"==typeof t&&Number.isFinite(t)&&!(t<0))return e.find(e=>t>=e.startMs&&t<=e.endMs)}(t,r);return l?{segment:l,supported:!1,score:o,overlap:s,method:"timestamp"}:{segment:a??t[0],supported:!1,score:o,overlap:s,method:"fallback"}}r.d(t,{c:()=>a})},51242:(e,t,r)=>{function n(e){let t=Math.max(0,Math.floor(e/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function a(e){return e.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g," ").replace(/\s+/g," ").trim()}function i(e,t){return e.length<=t?e:t<=1?e.slice(0,Math.max(0,t)):`${e.slice(0,t-1)}…`}function o(e,t={}){let r=Math.max(2e3,t.maxChars??24e3),o=t.includeIndex??!0,s=t.includeTimestamp??!1,u=Math.max(24,t.minCharsPerSegment??48),l=e.map((t,r)=>{let i=a(t.text||"");if(!i)return null;let u=[];return o&&u.push(`段${String(r+1).padStart(3,"0")}`),s&&u.push(`[${n(t.startMs)}-${n(t.endMs)}]`),t.sourceItemId&&(0===r||e[r-1]?.sourceItemId!==t.sourceItemId)&&u.push(`【来源：${a(t.sourceTitle||t.sourceItemId)}】`),{prefix:u.length>0?`${u.join(" ")} `:"",text:i}}).filter(e=>!!e);if(0===l.length)return{text:"",totalSegments:e.length,usedSegments:0,truncated:!1};let p=l.map(e=>`${e.prefix}${e.text}`).join("\n");if(p.length<=r)return{text:p,totalSegments:e.length,usedSegments:l.length,truncated:!1};let c=l.reduce((e,t)=>e+t.prefix.length+1,0),d=Math.max(u*l.length,r-c),m=Math.max(u,Math.floor(d/l.length)),h=l.map(e=>`${e.prefix}${i(e.text,m)}`).join("\n"),g=t.truncationNotice??!0?"（说明：以下转录为控制长度经过逐段压缩，每段只保留开头，“…”表示该段后续内容被省略；段号与时间戳仍是原始定位。请基于保留的内容作答，引用原话时不要把“…”前的残句当作完整原话。）\n":"";return{text:`${g}${i(h,Math.max(200,r-g.length))}`,totalSegments:e.length,usedSegments:l.length,truncated:!0}}function s(e,t=12){return e.filter(e=>!e.cancelled).slice(0,Math.max(1,t)).map((e,t)=>{let r=e.resolved?"已解决":"待澄清",n=a(e.note||"");return`${t+1}. ${r}：${n||"课堂中出现理解阻塞，请解释原因并给出应用建议。"}`}).join("\n")}function u(e){return e?.trim()?`
关键术语表（请在输出中使用正规写法，避免 ASR 误识别变体）：
${e.trim()}`:""}r.d(t,{OU:()=>u,d1:()=>o,eF:()=>s})},49607:(e,t,r)=>{r.d(t,{JX:()=>i,Ju:()=>o,SP:()=>s,gL:()=>a,y5:()=>u});var n=r(51242);function a(){return"你是一位经验丰富的学习诊断师。学生刚听完一节课，准备把这节课讲给同桌听——能讲出来的才算真的懂。你的任务是从课堂真实内容里选出 3-5 个他「应该能亲口讲出来」的目标点。选点标准：核心概念的定义与边界、因果机制（为什么会这样）、容易讲错的易混点。要选能展开讲 1-2 分钟的点，不要碎事实（年代、人名、孤立数字）。目标点必须全部来自课堂原文，不得编造原文没有的内容；每个目标都要附上你依据的原文片段。"}function i(e){return`${e.goalIntent?`学习目标：${e.goalIntent}

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

只输出 JSON，不解释。${(0,n.OU)(e.terminologyHint)}`}function o(e){let t=e.targets.map((e,t)=>`${t+1}. ${e.point}`).join("\n");return`你是坐在旁边听同学讲这节课的学生。${e.lessonTitle?`这节课是「${e.lessonTitle}」。`:""}${e.subject?`学科：${e.subject}。`:""}你没听过这节课，对内容一无所知，只能靠他的讲述来理解。

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

全程使用简体中文，口语化，像旁边真实的同学。`}function s(){return"你是一位严谨的学习诊断师。学生把一节课讲给了同桌听，你手里有两份材料：课堂的真实转录（带时间戳，是唯一的正确性依据），和学生讲述的记录。你的任务是对照课堂转录，逐个核对每个讲述目标，判断两件事：他讲没讲对（coverage），以及他讲的时候自不自信（confidence）。判断纪律：正确性只以课堂转录为准，不用你自己的知识替他加分或扣分；confidence 只看他的措辞——「可能」「大概」「我觉得」「是不是」「应该是吧」、自我修正、含糊带过，都是不确定的信号；讲得流畅肯定才是自信；note 只写基于证据的事实核对结论（如「把 A 说成了 B」「漏掉了 C 条件」），严禁给学习建议，严禁「如果」「应该」「建议」「可以」这类措辞；他没讲到的目标一律 missed，不要推测他「可能懂」。"}function u(e){let t=e.targets.map(e=>`- ${e.id}: ${e.point}`).join("\n");return`讲述目标：
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

只输出 JSON，不解释。`}},30450:(e,t,r)=>{r.d(t,{Dn:()=>d,tD:()=>g,xC:()=>h});var n=r(76109);let a=(0,r(30357).hu)("rate-limit"),i=null,o=!1,s={chat:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},tutor:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},transcribe:{perMinute:5,perHour:50,perDay:200,cost:"high"},generateSummary:{perMinute:10,perHour:100,perDay:500,cost:"medium"},generateTopics:{perMinute:10,perHour:100,perDay:500,cost:"medium"},translate:{perMinute:600,perHour:6e3,perDay:3e4,cost:"medium"},transcriptEnhance:{perMinute:15,perHour:150,perDay:800,cost:"medium"},extractTerms:{perMinute:5,perHour:30,perDay:100,cost:"medium"},search:{perMinute:10,perHour:60,perDay:200,cost:"high"},sendCode:{perMinute:1,perHour:10,perDay:20,cost:"low"},wechatQr:{perMinute:5,perHour:30,perDay:100,cost:"medium"},wechatQrPoll:{perMinute:90,perHour:900,perDay:3e3,cost:"low"},appsExecute:{perMinute:30,perHour:200,perDay:800,cost:"high"},classCheck:{perMinute:80,perHour:500,perDay:1600,cost:"medium"},default:{perMinute:120,perHour:1200,perDay:6e3,cost:"low"}},u=new Map,l=null;async function p(e,t,r){let n=s[r],i=`ratelimit:${t}:${r}:minute`,o=`ratelimit:${t}:${r}:hour`,u=`ratelimit:${t}:${r}:day`;try{let t=`
      local counts = {}
      for i = 1, 3 do
        counts[i] = tonumber(redis.call('GET', KEYS[i]) or '0')
      end
      local allowed = 1
      local blocked = 0
      for i = 1, 3 do
        if counts[i] >= tonumber(ARGV[i]) then
          allowed = 0
          blocked = i
          break
        end
      end
      if allowed == 1 then
        for i = 1, 3 do
          counts[i] = redis.call('INCR', KEYS[i])
          if counts[i] == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i + 3])) end
        end
      end
      local ttl1 = redis.call('TTL', KEYS[1])
      local ttl2 = redis.call('TTL', KEYS[2])
      local ttl3 = redis.call('TTL', KEYS[3])
      return { allowed, blocked, counts[1], counts[2], counts[3], ttl1, ttl2, ttl3 }
    `,r=(await e.eval(t,3,i,o,u,n.perMinute,n.perHour,n.perDay,60,3600,86400)).map(e=>Number(e)),[a,s,l,p,c]=r,d=Math.max(1,r[5]||60),m=Math.max(1,r[6]||3600),h=Math.max(1,r[7]||86400),g=1===a;return{allowed:g,remaining:{perMinute:Math.max(0,n.perMinute-l),perHour:Math.max(0,n.perHour-p),perDay:Math.max(0,n.perDay-c)},resetIn:{minute:d,hour:m,day:h},...g?{}:{error:["请求过于频繁，请稍后再试","本小时请求次数已达上限，请稍后再试","今日请求次数已达上限，请明天再试"][Math.max(0,s-1)]}}}catch(e){return a.error("[RateLimit] Redis error, falling back to memory:",e),c(t,r)}}function c(e,t){l||(l=setInterval(()=>{let e=Date.now()-9e7;for(let[t,r]of u.entries()){let n=r.filter(t=>t.createdAt>e);0===n.length?u.delete(t):u.set(t,n)}},12e4));let r=s[t],n=Date.now(),a=n-6e4,i=n-36e5,o=n-864e5,p=`${e}:${t}`,c=u.get(p)||[],d=c.filter(e=>e.createdAt>a),m=c.filter(e=>e.createdAt>i),h=c.filter(e=>e.createdAt>o),g=d.reduce((e,t)=>e+t.count,0),f=m.reduce((e,t)=>e+t.count,0),x=h.reduce((e,t)=>e+t.count,0);u.set(p,h);let y=(e,t)=>0===t.length?1:Math.max(1,Math.ceil((Math.min(...t.map(e=>e.createdAt))+e-n)/1e3));if(g>=r.perMinute)return{allowed:!1,remaining:{perMinute:0,perHour:Math.max(0,r.perHour-f),perDay:Math.max(0,r.perDay-x)},resetIn:{minute:y(6e4,d),hour:y(36e5,m),day:y(864e5,h)},error:"请求过于频繁，请稍后再试"};if(f>=r.perHour)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:Math.max(0,r.perDay-x)},resetIn:{minute:1,hour:y(36e5,m),day:y(864e5,h)},error:"本小时请求次数已达上限，请稍后再试"};if(x>=r.perDay)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:0},resetIn:{minute:1,hour:1,day:y(864e5,h)},error:"今日请求次数已达上限，请明天再试"};let M=[...h,{count:1,createdAt:n}];return u.set(p,M),{allowed:!0,remaining:{perMinute:r.perMinute-g-1,perHour:r.perHour-f-1,perDay:r.perDay-x-1},resetIn:{minute:60,hour:3600,day:86400}}}async function d(e,t="default"){let r=function(){if(i)return i;let e=process.env.REDIS_URL;if(!e)return o||(a.warn("[RateLimit] REDIS_URL not configured, using memory storage"),o=!0),null;try{return(i=new n.Redis(e,{maxRetriesPerRequest:3,enableReadyCheck:!0,lazyConnect:!0})).on("error",e=>{a.error("[RateLimit] Redis error:",e.message)}),i.on("connect",()=>{}),i}catch(e){return a.error("[RateLimit] Failed to create Redis client:",e),null}}(),u=r?await p(r,e,t):c(e,t);if(!u.allowed){let r=s[t];a.warn(`[RateLimit] DENY identifier="${e}" apiType=${t} limits=${r.perMinute}/min,${r.perHour}/h,${r.perDay}/d remaining=${u.remaining.perMinute}/${u.remaining.perHour}/${u.remaining.perDay} resetInSec=${u.resetIn.minute}/${u.resetIn.hour}/${u.resetIn.day} reason="${u.error}"`)}return u}function m(e){return e.trim().toLowerCase().replace(/[^a-z0-9:._-]+/g,"-").replace(/-+/g,"-").slice(0,120)||"unknown"}function h(e,t){if(t)return`user:${t}`;let r=m(function(e){let t=e.headers.get("x-forwarded-for"),r=e.headers.get("x-real-ip"),n=e.headers.get("cf-connecting-ip"),a=e.headers.get("forwarded");if(n?.trim())return n.trim();if(t?.trim())return t.split(",")[0]?.trim()||"unknown";if(r?.trim())return r.trim();let i=a?.match(/for=(?:"?\[?)([^;\],"]+)/i);return i?.[1]?i[1].trim():"unknown"}(e));if("unknown"===r||"127.0.0.1"===r||"::1"===r||"::ffff:127.0.0.1"===r){let t=m(e.headers.get("user-agent")||"anonymous");return`ip:${r}:ua:${t}`}return`ip:${r}`}function g(e){return new Response(JSON.stringify({success:!1,error:e.error,remaining:e.remaining,resetIn:e.resetIn}),{status:429,headers:{"Content-Type":"application/json","X-RateLimit-Remaining-Minute":String(e.remaining.perMinute),"X-RateLimit-Remaining-Hour":String(e.remaining.perHour),"X-RateLimit-Remaining-Day":String(e.remaining.perDay),"Retry-After":String(Math.min(e.resetIn.minute,60))}})}},39498:(e,t,r)=>{r.d(t,{Iy:()=>o,bE:()=>i});var n=r(45457),a=r(30450);function i(e){let t=e.headers.get("Authorization");if(!t?.startsWith("Bearer "))return null;let r=t.slice(7),a=n.O.verifyToken(r);return a?.sub||null}async function o(e,t){let r=process.env.SMOKE_BYPASS_TOKEN;if(r&&e.headers.get("X-Smoke-Bypass")===r)return null;let n=i(e),o=(0,a.xC)(e,n),s=await (0,a.Dn)(o,t);return s.allowed?null:(0,a.tD)(s)}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),n=t.X(0,[6662,9811,523,3219,7914,9234,8261,6682,8367,5457,6018],()=>r(28384));module.exports=n})();