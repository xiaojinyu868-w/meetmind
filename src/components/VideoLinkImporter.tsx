'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ImportedVideoResult,
  ImportedVideoSource,
  TranscriptSegment,
  VideoImportTraceEntry,
  VideoSourceMode,
} from '@/types';
import { parseVideoLink } from '@/lib/utils/video-link';
import { getPreference, setPreference } from '@/lib/db';

type TranscribeMode = 'turbo' | 'fast' | 'standard';
type ImportStatus = 'idle' | 'processing' | 'error' | 'success';

const BILI_COOKIE_KEY = 'settings_bilibili_cookie';

interface VideoLinkImporterProps {
  onImportReady: (result: ImportedVideoResult) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

interface RawSegmentLike {
  id?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  beginTime?: number;
  endTime?: number;
  confidence?: number;
}

interface ImportApiResponse {
  success?: boolean;
  error?: string;
  code?: string;
  detail?: string;
  sourceMode?: VideoSourceMode;
  trace?: VideoImportTraceEntry[];
  source?: ImportedVideoSource;
  segments?: RawSegmentLike[];
  sentences?: RawSegmentLike[];
}

const ERROR_MESSAGE_MAP: Record<string, string> = {
  MISSING_VIDEO_URL: '请先输入视频链接。',
  INVALID_VIDEO_URL: '链接格式无法识别，请检查后重试。',
  VIDEO_URL_UNSAFE: '该链接暂不支持导入。',
  BILI_URL_PARSE_FAILED: '无法解析 B站链接，请确认链接可访问。',
  BILI_PLAYURL_FAILED: '未能获取视频音频流，请稍后重试。',
  BILI_COOKIE_EXPIRED: 'B站登录状态已过期，请前往「设置 → 视频导入」更新 Cookie。',
  BILI_AUDIO_DOWNLOAD_FORBIDDEN: '该视频需要登录B站才能导入，请前往「设置 → 视频导入」配置你的B站 Cookie。',
  BILI_AUDIO_INCOMPLETE: 'B站音频下载不完整，可能受平台限制，请稍后重试或更换视频。',
  YTDLP_UNAVAILABLE: '服务端导入能力暂不可用，请稍后重试。',
  FFMPEG_NOT_FOUND: '服务端音频处理组件未就绪，请联系管理员。',
  DIRECT_MEDIA_TIMEOUT: '直链媒体下载超时，请稍后重试。',
  DIRECT_MEDIA_TOO_LARGE: '直链媒体文件过大，请更换较短视频或音频源。',
  UNSUPPORTED_PLATFORM: '目前仅支持 B站视频链接，其他平台即将支持。',
  ASR_TRANSCRIBE_FAILED: '视频已解析，但转写失败，请稍后重试。',
  ASR_PUBLIC_HOST_MISSING: '当前环境缺少公网可访问地址，阿里云文件转写不可用。请配置 PUBLIC_DOMAIN/PUBLIC_HOST。',
  ASR_API_KEY_MISSING: '服务端未配置转写密钥，请检查 DASHSCOPE_API_KEY。',
};

const MODE_HELP_TEXT: Record<TranscribeMode, string> = {
  turbo: '极速模式：优先走 Turbo 转写，速度最快；失败会自动回退到快速/标准。',
  fast: '快速模式：优先走并行分段转写，适合长视频；失败会自动回退到其它模式。',
  standard: '标准模式：优先走标准异步转写，稳定性更高；失败会自动回退到快速/极速。',
};

function mapSegments(data: Pick<ImportApiResponse, 'segments' | 'sentences'>): TranscriptSegment[] {
  const rawList = data.segments || data.sentences || [];
  if (!Array.isArray(rawList)) return [];

  return rawList.map((item, index: number) => ({
    id: item.id || `seg-${index}`,
    text: String(item.text || ''),
    startMs: Number(item.startMs ?? item.beginTime ?? 0),
    endMs: Number(item.endMs ?? item.endTime ?? 0),
    confidence: Number(item.confidence ?? 0.9),
    isFinal: true,
  }));
}

function formatDuration(durationSec?: number): string | null {
  if (!durationSec || !Number.isFinite(durationSec)) return null;
  const total = Math.max(0, Math.floor(durationSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isLikelyMojibakeText(value: string): boolean {
  if (!value) return false;
  if (value.includes('�')) return true;
  if (/\?{3,}/.test(value)) return true;
  const latinExtendedCount = (value.match(/[À-ÿ]/g) || []).length;
  const cjkCount = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  return latinExtendedCount >= 3 && latinExtendedCount > cjkCount;
}

function mapImportError(code?: string, fallback?: string): string {
  if (code && ERROR_MESSAGE_MAP[code]) {
    return ERROR_MESSAGE_MAP[code];
  }

  if (isLikelyMojibakeText(fallback || '')) {
    return '视频导入失败，请稍后重试。';
  }

  const normalized = (fallback || '').toLowerCase();
  if (normalized.includes('未授权') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return '登录状态已失效，请刷新页面后重试。';
  }

  return fallback || '视频导入失败，请稍后再试。';
}

function pickPrimaryErrorCode(data: ImportApiResponse): string | undefined {
  const failedTrace = (data.trace || []).filter((entry) => !entry.ok && entry.code);
  if (failedTrace.length === 0) return data.code;

  const priorityCodes = [
    'FFMPEG_NOT_FOUND',
    'ASR_PUBLIC_HOST_MISSING',
    'ASR_API_KEY_MISSING',
    'BILI_COOKIE_EXPIRED',
    'BILI_AUDIO_DOWNLOAD_FORBIDDEN',
    'BILI_PLAYURL_FAILED',
    'BILI_URL_PARSE_FAILED',
  ];

  for (const code of priorityCodes) {
    const matched = failedTrace.find((entry) => entry.code === code);
    if (matched?.code) return matched.code;
  }

  const nonYtDlp = failedTrace.find((entry) => entry.code !== 'YTDLP_UNAVAILABLE');
  if (nonYtDlp?.code) return nonYtDlp.code;

  return failedTrace[failedTrace.length - 1]?.code || data.code;
}

export function VideoLinkImporter({ onImportReady, onError, disabled }: VideoLinkImporterProps) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<TranscribeMode>('turbo');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [processingMessage, setProcessingMessage] = useState('');
  const [lastSource, setLastSource] = useState<ImportedVideoSource | null>(null);

  // B 站 Cookie 内联配置
  const [hasBiliCookie, setHasBiliCookie] = useState<boolean | null>(null); // null = loading
  const [showCookiePanel, setShowCookiePanel] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [cookieSaving, setCookieSaving] = useState(false);

  const parsedPreview = useMemo(() => parseVideoLink(url), [url]);
  const isBiliLink = parsedPreview?.provider === 'bilibili';

  // 初始化时检查是否已配置 Cookie
  useEffect(() => {
    getPreference<string>(BILI_COOKIE_KEY, '').then((v) => {
      setHasBiliCookie(!!v);
      if (v) setCookieInput(v);
    }).catch(() => setHasBiliCookie(false));
  }, []);

  // 保存 Cookie
  async function saveBiliCookie() {
    const trimmed = cookieInput.trim();
    setCookieSaving(true);
    try {
      await setPreference(BILI_COOKIE_KEY, trimmed);
      setHasBiliCookie(!!trimmed);
      if (trimmed) setShowCookiePanel(false);
    } catch {
      // ignore
    } finally {
      setCookieSaving(false);
    }
  }

  // 清除 Cookie
  async function clearBiliCookie() {
    setCookieSaving(true);
    try {
      await setPreference(BILI_COOKIE_KEY, '');
      setHasBiliCookie(false);
      setCookieInput('');
    } catch {
      // ignore
    } finally {
      setCookieSaving(false);
    }
  }

  async function handleImport() {
    if (disabled || status === 'processing') return;

    const trimmed = url.trim();
    if (!trimmed) {
      const message = '请先输入视频链接。';
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
      return;
    }

    // 只支持 B站链接
    if (parsedPreview && parsedPreview.provider !== 'bilibili') {
      const message = '目前仅支持 B站视频链接，其他平台即将支持。';
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
      return;
    }

    setStatus('processing');
    setErrorMessage('');
    setProcessingMessage('正在解析视频...');

    const timers: NodeJS.Timeout[] = [];
    timers.push(setTimeout(() => setProcessingMessage('正在提取音频...'), 800));
    timers.push(setTimeout(() => setProcessingMessage('正在转写...'), 2200));

    try {
      // 如果是 B 站链接，从本地 IndexedDB 读取用户 Cookie 一并发送
      let biliCookie: string | undefined;
      if (isBiliLink) {
        try {
          const savedCookie = await getPreference<string>(BILI_COOKIE_KEY, '');
          if (savedCookie) biliCookie = savedCookie;
        } catch {
          // 读取失败不影响导入
        }
      }

      const response = await fetch('/api/video/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, mode, language: 'zh', ...(biliCookie ? { biliCookie } : {}) }),
      });

      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as ImportApiResponse;

      if (!response.ok || !data?.success) {
        const primaryCode = pickPrimaryErrorCode(data);
        const message = mapImportError(primaryCode, data?.error || `请求失败 (${response.status})`);
        throw new Error(message);
      }

      const segments = mapSegments(data);
      const sourceMode = data.sourceMode;
      const trace = data.trace || [];

      const source: ImportedVideoSource = {
        provider: data.source?.provider || parsedPreview?.provider || 'generic',
        providerLabel: data.source?.providerLabel || parsedPreview?.providerLabel || 'Web Video',
        originalUrl: data.source?.originalUrl || trimmed,
        resolvedUrl: data.source?.resolvedUrl,
        embedUrl: data.source?.embedUrl,
        playableUrl: data.source?.playableUrl || trimmed,
        title: data.source?.title,
        durationSec: data.source?.durationSec,
        thumbnailUrl: data.source?.thumbnailUrl,
        audioUrl: data.source?.audioUrl,
        sourceMode: sourceMode || data.source?.sourceMode,
        bvid: data.source?.bvid,
        cid: data.source?.cid,
        importTrace: trace,
      };

      setProcessingMessage('导入完成');
      setLastSource(source);
      setStatus('success');

      onImportReady({
        segments,
        source,
        sourceMode: source.sourceMode,
        trace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频导入失败，请稍后再试。';
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
    } finally {
      timers.forEach((timer) => clearTimeout(timer));
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#E9E9E7]/80 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(214,165,87,0.12)]">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">视频链接</label>
          <input
            type="url"
            data-testid="video-link-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="粘贴 B站视频链接（bilibili.com 或 b23.tv）"
            className="w-full rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#E9E9E7] focus:ring-2 focus:ring-[#E9E9E7]"
            disabled={disabled || status === 'processing'}
          />
        </div>

        {parsedPreview && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs text-slate-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#D1F4E0]" />
            识别平台: {parsedPreview.providerLabel}
          </div>
        )}
      </section>

      {isBiliLink && hasBiliCookie === true && !showCookiePanel && (
        <div className="flex items-center gap-2 rounded-xl border border-[#D1F4E0] bg-[#D1F4E0]/30 px-3 py-2">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#D1F4E0]"></span>
          <span className="text-xs font-medium text-[#232322]">B站 Cookie 已配置</span>
          <button
            type="button"
            onClick={() => setShowCookiePanel(true)}
            className="ml-auto text-xs text-slate-500 hover:text-[#232322] transition"
          >
            修改
          </button>
        </div>
      )}

      {showCookiePanel && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">配置 B 站 Cookie（可选）</p>
            <button
              type="button"
              onClick={() => setShowCookiePanel(false)}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
            >
              ×
            </button>
          </div>

          <p className="text-xs text-slate-500">
            少数视频需要 B站登录态才能导入。Cookie 仅保存在你的浏览器，不会上传。
          </p>

          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-[#232322] hover:text-[#232322]">
              如何获取？
            </summary>
            <ol className="mt-2 ml-4 space-y-1 list-decimal text-slate-600">
              <li>电脑浏览器登录 <a href="https://www.bilibili.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">bilibili.com</a></li>
              <li>按 F12 → 点「应用 / Application」→ 左侧 Cookie</li>
              <li>复制 SESSDATA、bili_jct、DedeUserID 的值粘贴到下方</li>
            </ol>
          </details>

          <textarea
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder="SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx"
            rows={2}
            disabled={cookieSaving}
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono placeholder:text-slate-400 focus:border-[#E9E9E7] focus:ring-2 focus:ring-[#E9E9E7]"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveBiliCookie}
              disabled={cookieSaving || !cookieInput.trim()}
              className="px-4 py-1.5 rounded-lg bg-[#232322] text-white text-xs font-medium hover:bg-[#FDECC8] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {cookieSaving ? '保存中...' : '保存'}
            </button>
            {hasBiliCookie && (
              <button
                type="button"
                onClick={clearBiliCookie}
                disabled={cookieSaving}
                className="px-3 py-1.5 rounded-lg text-red-500 text-xs hover:bg-red-50 transition"
              >
                清除
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCookiePanel(false)}
              className="ml-auto px-3 py-1.5 rounded-lg text-slate-500 text-xs hover:bg-slate-100 transition"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">转写模式</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            { id: 'turbo' as const, label: '极速模式（推荐）', accent: 'text-[#232322]' },
            { id: 'fast' as const, label: '快速模式', accent: 'text-slate-700' },
            { id: 'standard' as const, label: '标准模式', accent: 'text-slate-700' },
          ]).map((item) => {
            const active = mode === item.id;
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                  active
                    ? 'border-[#E9E9E7] bg-[#FDF3C0]/50/70 shadow-[0_6px_14px_rgba(214,165,87,0.15)]'
                    : 'border-slate-200 hover:border-[#E9E9E7] hover:bg-[#EFEFEF]/30'
                }`}
              >
                <input
                  type="radio"
                  name="video-transcribe-mode"
                  checked={active}
                  onChange={() => setMode(item.id)}
                  disabled={disabled || status === 'processing'}
                  className="h-4 w-4 accent-[#232322]"
                />
                <span className={`whitespace-nowrap text-sm ${item.accent}`}>{item.label}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
          {MODE_HELP_TEXT[mode]}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          说明：三种模式只决定&ldquo;优先策略&rdquo;，导入链路会自动回退，不需要你手动反复切换。
        </p>
      </section>

      <button
        type="button"
        data-testid="video-import-button"
        onClick={handleImport}
        disabled={disabled || status === 'processing' || (!!parsedPreview && parsedPreview.provider !== 'bilibili')}
        className="w-full rounded-2xl bg-[#232322] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(237,133,24,0.34)] transition hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'processing' ? '处理中...' : '导入并转写'}
      </button>

      {status === 'processing' && (
        <div className="rounded-xl border border-[#E9E9E7] bg-[#FDF3C0]/50 px-3 py-2 text-sm text-[#232322]">
          {processingMessage}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-3 space-y-2">
          <p className="text-sm text-red-600">{errorMessage}</p>
          {isBiliLink && (errorMessage.includes('Cookie') || errorMessage.includes('登录') || errorMessage.includes('内存不足')) && !hasBiliCookie && (
            <button
              type="button"
              onClick={() => setShowCookiePanel(true)}
              className="text-xs font-medium text-[#232322] bg-[#FDF3C0] hover:bg-[#FDF3C0] px-3 py-1.5 rounded-lg transition"
            >
              配置 B 站 Cookie 后重试
            </button>
          )}
        </div>
      )}

      {status === 'success' && lastSource && (
        <div className="rounded-xl border border-[#D1F4E0] bg-[#D1F4E0]/30 px-3 py-2 text-sm text-[#232322]">
          已导入: {lastSource.title || lastSource.providerLabel}
          {formatDuration(lastSource.durationSec) ? ` | 时长 ${formatDuration(lastSource.durationSec)}` : ''}
        </div>
      )}
    </div>
  );
}
