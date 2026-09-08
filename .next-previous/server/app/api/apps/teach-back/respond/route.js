"use strict";(()=>{var e={};e.id=4867,e.ids=[4867],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},66398:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>k,patchFetch:()=>I,requestAsyncStorage:()=>S,routeModule:()=>w,serverHooks:()=>R,staticGenerationAsyncStorage:()=>D});var n={};t.r(n),t.d(n,{POST:()=>b});var i=t(88255),a=t(75657),o=t(37391),s=t(43955),u=t(89234),p=t(30357),l=t(49607),c=t(73548),d=t(76018),m=t(66605);let h=(0,p.hu)("teach-back-respond");async function g(e){let r=e.targets.slice(0,8);if(0===r.length)return null;let t=e.teachingTurns.map(e=>{var r;return`${"user"===e.role?"学生":"同桌"}：${("string"==typeof(r=e.text)?r.replace(/\s+/g," ").trim():"").slice(0,600)}`}).join("\n").slice(0,8e3);try{let n=await (0,d.W6)([{role:"system",content:(0,l.Ju)({lessonTitle:e.metadata?.title,subject:e.metadata?.subject,targets:r})},{role:"user",content:`讲述到目前为止的记录（「学生：」是正在讲的同学，「同桌：」是你之前说过的话）：
${t||"（他还没有开口）"}

现在轮到你决定：开口说一句话，还是继续安静听。
输出 JSON：
{ "say": string | null }

- say 为 null 表示你继续安静听，不打扰他
- 要开口时只说一句口语化的话（不超过 40 字），遵循你的行为准则

只输出 JSON，不解释。`}],m.R7.workshop,{temperature:.6,maxTokens:200,responseFormat:"json_object"});return function(e){let r=e??{};if("string"!=typeof r.say)return null;let t=r.say.replace(/\s+/g," ").trim();return t&&"null"!==t.toLowerCase()?t.slice(0,120):null}((0,c.QW)(n.content))}catch(e){return h.warn("teach-back respond failed",{message:e instanceof Error?e.message.slice(0,240):String(e).slice(0,240)}),null}}var x=t(39498);let f=(0,p.hu)("teach-back-respond"),y=u.object({startMs:u.number().nonnegative(),endMs:u.number().nonnegative(),snippet:u.string().max(600)}).nullable(),$=u.object({id:u.string().min(1).max(60),point:u.string().min(1).max(120),why:u.string().max(200).optional(),evidence:y}),M=u.object({role:u.enum(["user","assistant"]),text:u.string().max(2e3)}),q=u.object({targets:u.array($).min(1).max(8),teachingTurns:u.array(M).min(0).max(200),metadata:u.object({title:u.string().max(200).optional(),subject:u.string().max(120).optional()}).optional()});async function b(e){let r=await (0,x.Iy)(e,"appsExecute");if(r)return r;try{let r=q.safeParse(await e.json());if(!r.success)return s.NextResponse.json({ok:!1,error:"请求内容不完整"},{status:400});let t=await g({targets:r.data.targets,teachingTurns:r.data.teachingTurns,metadata:r.data.metadata});return s.NextResponse.json({ok:!0,say:t})}catch(e){return f.error("teach-back respond failed",e),s.NextResponse.json({ok:!1,error:"同桌这次没反应过来"},{status:500})}}let w=new i.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/apps/teach-back/respond/route",pathname:"/api/apps/teach-back/respond",filename:"route",bundlePath:"app/api/apps/teach-back/respond/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/apps/teach-back/respond/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:S,staticGenerationAsyncStorage:D,serverHooks:R}=w,k="/api/apps/teach-back/respond/route";function I(){return(0,o.patchFetch)({serverHooks:R,staticGenerationAsyncStorage:D})}},51242:(e,r,t)=>{function n(e){let r=Math.max(0,Math.floor(e/1e3));return`${Math.floor(r/60)}:${String(r%60).padStart(2,"0")}`}function i(e){return e.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g," ").replace(/\s+/g," ").trim()}function a(e,r){return e.length<=r?e:r<=1?e.slice(0,Math.max(0,r)):`${e.slice(0,r-1)}…`}function o(e,r={}){let t=Math.max(2e3,r.maxChars??24e3),o=r.includeIndex??!0,s=r.includeTimestamp??!1,u=Math.max(24,r.minCharsPerSegment??48),p=e.map((r,t)=>{let a=i(r.text||"");if(!a)return null;let u=[];return o&&u.push(`段${String(t+1).padStart(3,"0")}`),s&&u.push(`[${n(r.startMs)}-${n(r.endMs)}]`),r.sourceItemId&&(0===t||e[t-1]?.sourceItemId!==r.sourceItemId)&&u.push(`【来源：${i(r.sourceTitle||r.sourceItemId)}】`),{prefix:u.length>0?`${u.join(" ")} `:"",text:a}}).filter(e=>!!e);if(0===p.length)return{text:"",totalSegments:e.length,usedSegments:0,truncated:!1};let l=p.map(e=>`${e.prefix}${e.text}`).join("\n");if(l.length<=t)return{text:l,totalSegments:e.length,usedSegments:p.length,truncated:!1};let c=p.reduce((e,r)=>e+r.prefix.length+1,0),d=Math.max(u*p.length,t-c),m=Math.max(u,Math.floor(d/p.length)),h=p.map(e=>`${e.prefix}${a(e.text,m)}`).join("\n"),g=r.truncationNotice??!0?"（说明：以下转录为控制长度经过逐段压缩，每段只保留开头，“…”表示该段后续内容被省略；段号与时间戳仍是原始定位。请基于保留的内容作答，引用原话时不要把“…”前的残句当作完整原话。）\n":"";return{text:`${g}${a(h,Math.max(200,t-g.length))}`,totalSegments:e.length,usedSegments:p.length,truncated:!0}}function s(e,r=12){return e.filter(e=>!e.cancelled).slice(0,Math.max(1,r)).map((e,r)=>{let t=e.resolved?"已解决":"待澄清",n=i(e.note||"");return`${r+1}. ${t}：${n||"课堂中出现理解阻塞，请解释原因并给出应用建议。"}`}).join("\n")}function u(e){return e?.trim()?`
关键术语表（请在输出中使用正规写法，避免 ASR 误识别变体）：
${e.trim()}`:""}t.d(r,{OU:()=>u,d1:()=>o,eF:()=>s})},49607:(e,r,t)=>{t.d(r,{JX:()=>a,Ju:()=>o,SP:()=>s,gL:()=>i,y5:()=>u});var n=t(51242);function i(){return"你是一位经验丰富的学习诊断师。学生刚听完一节课，准备把这节课讲给同桌听——能讲出来的才算真的懂。你的任务是从课堂真实内容里选出 3-5 个他「应该能亲口讲出来」的目标点。选点标准：核心概念的定义与边界、因果机制（为什么会这样）、容易讲错的易混点。要选能展开讲 1-2 分钟的点，不要碎事实（年代、人名、孤立数字）。目标点必须全部来自课堂原文，不得编造原文没有的内容；每个目标都要附上你依据的原文片段。"}function a(e){return`${e.goalIntent?`学习目标：${e.goalIntent}

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

只输出 JSON，不解释。${(0,n.OU)(e.terminologyHint)}`}function o(e){let r=e.targets.map((e,r)=>`${r+1}. ${e.point}`).join("\n");return`你是坐在旁边听同学讲这节课的学生。${e.lessonTitle?`这节课是「${e.lessonTitle}」。`:""}${e.subject?`学科：${e.subject}。`:""}你没听过这节课，对内容一无所知，只能靠他的讲述来理解。

你的行为准则：
- 大部分时候安静听。他讲完一段，你最多用「嗯」「原来如此」「懂了」这类很短的话回应，不打断他的节奏。
- 只有两种情况才开口提问：
  (a) 你真的跟不上——他讲的东西前后矛盾、跳得太快、或用了没解释过的概念，你就老实说「这里我没跟上，为什么……？」
  (b) 他讲完了（或明显开始收尾），但下面还有目标没被讲到，你用自然的话追问，比如「那……是怎么回事？」一次只问一个，不念清单。
- 绝不讲课、绝不补充知识点、绝不纠正他（哪怕他讲错了也不纠正——他的错误稍后由系统对照课堂原声核对，不是你的事）。
- 不夸他，不评价「讲得好不好」。
- 第一句话只需请他开始讲，比如「我没听这节课，你给我讲讲吧。」

他希望讲完后能覆盖这些目标（只在你心里，不要念出来）：
${r||"（由你边听边判断这节课的核心内容）"}

全程使用简体中文，口语化，像旁边真实的同学。`}function s(){return"你是一位严谨的学习诊断师。学生把一节课讲给了同桌听，你手里有两份材料：课堂的真实转录（带时间戳，是唯一的正确性依据），和学生讲述的记录。你的任务是对照课堂转录，逐个核对每个讲述目标，判断两件事：他讲没讲对（coverage），以及他讲的时候自不自信（confidence）。判断纪律：正确性只以课堂转录为准，不用你自己的知识替他加分或扣分；confidence 只看他的措辞——「可能」「大概」「我觉得」「是不是」「应该是吧」、自我修正、含糊带过，都是不确定的信号；讲得流畅肯定才是自信；note 只写基于证据的事实核对结论（如「把 A 说成了 B」「漏掉了 C 条件」），严禁给学习建议，严禁「如果」「应该」「建议」「可以」这类措辞；他没讲到的目标一律 missed，不要推测他「可能懂」。"}function u(e){let r=e.targets.map(e=>`- ${e.id}: ${e.point}`).join("\n");return`讲述目标：
${r}

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

只输出 JSON，不解释。`}},30450:(e,r,t)=>{t.d(r,{Dn:()=>d,tD:()=>g,xC:()=>h});var n=t(76109);let i=(0,t(30357).hu)("rate-limit"),a=null,o=!1,s={chat:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},tutor:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},transcribe:{perMinute:5,perHour:50,perDay:200,cost:"high"},generateSummary:{perMinute:10,perHour:100,perDay:500,cost:"medium"},generateTopics:{perMinute:10,perHour:100,perDay:500,cost:"medium"},translate:{perMinute:600,perHour:6e3,perDay:3e4,cost:"medium"},transcriptEnhance:{perMinute:15,perHour:150,perDay:800,cost:"medium"},extractTerms:{perMinute:5,perHour:30,perDay:100,cost:"medium"},search:{perMinute:10,perHour:60,perDay:200,cost:"high"},sendCode:{perMinute:1,perHour:10,perDay:20,cost:"low"},wechatQr:{perMinute:5,perHour:30,perDay:100,cost:"medium"},wechatQrPoll:{perMinute:90,perHour:900,perDay:3e3,cost:"low"},appsExecute:{perMinute:30,perHour:200,perDay:800,cost:"high"},classCheck:{perMinute:80,perHour:500,perDay:1600,cost:"medium"},default:{perMinute:120,perHour:1200,perDay:6e3,cost:"low"}},u=new Map,p=null;async function l(e,r,t){let n=s[t],a=`ratelimit:${r}:${t}:minute`,o=`ratelimit:${r}:${t}:hour`,u=`ratelimit:${r}:${t}:day`;try{let r=`
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
    `,t=(await e.eval(r,3,a,o,u,n.perMinute,n.perHour,n.perDay,60,3600,86400)).map(e=>Number(e)),[i,s,p,l,c]=t,d=Math.max(1,t[5]||60),m=Math.max(1,t[6]||3600),h=Math.max(1,t[7]||86400),g=1===i;return{allowed:g,remaining:{perMinute:Math.max(0,n.perMinute-p),perHour:Math.max(0,n.perHour-l),perDay:Math.max(0,n.perDay-c)},resetIn:{minute:d,hour:m,day:h},...g?{}:{error:["请求过于频繁，请稍后再试","本小时请求次数已达上限，请稍后再试","今日请求次数已达上限，请明天再试"][Math.max(0,s-1)]}}}catch(e){return i.error("[RateLimit] Redis error, falling back to memory:",e),c(r,t)}}function c(e,r){p||(p=setInterval(()=>{let e=Date.now()-9e7;for(let[r,t]of u.entries()){let n=t.filter(r=>r.createdAt>e);0===n.length?u.delete(r):u.set(r,n)}},12e4));let t=s[r],n=Date.now(),i=n-6e4,a=n-36e5,o=n-864e5,l=`${e}:${r}`,c=u.get(l)||[],d=c.filter(e=>e.createdAt>i),m=c.filter(e=>e.createdAt>a),h=c.filter(e=>e.createdAt>o),g=d.reduce((e,r)=>e+r.count,0),x=m.reduce((e,r)=>e+r.count,0),f=h.reduce((e,r)=>e+r.count,0);u.set(l,h);let y=(e,r)=>0===r.length?1:Math.max(1,Math.ceil((Math.min(...r.map(e=>e.createdAt))+e-n)/1e3));if(g>=t.perMinute)return{allowed:!1,remaining:{perMinute:0,perHour:Math.max(0,t.perHour-x),perDay:Math.max(0,t.perDay-f)},resetIn:{minute:y(6e4,d),hour:y(36e5,m),day:y(864e5,h)},error:"请求过于频繁，请稍后再试"};if(x>=t.perHour)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:Math.max(0,t.perDay-f)},resetIn:{minute:1,hour:y(36e5,m),day:y(864e5,h)},error:"本小时请求次数已达上限，请稍后再试"};if(f>=t.perDay)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:0},resetIn:{minute:1,hour:1,day:y(864e5,h)},error:"今日请求次数已达上限，请明天再试"};let $=[...h,{count:1,createdAt:n}];return u.set(l,$),{allowed:!0,remaining:{perMinute:t.perMinute-g-1,perHour:t.perHour-x-1,perDay:t.perDay-f-1},resetIn:{minute:60,hour:3600,day:86400}}}async function d(e,r="default"){let t=function(){if(a)return a;let e=process.env.REDIS_URL;if(!e)return o||(i.warn("[RateLimit] REDIS_URL not configured, using memory storage"),o=!0),null;try{return(a=new n.Redis(e,{maxRetriesPerRequest:3,enableReadyCheck:!0,lazyConnect:!0})).on("error",e=>{i.error("[RateLimit] Redis error:",e.message)}),a.on("connect",()=>{}),a}catch(e){return i.error("[RateLimit] Failed to create Redis client:",e),null}}(),u=t?await l(t,e,r):c(e,r);if(!u.allowed){let t=s[r];i.warn(`[RateLimit] DENY identifier="${e}" apiType=${r} limits=${t.perMinute}/min,${t.perHour}/h,${t.perDay}/d remaining=${u.remaining.perMinute}/${u.remaining.perHour}/${u.remaining.perDay} resetInSec=${u.resetIn.minute}/${u.resetIn.hour}/${u.resetIn.day} reason="${u.error}"`)}return u}function m(e){return e.trim().toLowerCase().replace(/[^a-z0-9:._-]+/g,"-").replace(/-+/g,"-").slice(0,120)||"unknown"}function h(e,r){if(r)return`user:${r}`;let t=m(function(e){let r=e.headers.get("x-forwarded-for"),t=e.headers.get("x-real-ip"),n=e.headers.get("cf-connecting-ip"),i=e.headers.get("forwarded");if(n?.trim())return n.trim();if(r?.trim())return r.split(",")[0]?.trim()||"unknown";if(t?.trim())return t.trim();let a=i?.match(/for=(?:"?\[?)([^;\],"]+)/i);return a?.[1]?a[1].trim():"unknown"}(e));if("unknown"===t||"127.0.0.1"===t||"::1"===t||"::ffff:127.0.0.1"===t){let r=m(e.headers.get("user-agent")||"anonymous");return`ip:${t}:ua:${r}`}return`ip:${t}`}function g(e){return new Response(JSON.stringify({success:!1,error:e.error,remaining:e.remaining,resetIn:e.resetIn}),{status:429,headers:{"Content-Type":"application/json","X-RateLimit-Remaining-Minute":String(e.remaining.perMinute),"X-RateLimit-Remaining-Hour":String(e.remaining.perHour),"X-RateLimit-Remaining-Day":String(e.remaining.perDay),"Retry-After":String(Math.min(e.resetIn.minute,60))}})}},39498:(e,r,t)=>{t.d(r,{Iy:()=>o,bE:()=>a});var n=t(45457),i=t(30450);function a(e){let r=e.headers.get("Authorization");if(!r?.startsWith("Bearer "))return null;let t=r.slice(7),i=n.O.verifyToken(t);return i?.sub||null}async function o(e,r){let t=process.env.SMOKE_BYPASS_TOKEN;if(t&&e.headers.get("X-Smoke-Bypass")===t)return null;let n=a(e),o=(0,i.xC)(e,n),s=await (0,i.Dn)(o,r);return s.allowed?null:(0,i.tD)(s)}}};var r=require("../../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),n=r.X(0,[6662,9811,523,3219,7914,9234,8261,6682,8367,5457,6018],()=>t(66398));module.exports=n})();