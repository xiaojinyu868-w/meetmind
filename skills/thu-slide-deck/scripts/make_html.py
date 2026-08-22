#!/usr/bin/env python3
# make_html.py — 纯文本大纲 → 单文件 HTML 讲演 deck 生成器（v5 主交付）
# 瑞士国际主义视觉：直角 / 无阴影 / 无渐变 / 1px 发丝线；主题固定清华紫。
# 单文件输出：所有 CSS/JS 内联，零 CDN、零网络、零构建，教室离线可放映。
# 七种页型：COVER / SECTION / STATEMENT / CONTENT / DATA / COMPARE / CLOSING。
# 演讲者模式：按 P 当前窗口变深色控制台（页预览 + 口播稿 + 意图 + 计时），
# 并弹干净观众屏（BroadcastChannel + postMessage 双通道同步翻页）。
# 方法论参考 guizang-ppt-skill（AGPL-3.0，仅吸收设计参数）与
# anthropics/skills 官方 pptx skill；本文件代码全部原创。
# 零依赖：只用标准库。用法：python3 make_html.py <slides.txt> <output.html>
# 生成后自检：data-layout 白名单 / data-slide-id 唯一 / SPEAKER_NOTES 数 == 页数 /
# HTML 标签配平；失败非零退出。输入 DSL 见 SKILL.md。
import json, os, re, sys
from html.parser import HTMLParser
from xml.sax.saxutils import escape

ENDING_TITLES = ('谢谢聆听', '谢谢', '恳请批评指正')
LAYOUTS = ('COVER', 'SECTION', 'STATEMENT', 'CONTENT', 'DATA', 'COMPARE', 'CLOSING')
VOID_TAGS = {'meta', 'br', 'hr', 'img', 'link', 'input', 'col', 'wbr', 'source', 'base'}


def esc(text):
    return escape(text, {'"': '&quot;'})


def rich(text):
    """转义后支持 *强调字* → <em>（斜体，不用 accent 色压紫底）。"""
    return re.sub(r'\*([^*]+)\*', r'<em>\1</em>', esc(text))


