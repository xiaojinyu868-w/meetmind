# public/fonts

| 文件 | 字体 | 用途 | 授权 |
|------|------|------|------|
| `inter-var-latin.woff2` | Inter | 全局 UI 正文 | OFL |
| `instrument-serif-400*.woff2` | Instrument Serif | 展示衬线 | OFL |
| `jetbrains-mono-var-latin.woff2` | JetBrains Mono | 代码 | OFL |
| `HongleiBanShu-subset.woff2` | 鸿雷板书简体（子集） | 板书精讲黑板手写字 | 见下方授权状态 |

## 鸿雷板书简体（HongleiBanShu-subset.woff2）

- **出处**：作者「鸿雷字记」（微信公众号），分发渠道[猫啃网 freefonts/3791](https://www.maoken.com/freefonts/3791.html)。
  原始文件：`鸿雷板书简体2.000.ttf`（7.2MB，备份在 `public/demo/fonts/HongleiBanShu.ttf`，demo 字体评估设施）。
- **授权状态**：作者在分发页声明免费商用（含商业用途）；部分分发站标注「嵌入式用途（网页 @font-face / App 嵌入）请联系版权方」。
  **待办（temporary use）：需联系鸿雷字记确认网页嵌入授权并留证；拿到确认前本文件属临时使用。**
- **子集范围**：GB2312 一级汉字（3755 字）+ ASCII 可打印 + 常用全角标点，共 3880 字，1.8MB。
  二级汉字（罕用字）未包含，缺失时回退字体栈（站酷快乐体）；GB2312 全量子集约 3.6MB，如需全量可用下方命令调整字符集后重新生成。
- **可复现子集化命令**（python 3.11 venv + `pip install fonttools brotli`）：

  ```bash
  # 1. 生成字符集（GB2312 一级 B0A1-D7FE + ASCII + 全角标点）
  python scripts 见 git 历史 /tmp/subset_honglei_l1.py（字符集生成器）
  # 2. 子集化
  pyftsubset public/demo/fonts/HongleiBanShu.ttf \
    --output-file=public/fonts/HongleiBanShu-subset.woff2 \
    --flavor=woff2 --text-file=<字符集文件> --no-hinting
  ```

- **声明位置**：`src/app/globals.css` 的 `@font-face`（family `HongleiBanShu`，`font-display: swap`），
  消费方：`src/components/apps/windows/blackboard/BoardWrite.tsx` 的 `CHALK_FONT`。
