#!/usr/bin/env python3
# estimate_duration.py — 讲稿时长估算器
#
# 零依赖：只用 Python 标准库。按中文试讲语速约 240 字/分钟估算，
# 问答 / 停顿 / 翻页等现场损耗用缓冲系数 1.15 放大。
# 分段规则：优先按「」标记的分段标题切分（讲稿时间标注惯例），否则按空行切分。
#
# 用法：
#   python3 estimate_duration.py [讲稿文件]      # 省略文件则从 stdin 读
#   echo "讲稿..." | python3 estimate_duration.py
import re
import sys

CHARS_PER_MINUTE = 240  # 中文试讲语速（字/分钟）
BUFFER_FACTOR = 1.15    # 问答 / 停顿 / 翻页缓冲系数

# 计数时忽略空白和常见标点，只数"要念出来"的字符
COUNTABLE = re.compile(r'[^\s，。！？；：、（）「」『』""''…—,.!?;:()\[\]<>《》\-]')


def count_chars(text):
    return len(COUNTABLE.findall(text))


def format_duration(seconds):
    if seconds < 60:
        return '约 {} 秒'.format(int(round(seconds)))
    minutes = seconds / 60.0
    if minutes < 10:
        return '约 {:.1f} 分钟'.format(minutes)
    return '约 {} 分钟'.format(int(round(minutes)))


def split_sections(text):
    """优先按「」分段标题切分；没有「」标记时按空行切分。"""
    lines = text.splitlines()
    bracketed = [l for l in lines if l.strip().startswith('「')]
    if bracketed:
        sections, current = [], []
        for line in lines:
            if line.strip().startswith('「') and current:
                sections.append(current)
                current = [line]
            else:
                current.append(line)
        if current:
            sections.append(current)
    else:
        sections, current = [], []
        for line in lines:
            if line.strip() == '':
                if current:
                    sections.append(current)
                    current = []
            else:
                current.append(line)
        if current:
            sections.append(current)
    return ['\n'.join(s) for s in sections]


def section_label(section, index):
    first = section.strip().splitlines()[0].strip() if section.strip() else ''
    if first.startswith('「'):
        return first if len(first) <= 30 else first[:30] + '…'
    return '第 {} 段'.format(index)


def main(argv):
    if len(argv) > 2:
        print('用法: python3 estimate_duration.py [讲稿文件]', file=sys.stderr)
        return 2
    if len(argv) == 2:
        with open(argv[1], 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    total_chars = count_chars(text)
    if total_chars == 0:
        print('输入为空或没有可计数的正文。')
        return 0

    total_seconds = total_chars / CHARS_PER_MINUTE * 60 * BUFFER_FACTOR
    print('=== 讲稿时长估算（语速 {} 字/分钟，缓冲系数 {}）==='.format(
        CHARS_PER_MINUTE, BUFFER_FACTOR))
    print('总字数：{} 字'.format(total_chars))
    print('预计总时长：{}'.format(format_duration(total_seconds)))
    print()

    sections = split_sections(text)
    print('--- 逐段时长建议（共 {} 段）---'.format(len(sections)))
    for i, section in enumerate(sections, 1):
        chars = count_chars(section)
        if chars == 0:
            continue
        seconds = chars / CHARS_PER_MINUTE * 60 * BUFFER_FACTOR
        print('  {}：{} 字，{}'.format(section_label(section, i), chars, format_duration(seconds)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
