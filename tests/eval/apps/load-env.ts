// 必须是 runner 的第一个 import：插件 → llm-service → app.config 在模块加载时就按 env 挑默认模型，
// 等到 main() 里再 loadEnv 已经晚了（asr / teach runner 用动态 import 绕开，这里 dry-run 也要生产真件，改成先把 env 装好）。
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env.local'), quiet: true });
loadEnv({ path: resolve(here, '../../../.env'), quiet: true });
