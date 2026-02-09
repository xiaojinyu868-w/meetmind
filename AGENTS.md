# Agent Rules (Project)

## Text Encoding & Chinese Copy

- All source files must be saved as `UTF-8` (no mojibake, no mixed legacy encodings).
- All user-facing Chinese text must be readable Simplified Chinese.
- Do not commit garbled text such as `锟斤拷`, `馃`, `鈥`, `銆`, `锛`, or truncated labels like `课堂摘`, `我的笔`.
- If a Chinese string looks suspicious, normalize and verify before commit.

## Pre-Commit Check (required for UI text edits)

- Run a scan for suspicious characters in changed files.
- Manually verify core pages render Chinese correctly: top nav, mode tabs, recorder panel, video importer.
- If any mojibake appears, fix it in source rather than relying on browser/runtime workarounds.