def parse_dsl(text):  # 与 check_deck.py / make_pptx.py 同一份 DSL 语义
    meta, slides, cur = {}, [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.lstrip()
        if not s or s.startswith('//'):
            continue
        if line.startswith('%'):
            key, _, val = line[1:].partition(' ')
            meta[key.strip()] = val.strip()
        elif line.startswith('# '):
            cur = {'title': line[2:].strip(), 'bullets': [], 'notes': [], 'intent': None}
            slides.append(cur)
        elif s.startswith('>>') and cur is not None:
            cur['notes'].append(s[2:].strip())
        elif s.startswith('~ ') and cur is not None:
            cur['intent'] = s[2:].strip()
        elif s.startswith('- ') and cur is not None:
            cur['bullets'].append((2 if raw.startswith('  ') else 1, s[2:].strip()))
    return meta, slides


def classify(title):
    if title in ENDING_TITLES:
        return 'CLOSING', title
    for pre, layout in (('章节：', 'SECTION'), ('强调：', 'STATEMENT'),
                        ('数据：', 'DATA'), ('对比：', 'COMPARE')):
        if title.startswith(pre):
            return layout, title[len(pre):].strip()
    return 'CONTENT', title


def parse_duration(meta):
    raw = meta.get('duration')
    if not raw:
        return None
    try:
        d = float(raw)
        return d if d > 0 else None
    except ValueError:
        return None


def cover_kicker(meta):
    """封面左上 mono kicker：从 subtitle 关键词推英文栏目名 + %date。"""
    s = meta.get('subtitle', '')
    base = 'PRESENTATION'
    for kw, en in (('组会', 'GROUP MEETING'), ('答辩', 'DEFENSE'),
                   ('路演', 'ROADSHOW'), ('竞赛', 'COMPETITION'), ('课程', 'COURSE TALK')):
        if kw in s:
            base = en
            break
    d = meta.get('date', '')
    return base + (' · ' + d if d else '')


# ---------- 页型渲染 ----------

def chrome(label, n, total):
    return ('<header class="chrome"><span>%s</span><span>%02d / %02d</span></header>'
            % (esc(label), n, total))


def footer(n):
    return ('<footer class="foot"><div class="foot-rule"></div>'
            '<div class="foot-row"><span>清华大学</span><span>%02d</span></div></footer>' % n)


def open_section(layout, n):
    return '<section class="slide" data-layout="%s" data-slide-id="s%02d">' % (layout, n)


def build_cover(meta, n, total):
    out = [open_section('COVER', n), '<div class="body">']
    out.append('<div class="cover-kicker" data-anim>%s</div>' % esc(cover_kicker(meta)))
    out.append('<div class="cover-mid"><h1 class="cover-title" data-anim>%s</h1>'
               % rich(meta.get('title', '')))
    if meta.get('subtitle'):
        out.append('<p class="cover-sub" data-anim>%s</p>' % esc(meta['subtitle']))
    out.append('</div>')
    bits = ' · '.join(esc(x) for x in (meta.get('author'), meta.get('date')) if x)
    out.append('<div data-anim><div class="cover-rule"></div>'
               '<div class="cover-meta">%s</div></div>' % bits)
    out.append('</div></section>')
    return ''.join(out)


def build_section(sec_no, title, n, total, label):
    return ''.join([
        open_section('SECTION', n),
        chrome(label, n, total),
        '<div class="body sec">',
        '<div class="sec-num" data-anim>%02d</div>' % sec_no,
        '<h1 class="sec-title" data-anim>%s</h1>' % rich(title),
        '</div>', footer(n), '</section>'])


def build_statement(title, n, total, label):
    return ''.join([
        open_section('STATEMENT', n),
        chrome(label, n, total),
        '<div class="body stmt">',
        '<p class="stmt-text" data-anim>%s</p>' % rich(title),
        '</div>', footer(n), '</section>'])


def head_block(kicker_text, title):
    """CONTENT / DATA / COMPARE 共用的白底论断标题块。"""
    return ('<div class="kicker" data-anim>%s</div>'
            '<h2 class="c-title" data-anim>%s</h2>'
            '<div class="c-rule" data-anim></div>'
            % (esc(kicker_text), rich(title)))


def build_content(title, bullets, n, total, label, arg_no):
    out = [open_section('CONTENT', n), chrome(label, n, total), '<div class="body">',
           head_block('论点 %02d' % arg_no, title), '<ul class="c-list">']
    for lv, text in bullets:
        out.append('<li class="l%d" data-anim>%s</li>' % (lv, rich(text)))
    out.append('</ul></div>')
    out.append(footer(n))
    out.append('</section>')
    return ''.join(out)


def build_data(title, bullets, n, total, label, arg_no):
    stats = []
    for lv, text in bullets:
        parts = [p.strip() for p in text.split('|')]
        num = parts[0] if parts else ''
        lab = parts[1] if len(parts) > 1 else ''
        note = parts[2] if len(parts) > 2 else ''
        if len(parts) == 1:
            sys.stderr.write('提示：第 %d 页数据行「%s」缺少「| 标签」，已按纯数字渲染\n'
                             % (n, text[:16]))
        stats.append((num, lab, note))
    if not 2 <= len(stats) <= 4:
        sys.stderr.write('提示：第 %d 页数据页 %d 列，建议 2-4 个 stat 列\n' % (n, len(stats)))
    focus = 0
    for i, (_, _, note) in enumerate(stats):
        if '焦点' in note:
            focus = i
            break
    out = [open_section('DATA', n), chrome(label, n, total), '<div class="body">',
           head_block('论点 %02d' % arg_no, title), '<div class="stats">']
    for i, (num, lab, note) in enumerate(stats):
        cls = 'stat focus' if i == focus else 'stat'
        out.append('<div class="%s" data-anim>' % cls)
        out.append('<div class="stat-label">%s</div>' % esc(lab))
        out.append('<div class="stat-num">%s</div>' % esc(num))
        if note:
            out.append('<div class="stat-note">%s</div>' % esc(note))
        out.append('</div>')
    out.append('</div></div>')
    out.append(footer(n))
    out.append('</section>')
    return ''.join(out)


def build_compare(title, bullets, n, total, label, arg_no):
    out = [open_section('COMPARE', n), chrome(label, n, total), '<div class="body">',
           head_block('论点 %02d' % arg_no, title), '<div class="cmp">']
    for lv, text in bullets:
        parts = [p.strip() for p in text.split('|', 1)]
        left = parts[0]
        right = parts[1] if len(parts) > 1 else ''
        if len(parts) == 1:
            sys.stderr.write('提示：第 %d 页对比行「%s」缺少「|」右侧，已留空\n' % (n, text[:16]))
        out.append('<div class="cmp-row" data-anim>'
                   '<div class="cmp-l">%s</div><div class="cmp-r">%s</div></div>'
                   % (rich(left), rich(right)))
    out.append('</div></div>')
    out.append(footer(n))
    out.append('</section>')
    return ''.join(out)


def build_closing(title, bullets, n, total):
    items = [t for lv, t in bullets]
    out = [open_section('CLOSING', n)]
    if items:
        out.append('<div class="body closing">')
        out.append('<div class="cl-left"><div class="cl-tag" data-anim>THANKS</div>'
                   '<h1 class="cl-title" data-anim>%s</h1></div>' % rich(title))
        out.append('<div class="cl-right"><div class="cl-kicker" data-anim>要点回顾</div>'
                   '<ul class="cl-list">')
        for i, text in enumerate(items):
            cls = ' class="hl"' if i == 2 else ''  # 第 3 条紫色，与封面色彩闭环
            out.append('<li%s data-anim>%s</li>' % (cls, rich(text)))
        out.append('</ul></div></div>')
    else:
        out.append('<div class="body closing full">'
                   '<div class="cl-left"><div class="cl-tag" data-anim>THANKS</div>'
                   '<h1 class="cl-title" data-anim>%s</h1></div></div>' % rich(title))
    out.append('</section>')
    return ''.join(out)


# ---------- CSS（单文件内联，瑞士国际主义：直角 / 无阴影 / 无渐变 / 1px 发丝线） ----------

CSS = r"""
:root{
--paper:#FBFAFC;--ink:#16101C;--accent:#660874;--accent-on:#FFF;
--grey-1:#F3EEF7;--grey-2:#DDD3E4;--grey-3:#7A7285;--border-subtle:#E8E2EE;
--sans:"Inter",-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif;
--mono:ui-monospace,"SF Mono","Cascadia Code","Consolas",monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
em{font-style:italic}
#stage{width:100vw;height:100vh;overflow:hidden}
#deck{display:flex;height:100vh;transition:transform .6s cubic-bezier(.25,.46,.45,.94)}
.slide{position:relative;flex:0 0 100vw;width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--paper)}
.body{flex:1;display:flex;flex-direction:column;padding:5.5vh 5vw 7vh;min-height:0}

/* 顶部 chrome 与底部发丝线页脚 */
.chrome{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;padding:2.4vh 5vw 0;font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--grey-3);pointer-events:none}
.foot{position:absolute;left:0;right:0;bottom:0;padding:0 5vw 2.4vh;pointer-events:none}
.foot-rule{height:1px;background:var(--border-subtle)}
.foot-row{display:flex;justify-content:space-between;padding-top:1vh;font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--grey-3)}

/* 深色页（封面/章节/强调）：满屏清华紫，chrome 反白 */
.slide[data-layout=COVER],.slide[data-layout=SECTION],.slide[data-layout=STATEMENT]{background:var(--accent);color:var(--accent-on)}
.slide[data-layout=SECTION] .chrome,.slide[data-layout=STATEMENT] .chrome{color:rgba(255,255,255,.55)}
.slide[data-layout=SECTION] .foot-rule,.slide[data-layout=STATEMENT] .foot-rule{background:rgba(255,255,255,.22)}
.slide[data-layout=SECTION] .foot-row,.slide[data-layout=STATEMENT] .foot-row{color:rgba(255,255,255,.55)}
.slide[data-layout=COVER] .chrome,.slide[data-layout=COVER] .foot,
.slide[data-layout=CLOSING] .chrome,.slide[data-layout=CLOSING] .foot{display:none}

/* COVER */
.cover-kicker{font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.cover-mid{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.cover-title{font-size:min(7vw,12vh);font-weight:200;letter-spacing:-.02em;line-height:1.18;max-width:88%;text-wrap:balance}
.cover-sub{margin-top:3vh;font-size:max(20px,1.4vw);font-weight:300;color:rgba(255,255,255,.7);letter-spacing:.02em}
.cover-rule{height:1px;background:rgba(255,255,255,.22)}
.cover-meta{padding-top:1.6vh;font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6)}

/* SECTION */
.sec{justify-content:center}
.sec-num{font-family:var(--mono);font-size:min(9vw,15vh);font-weight:400;letter-spacing:.1em;color:rgba(255,255,255,.25);line-height:1}
.sec-title{margin-top:2.5vh;font-size:min(4.6vw,8vh);font-weight:200;letter-spacing:-.02em;line-height:1.2}

/* STATEMENT */
.stmt{justify-content:center}
.stmt-text{font-size:min(6vw,10.5vh);font-weight:200;letter-spacing:-.01em;line-height:1.3;max-width:84%;text-wrap:balance}

/* CONTENT 标题块（DATA / COMPARE 共用） */
.kicker{font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--accent)}
.c-title{margin-top:1vh;font-size:min(2.5vw,4.4vh);font-weight:400;letter-spacing:-.01em;line-height:1.4;max-width:86%}
.c-rule{height:1px;background:var(--border-subtle);margin:2.4vh 0 3.6vh}

/* CONTENT 要点：不对称网格，要点区 max-width 62%，右侧留白 */
.c-list{list-style:none;max-width:62%}
.c-list li{position:relative;line-height:1.65}
.c-list .l1{padding-left:24px;margin-bottom:1.5vh;font-size:max(18px,1.15vw);font-weight:400}
.c-list .l1::before{content:'';position:absolute;left:0;top:.58em;width:8px;height:8px;background:var(--accent)}
.c-list .l2{padding-left:48px;margin-bottom:1vh;font-size:max(16px,1vw);color:var(--grey-3)}
.c-list .l2::before{content:'\2013';position:absolute;left:26px;color:var(--grey-2)}

/* DATA：2-4 stat 列，列顶 2px 紫线，焦点列紫底反白 */
.stats{flex:1;display:flex;gap:2.5vw;align-items:flex-start;min-height:0}
.stat{flex:1;display:flex;flex-direction:column;border-top:2px solid var(--accent);padding-top:2.4vh;min-width:0}
.stat-label{font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--grey-3);margin-bottom:3vh}
.stat-num{font-size:min(6vw,10vh);font-weight:200;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.05;margin-bottom:2.2vh}
.stat-note{font-size:max(16px,1vw);line-height:1.5;color:var(--grey-3)}
.stat.focus{background:var(--accent);padding:2.4vh 2vw 2.5vh;color:var(--accent-on)}
.stat.focus .stat-label,.stat.focus .stat-note{color:rgba(255,255,255,.72)}
.stat.focus .stat-num{color:var(--accent-on)}

/* COMPARE：左右两半 + 中缝 1px 竖线，左半 opacity .62 */
.cmp{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.cmp::before{content:'';position:absolute;left:50%;top:2%;bottom:2%;width:1px;background:var(--grey-2)}
.cmp-row{display:grid;grid-template-columns:1fr 1fr;column-gap:6vw;padding:1.7vh 0}
.cmp-l,.cmp-r{font-size:max(18px,1.1vw);line-height:1.6;font-weight:400}
.cmp-l{text-align:right;opacity:.62}

/* CLOSING：左紫右白 split（无要点时整页紫） */
.closing{flex-direction:row;padding:0}
.cl-left{width:44%;background:var(--accent);color:var(--accent-on);display:flex;flex-direction:column;justify-content:center;padding:0 4.5vw}
.cl-tag{font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:3vh}
.cl-title{font-size:min(5vw,8.5vh);font-weight:200;letter-spacing:-.02em;line-height:1.15}
.cl-right{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 5vw;min-width:0}
.cl-kicker{font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--grey-3);margin-bottom:2.5vh}
.cl-list{list-style:none}
.cl-list li{padding:1.8vh 0;border-top:1px solid var(--border-subtle);font-size:max(18px,1.15vw);line-height:1.55}
.cl-list li.hl{color:var(--accent)}
.closing.full .cl-left{width:100%;padding:0 10vw}

/* 导航点：6×6px 直角方块，active 紫、宽 18px */
#dots{position:fixed;bottom:1.2vh;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:40}
.dot{width:6px;height:6px;background:var(--grey-2);border:0;padding:0;cursor:pointer}
.dot.active{width:18px;background:var(--accent)}
body.on-dark .dot{background:rgba(255,255,255,.35)}
body.on-dark .dot.active{background:#fff}
#keyhint{position:fixed;right:5vw;bottom:1.2vh;font-family:var(--mono);font-size:max(13px,.8vw);letter-spacing:.15em;text-transform:uppercase;color:var(--grey-3);z-index:40;pointer-events:none}
body.on-dark #keyhint{color:rgba(255,255,255,.5)}
body.audience #dots,body.audience #keyhint,body.speaker #dots,body.speaker #keyhint{display:none}

/* ESC 总览：网格缩略图 */
#overview{position:fixed;inset:0;z-index:60;background:var(--paper);display:none;overflow:auto;padding:5vh 5vw}
#overview.open{display:block}
.ov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:2.5vw}
.ov-item{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--border-subtle);background:#fff;cursor:pointer}
.ov-item.cur{border:2px solid var(--accent)}
.ov-item .slide{position:absolute;top:0;left:0;flex:none;pointer-events:none}
.ov-item [data-anim]{opacity:1!important;transform:none!important;transition:none!important}
.ov-num{position:absolute;left:8px;bottom:6px;z-index:2;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--grey-3);background:rgba(255,255,255,.75);padding:1px 4px}

/* 演讲者控制台（按 P）：深色 #101216 */
#console{display:none}
body.speaker #console{position:fixed;inset:0;z-index:70;background:#101216;color:#E8E9ED;display:flex;flex-direction:column}
.c-main{flex:1;display:grid;grid-template-columns:minmax(0,11fr) minmax(0,9fr);gap:3vw;padding:4vh 3vw 2.5vh;min-height:0}
.c-prev{position:relative;align-self:center;width:100%;aspect-ratio:16/9;max-height:100%;overflow:hidden;background:#000;margin:0 auto}
body.speaker #stage{position:absolute;top:0;left:0}
.c-side{min-height:0;overflow:auto;padding-right:1vw}
.c-tag{font-family:var(--mono);font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#8A8F9C}
.c-title{margin-top:1.2vh;font-size:clamp(18px,1.6vw,26px);font-weight:400;line-height:1.4}
.c-intent{margin-top:1.2vh;font-size:13px;line-height:1.6;color:#9AA0AE}
.c-talk{margin-top:2.4vh;border-top:1px solid #262A33;padding-top:2.4vh}
.c-talk p{margin-bottom:1.4vh;font-size:16px;line-height:1.75;color:#E8E9ED}
.c-talk p.c-empty{color:#6B7180}
.c-next{margin-top:2.4vh;border-top:1px solid #262A33;padding-top:1.6vh;font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:#8A8F9C}
.c-bar{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #262A33;padding:1.8vh 3vw;font-family:var(--mono);font-size:13px;letter-spacing:.1em;color:#C6CAD4}
.c-timer{display:flex;align-items:center;gap:16px}
.c-timer button{background:none;border:1px solid #3A3F4B;color:#E8E9ED;font-family:var(--mono);font-size:12px;letter-spacing:.12em;padding:6px 16px;cursor:pointer}
.c-timer button:hover{border-color:#B14FC0;color:#fff}
#tRemain.over{color:#FF9DB0}
.c-meta{display:flex;gap:24px;align-items:center}
#cSync{color:#8A8F9C}

/* 观众屏结束页 */
#ended{display:none;position:fixed;inset:0;z-index:100;background:var(--ink);color:#fff;align-items:center;justify-content:center;font-size:min(3vw,5vh);font-weight:200;letter-spacing:.04em}

/* 入场动效：stagger fade + translateY(12px)，尊重 prefers-reduced-motion，B 键静态模式 */
[data-anim]{opacity:0;transform:translateY(12px);transition:opacity .5s ease,transform .5s ease}
[data-anim].in{opacity:1;transform:none}
html.static [data-anim]{opacity:1;transform:none;transition:none}
@media (prefers-reduced-motion:reduce){
[data-anim]{opacity:1!important;transform:none!important;transition:none!important}
#deck{transition:none}
}
"""


# ---------- JS（单文件内联，无任何库） ----------

JS = r"""
(function(){
"use strict";
var deck=document.getElementById('deck');
var slides=[].slice.call(deck.querySelectorAll('.slide'));
var N=slides.length;
var NOTES=SPEAKER_NOTES;
var body=document.body, html=document.documentElement;
var params=new URLSearchParams(location.search);
var isAudience=params.get('audience')==='1';
var session=params.get('session')||'';
var popup=null, chan=null, lastAck=0, lastSend=0, pendingSync=false;
var idx=0, lock=false;
var DARK={COVER:1,SECTION:1,STATEMENT:1};
var dotsBox=document.getElementById('dots');
var dots=[];
slides.forEach(function(s,i){
  var b=document.createElement('button');
  b.className='dot';
  b.setAttribute('aria-label','\u7b2c '+(i+1)+' \u9875');
  b.addEventListener('click',function(){go(i)});
  dotsBox.appendChild(b);dots.push(b);
});
try{if(localStorage.getItem('thu-deck-static')==='1')html.classList.add('static')}catch(e){}
if(isAudience)body.classList.add('audience');

function anim(slide){
  var els=slide.querySelectorAll('[data-anim]');
  var i;
  for(i=0;i<els.length;i++){els[i].classList.remove('in');els[i].style.transitionDelay='0ms'}
  if(html.classList.contains('static'))return;
  void slide.offsetWidth;
  for(i=0;i<els.length;i++){
    (function(el,k){el.style.transitionDelay=(k*80)+'ms';el.classList.add('in')})(els[i],i);
  }
}
function go(n,fromSync){
  n=Math.max(0,Math.min(N-1,n));
  if(n===idx&&deck.style.transform)return;
  idx=n;
  deck.style.transform='translateX('+(-100*n)+'vw)';
  for(var i=0;i<N;i++){
    dots[i].className='dot'+(i===n?' active':'');
    slides[i].classList.toggle('active',i===n);
  }
  body.classList.toggle('on-dark',!!DARK[slides[idx].getAttribute('data-layout')]);
  try{history.replaceState(null,'','#'+(n+1))}catch(e){}
  anim(slides[n]);
  if(!fromSync)syncGoto();
  if(body.classList.contains('speaker'))renderConsole();
}
function step(d){
  if(lock)return;
  lock=true;setTimeout(function(){lock=false},600);
  go(idx+d);
}

/* 键盘 / 滚轮 / 触屏 */
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();step(1)}
  else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();step(-1)}
  else if(e.key==='Home'){e.preventDefault();go(0)}
  else if(e.key==='End'){e.preventDefault();go(N-1)}
  else if(e.key==='Escape'){
    if(body.classList.contains('speaker'))speaker(false);else toggleOverview();
  }
  else if(e.key==='p'||e.key==='P'){if(!isAudience)speaker(!body.classList.contains('speaker'))}
  else if(e.key==='b'||e.key==='B'){
    html.classList.toggle('static');
    try{localStorage.setItem('thu-deck-static',html.classList.contains('static')?'1':'0')}catch(err){}
    anim(slides[idx]);
  }
});
var wheelLock=false;
window.addEventListener('wheel',function(e){
  if(overviewOpen()||body.classList.contains('speaker'))return;
  if(wheelLock)return;
  if(Math.abs(e.deltaY)<12&&Math.abs(e.deltaX)<12)return;
  wheelLock=true;setTimeout(function(){wheelLock=false},600);
  step((e.deltaY>0||e.deltaX>0)?1:-1);
},{passive:true});
var tx=0,ty=0;
window.addEventListener('touchstart',function(e){tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
window.addEventListener('touchend',function(e){
  var dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))step(dx<0?1:-1);
},{passive:true});

/* ESC 总览 */
var ov=document.getElementById('overview'),ovBuilt=false;
function overviewOpen(){return ov.classList.contains('open')}
function toggleOverview(){
  if(overviewOpen()){ov.classList.remove('open');return}
  if(!ovBuilt)buildOverview();
  ov.classList.add('open');fitOverview();
}
function buildOverview(){
  ovBuilt=true;
  var grid=document.createElement('div');grid.className='ov-grid';
  slides.forEach(function(s,i){
    var item=document.createElement('div');item.className='ov-item'+(i===idx?' cur':'');
    var cl=s.cloneNode(true);cl.removeAttribute('id');
    item.appendChild(cl);
    var num=document.createElement('span');num.className='ov-num';num.textContent=(i+1)+' / '+N;
    item.appendChild(num);
    item.addEventListener('click',function(){ov.classList.remove('open');go(i)});
    grid.appendChild(item);
  });
  ov.appendChild(grid);
}
function fitOverview(){
  var items=ov.querySelectorAll('.ov-item');
  for(var i=0;i<items.length;i++){
    var w=items[i].clientWidth;if(!w)continue;
    var cl=items[i].querySelector('.slide');
    cl.style.width='100vw';cl.style.height='100vh';
    cl.style.transformOrigin='0 0';
    cl.style.transform='scale('+(w/window.innerWidth)+')';
  }
}

/* 双通道同步：BroadcastChannel（thu-deck:<session>）+ postMessage 兜底 */
function openChan(){
  if(chan||!('BroadcastChannel' in window))return;
  try{
    chan=new BroadcastChannel('thu-deck:'+(session||'default'));
    chan.onmessage=function(e){onMsg(e.data)};
  }catch(e){}
}
function send(d){
  if(d&&d.t==='goto')lastSend=Date.now();
  if(chan){try{chan.postMessage(d)}catch(e){}}
  if(popup&&!popup.closed){try{popup.postMessage(d,'*')}catch(e){}}
}
function ackTo(){
  var d={t:'ack'};
  if(chan){try{chan.postMessage(d)}catch(e){}}
  try{if(window.opener)window.opener.postMessage(d,'*')}catch(e){}
}
function syncGoto(){
  if(!body.classList.contains('speaker'))return;
  send({t:'goto',i:idx});
}
function onMsg(d){
  if(!d||!d.t)return;
  if(isAudience){
    if(d.t==='goto'){go(d.i,true);ackTo()}
    else if(d.t==='end'){document.getElementById('ended').style.display='flex'}
  }else if(d.t==='ack'){
    lastAck=Date.now();
    var cs=document.getElementById('cSync');
    if(cs)cs.textContent='\u89c2\u4f17\u5c4f\u5df2\u540c\u6b65';
    if(pendingSync){pendingSync=false;syncGoto()}  // 只在等首次同步时回发，避免 goto-ack 乒乓
  }
}
window.addEventListener('message',function(e){onMsg(e.data)});
if(isAudience){openChan();setTimeout(ackTo,300)}

/* 演讲者控制台 */
var cPrev=document.getElementById('cPrev');
var stage=document.getElementById('stage');
var stageHome=stage.parentNode, stageNext=stage.nextSibling;
function speaker(on){
  if(on){
    body.classList.add('speaker');
    if(!session)session=String(Date.now());
    openChan();
    cPrev.appendChild(stage);fitPreview();
    openAudience();
    renderConsole();syncGoto();
  }else{
    body.classList.remove('speaker');
    stage.style.transform='';
    stageHome.insertBefore(stage,stageNext);
    send({t:'end'});
  }
}
function openAudience(){
  if(popup&&!popup.closed)return;
  var url=location.pathname+'?audience=1&session='+session;
  popup=window.open(url,'thu-deck-audience');
  pendingSync=true;
  var el=document.getElementById('cSync');
  if(!popup)el.textContent='\u89c2\u4f17\u5c4f\u5f39\u7a97\u88ab\u62e6\u622a\u2014\u2014\u8bf7\u5141\u8bb8\u5f39\u7a97\u540e\u91cd\u65b0\u6309 P';
  else el.textContent='\u89c2\u4f17\u5c4f\u672a\u8fde\u63a5';
}
function fitPreview(){
  if(!body.classList.contains('speaker'))return;
  var w=cPrev.clientWidth,h=cPrev.clientHeight;
  if(!w||!h)return;
  var k=Math.min(w/window.innerWidth,h/window.innerHeight);
  var ox=(w-window.innerWidth*k)/2,oy=(h-window.innerHeight*k)/2;
  stage.style.transformOrigin='0 0';
  stage.style.transform='translate('+ox+'px,'+oy+'px) scale('+k+')';
}
window.addEventListener('resize',function(){fitPreview();if(overviewOpen())fitOverview()});

function renderConsole(){
  var note=NOTES[idx],next=NOTES[idx+1];
  document.getElementById('cTag').textContent=
    '\u5f53\u524d\u9875 \u00b7 '+(idx+1)+' / '+N+(note.min?(' \u00b7 \u9884\u7b97 '+note.min+' \u5206\u949f'):'');
  document.getElementById('cTitle').textContent=note.title;
  var it=document.getElementById('cIntent');
  it.textContent=note.intent?('\u610f\u56fe \u00b7 '+note.intent):'';
  it.style.display=note.intent?'':'none';
  var tk=document.getElementById('cTalk');
  tk.textContent='';
  if(note.talk.length){
    note.talk.forEach(function(line){
      var p=document.createElement('p');p.textContent=line;tk.appendChild(p);
    });
  }else{
    var p=document.createElement('p');p.className='c-empty';
    p.textContent='\uff08\u672c\u9875\u65e0\u53e3\u64ad\u7a3f\uff09';tk.appendChild(p);
  }
  document.getElementById('cNext').textContent=
    next?('\u4e0b\u4e00\u9875 \u00b7 '+next.title):'\u4e0b\u4e00\u9875 \u00b7 \u5df2\u662f\u6700\u540e\u4e00\u9875';
  document.getElementById('cPage').textContent='\u7b2c '+(idx+1)+' \u9875 / \u5171 '+N+' \u9875';
}

/* 计时器：开始/暂停(继续)/重置，按 %duration 预算显示剩余 */
var T={run:false,acc:0,t0:0};
var BUDGET=DECK_MINUTES||0;
document.getElementById('tToggle').addEventListener('click',function(){
  if(T.run){T.acc+=Date.now()-T.t0;T.run=false;this.textContent='\u7ee7\u7eed'}
  else{T.t0=Date.now();T.run=true;this.textContent='\u6682\u505c'}
});
document.getElementById('tReset').addEventListener('click',function(){
  T.run=false;T.acc=0;document.getElementById('tToggle').textContent='\u5f00\u59cb';
});
function fmt(ms){
  var s=Math.floor(Math.abs(ms)/1000),m=Math.floor(s/60);s=s%60;
  return (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
}
setInterval(function(){
  if(!body.classList.contains('speaker'))return;
  var el=T.acc+(T.run?Date.now()-T.t0:0);
  document.getElementById('tElapsed').textContent='\u5df2\u8fdb\u884c '+fmt(el);
  var r=document.getElementById('tRemain');
  if(BUDGET>0){
    var rem=BUDGET*60000-el;
    r.textContent=rem>=0?('\u5269\u4f59 '+fmt(rem)):('\u8d85\u65f6 '+fmt(rem));
    r.className=rem>=0?'':'over';
  }else r.textContent='';
  var cs=document.getElementById('cSync');
  if(popup&&popup.closed&&cs.textContent.indexOf('\u62e6\u622a')<0)
    cs.textContent='\u89c2\u4f17\u5c4f\u672a\u8fde\u63a5';
  else if(popup&&!popup.closed&&lastSend>lastAck&&Date.now()-lastSend>3500)
    cs.textContent='\u89c2\u4f17\u5c4f\u672a\u8fde\u63a5\uff08ack \u8d85\u65f6\uff09';
},500);

/* 入口：支持 location.hash 跳页（#3） */
var m=(location.hash||'').match(/^#(\d+)$/);
go(m?parseInt(m[1],10)-1:0,true);
})();
"""

CONSOLE_HTML = """
<div id="console">
<div class="c-main">
<div class="c-prev" id="cPrev"></div>
<div class="c-side">
<div class="c-tag" id="cTag"></div>
<div class="c-title" id="cTitle"></div>
<div class="c-intent" id="cIntent"></div>
<div class="c-talk" id="cTalk"></div>
<div class="c-next" id="cNext"></div>
</div>
</div>
<div class="c-bar">
<div class="c-timer">
<button id="tToggle">开始</button><button id="tReset">重置</button>
<span id="tElapsed">已进行 00:00</span><span id="tRemain"></span>
</div>
<div class="c-meta"><span id="cPage"></span><span id="cSync"></span></div>
</div>
</div>
<div id="overview"></div>
<div id="ended">演示已结束</div>
"""


# ---------- 组装与自检 ----------

def build_deck(meta, slides):
    """返回 (sections_html, notes_list)。第一页为封面（有 %title 时）。"""
    duration = parse_duration(meta)
    entries = []  # (layout, payload)
    if meta.get('title'):
        entries.append(('COVER', None))
    for s in slides:
        layout, title = classify(s['title'])
        entries.append((layout, (title, s)))
    total = len(entries)
    per_min = round(duration / total, 1) if duration else None

    parts, notes = [], []
    sec_no = arg_no = 0
    cur_label = meta.get('subtitle') or 'THU SLIDE DECK'
    for i, (layout, payload) in enumerate(entries, 1):
        if layout == 'COVER':
            parts.append(build_cover(meta, i, total))
            disp = meta.get('title', '')
            intent, talk = None, []
        else:
            title, s = payload
            intent, talk = s['intent'], s['notes']
            bullets = s['bullets']
            if layout == 'SECTION':
                sec_no += 1
                cur_label = title
                parts.append(build_section(sec_no, title, i, total, 'SECTION %02d' % sec_no))
            elif layout == 'STATEMENT':
                parts.append(build_statement(title, i, total, cur_label))
            elif layout == 'DATA':
                arg_no += 1
                parts.append(build_data(title, bullets, i, total, cur_label, arg_no))
            elif layout == 'COMPARE':
                arg_no += 1
                parts.append(build_compare(title, bullets, i, total, cur_label, arg_no))
            elif layout == 'CLOSING':
                parts.append(build_closing(title, bullets, i, total))
            else:
                arg_no += 1
                if len([1 for lv, _ in bullets if lv == 1]) > 7:
                    sys.stderr.write('提示：第 %d 页一级要点超过 7 条，建议拆分\n' % i)
                parts.append(build_content(title, bullets, i, total, cur_label, arg_no))
            disp = title
        notes.append({'id': 's%02d' % i, 'title': disp, 'intent': intent,
                      'talk': talk, 'min': per_min})
    return ''.join(parts), notes, total, duration


def assemble(doc_title, sections, notes, duration):
    notes_json = json.dumps(notes, ensure_ascii=False).replace('</', '<\\/')
    return ''.join([
        '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n',
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n',
        '<title>', esc(doc_title), '</title>\n',
        '<style>', CSS, '</style>\n</head>\n<body>\n',
        '<div id="stage"><div id="deck">', sections, '</div></div>\n',
        '<nav id="dots" aria-label="页面导航"></nav>\n',
        '<div id="keyhint">← → 翻页 · ESC 总览 · P 演讲模式</div>\n',
        CONSOLE_HTML,
        '<script>\nvar SPEAKER_NOTES = /*SN-BEGIN*/', notes_json, '/*SN-END*/;\n',
        'var DECK_MINUTES = ', json.dumps(duration or 0), ';\n</script>\n',
        '<script>', JS, '</script>\n',
        '</body>\n</html>\n'])


class _Balance(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.stack, self.err = [], None

    def handle_starttag(self, tag, attrs):
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        if tag in VOID_TAGS or self.err:
            return
        if not self.stack:
            self.err = '多余闭合标签 </%s>' % tag
        elif self.stack[-1] != tag:
            self.err = '标签不配平：期望 </%s>，遇到 </%s>' % (self.stack[-1], tag)
        else:
            self.stack.pop()


def selfcheck(html_text, n_slides):
    """生成后自检：返回错误列表（空 = 通过）。"""
    errs = []
    layouts = re.findall(r'data-layout="([^"]+)"', html_text)
    if len(layouts) != n_slides:
        errs.append('data-layout 数（%d）与页数（%d）不一致' % (len(layouts), n_slides))
    bad = [l for l in layouts if l not in LAYOUTS]
    if bad:
        errs.append('data-layout 越出白名单：%s' % ', '.join(sorted(set(bad))))
    ids = re.findall(r'data-slide-id="([^"]+)"', html_text)
    if len(ids) != len(set(ids)):
        errs.append('data-slide-id 存在重复')
    m = re.search(r'/\*SN-BEGIN\*/(\[.*\])/\*SN-END\*/', html_text, re.S)
    if not m:
        errs.append('SPEAKER_NOTES 未嵌入')
    else:
        try:
            notes = json.loads(m.group(1))
            if len(notes) != n_slides:
                errs.append('SPEAKER_NOTES 数（%d）与页数（%d）不一致' % (len(notes), n_slides))
        except ValueError as e:
            errs.append('SPEAKER_NOTES JSON 非法：%s' % e)
    p = _Balance()
    p.feed(html_text)
    p.close()
    if p.err:
        errs.append('HTML 标签配平失败：%s' % p.err)
    elif p.stack:
        errs.append('HTML 标签未闭合：%s' % ', '.join(p.stack))
    return errs


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        sys.stderr.write('用法: python3 make_html.py <slides.txt> <output.html>\n')
        return 2
    src, dst = argv
    if not os.path.isfile(src):
        sys.stderr.write('错误：输入文件不存在: %s\n' % src)
        return 2
    with open(src, 'r', encoding='utf-8') as f:
        meta, slides = parse_dsl(f.read())
    if not meta.get('title') and not slides:
        sys.stderr.write('错误：未解析到任何页面（需要 %% 元信息或至少一页 # 标题）\n')
        return 2
    doc_title = meta.get('title') or (slides[0]['title'] if slides else 'THU Slide Deck')
    sections, notes, total, duration = build_deck(meta, slides)
    html_text = assemble(doc_title, sections, notes, duration)
    errs = selfcheck(html_text, total)
    if errs:
        for e in errs:
            sys.stderr.write('自检失败：%s\n' % e)
        return 1
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(html_text)
    size = os.path.getsize(dst)
    print('已生成: %s（%d 字节，%d 页，HTML 自检通过）' % (dst, size, total))
    return 0


if __name__ == '__main__':
    sys.exit(main())
