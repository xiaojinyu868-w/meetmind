// 口袋纯逻辑单测（node:test，不依赖 Electron）：make test-desktop
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readSelection, snapshotClipboard, restoreClipboard } = require('./selection');
const { detectSource, mergeBookmark, parseAppleScriptPair, parseWindowsForeground } = require('./source');
const { postClip, stashPendingClip, flushPendingClips, readPending } = require('./clip-client');

/** 假剪贴板：Electron clipboard 的最小子集 */
function fakeClipboard(initial = {}) {
  const state = { text: initial.text || '', html: initial.html || '', rtf: '', image: initial.image || null, bookmark: initial.bookmark || null };
  const emptyImage = { isEmpty: () => true, toDataURL: () => '' };
  return {
    state,
    readText: () => state.text,
    readHTML: () => state.html,
    readRTF: () => state.rtf,
    readImage: () => state.image || emptyImage,
    readBookmark: () => state.bookmark || { title: '', url: '' },
    clear: () => { state.text = ''; state.html = ''; state.rtf = ''; state.image = null; state.bookmark = null; },
    write: (data) => {
      state.text = data.text || ''; state.html = data.html || ''; state.rtf = data.rtf || '';
      state.image = data.image || null; state.bookmark = data.bookmark ? { title: data.bookmark, url: data.bookmark } : null;
    },
  };
}

const fakeImage = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA', toPNG: () => Buffer.from('png') };
const noSleep = async () => {};

test('readSelection：模拟复制拿到选区文字与 HTML，并把用户原来的剪贴板还原', async () => {
  const clipboard = fakeClipboard({ text: '用户原来复制的东西' });
  const exec = (_file, _args, _opts, cb) => { clipboard.state.text = '选中的一段'; clipboard.state.html = '<p>选中的<b>一段</b></p>'; cb(null); };
  const result = await readSelection({ clipboard, exec, platform: 'darwin', sleep: noSleep });
  assert.equal(result.kind, 'text');
  assert.equal(result.text, '选中的一段');
  assert.match(result.html, /<b>一段<\/b>/);
  assert.equal(result.viaSimulatedCopy, true);
  assert.equal(clipboard.state.text, '用户原来复制的东西', '剪贴板必须还原');
});

test('readSelection：没有选区时复制不产出 → none，剪贴板照样还原', async () => {
  const clipboard = fakeClipboard({ text: '旧内容' });
  const exec = (_file, _args, _opts, cb) => cb(null); // 复制"成功"但什么都没进剪贴板
  const result = await readSelection({ clipboard, exec, platform: 'darwin', sleep: noSleep });
  assert.equal(result.kind, 'none');
  assert.equal(clipboard.state.text, '旧内容');
});

test('readSelection：模拟复制不可用（Linux 无 xdotool）时，剪贴板里的图当图收', async () => {
  const clipboard = fakeClipboard({ image: fakeImage });
  const exec = (_file, _args, _opts, cb) => cb(new Error('ENOENT'));
  const result = await readSelection({ clipboard, exec, platform: 'linux', sleep: noSleep });
  assert.equal(result.kind, 'image');
  assert.equal(result.viaSimulatedCopy, false);
  assert.equal(clipboard.state.image, fakeImage, '图也要还原回去');
});

test('snapshot / restore 往返：空剪贴板还原为空', () => {
  const clipboard = fakeClipboard();
  const snapshot = snapshotClipboard(clipboard);
  clipboard.state.text = '中间被改了';
  restoreClipboard(clipboard, snapshot);
  assert.equal(clipboard.state.text, '');
});

test('source：AppleScript 的 "url, title" 只在第一个逗号切；PowerShell 的 "process|title"', () => {
  assert.deepEqual(parseAppleScriptPair('https://chatgpt.com/c/abc, 贝叶斯, 条件概率 - ChatGPT'), { url: 'https://chatgpt.com/c/abc', title: '贝叶斯, 条件概率 - ChatGPT' });
  assert.deepEqual(parseWindowsForeground('chrome|贝叶斯 - Google Chrome'), { app: 'chrome', windowTitle: '贝叶斯 - Google Chrome' });
  assert.deepEqual(parseWindowsForeground(''), { app: '', windowTitle: '' });
});

test('source：macOS 前台是 Chrome 时追问网址与页标题', async () => {
  const calls = [];
  const exec = (_file, args, _opts, cb) => {
    calls.push(args[1]);
    if (/frontmost/.test(args[1])) return cb(null, 'Google Chrome|贝叶斯 - Google Chrome\n');
    if (/Google Chrome/.test(args[1])) return cb(null, 'https://chatgpt.com/c/abc, 贝叶斯 - ChatGPT\n');
    return cb(new Error('unexpected'));
  };
  const source = await detectSource({ exec, platform: 'darwin' });
  assert.deepEqual(source, { app: 'Google Chrome', windowTitle: '贝叶斯 - Google Chrome', url: 'https://chatgpt.com/c/abc', pageTitle: '贝叶斯 - ChatGPT' });
  assert.equal(calls.length, 2);
});

test('source：任何一步失败都只是少字段，不抛', async () => {
  const exec = (_file, _args, _opts, cb) => cb(new Error('osascript denied'));
  assert.deepEqual(await detectSource({ exec, platform: 'darwin' }), { app: '', windowTitle: '' });
  assert.deepEqual(mergeBookmark({ app: 'Safari' }, { url: 'https://claude.ai/x', title: 'Claude' }), { app: 'Safari', url: 'https://claude.ai/x', pageTitle: 'Claude' });
});

test('clip-client：状态映射——200 ok / 401 auth / 422 empty / 5xx 重试后 fail', async () => {
  const mk = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  assert.equal((await postClip({ origin: 'http://x', token: 't', payload: {}, fetchImpl: mk(200, { success: true, capture: { id: '1' } }) })).status, 'ok');
  assert.equal((await postClip({ origin: 'http://x', token: 't', payload: {}, fetchImpl: mk(401, {}) })).status, 'auth');
  assert.equal((await postClip({ origin: 'http://x', token: 't', payload: {}, fetchImpl: mk(422, {}) })).status, 'empty');
  let attempts = 0;
  const flaky = async () => { attempts += 1; return { status: 503, ok: false, json: async () => ({}) }; };
  const result = await postClip({ origin: 'http://x', token: 't', payload: {}, fetchImpl: flaky });
  assert.equal(result.status, 'fail');
  assert.equal(attempts, 2, '5xx 重试一次');
});

test('clip-client：离线队列——失败进队，补传成功出队、网络失败留着、空内容丢弃', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pocket-'));
  stashPendingClip(dir, { text: 'a', clientId: 'a' });
  stashPendingClip(dir, { text: 'b', clientId: 'b' });
  stashPendingClip(dir, { text: '', clientId: 'c' });
  assert.equal(readPending(dir).length, 3);
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.clientId === 'a') return { status: 200, ok: true, json: async () => ({ success: true, capture: { id: 'a' } }) };
    if (body.clientId === 'c') return { status: 422, ok: false, json: async () => ({}) };
    throw new Error('offline');
  };
  const result = await flushPendingClips({ userDataDir: dir, origin: 'http://x', token: 't', fetchImpl });
  assert.equal(result.sent, 1);
  assert.equal(result.left, 1);
  assert.deepEqual(readPending(dir).map((item) => item.clientId), ['b']);
  // 没登录：原样保留
  const untouched = await flushPendingClips({ userDataDir: dir, origin: 'http://x', token: null, fetchImpl });
  assert.equal(untouched.left, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
