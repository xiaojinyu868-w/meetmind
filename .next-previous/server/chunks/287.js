"use strict";exports.id=287,exports.ids=[287],exports.modules={88255:(e,t,r)=>{e.exports=r(30517)},95553:(e,t,r)=>{r.d(t,{Kf:()=>b,S9:()=>L,qj:()=>B,QQ:()=>v});var n=r(84770),i=r.n(n),o=r(92048),a=r.n(o),l=r(55315),s=r.n(l),c=r(30357);let d=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let e=0;e<8;e++)t=1&t?3988292384^t>>>1:t>>>1;d[e]=t>>>0}function p(e){let t=4294967295;for(let r=0;r<e.length;r++)t=d[(t^e[r])&255]^t>>>8;return(4294967295^t)>>>0}function f(e){let t=[],r=[],n=0;for(let i of e){let e=Buffer.from(i.name,"utf8"),o=p(i.data),a=Buffer.alloc(30);a.writeUInt32LE(67324752,0),a.writeUInt16LE(20,4),a.writeUInt16LE(2048,6),a.writeUInt16LE(0,8),a.writeUInt16LE(0,10),a.writeUInt16LE(0,12),a.writeUInt32LE(o,14),a.writeUInt32LE(i.data.length,18),a.writeUInt32LE(i.data.length,22),a.writeUInt16LE(e.length,26),a.writeUInt16LE(0,28),t.push(a,e,i.data);let l=Buffer.alloc(46);l.writeUInt32LE(33639248,0),l.writeUInt16LE(20,4),l.writeUInt16LE(20,6),l.writeUInt16LE(2048,8),l.writeUInt16LE(0,10),l.writeUInt16LE(0,12),l.writeUInt16LE(0,14),l.writeUInt32LE(o,16),l.writeUInt32LE(i.data.length,20),l.writeUInt32LE(i.data.length,24),l.writeUInt16LE(e.length,28),l.writeUInt32LE(n,42),r.push(l,e),n+=30+e.length+i.data.length}let i=Buffer.concat(r),o=Buffer.alloc(22);return o.writeUInt32LE(101010256,0),o.writeUInt16LE(e.length,8),o.writeUInt16LE(e.length,10),o.writeUInt32LE(i.length,12),o.writeUInt32LE(n,16),Buffer.concat([...t,i,o])}function u(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}let m=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,g=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;function w(e,t){let r=`试讲讲稿 \xb7 生成于 ${t}`,n=e.split(/\r?\n/),i=[`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${u(r)}</w:t></w:r></w:p>`,"<w:p/>",...n.map(e=>""===e?"<w:p/>":`<w:p><w:r><w:t xml:space="preserve">${u(e)}</w:t></w:r></w:p>`)].join(""),o=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${i}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;return f([{name:"[Content_Types].xml",data:Buffer.from(m,"utf8")},{name:"_rels/.rels",data:Buffer.from(g,"utf8")},{name:"word/document.xml",data:Buffer.from(o,"utf8")}])}let h=(0,c.hu)("xiaoda-compat"),x="【讲稿开始】",y="【讲稿结束】",b=s().join(process.cwd(),"data","xiaoda-files"),E=864e5,L=/^[a-f0-9]{32}\.(docx|html)$/,_="application/vnd.openxmlformats-officedocument.wordprocessingml.document";function U(e){let t=e.indexOf(x);if(t<0)return null;let r=t+x.length,n=e.indexOf(y,r);return n<0?null:e.slice(r,n).trim()||null}function v(e){let t=e.get("x-forwarded-host")?.split(",")[0].trim()||e.get("host")?.trim()||"localhost",r=e.get("x-forwarded-proto")?.split(",")[0].trim(),n=t.startsWith("localhost")||t.startsWith("127.0.0.1"),i=r||(n?"http":"https");return`${i}://${t}`}function I(e){let t=e=>String(e).padStart(2,"0");return`${e.getFullYear()}-${t(e.getMonth()+1)}-${t(e.getDate())} ${t(e.getHours())}:${t(e.getMinutes())}`}function $(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function S(e,t){let r=e.split(/\r?\n/).map(e=>e.trim()).filter(Boolean).map(e=>`<p>${$(e)}</p>`).join("\n      ");return`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>试讲讲稿 \xb7 上场包</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: #f7f5f2; color: #1c1a17;
    font-size: 19px; line-height: 1.9;
    padding: 28px 18px 64px;
  }
  .page { max-width: 640px; margin: 0 auto; }
  header { margin-bottom: 28px; }
  .badge {
    display: inline-block; font-size: 13px; letter-spacing: 2px;
    color: #8a6d3b; border: 1px solid #d8c9a8; border-radius: 999px;
    padding: 2px 12px; margin-bottom: 14px;
  }
  h1 { font-size: 26px; line-height: 1.4; margin-bottom: 10px; }
  .scene { font-size: 15px; color: #6b655c; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #9a938a; }
  .draft p { margin: 0 0 1.1em; }
  @media print {
    body { background: #fff; font-size: 14pt; padding: 0; }
    .page { max-width: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div class="badge">上场包</div>
      <h1>试讲讲稿</h1>
      <p class="scene">场合：__________　听众：__________　时长：__________</p>
      <p class="meta">生成于 ${$(t)} \xb7 上场前 \xb7 MeetMind</p>
    </header>
    <main class="draft">
      ${r}
    </main>
  </div>
</body>
</html>
`}function T(e){let t;try{t=a().readdirSync(b)}catch{return}for(let r of t)if(L.test(r))try{let t=a().statSync(s().join(b,r));e-t.mtimeMs>E&&a().unlinkSync(s().join(b,r))}catch{}}async function B(e,t){let r=U(e);if(!r)return null;try{let e=new Date,n=I(e),o=w(r,n),l=S(r,n),c=i().randomBytes(16).toString("hex");a().mkdirSync(b,{recursive:!0}),T(e.getTime()),a().writeFileSync(s().join(b,`${c}.docx`),o),a().writeFileSync(s().join(b,`${c}.html`),l,"utf8");let d=`${t}/api/compat/v1/files/${c}.docx`,p=`${t}/api/compat/v1/files/${c}.html`;return h.debug("rehearsal draft artifacts generated",{chars:r.length,docxBytes:o.length,stem:c}),{noteLine:`

📄 讲稿附件已生成，也可在线查看：${p}`,xSoda:{attachments:[{fileUrl:d,fileName:"试讲讲稿.docx",fileType:"word",mimeType:_,fileSize:o.length,expiresAt:new Date(e.getTime()+E).toISOString()}]}}}catch(t){let e=t instanceof Error?t.message:String(t);return h.warn("rehearsal draft artifacts failed",{err:e}),null}}},30357:(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{hu:()=>createLogger,j:()=>track});let isBrowser=!1,alsInstance=null;function getALS(){if(isBrowser)return null;if(alsInstance)return alsInstance;try{let nodeRequire=eval("require"),{AsyncLocalStorage}=nodeRequire("async_hooks");return alsInstance=new AsyncLocalStorage}catch{return null}}function withLogContext(e,t){let r=getALS();if(!r)return t();let n={...r.getStore()??{},...e};return r.run(n,t)}function getContext(){let e=getALS();return e?e.getStore()??{}:{}}let rootPino=null;function getRootPino(){if(isBrowser)return null;if(rootPino)return rootPino;try{let nodeRequire=eval("require"),pinoModule=nodeRequire("pino"),pino=pinoModule.default??pinoModule,level=process.env.LOG_LEVEL??"info",isDev=!1,transport=isDev&&!process.env.LOG_JSON?(()=>{try{return nodeRequire.resolve("pino-pretty"),{target:"pino-pretty",options:{colorize:!0,translateTime:"SYS:HH:MM:ss.l",ignore:"pid,hostname"}}}catch{return}})():void 0;return rootPino=pino({level,base:{service:"meetmind"},timestamp:pino.stdTimeFunctions.isoTime,...transport?{transport}:{}})}catch{return null}}function fmtConsole(e,t,r){let n=`[${e}]`;return void 0!==r?[n,t,r]:[n,t]}function createLogger(e){let t=getRootPino();if(!t){let t=process.env.LOG_LEVEL??"info",r={debug:0,info:1,warn:2,error:3},n=r[t]??1,i=e=>r[e]>=n,o=t=>(r,n)=>{i(t)&&("error"===t?console.error:"warn"===t?console.warn:console.log)(...fmtConsole(e,r,n))};return{debug:o("debug"),info:o("info"),warn:o("warn"),error:o("error"),child:t=>createLogger(`${e}:${String(t.scope??"sub")}`)}}let r=t.child({tag:e}),n=(e,t,n)=>{let i={...getContext()};void 0!==n&&(i.data=n),r[e](i,t)};return{debug:(e,t)=>n("debug",e,t),info:(e,t)=>n("info",e,t),warn:(e,t)=>n("warn",e,t),error:(e,t)=>n("error",e,t),child:t=>{let n=r.child(t),i=(e,t,r)=>{let i={...getContext()};void 0!==r&&(i.data=r),n[e](i,t)};return{debug:(e,t)=>i("debug",e,t),info:(e,t)=>i("info",e,t),warn:(e,t)=>i("warn",e,t),error:(e,t)=>i("error",e,t),child:t=>{let r=n.child(t),i=(e,t,n)=>{let i={...getContext()};void 0!==n&&(i.data=n),r[e](i,t)};return{debug:(e,t)=>i("debug",e,t),info:(e,t)=>i("info",e,t),warn:(e,t)=>i("warn",e,t),error:(e,t)=>i("error",e,t),child:t=>createLogger(`${e}:${String(t.scope??"sub")}`)}}}}}}let trackLog=createLogger("track");function track(e){let{kind:t,...r}=e;trackLog[t.endsWith(".fail")?"error":(t.endsWith(".success"),"info")](t,r)}}};