"use strict";exports.id=4739,exports.ids=[4739],exports.modules={90130:(e,r,t)=>{t.d(r,{y:()=>p});var s=t(91323),i=t(45171);let a=(0,t(30357).hu)("email"),o=()=>({host:process.env.SMTP_HOST||"smtp.qq.com",port:parseInt(process.env.SMTP_PORT||"465"),secure:"false"!==process.env.SMTP_SECURE,user:process.env.SMTP_USER||"",pass:process.env.SMTP_PASS||"",from:process.env.SMTP_FROM||process.env.SMTP_USER||"",appName:process.env.APP_NAME||"MeetMind"});function n(){let e=o();if(!e.user||!e.pass)throw a.error("[EmailService] SMTP 配置检查:",{host:e.host,user:e.user?"已配置":"未配置",pass:e.pass?"已配置":"未配置"}),Error("邮箱服务未配置，请设置 SMTP_USER 和 SMTP_PASS 环境变量");return s.createTransport({host:e.host,port:e.port,secure:e.secure,auth:{user:e.user,pass:e.pass}})}let c=()=>{let e=o().appName;return{login:{subject:`【${e}】登录验证码`,html:r=>`
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${e}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
            <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">您正在登录 ${e}，验证码为：</p>
            <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
              <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${r}</span>
            </div>
            <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
            如非本人操作，请忽略此邮件
          </p>
        </div>
      `},register:{subject:`【${e}】注册验证码`,html:r=>`
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${e}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
            <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">欢迎注册 ${e}，验证码为：</p>
            <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
              <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${r}</span>
            </div>
            <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
            如非本人操作，请忽略此邮件
          </p>
        </div>
      `},reset_password:{subject:`【${e}】重置密码验证码`,html:r=>`
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4A574; margin: 0; font-size: 28px;">${e}</h1>
            <p style="color: #666; margin: 10px 0 0;">AI 驱动的智能学习助手</p>
          </div>
          <div style="background: linear-gradient(135deg, #FAF7F2 0%, #F2EDE3 100%); border-radius: 16px; padding: 30px; text-align: center;">
            <p style="color: #1E3B4D; font-size: 16px; margin: 0 0 20px;">您正在重置密码，验证码为：</p>
            <div style="background: white; border-radius: 12px; padding: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(212,165,116,0.15);">
              <span style="font-size: 36px; font-weight: bold; color: #D4A574; letter-spacing: 8px;">${r}</span>
            </div>
            <p style="color: #666; font-size: 14px; margin: 20px 0 0;">验证码 5 分钟内有效，请勿泄露给他人</p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
            如非本人操作，请立即修改密码
          </p>
        </div>
      `}}};async function d(e,r,t,s={}){let{maxRetries:i=2,retryDelay:d=1e3}=s,p=c()[t],l=o();for(let t=0;t<=i;t++)try{let t=n();await t.sendMail({from:`"${l.appName}" <${l.from}>`,to:e,subject:p.subject,html:p.html(r)});return}catch(e){a.error(`[EmailService] 发送邮件失败 [attempt: ${t+1}/${i+1}]:`,e),t<i&&await new Promise(e=>setTimeout(e,d*(t+1)))}a.error(`[EmailService] 发送邮件最终失败: ${e} (${t}) - 验证码已入库，用户可尝试重新发送`)}let p={isConfigured(){let e=o();return!!(e.user&&e.pass)},async sendVerificationCode(e,r){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))return{success:!1,error:"邮箱格式不正确"};if(!this.isConfigured())return a.error("[EmailService] SMTP 未配置"),{success:!1,error:"邮箱服务暂不可用"};let t=await i.N.createCode(e,"email",r);if(!t.success)return{success:!1,error:t.error,retryAfter:t.retryAfter};let s=t.code,d=c()[r],p=o();try{let r=n();return await r.sendMail({from:`"${p.appName}" <${p.from}>`,to:e,subject:d.subject,html:d.html(s)}),{success:!0}}catch(e){return a.error("[EmailService] 发送邮件失败:",e),{success:!1,error:"发送邮件失败，请稍后重试"}}},async sendVerificationCodeAsync(e,r){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))return{success:!1,error:"邮箱格式不正确"};if(!this.isConfigured())return a.error("[EmailService] SMTP 未配置"),{success:!1,error:"邮箱服务暂不可用"};let t=await i.N.createCode(e,"email",r);if(!t.success)return{success:!1,error:t.error,retryAfter:t.retryAfter};let s=t.code;return setImmediate(()=>{d(e,s,r,{maxRetries:2,retryDelay:1e3}).catch(e=>{a.error("[EmailService] 异步发送邮件出错:",e)})}),{success:!0}},verifyCode:async(e,r,t)=>i.N.verifyCode(e,r,"email",t)}},96460:(e,r,t)=>{t.d(r,{J:()=>m});var s=t(84770),i=t(45171);let a=(0,t(30357).hu)("sms"),o=process.env.TENCENT_SMS_SECRET_ID||"",n=process.env.TENCENT_SMS_SECRET_KEY||"",c=process.env.TENCENT_SMS_SDK_APP_ID||"",d=process.env.TENCENT_SMS_SIGN_NAME||"MeetMind",p=process.env.TENCENT_SMS_TEMPLATE_ID||"",l="sms.tencentcloudapi.com",u="SendSms";async function f(e,r){let t=JSON.stringify({PhoneNumberSet:[`+86${e}`],SmsSdkAppId:c,SignName:d,TemplateId:p,TemplateParamSet:r}),i=function(e){let r=Math.floor(Date.now()/1e3),t=new Date(1e3*r).toISOString().slice(0,10),i="application/json; charset=utf-8",a=(0,s.createHash)("sha256").update(e).digest("hex"),c=`content-type:${i}
host:${l}
x-tc-action:${u.toLowerCase()}
`,d="content-type;host;x-tc-action",p=`POST
/

${c}
${d}
${a}`,f="TC3-HMAC-SHA256",m=`${t}/sms/tc3_request`,g=(0,s.createHash)("sha256").update(p).digest("hex"),y=function(e,r,t,i){let a=(0,s.createHmac)("sha256",`TC3${e}`).update(r).digest(),o=(0,s.createHmac)("sha256",a).update("sms").digest(),n=(0,s.createHmac)("sha256",o).update("tc3_request").digest();return(0,s.createHmac)("sha256",n).update(i).digest("hex")}(n,t,0,`${f}
${r}
${m}
${g}`),x=`${f} Credential=${o}/${m}, SignedHeaders=${d}, Signature=${y}`;return{"Content-Type":i,Host:l,"X-TC-Action":u,"X-TC-Version":"2021-01-11","X-TC-Timestamp":String(r),"X-TC-Region":"ap-guangzhou",Authorization:x}}(t);try{let e=await fetch(`https://${l}`,{method:"POST",headers:i,body:t}),r=await e.json();if(r.Response?.Error)return a.error("[SmsService] 腾讯云API错误:",r.Response.Error),{success:!1,error:"短信发送失败"};let s=r.Response?.SendStatusSet?.[0];if(s?.Code!=="Ok")return a.error("[SmsService] 短信发送失败:",s),{success:!1,error:s?.Message||"短信发送失败"};return{success:!0}}catch(e){return a.error("[SmsService] 请求失败:",e),{success:!1,error:"网络错误，请稍后重试"}}}let m={isConfigured:()=>!!(o&&n&&c&&p),async sendVerificationCode(e,r){if(!/^1[3-9]\d{9}$/.test(e))return{success:!1,error:"手机号格式不正确"};if(!this.isConfigured())return a.error("[SmsService] 腾讯云短信未配置"),{success:!1,error:"短信服务暂不可用"};let t=await i.N.createCode(e,"sms",r);if(!t.success)return{success:!1,error:t.error,retryAfter:t.retryAfter};let s=t.code,o=await f(e,[s,"5"]);return o.success?{success:!0}:{success:!1,error:o.error}},verifyCode:async(e,r,t)=>i.N.verifyCode(e,r,"sms",t)}},45171:(e,r,t)=>{t.d(r,{N:()=>c});var s=t(37462),i=t(84770);let a=(0,t(30357).hu)("verification-code");async function o(e,r){let t=await s.Z.verificationCode.findFirst({where:{target:e,type:r,createdAt:{gte:new Date(Date.now()-6e4)}},orderBy:{createdAt:"desc"}});return t?{allowed:!1,retryAfter:60-Math.floor((Date.now()-t.createdAt.getTime())/1e3)}:{allowed:!0}}async function n(){await s.Z.verificationCode.deleteMany({where:{expiresAt:{lt:new Date}}})}let c={async createCode(e,r,t){let c=await o(e,r);if(!c.allowed)return{success:!1,error:`请${c.retryAfter}秒后再试`,retryAfter:c.retryAfter};await s.Z.verificationCode.deleteMany({where:{target:e,type:r,purpose:t}});let d=String((0,i.randomInt)(1e5,1e6)),p=new Date(Date.now()+3e5);return await s.Z.verificationCode.create({data:{target:e,code:d,type:r,purpose:t,expiresAt:p}}),n().catch(e=>a.error("cleanup failed",e)),{success:!0,code:d}},async verifyCode(e,r,t,i){let a=await s.Z.verificationCode.findFirst({where:{target:e,type:t,purpose:i,verified:!1},orderBy:{createdAt:"desc"}});return a?a.expiresAt<new Date?(await s.Z.verificationCode.delete({where:{id:a.id}}),{success:!1,error:"验证码已过期，请重新获取"}):a.attempts>=5?(await s.Z.verificationCode.delete({where:{id:a.id}}),{success:!1,error:"验证次数过多，请重新获取验证码"}):a.code!==r?(await s.Z.verificationCode.update({where:{id:a.id},data:{attempts:a.attempts+1}}),{success:!1,error:"验证码错误",attemptsLeft:5-a.attempts-1}):(await s.Z.verificationCode.update({where:{id:a.id},data:{verified:!0}}),{success:!0}):{success:!1,error:"请先获取验证码"}},isCodeVerified:async(e,r,t)=>!!await s.Z.verificationCode.findFirst({where:{target:e,type:r,purpose:t,verified:!0,expiresAt:{gte:new Date}}}),consumeVerifiedCode:async(e,r,t)=>(await s.Z.verificationCode.deleteMany({where:{target:e,type:r,purpose:t,verified:!0}})).count>0}}};