/**
 * 「请一个分身」线配置。
 *
 * 目录布局（每分身一份，root = codexHomeRoot/<egoId>/）：
 *   distill-home/   蒸馏线程的 CODEX_HOME（进程隔离，不污染 ~/.codex）
 *   chat-home/      对话线程的 CODEX_HOME
 *   work/           两条线程共享的 cwd：
 *     skills/huashu-nuwa/        nuwa skill 原文（distill 启动时从 assets 复制）
 *     skills/<name>-perspective/ 蒸馏产物（nuwa 自包含目录规范）
 *     skill/                     产物镜像（对话线程的固定挂载点 ./skill/SKILL.md）
 *     sources/transcripts/       私有轨本地语料（P2 corpus-service 产出）
 *     lesson/ learner/           课后上下文物化文件（对话线程 ensureSession 时重刷）
 *
 * 底座模型 provider 直接复用 teach 注册表（resolveTeachProvider），一行
 * TEACH_PROVIDER 同时切换两条线；蒸馏/对话线程的 config.toml 永远指向本地 shim。
 */

import path from 'node:path';
import { resolveTeachProviderById, type TeachProviderConfig } from '@/lib/config/teach.config';

/** 蒸馏线程 provider：默认 gemini-openai-next（commonstack 的 Gemini 强制
 *  thought_signature 与带工具线程不兼容；glm-dashscope 账户曾报"产品未激活"；
 *  openai-next 网关已实测完整蒸馏跑通，见 out/fenshen-spike/REPORT.md 与冒烟记录）。
 *  FENSHEN_DISTILL_PROVIDER 可显式覆盖。对话线程仍走 resolveTeachProvider()。 */
export function resolveDistillProvider(): TeachProviderConfig {
  return resolveTeachProviderById(env('FENSHEN_DISTILL_PROVIDER') || 'gemini-openai-next');
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const FenshenConfig = {
  /** 分身数据根目录（data/fenshen-codex/<egoId>/{distill-home,chat-home,work}） */
  codexHomeRoot: env('FENSHEN_CODEX_HOME') || 'data/fenshen-codex',
  /** 每分身事件日志目录（data/fenshen-events/<egoId>.jsonl） */
  eventLogDir: env('FENSHEN_EVENT_LOG_DIR') || 'data/fenshen-events',
  /** nuwa skill 原文模板源（仓库内，distill 启动时复制进分身 work/skills/） */
  nuwaTemplateDir: env('FENSHEN_NUWA_TEMPLATE_DIR') || 'assets/fenshen/huashu-nuwa',
} as const;

export interface EgoPaths {
  /** data/fenshen-codex/<egoId>/ */
  root: string;
  /** 蒸馏线程 CODEX_HOME */
  distillHome: string;
  /** 对话线程 CODEX_HOME */
  chatHome: string;
  /** 两条线程共享的 cwd */
  workDir: string;
  /** 蒸馏产物扫描目录（work/skills/） */
  skillsDir: string;
  /** 对话线程的固定 skill 挂载点（work/skill/） */
  chatSkillDir: string;
}

/** egoId 是服务端生成的 cuid，无路径分隔符；仍防一手 */
export function egoPaths(egoId: string): EgoPaths {
  const safe = egoId.replace(/[^a-zA-Z0-9_-]/g, '');
  // resolve：codexHomeRoot 相对则拼 cwd，绝对（测试/部署注入）则原样用
  const root = path.join(path.resolve(process.cwd(), FenshenConfig.codexHomeRoot), safe);
  const workDir = path.join(root, 'work');
  return {
    root,
    distillHome: path.join(root, 'distill-home'),
    chatHome: path.join(root, 'chat-home'),
    workDir,
    skillsDir: path.join(workDir, 'skills'),
    chatSkillDir: path.join(workDir, 'skill'),
  };
}

/** 私有轨（用户自己的老师）走 nuwa 纯本地语料模式；hall 走联网采集 */
export function isPrivateSource(sourceType: string): boolean {
  return sourceType === 'bilibili' || sourceType === 'upload';
}
