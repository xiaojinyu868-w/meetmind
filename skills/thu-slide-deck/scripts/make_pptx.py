#!/usr/bin/env python3
# make_pptx.py — 纯文本大纲 → 清华紫风格 16:9 讲演 PPT（.pptx）生成器
# v4：视觉审美升级（吸收 anthropics/skills 官方 pptx skill 等明星 PPT skill）——
# 封面改整页深紫底（明暗三明治：封面/结尾深色，内容页浅色）；删掉章节页装饰性
# 竖条（NEVER 侧边条）；内容页标题 28/22pt，与 18pt 正文拉开字号层级。
# v3：DSL 新增两类不渲染的元信息行——封面区 %duration（汇报时长，分钟）、
# 页内 "~ " 开头的意图声明（观众状态转移，AST）。两者只解析留存供
# scripts/check_deck.py 体检用，渲染输出与 v2 完全一致。
# 零依赖：只用标准库（zipfile + xml.sax.saxutils.escape）。pptx 本质是 ZIP，
# 本脚本手写最小合法 OPC 结构：Content_Types / _rels / presentation(+rels)
# / slideMaster(+rels) / slideLayout(+rels) / theme / slides/slideN(+rels)
# / notesMaster(+rels) / notesSlides/notesSlideN(+rels)（仅当存在 >> 备注时）。
# 输入 DSL 见 SKILL.md。用法：python3 make_pptx.py <slides.txt> <output.pptx>
import os, sys, zipfile
from xml.sax.saxutils import escape

SLIDE_W, SLIDE_H = 12192000, 6858000  # 画布 16:9，EMU
PURPLE, LIGHT, DARK, GRAY, WHITE = '660874', 'F3EEF7', '333333', '808080', 'FFFFFF'
FONT = '微软雅黑'
ENDING_TITLES = ('谢谢聆听', '谢谢', '恳请批评指正')
NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
GRP = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
       '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
       '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')
RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'

def esc(text): return escape(text, {'"': '&quot;'})

def fill_xml(color):
    return '<a:noFill/>' if color is None else \
        '<a:solidFill><a:srgbClr val="{}"/></a:solidFill>'.format(color)

def sp(sid, name, x, y, cx, cy, color=None, paras='', anchor='t'):
    """一个矩形形状：可纯色填充（装饰条），也可带文本体（文本框）。"""
    return ('<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/>'
            '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fill}</p:spPr>'
            '<p:txBody><a:bodyPr wrap="square" anchor="{anchor}"/><a:lstStyle/>{paras}</p:txBody>'
            '</p:sp>').format(sid=sid, name=esc(name), x=x, y=y, cx=cx, cy=cy,
                              fill=fill_xml(color), anchor=anchor, paras=paras)
def rpr(size, bold, color):
    return ('<a:rPr lang="zh-CN" sz="{}"{}><a:solidFill><a:srgbClr val="{}"/></a:solidFill>'
            '<a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr>'
            ).format(int(size * 100), ' b="1"' if bold else '', color, f=FONT)

def para(text, size, bold=False, color=DARK, algn='l', level=None, space_before=None):
    """单段文字。level=None 无项目符号；1=紫色方块；2=灰色短横。"""
    ppr = inner = ''
    if level in (1, 2):
        ppr = ' marL="342900" indent="-342900"' if level == 1 else ' marL="742950" indent="-228600"'
        ch, cl = ('■', PURPLE) if level == 1 else ('–', GRAY)
        inner = ('<a:buClr><a:srgbClr val="{}"/></a:buClr><a:buFont typeface="Arial"/>'
                 '<a:buChar char="{}"/>').format(cl, ch)
    else:
        inner = '<a:buNone/>'
    if space_before:
        inner += '<a:spcBef><a:spcPts val="{}"/></a:spcBef>'.format(space_before)
    return ('<a:p><a:pPr algn="{}"{}>{}</a:pPr><a:r>{}'
            '<a:t xml:space="preserve">{}</a:t></a:r></a:p>'
            ).format(algn, ppr, inner, rpr(size, bold, color), esc(text))

