#!/usr/bin/env python3
# check_deck.py — 讲演体检：对 slides.txt 做确定性检查，输出中文体检报告。
# 思想来自 humanize-ppt（MIT，https://github.com/LearnPrompt/humanize-ppt）：
# 每页声明观众状态转移（~ 意图），生成后对整副 deck 做"能否上台"的体检。
# 纯标准库零依赖。用法：python3 check_deck.py <slides.txt>
# 退出码：有 ERROR → 1；仅 WARN 或全绿 → 0。
import os, sys

# 栏目词：内容页标题以这些词结尾 = 栏目名式标题，不是论断句
SECTION_WORDS = ('背景', '介绍', '概述', '相关工作', '方法', '实验', '结果', '分析', '总结', '展望', '致谢')
ENDING_TITLES = ('谢谢聆听', '谢谢', '恳请批评指正')


def parse_dsl(text):  # 与 make_pptx.py 同一份 DSL 语义
    meta, slides, cur = {}, [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.lstrip()
        if not s or s.startswith('//'):
            continue
        if line.startswith('%'):
            key, _, val = line[1:].partition(' '); meta[key.strip()] = val.strip()
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
        return 'ending'
    # 「数据：」「对比：」是 v5 新增页型前缀，与内容页一样参与体检
    for pre, kind in (('章节：', 'section'), ('强调：', 'emphasis'),
                      ('数据：', 'data'), ('对比：', 'compare')):
        if title.startswith(pre):
            return kind
    return 'content'


def parse_duration(meta):
    """%duration 缺失或解析失败都降级为 None（跳过节奏检查），不崩。"""
    raw = meta.get('duration')
    if not raw:
        return None
    try:
        d = float(raw)
        return d if d > 0 else None
    except ValueError:
        return None


def fmt_minutes(d):
    return '{:g}'.format(d)  # 10 分钟显示为 10 而不是 10.0


def check(meta, slides):
    """返回 (issues, n_content, n_section)。issues = [(page|None, level, 类别, 问题与改法)]"""
    issues = []
    offset = 1 if meta.get('title') else 0  # 封面占第 1 页，页号与 pptx 页脚一致
    n_content = n_section = 0
    for i, s in enumerate(slides, 1):
        kind = classify(s['title'])
        if kind == 'section':
            n_section += 1
            continue
        if kind in ('emphasis', 'ending'):
            continue
        n_content += 1
        page = i + offset
        title = s['title']
        if kind in ('data', 'compare') and '：' in title:
            title = title.split('：', 1)[1].strip()  # 页型前缀不计入标题论断检查
        # 1. 标题论断检测
        if len(title) <= 6 or any(title.endswith(w) for w in SECTION_WORDS):
            issues.append((page, 'WARN', '标题论断',
                           '「{}」是栏目名式标题，改成一句完整论断（听众只读标题也能跟上论证）'.format(title)))
        # 2. 要点密度
        lvl1 = [t for lv, t in s['bullets'] if lv == 1]
        if len(lvl1) > 9:
            issues.append((page, 'ERROR', '要点密度',
                           '{} 条一级要点塞在一页，必须拆页（一页只讲一件事）'.format(len(lvl1))))
        elif len(lvl1) > 6:
            issues.append((page, 'WARN', '要点密度',
                           '{} 条一级要点，建议拆页（每页 ≤6 条，一页只讲一件事）'.format(len(lvl1))))
        for lv, t in s['bullets']:
            if len(t) > 40:
                issues.append((page, 'WARN', '要点过长',
                               '要点「{}…」{} 字——要点是关键词不是句子，细节放嘴里讲'.format(t[:12], len(t))))
        # 3. 口播稿缺失
        if not s['notes']:
            issues.append((page, 'WARN', '口播稿缺失',
                           '这页没有 >> 口播稿，演示者视图会是空的'))
        # 4. 意图缺失
        if not s['intent']:
            issues.append((page, 'WARN', '意图缺失',
                           '本页的观众状态转移未声明——这页要把观众从哪带到哪？（加一行 ~ 意图）'))
    # 5. 节奏配比（声明 %duration 才检查）
    duration = parse_duration(meta)
    if duration is not None:
        if n_content > duration * 1.0:
            issues.append((None, 'WARN', '节奏配比',
                           '{} 页内容页对 {} 分钟——页数超过分钟数，讲不完（砍页或把细节挪进附录）'
                           .format(n_content, fmt_minutes(duration))))
        elif n_content < duration * 0.4:
            issues.append((None, 'WARN', '节奏配比',
                           '{} 页内容页对 {} 分钟——页数太少撑不满（补充论证页，或缩短声明时长）'
                           .format(n_content, fmt_minutes(duration))))
    # 6. 结构建议
    if n_content > 10 and n_section == 0:
        issues.append((None, 'WARN', '结构建议',
                       '{} 页内容页却没有章节过渡页——长汇报建议加「章节：」页切成 10 分钟以内的小段'
                       .format(n_content)))
    return issues, n_content, n_section


def report(path, meta, slides):
    issues, n_content, n_section = check(meta, slides)
    n_warn = sum(1 for x in issues if x[1] == 'WARN')
    n_error = sum(1 for x in issues if x[1] == 'ERROR')
    n_pages = len(slides) + (1 if meta.get('title') else 0)
    out = ['讲演体检报告：{}'.format(path), '=' * 46]
    if not issues:
        out.append('（未发现问题）')
    for page, level, cat, msg in issues:
        where = '第 {} 页'.format(page) if page is not None else '全局'
        out.append('{} [{}] {}：{}'.format(where, level, cat, msg))
    out.append('=' * 46)
    out.append('总评：{} 页（内容页 {} · 章节页 {}）· {} WARN · {} ERROR'.format(
        n_pages, n_content, n_section, n_warn, n_error))
    if n_error:
        verdict = '能否上台：还不能——先修 ERROR（硬伤），再逐条过 WARN。'
    elif n_warn:
        verdict = '能否上台：能，但建议先把 WARN 改掉——每一条都对应一个真实的翻车点。'
    else:
        verdict = '能否上台：可以——论断、密度、口播稿、意图、节奏全部达标。'
    out.append(verdict)
    return '\n'.join(out), n_error


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 1:
        print('用法: python3 check_deck.py <slides.txt>', file=sys.stderr)
        return 2
    src = argv[0]
    if not os.path.isfile(src):
        print('错误：输入文件不存在: {}'.format(src), file=sys.stderr)
        return 2
    with open(src, 'r', encoding='utf-8') as f:
        meta, slides = parse_dsl(f.read())
    text, n_error = report(src, meta, slides)
    print(text)
    return 1 if n_error else 0


if __name__ == '__main__':
    sys.exit(main())
