#!/usr/bin/env python3
# make_docx.py — 讲稿文本 → 最小合法 Word（.docx）生成器
#
# 零依赖：只用 Python 标准库（zipfile）。docx 本质是 ZIP，装三个固定条目即可
# 被 Word / WPS / LibreOffice 正常打开：
#   [Content_Types].xml / _rels/.rels / word/document.xml
# 文本按行转段落（<w:p><w:r><w:t>），XML 转义 & < > "；
# 首段为加粗标题「<标题> · 生成于 <时间>」，A4 页面设置。
#
# 用法：
#   python3 make_docx.py <input.md|txt> <output.docx> [--title 标题]
# 示例：
#   python3 make_docx.py draft.txt 讲稿.docx --title "组会试讲"
import argparse
import os
import sys
import zipfile
from datetime import datetime

CONTENT_TYPES_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)

RELS_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/>'
    '</Relationships>'
)

# A4（11906 x 16838 twips）+ 1 英寸页边距
SECT_PR = (
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
    'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
)


def escape_xml(text):
    return (
        text.replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
    )


def build_document_xml(text, title):
    paragraphs = [
        '<w:p><w:r><w:rPr><w:b/></w:rPr>'
        '<w:t xml:space="preserve">{}</w:t></w:r></w:p>'.format(
            escape_xml('{} · 生成于 {}'.format(title, datetime.now().strftime('%Y-%m-%d %H:%M')))
        ),
        '<w:p/>',
    ]
    for line in text.splitlines():
        if line == '':
            paragraphs.append('<w:p/>')
        else:
            paragraphs.append(
                '<w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>'.format(escape_xml(line))
            )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>{}' + SECT_PR + '</w:body></w:document>'
    ).format(''.join(paragraphs))


def build_docx(text, title, output_path):
    """讲稿正文 → 最小合法 docx（ZIP_STORED，不压缩）。"""
    document_xml = build_document_xml(text, title)
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_STORED) as zf:
        zf.writestr('[Content_Types].xml', CONTENT_TYPES_XML)
        zf.writestr('_rels/.rels', RELS_XML)
        zf.writestr('word/document.xml', document_xml)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='把讲稿文本（.md/.txt）转成最小合法的 Word .docx，纯标准库零依赖。'
    )
    parser.add_argument('input', help='输入文本文件路径（UTF-8，按行转段落）')
    parser.add_argument('output', help='输出 .docx 文件路径')
    parser.add_argument('--title', default='试讲讲稿', help='文档首段的加粗标题（默认：试讲讲稿）')
    args = parser.parse_args(argv)

    if not os.path.isfile(args.input):
        parser.error('输入文件不存在: {}'.format(args.input))

    with open(args.input, 'r', encoding='utf-8') as f:
        text = f.read()

    build_docx(text, args.title, args.output)

    # 自检：ZIP 完整性 + document.xml 可解析
    with zipfile.ZipFile(args.output) as zf:
        bad = zf.testzip()
        if bad is not None:
            print('错误：生成的 docx 校验失败（损坏条目: {}）'.format(bad), file=sys.stderr)
            return 1
        import xml.etree.ElementTree as ET
        ET.fromstring(zf.read('word/document.xml'))

    print('已生成: {}（{} 字节）'.format(args.output, os.path.getsize(args.output)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