def slide_xml(shapes):  # 以下是五种页型
    return (XML_DECL + '<p:sld ' + NS + '><p:cSld><p:spTree>' + GRP + ''.join(shapes) +
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')

def cover_slide(meta):
    # 明暗三明治：封面整页深紫底，与结尾页呼应，内容页浅色——
    # 比"顶部色带"更接近 premium 演示的封面结构（anthropics pptx skill 的 dark/light sandwich）
    shapes = [sp(2, 'bg', 0, 0, SLIDE_W, SLIDE_H, PURPLE),
              sp(3, 'title', 914400, 2300000, SLIDE_W - 1828800, 1400000, None,
                 para(meta.get('title', ''), 40, True, WHITE, 'ctr'), 'ctr'),
              sp(4, 'subtitle', 914400, 3720000, SLIDE_W - 1828800, 500000, None,
                 para(meta.get('subtitle', ''), 18, False, LIGHT, 'ctr'), 'ctr')]
    y = 4780000
    for key, sid in (('author', 5), ('date', 6)):
        if meta.get(key):
            shapes.append(sp(sid, key, 914400, y, SLIDE_W - 1828800, 400000, None,
                             para(meta[key], 14, False, 'C29BCF', 'ctr'), 'ctr'))
            y += 460000
    return slide_xml(shapes)

def section_slide(title):
    # 整页紫底 + 居左大字；不加装饰性竖条/色条（明星 skill 的 NEVER 清单：侧边条=AI 味）
    return slide_xml([sp(2, 'bg', 0, 0, SLIDE_W, SLIDE_H, PURPLE),
                      sp(3, 'title', 1000000, 2750000, SLIDE_W - 2000000, 1350000, None,
                         para(title, 40, True, WHITE, 'l'), 'ctr')])

def emphasis_slide(text):
    """强调页（高桥流）：整页紫底，居中白色超大字单句，用于关键结论的注意力重置。"""
    return slide_xml([sp(2, 'bg', 0, 0, SLIDE_W, SLIDE_H, PURPLE),
                      sp(3, 'text', 914400, 2400000, SLIDE_W - 1828800, 2000000, PURPLE,
                         para(text, 54, True, WHITE, 'ctr'), 'ctr')])

def content_slide(title, bullets, page):
    # 论断式标题较长：>20 字时降为 22pt 并加高标题栏，允许两行
    # 字号层级（中文讲演场景）：标题 28pt vs 正文 18pt——size contrast 必须拉得够开
    long_title = len(title) > 20
    bar_h = int(SLIDE_H * (0.19 if long_title else 0.13))
    paras = [para(t, 18 if lv == 1 else 16, False, DARK if lv == 1 else '666666',
                  'l', lv, 800) for lv, t in bullets]
    return slide_xml([
        sp(2, 'bar', 0, 0, SLIDE_W, bar_h, PURPLE),
        sp(3, 'title', 600000, 0, SLIDE_W - 1200000, bar_h, None,
           para(title, 22 if long_title else 28, True, WHITE, 'l'), 'ctr'),
        sp(4, 'body', 700000, bar_h + 400000, SLIDE_W - 1400000,
           SLIDE_H - bar_h - 1100000, None, ''.join(paras)),
        sp(5, 'rule', 600000, SLIDE_H - 470000, SLIDE_W - 1200000, 19050, 'D9D9D9'),
        sp(6, 'footer', 600000, SLIDE_H - 420000, 3000000, 300000, None,
           para('清华大学', 10.5, False, GRAY, 'l')),
        sp(7, 'pagenum', SLIDE_W - 1600000, SLIDE_H - 420000, 1000000, 300000, None,
           para(str(page), 10.5, False, GRAY, 'r'))])

def ending_slide(title):
    return slide_xml([sp(2, 'bg', 0, 0, SLIDE_W, SLIDE_H, PURPLE),
                      sp(3, 'title', 914400, 2600000, SLIDE_W - 1828800, 1600000, PURPLE,
                         para(title, 44, True, WHITE, 'ctr'), 'ctr')])

def notes_slide_xml(notes):
    """讲者备注页：sldImg 占位 + body 占位放口播稿全文（16pt，只在演示者视图显示）。"""
    paras = ''.join(para(t, 16, False, DARK) for t in notes)
    img = ('<p:sp><p:nvSpPr><p:cNvPr id="2" name="幻灯片图像"/>'
           '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
           '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm>'
           '<a:off x="762000" y="685800"/><a:ext cx="5486400" cy="3086100"/></a:xfrm></p:spPr>'
           '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>')
    body = ('<p:sp><p:nvSpPr><p:cNvPr id="3" name="备注"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm>'
            '<a:off x="685800" y="4114800"/><a:ext cx="5486400" cy="4343400"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' + paras + '</p:txBody></p:sp>')
    return (XML_DECL + '<p:notes ' + NS + '><p:cSld><p:spTree>' + GRP + img + body +
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>')

def parse_dsl(text):  # DSL 解析
    meta, slides, cur = {}, [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.lstrip()
        if not s or s.startswith('//'):
            continue
        if line.startswith('%'):
            # %title/%subtitle/%author/%date 构成封面；%duration 等额外元信息留存供体检
            key, _, val = line[1:].partition(' '); meta[key.strip()] = val.strip()
        elif line.startswith('# '):
            cur = {'title': line[2:].strip(), 'bullets': [], 'notes': [], 'intent': None}
            slides.append(cur)
        elif s.startswith('>>') and cur is not None:
            cur['notes'].append(s[2:].strip())  # 讲者备注（口播稿，可多行）
        elif s.startswith('~ ') and cur is not None:
            cur['intent'] = s[2:].strip()  # 意图声明（观众状态转移，不渲染，供体检）
        elif s.startswith('- ') and cur is not None:
            cur['bullets'].append((2 if raw.startswith('  ') else 1, s[2:].strip()))
    return meta, slides

def classify(title):
    if title in ENDING_TITLES:
        return 'ending'
    for pre, kind in (('章节：', 'section'), ('强调：', 'emphasis')):
        if title.startswith(pre):
            return kind
    return 'content'

def content_types_xml(pages):  # 以下是最小合法 OPC 包结构
    o = ('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
         '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
         '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
         '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>')
    if any(p[2] for p in pages):
        o += ('<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType='
              '"application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>')
    for i, p in enumerate(pages, 1):
        o += ('<Override PartName="/ppt/slides/slide{}.xml" ContentType='
              '"application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').format(i)
        if p[2]:
            o += ('<Override PartName="/ppt/notesSlides/notesSlide{}.xml" ContentType='
                  '"application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>').format(i)
    return (XML_DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>' + o + '</Types>')

def rels_xml(pairs):
    body = ''.join('<Relationship Id="{}" Type="{}" Target="{}"/>'.format(*p) for p in pairs)
    return (XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006'
            '/relationships">' + body + '</Relationships>')

def presentation_xml(n, has_notes):
    base = 3 if has_notes else 2  # rId1=slideMaster，rId2=notesMaster（如有）
    nm = ('<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' if has_notes else '')
    sld_ids = ''.join('<p:sldId id="{}" r:id="rId{}"/>'.format(255 + i, base + i - 1)
                      for i in range(1, n + 1))
    return (XML_DECL + '<p:presentation ' + NS + '>'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            + nm + '<p:sldIdLst>' + sld_ids + '</p:sldIdLst>'
            '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
            '</p:presentation>')

CLR_MAP = ('<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
           'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" '
           'hlink="hlink" folHlink="folHlink"/>')
MASTER_XML = (XML_DECL + '<p:sldMaster ' + NS + '><p:cSld><p:spTree>' + GRP +
              '</p:spTree></p:cSld>' + CLR_MAP +
              '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
              '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:titleStyle>'
              '<p:bodyStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:bodyStyle>'
              '<p:otherStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:otherStyle></p:txStyles>'
              '</p:sldMaster>')
LAYOUT_XML = (XML_DECL + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="空白"><p:spTree>'
              + GRP + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')
NOTES_MASTER_XML = (XML_DECL + '<p:notesMaster ' + NS + '><p:cSld><p:spTree>' + GRP +
                    '</p:spTree></p:cSld>' + CLR_MAP +
                    '<p:notesStyle><a:lvl1pPr><a:defRPr sz="1600">'
                    '<a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:defRPr>'
                    '</a:lvl1pPr></p:notesStyle></p:notesMaster>')
THEME_XML = (XML_DECL + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
             'name="THU"><a:themeElements>'
             '<a:clrScheme name="THU"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
             '<a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="F3EEF7"/></a:lt2>'
             '<a:accent1><a:srgbClr val="660874"/></a:accent1><a:accent2><a:srgbClr val="9E4AAD"/></a:accent2>'
             '<a:accent3><a:srgbClr val="C29BCF"/></a:accent3><a:accent4><a:srgbClr val="808080"/></a:accent4>'
             '<a:accent5><a:srgbClr val="4A4A4A"/></a:accent5><a:accent6><a:srgbClr val="D9D9D9"/></a:accent6>'
             '<a:hlink><a:srgbClr val="660874"/></a:hlink><a:folHlink><a:srgbClr val="9E4AAD"/></a:folHlink></a:clrScheme>'
             '<a:fontScheme name="THU"><a:majorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/>'
             '<a:font script="Hans" typeface="微软雅黑"/></a:majorFont>'
             '<a:minorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/>'
             '<a:font script="Hans" typeface="微软雅黑"/></a:minorFont></a:fontScheme>'
             '<a:fmtScheme name="THU"><a:fillStyleLst>'
             '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:gradFill rotWithShape="1"><a:gsLst>'
             '<a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs>'
             '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>'
             '<a:lnStyleLst>'
             '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:prstDash val="solid"/></a:ln>'
             '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:prstDash val="solid"/></a:ln>'
             '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:prstDash val="solid"/></a:ln></a:lnStyleLst>'
             '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>'
             '<a:effectStyle><a:effectLst/></a:effectStyle>'
             '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
             '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
             '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
             '</a:fmtScheme></a:themeElements></a:theme>')

def build_pptx(meta, slides, output_path):  # 构建
    pages = []  # (kind, xml, notes|None)
    if meta.get('title'):
        pages.append(('cover', cover_slide(meta), None))
    for s in slides:
        kind, notes = classify(s['title']), (s['notes'] or None)
        if kind in ('section', 'emphasis'):
            fn = section_slide if kind == 'section' else emphasis_slide
            pages.append((kind, fn(s['title'].split('：', 1)[1].strip()), notes))
        elif kind == 'ending':
            pages.append((kind, ending_slide(s['title']), notes))
        else:
            if len(s['bullets']) > 7:
                print('提示：「{}」有 {} 条要点，超过 7 条，建议拆分为两页'.format(
                    s['title'], len(s['bullets'])), file=sys.stderr)
            pages.append((kind, content_slide(s['title'], s['bullets'], len(pages) + 1), notes))
    if not pages:
        pages.append(('content', content_slide('（空白大纲）', [], 1), None))
    n = len(pages)
    has_notes = any(p[2] for p in pages)
    base = 3 if has_notes else 2
    pres_rels = [('rId1', RT + 'slideMaster', 'slideMasters/slideMaster1.xml')]
    if has_notes:
        pres_rels.append(('rId2', RT + 'notesMaster', 'notesMasters/notesMaster1.xml'))
    pres_rels += [('rId{}'.format(base + i - 1), RT + 'slide', 'slides/slide{}.xml'.format(i))
                  for i in range(1, n + 1)]
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content_types_xml(pages))
        zf.writestr('_rels/.rels', rels_xml(
            [('rId1', RT + 'officeDocument', 'ppt/presentation.xml')]))
        zf.writestr('ppt/presentation.xml', presentation_xml(n, has_notes))
        zf.writestr('ppt/_rels/presentation.xml.rels', rels_xml(pres_rels))
        zf.writestr('ppt/slideMasters/slideMaster1.xml', MASTER_XML)
        zf.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels_xml(
            [('rId1', RT + 'slideLayout', '../slideLayouts/slideLayout1.xml'),
             ('rId2', RT + 'theme', '../theme/theme1.xml')]))
        zf.writestr('ppt/slideLayouts/slideLayout1.xml', LAYOUT_XML)
        zf.writestr('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels_xml(
            [('rId1', RT + 'slideMaster', '../slideMasters/slideMaster1.xml')]))
        zf.writestr('ppt/theme/theme1.xml', THEME_XML)
        if has_notes:
            zf.writestr('ppt/notesMasters/notesMaster1.xml', NOTES_MASTER_XML)
            zf.writestr('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels_xml(
                [('rId1', RT + 'theme', '../theme/theme1.xml')]))
        for i, (_, xml, notes) in enumerate(pages, 1):
            zf.writestr('ppt/slides/slide{}.xml'.format(i), xml)
            srels = [('rId1', RT + 'slideLayout', '../slideLayouts/slideLayout1.xml')]
            if notes:
                srels.append(('rId2', RT + 'notesSlide', '../notesSlides/notesSlide{}.xml'.format(i)))
                zf.writestr('ppt/notesSlides/notesSlide{}.xml'.format(i), notes_slide_xml(notes))
                zf.writestr('ppt/notesSlides/_rels/notesSlide{}.xml.rels'.format(i), rels_xml(
                    [('rId1', RT + 'slide', '../slides/slide{}.xml'.format(i)),
                     ('rId2', RT + 'notesMaster', '../notesMasters/notesMaster1.xml')]))
            zf.writestr('ppt/slides/_rels/slide{}.xml.rels'.format(i), rels_xml(srels))
    return n

def verify(path):
    """自检：ZIP 完整性、每个 XML/rels 良构、slide/notesSlide 双向关系完整性。"""
    import xml.etree.ElementTree as ET
    R = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    with zipfile.ZipFile(path) as zf:
        assert zf.testzip() is None, 'ZIP 存在损坏条目'
        names = zf.namelist()
        for name in names:  # 良构性：逐个解析
            if name.endswith('.xml') or name.endswith('.rels'):
                ET.fromstring(zf.read(name))
        def rel_ids(part):
            return {r.get('Id'): r.get('Target')
                    for r in ET.fromstring(zf.read(part)).findall(R + 'Relationship')}
        slide_xmls = [n for n in names if n.startswith('ppt/slides/slide')]
        for sx in slide_xmls:
            base = os.path.basename(sx)
            ids = rel_ids('ppt/slides/_rels/{}.rels'.format(base))
            assert ids.get('rId1', '').endswith('slideLayout1.xml'), '{} 缺 layout 关系'.format(base)
            if 'rId2' in ids:  # slide → notesSlide 引用存在且文件在包内
                nb = base.replace('slide', 'notesSlide')
                assert ids['rId2'].endswith('notesSlides/' + nb), '{} notesSlide 引用错误'.format(base)
                assert 'ppt/notesSlides/' + nb in names, '{} 目标缺失'.format(ids['rId2'])
        for nx in [n for n in names if n.startswith('ppt/notesSlides/notesSlide')]:
            base = os.path.basename(nx)
            ids = rel_ids('ppt/notesSlides/_rels/{}.rels'.format(base))
            sb = base.replace('notesSlide', 'slide')  # notesSlide → slide 与 notesMaster 引用
            assert ids.get('rId1', '').endswith('slides/' + sb), '{} 缺 slide 引用'.format(base)
            assert 'ppt/slides/' + sb in names, '{} slide 目标缺失'.format(base)
            assert ids.get('rId2', '').endswith('notesMaster1.xml'), '{} 缺 notesMaster 引用'.format(base)
        # presentation.xml 的 sldIdLst 数量 == slide 文件数，且 rId 都在 rels 里
        pres = ET.fromstring(zf.read('ppt/presentation.xml'))
        P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
        A = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
        sld_ids = pres.find(P + 'sldIdLst').findall(P + 'sldId')
        assert len(sld_ids) == len(slide_xmls), 'sldIdLst 数量与 slide 文件数不符'
        rels = rel_ids('ppt/_rels/presentation.xml.rels')
        assert all(s.get(A + 'id') in rels for s in sld_ids), 'sldId 的 rId 不在 presentation rels 中'
    return len(slide_xmls)

def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        print('用法: python3 make_pptx.py <slides.txt> <output.pptx>', file=sys.stderr)
        return 2
    src, out = argv
    if not os.path.isfile(src):
        print('错误：输入文件不存在: {}'.format(src), file=sys.stderr); return 2
    with open(src, 'r', encoding='utf-8') as f:
        meta, slides = parse_dsl(f.read())
    build_pptx(meta, slides, out)
    n = verify(out)
    print('已生成: {}（{} 字节，{} 页，XML 与关系自检通过）'.format(out, os.path.getsize(out), n))
    return 0

if __name__ == '__main__':
    sys.exit(main())