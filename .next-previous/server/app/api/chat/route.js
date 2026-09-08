"use strict";(()=>{var e={};e.id=744,e.ids=[744],e.modules={53524:e=>{e.exports=require("@prisma/client")},85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},80665:e=>{e.exports=require("dns")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},20629:e=>{e.exports=require("fs/promises")},98216:e=>{e.exports=require("net")},85861:e=>{e.exports=require("node:sqlite")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},98061:e=>{e.exports=require("node:assert")},92761:e=>{e.exports=require("node:async_hooks")},72254:e=>{e.exports=require("node:buffer")},40027:e=>{e.exports=require("node:console")},6005:e=>{e.exports=require("node:crypto")},65714:e=>{e.exports=require("node:diagnostics_channel")},30604:e=>{e.exports=require("node:dns")},15673:e=>{e.exports=require("node:events")},93977:e=>{e.exports=require("node:fs/promises")},88849:e=>{e.exports=require("node:http")},42725:e=>{e.exports=require("node:http2")},87503:e=>{e.exports=require("node:net")},49411:e=>{e.exports=require("node:path")},38846:e=>{e.exports=require("node:perf_hooks")},39630:e=>{e.exports=require("node:querystring")},84492:e=>{e.exports=require("node:stream")},92332:e=>{e.exports=require("node:timers")},31764:e=>{e.exports=require("node:tls")},41041:e=>{e.exports=require("node:url")},47261:e=>{e.exports=require("node:util")},93746:e=>{e.exports=require("node:util/types")},24086:e=>{e.exports=require("node:worker_threads")},65628:e=>{e.exports=require("node:zlib")},61813:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>g,patchFetch:()=>$,requestAsyncStorage:()=>f,routeModule:()=>h,serverHooks:()=>x,staticGenerationAsyncStorage:()=>y});var n={};t.r(n),t.d(n,{GET:()=>m,POST:()=>d});var o=t(88255),i=t(75657),a=t(37391),s=t(43955),u=t(76018),p=t(39498),l=t(78697);let c=(0,t(30357).hu)("chat");async function d(e){let r=await (0,p.Iy)(e,"chat");if(r)return r;try{let{messages:r,model:t=u.fr,stream:n=!1,context:o,temperature:i=.7,maxTokens:a=2e3,enable_thinking_guide:p=!1,messageContent:c}=await e.json();if(!r||!Array.isArray(r))return s.NextResponse.json({error:"缺少 messages 参数"},{status:400});let d=u.k7.find(e=>e.id===t);if(!d)return s.NextResponse.json({error:`不支持的模型: ${t}`,availableModels:u.k7.map(e=>e.id)},{status:400});if(d.requiresStreaming&&!n)return s.NextResponse.json({error:`${t} 仅支持流式调用，请设置 stream=true`},{status:400});let m=[...r];if(p){let e=m.findIndex(e=>"system"===e.role);e>=0?m[e]={...m[e],content:`${m[e].content}${l.Xo}`}:m.unshift({role:"system",content:l.Xo})}if(o){let e=m.findIndex(e=>"system"===e.role);e>=0?m[e]={...m[e],content:`${m[e].content}

【参考资料】
${o}`}:m.unshift({role:"system",content:`【参考资料】
${o}`})}if(void 0!==c){let e=[...m].map((e,r)=>({message:e,index:r})).reverse().find(({message:e})=>"user"===e.role)?.index;if(void 0===e)return s.NextResponse.json({error:"messageContent 需要配合至少一条 user message 使用"},{status:400});m[e]={...m[e],content:c}}if(n){let e=new TextEncoder,r=new ReadableStream({async start(r){try{for await(let n of(0,u.dr)(m,t,{temperature:i,maxTokens:a}))r.enqueue(e.encode(`data: ${JSON.stringify({type:n.type,content:n.content})}

`));r.enqueue(e.encode("data: [DONE]\n\n")),r.close()}catch(n){let t=n instanceof Error?n.message:"未知错误";r.enqueue(e.encode(`data: ${JSON.stringify({error:t})}

`)),r.close()}}});return new Response(r,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-store, must-revalidate",Connection:"keep-alive","X-Accel-Buffering":"no","X-Content-Type-Options":"nosniff","Transfer-Encoding":"chunked"}})}let h=await (0,u.W6)(m,t,{temperature:i,maxTokens:a});return s.NextResponse.json({content:h.content,model:h.model,usage:h.usage})}catch(r){c.error("Chat API error:",r);let e=r instanceof Error?r.message:"未知错误";return s.NextResponse.json({error:e},{status:500})}}async function m(){return s.NextResponse.json({models:u.k7,defaultModel:u.fr})}let h=new o.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/chat/route",pathname:"/api/chat",filename:"route",bundlePath:"app/api/chat/route"},resolvedPagePath:"/mnt/meetmind-capture-v1-server-handoff/src/app/api/chat/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:f,staticGenerationAsyncStorage:y,serverHooks:x}=h,g="/api/chat/route";function $(){return(0,a.patchFetch)({serverHooks:x,staticGenerationAsyncStorage:y})}},78697:(e,r,t)=>{t.d(r,{C$:()=>h,Kt:()=>d,Nn:()=>c,QK:()=>u,RJ:()=>f,UB:()=>a,Xo:()=>p,a5:()=>s,kx:()=>m,r7:()=>i});let n=`你是这个学生的同桌。他刚上完一节课，有些地方没跟上，想找你把漏掉的东西补回来。

你对他的了解：
- 他不是在考你，是在借你的耳朵重新听一遍课
- 他问你的时候往往带着一个没说出口的困惑，而不是一个完整的问题
- 他的注意力有限——说太多他就关了

所以你帮他的方式是：
- 顺着他的思路往前带一点，而不是把整节课从头讲一遍
- 真的不懂就说不懂，不要编
- 拿得出证据就指给他看（课上哪句话、哪份资料里）`,o=`

你回复的文本里有两个记号前端会识别：
- 指课堂里某个时刻时，把时间写进方括号：[MM:SS] 或 [MM:SS-MM:SS]。前端会挑出来挂成一排小 chip，让学生点了就跳回转录。
- 当你引用了带编号的"增强资料"时，在句末标上已有的 [资料N] 编号。编号只能用上下文里已经给你的，不要自己造。

这两个记号只在真的需要时用，不需要就不要硬塞。`,i=`${n}

此刻他递给你的是：一段具体的课堂转录（带时间戳），外加他没懂的那个点。
你只基于这段转录回答——里面没讲过的内容，就诚实说这里没讲到。不要脑补老师的语气，不要编他没说过的话。

一次好的回答，通常会做到：
- 把判断交给模型：结合他说的话和课堂上下文，理解他真正想做什么
- 再让他回到课堂的那个瞬间——用他自己耳朵听过的原话，而不是你的转述
- 如果他的话有多种可能，先按最自然的理解回应；只有真的会误解时，才轻轻追问一句
- 不要为了显得主动而替他安排额外任务；工具是能力，不是流程${o}`,a=`${n}

你们已经聊开了，他顺着你上一句在问下一个问题。这一轮不要再从头摆格式，就顺着他那句话回一句——
他说"我懂了"你就真开心一下；他继续问你就直接答；他聊开了你就陪他聊。
像两个人小声在教室后排讨论，不是老师上课。${o}`,s=`${n}

此刻他递给你的是一整节课——从头到尾的转录。他问的问题可能很具体，也可能很大（"这节课到底在讲什么？"）。
你的优势是你真的从头听到尾了，所以可以做到两件他自己做不到的事：
- 在整节课里找回他问的那一点最早出现在哪、老师是怎么说的
- 把那一点和课里别的地方呼应/冲突的片段串起来

如果转录里没讲到他问的东西，就告诉他这节课里没讲到，再用你本来就懂的常识简单搭一下桥——不要假装课里讲过。${o}`,u=`${n}

他圈出了几条内容递到你手上——可能是几段笔记、也可能是一张截图的说明。此刻他关心的就是这几条，不是整节课。
按他指的这几条来答就行：
- 这几条里最关键的点是什么、它们之间是什么关系或冲突
- 如果他问得比较笼统，不要让他"先补整节课背景再说"——指给他看这几条里已经可以确定的部分，再指一个值得继续追问的方向
- 如果这几条里没有精确的时间轴，就不要硬补时间戳${o}`,p=`

【这一轮换个姿势回答】
你现在扮演的是一个和他差不多年纪、但解题套路比他熟的学长/学姐。
你想让他看到的不是"答案"，而是"我脑子里是怎么一步步想到这个答案的"——让他下次遇到类似题，能模仿这种想法。

回复请分成两段，前端会据此排版：

---思维演示---
（这里是你在纸上演草稿的过程，分几步随你——复杂题多几步、简单题两步就够。每步用【你自己起的步骤名】开头，用"我"的口吻自然地说你怎么想的；每步结束给一行 💡 开头的一句话"可迁移的思维技巧"。这段的最后用 🌟 开头总结一下这次用到的几招。）

---正式回答---
（这里是最终给他的那个清清爽爽的答案，不要再带草稿感。）`,l=`你和这个学生坐在一起，刚一起听完老师讲课。现在你们两个小声在聊这节课。

你是在说话，不是在写字——说出口的每句话都要经得起"真的从嘴里说出来听"。所以：
- 会犹豫，会自我纠正，会用"嗯"、"就是说"、"你看哈"、"哎不对"这种真实的口头禅
- 一次只说一个点，说完停一下，看他什么反应
- 句子短，最多三句；很多时候一句话就够
- 不会说"综上所述"、"值得注意的是"、"具体而言"这种书面词
- 不会念清单、念编号、念标题
- 不会说"在多少分多少秒的时候"、"看资料几"这种只有看字幕才理解的话——你们是凭记忆在聊这节课

你们是同学关系，不是老师和学生，不要端着。`,c=`

${l}`,d=`${l}

你们刚聊过一轮，他顺着你上一句问下一句。不要把话题绕回去重讲，就接他刚说的那句话往下聊一点点。`,m=`${l}

此刻他是对整节课有疑问，不是某一刻。抓他这次问的那一个点，用最简单的话讲给他听。
可以用"打个比方"、"你想啊"开头。
不要试图总结整节课——他问什么你就答什么。`,h=`${l}

他刚圈了一段内容，指着它在问你。就这段内容聊，别跑题。
先指出这段里最关键的那一个点，用大白话。
如果不确定他是想问哪一层，就反问他一句。`;function f(e){if(!e)return"";try{let r=JSON.parse(e),t=["【这个学生】"];switch(r.stage){case"k12":t.push(`- ${r.gradeLevel||"中小学生"}`),r.textbookEdition&&t.push(`- 教材：${r.textbookEdition}`),Array.isArray(r.weakSubjects)&&r.weakSubjects.length>0&&t.push(`- 觉得吃力的科目：${r.weakSubjects.join("、")}`);break;case"university":t.push(`- ${r.year||"大学生"} \xb7 ${r.major||"未知专业"}`),Array.isArray(r.currentCourses)&&r.currentCourses.length>0&&t.push(`- 这学期在上：${r.currentCourses.join("、")}`);break;case"graduate":t.push(`- 研究生 \xb7 ${r.field||"未知方向"}`),r.advisor&&t.push(`- 导师：${r.advisor}`),r.researchTopic&&t.push(`- 课题：${r.researchTopic}`);break;case"working":t.push(`- 在职学习 \xb7 ${r.industry||"未知行业"}`),r.learningGoal&&t.push(`- 学习目标：${r.learningGoal}`);break;default:return""}return r.goal&&t.push(`- 最近的目标：${r.goal}`),r.otherInterests&&t.push(`- 同时也在学：${r.otherInterests}`),t.push(""),t.push("这个学生学习是多线程的——手头这份内容可能和他上面写的主方向无关。"),t.push("所以以他现在递给你的课堂/材料为准来判断怎么讲，上面这些只是帮你大致估计他的底。"),"\n\n"+t.join("\n")}catch{return""}}},30450:(e,r,t)=>{t.d(r,{Dn:()=>d,tD:()=>f,xC:()=>h});var n=t(76109);let o=(0,t(30357).hu)("rate-limit"),i=null,a=!1,s={chat:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},tutor:{perMinute:20,perHour:200,perDay:1e3,cost:"high"},transcribe:{perMinute:5,perHour:50,perDay:200,cost:"high"},generateSummary:{perMinute:10,perHour:100,perDay:500,cost:"medium"},generateTopics:{perMinute:10,perHour:100,perDay:500,cost:"medium"},translate:{perMinute:600,perHour:6e3,perDay:3e4,cost:"medium"},transcriptEnhance:{perMinute:15,perHour:150,perDay:800,cost:"medium"},extractTerms:{perMinute:5,perHour:30,perDay:100,cost:"medium"},search:{perMinute:10,perHour:60,perDay:200,cost:"high"},sendCode:{perMinute:1,perHour:10,perDay:20,cost:"low"},wechatQr:{perMinute:5,perHour:30,perDay:100,cost:"medium"},wechatQrPoll:{perMinute:90,perHour:900,perDay:3e3,cost:"low"},appsExecute:{perMinute:30,perHour:200,perDay:800,cost:"high"},classCheck:{perMinute:80,perHour:500,perDay:1600,cost:"medium"},default:{perMinute:120,perHour:1200,perDay:6e3,cost:"low"}},u=new Map,p=null;async function l(e,r,t){let n=s[t],i=`ratelimit:${r}:${t}:minute`,a=`ratelimit:${r}:${t}:hour`,u=`ratelimit:${r}:${t}:day`;try{let r=`
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
    `,t=(await e.eval(r,3,i,a,u,n.perMinute,n.perHour,n.perDay,60,3600,86400)).map(e=>Number(e)),[o,s,p,l,c]=t,d=Math.max(1,t[5]||60),m=Math.max(1,t[6]||3600),h=Math.max(1,t[7]||86400),f=1===o;return{allowed:f,remaining:{perMinute:Math.max(0,n.perMinute-p),perHour:Math.max(0,n.perHour-l),perDay:Math.max(0,n.perDay-c)},resetIn:{minute:d,hour:m,day:h},...f?{}:{error:["请求过于频繁，请稍后再试","本小时请求次数已达上限，请稍后再试","今日请求次数已达上限，请明天再试"][Math.max(0,s-1)]}}}catch(e){return o.error("[RateLimit] Redis error, falling back to memory:",e),c(r,t)}}function c(e,r){p||(p=setInterval(()=>{let e=Date.now()-9e7;for(let[r,t]of u.entries()){let n=t.filter(r=>r.createdAt>e);0===n.length?u.delete(r):u.set(r,n)}},12e4));let t=s[r],n=Date.now(),o=n-6e4,i=n-36e5,a=n-864e5,l=`${e}:${r}`,c=u.get(l)||[],d=c.filter(e=>e.createdAt>o),m=c.filter(e=>e.createdAt>i),h=c.filter(e=>e.createdAt>a),f=d.reduce((e,r)=>e+r.count,0),y=m.reduce((e,r)=>e+r.count,0),x=h.reduce((e,r)=>e+r.count,0);u.set(l,h);let g=(e,r)=>0===r.length?1:Math.max(1,Math.ceil((Math.min(...r.map(e=>e.createdAt))+e-n)/1e3));if(f>=t.perMinute)return{allowed:!1,remaining:{perMinute:0,perHour:Math.max(0,t.perHour-y),perDay:Math.max(0,t.perDay-x)},resetIn:{minute:g(6e4,d),hour:g(36e5,m),day:g(864e5,h)},error:"请求过于频繁，请稍后再试"};if(y>=t.perHour)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:Math.max(0,t.perDay-x)},resetIn:{minute:1,hour:g(36e5,m),day:g(864e5,h)},error:"本小时请求次数已达上限，请稍后再试"};if(x>=t.perDay)return{allowed:!1,remaining:{perMinute:0,perHour:0,perDay:0},resetIn:{minute:1,hour:1,day:g(864e5,h)},error:"今日请求次数已达上限，请明天再试"};let $=[...h,{count:1,createdAt:n}];return u.set(l,$),{allowed:!0,remaining:{perMinute:t.perMinute-f-1,perHour:t.perHour-y-1,perDay:t.perDay-x-1},resetIn:{minute:60,hour:3600,day:86400}}}async function d(e,r="default"){let t=function(){if(i)return i;let e=process.env.REDIS_URL;if(!e)return a||(o.warn("[RateLimit] REDIS_URL not configured, using memory storage"),a=!0),null;try{return(i=new n.Redis(e,{maxRetriesPerRequest:3,enableReadyCheck:!0,lazyConnect:!0})).on("error",e=>{o.error("[RateLimit] Redis error:",e.message)}),i.on("connect",()=>{}),i}catch(e){return o.error("[RateLimit] Failed to create Redis client:",e),null}}(),u=t?await l(t,e,r):c(e,r);if(!u.allowed){let t=s[r];o.warn(`[RateLimit] DENY identifier="${e}" apiType=${r} limits=${t.perMinute}/min,${t.perHour}/h,${t.perDay}/d remaining=${u.remaining.perMinute}/${u.remaining.perHour}/${u.remaining.perDay} resetInSec=${u.resetIn.minute}/${u.resetIn.hour}/${u.resetIn.day} reason="${u.error}"`)}return u}function m(e){return e.trim().toLowerCase().replace(/[^a-z0-9:._-]+/g,"-").replace(/-+/g,"-").slice(0,120)||"unknown"}function h(e,r){if(r)return`user:${r}`;let t=m(function(e){let r=e.headers.get("x-forwarded-for"),t=e.headers.get("x-real-ip"),n=e.headers.get("cf-connecting-ip"),o=e.headers.get("forwarded");if(n?.trim())return n.trim();if(r?.trim())return r.split(",")[0]?.trim()||"unknown";if(t?.trim())return t.trim();let i=o?.match(/for=(?:"?\[?)([^;\],"]+)/i);return i?.[1]?i[1].trim():"unknown"}(e));if("unknown"===t||"127.0.0.1"===t||"::1"===t||"::ffff:127.0.0.1"===t){let r=m(e.headers.get("user-agent")||"anonymous");return`ip:${t}:ua:${r}`}return`ip:${t}`}function f(e){return new Response(JSON.stringify({success:!1,error:e.error,remaining:e.remaining,resetIn:e.resetIn}),{status:429,headers:{"Content-Type":"application/json","X-RateLimit-Remaining-Minute":String(e.remaining.perMinute),"X-RateLimit-Remaining-Hour":String(e.remaining.perHour),"X-RateLimit-Remaining-Day":String(e.remaining.perDay),"Retry-After":String(Math.min(e.resetIn.minute,60))}})}},39498:(e,r,t)=>{t.d(r,{Iy:()=>a,bE:()=>i});var n=t(45457),o=t(30450);function i(e){let r=e.headers.get("Authorization");if(!r?.startsWith("Bearer "))return null;let t=r.slice(7),o=n.O.verifyToken(t);return o?.sub||null}async function a(e,r){let t=process.env.SMOKE_BYPASS_TOKEN;if(t&&e.headers.get("X-Smoke-Bypass")===t)return null;let n=i(e),a=(0,o.xC)(e,n),s=await (0,o.Dn)(a,r);return s.allowed?null:(0,o.tD)(s)}}};var r=require("../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),n=r.X(0,[6662,9811,523,3219,7914,8261,6682,8367,5457,6018],()=>t(61813));module.exports=n})();