#!/usr/bin/env python3
"""
bundle-report — 把某条路由首屏 JS 的每个模块归到源码文件（gzip 后字节）。

用法：make bundle-report ROUTE='/(main)/app/page'（默认）
前置：用 NEXT_BUNDLE_ATTRIBUTION=1 NEXT_DIST_DIR=.next-attr 构建（Makefile 目标已封装）。
原理：归因构建里 webpack 模块 id 是源码路径、关了 scope hoisting，产物里每个模块边界都能切出来；
按 gzip(单模块源码) 估算体积（比例可信，绝对值略高于整体 gzip）。
"""
import gzip
import json
import os
import re
import sys
from collections import defaultdict

DIST = sys.argv[1] if len(sys.argv) > 1 else '.next-attr'
ROUTE = sys.argv[2] if len(sys.argv) > 2 else '/(main)/app/page'
TOP = int(sys.argv[3]) if len(sys.argv) > 3 else 40

manifest = json.load(open(os.path.join(DIST, 'app-build-manifest.json')))
files = [f for f in manifest['pages'][ROUTE] if f.endswith('.js')]

# 模块边界："<path>":function( / "<path>":(e,t,n)=>  （named ids 是带引号的字符串键）
BOUNDARY = re.compile(r'"((?:\./|\.\./|[a-zA-Z@(][^"\n]{2,200}?))":\s*(?:function\s*\(|\([a-zA-Z_$,\s]*\)\s*=>|[a-zA-Z_$]\s*=>)')

by_module = defaultdict(int)
by_chunk = {}
total_gz = 0
for f in files:
    path = os.path.join(DIST, f)
    if not os.path.exists(path):
        continue
    src = open(path, encoding='utf-8', errors='ignore').read()
    chunk_gz = len(gzip.compress(src.encode('utf-8'), 6))
    total_gz += chunk_gz
    by_chunk[f] = chunk_gz
    idx = [(m.start(), m.group(1)) for m in BOUNDARY.finditer(src)]
    if not idx:
        by_module[f'(chunk) {f}'] += chunk_gz
        continue
    for (a, name), (b, _) in zip(idx, idx[1:] + [(len(src), None)]):
        by_module[name] += len(gzip.compress(src[a:b].encode('utf-8'), 6))

def group(name: str) -> str:
    name = name.split('?')[0]
    if 'node_modules/' in name:
        pkg = name.split('node_modules/')[-1]
        parts = pkg.split('/')
        return 'npm:' + ('/'.join(parts[:2]) if parts[0].startswith('@') else parts[0])
    return name

by_group = defaultdict(int)
for name, size in by_module.items():
    by_group[group(name)] += size

print(f'route {ROUTE}: {len(files)} chunks, {total_gz/1024:.0f} KB gzip total (whole-chunk gzip)')
print(f'\n== top {TOP} modules / packages (per-module gzip estimate) ==')
for name, size in sorted(by_group.items(), key=lambda kv: -kv[1])[:TOP]:
    print(f'{size/1024:7.1f} KB  {name}')
print('\n== chunks ==')
for f, size in sorted(by_chunk.items(), key=lambda kv: -kv[1])[:12]:
    print(f'{size/1024:7.1f} KB  {f}')
