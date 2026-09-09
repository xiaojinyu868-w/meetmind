// 口袋 · 服务端客户端：剪藏上传、撤销、离线队列
//
// 文字剪藏走 POST {origin}/api/workspace/clip（服务端做 HTML→Markdown / 来源命名 / 分组）；
// 撤销走 DELETE /api/workspace/captures。失败（断网 / 5xx）的文字条目进 userData/pending-clips.json，
// 启动时补传——clientId 是幂等键，补传不会落两条。
const fs = require('fs');
const path = require('path');

const RETRY_DELAY_MS = 1500;
const MAX_PENDING = 200;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 上传一条文字剪藏。返回 { status: 'ok', capture } | { status: 'auth' } | { status: 'empty' } | { status: 'fail', error }
 * 只对网络 / 5xx 重试一次；401（登录过期）、422（没内容）不重试。
 */
async function postClip({ origin, token, payload, fetchImpl = fetch }) {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await delay(RETRY_DELAY_MS);
    try {
      const response = await fetchImpl(`${origin}/api/workspace/clip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) return { status: 'auth' };
      if (response.status === 422) return { status: 'empty' };
      if (response.status === 400) return { status: 'fail', error: 'bad-request', permanent: true };
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.success && data.capture) return { status: 'ok', capture: data.capture };
      lastError = `clip 返回 ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { status: 'fail', error: lastError };
}

/** 撤销：软删这条收集（服务端会同时收回引用它的今日情报） */
async function deleteCapture({ origin, token, captureId, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${origin}/api/workspace/captures`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ── 离线队列（文字剪藏；图片仍走 screenshot.js 的 pending-shots/）──────────

function pendingFile(userDataDir) {
  return path.join(userDataDir, 'pending-clips.json');
}

function readPending(userDataDir) {
  try {
    const raw = fs.readFileSync(pendingFile(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(userDataDir, items) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(pendingFile(userDataDir), JSON.stringify(items.slice(-MAX_PENDING)), 'utf8');
    return true;
  } catch (err) {
    console.warn('[pocket] 写离线队列失败', err);
    return false;
  }
}

function stashPendingClip(userDataDir, payload) {
  const items = readPending(userDataDir);
  items.push(payload);
  return writePending(userDataDir, items);
}

/** 启动补传：成功 / 永久失败 / 空内容的条目出队；网络失败的留着下次 */
async function flushPendingClips({ userDataDir, origin, token, fetchImpl }) {
  const items = readPending(userDataDir);
  if (!items.length) return { sent: 0, left: 0 };
  if (!token) return { sent: 0, left: items.length };
  const left = [];
  let sent = 0;
  for (const payload of items) {
    const result = await postClip({ origin, token, payload, fetchImpl });
    if (result.status === 'ok') { sent += 1; continue; }
    if (result.status === 'empty' || result.permanent) continue;
    if (result.status === 'auth') { left.push(payload); continue; }
    left.push(payload);
  }
  writePending(userDataDir, left);
  return { sent, left: left.length };
}

module.exports = { postClip, deleteCapture, stashPendingClip, flushPendingClips, readPending, newClientId };
