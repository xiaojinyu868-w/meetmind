// 自动更新检查（轻量、零依赖、未签名包友好）
//
// 为什么不用 electron-updater：
//   electron-updater 在 macOS 上强制要求代码签名（未签名直接拒绝），
//   我们目前是未签名分发；而且它会引入 node_modules 依赖，破坏
//   「安装包零 npm 依赖」的打包结构。
//
// 策略（安静原则）：
//   - 启动 20s 后查一次，之后每 4h 查一次 GitHub Releases
//   - 发现更新的 desktop-v* 版本 → 系统通知一次（同一版本只提示一次）
//   - 用户点通知 → 浏览器打开对应平台的安装包下载地址
//   - 不打断、不弹窗、不自动下载——与 MeetMind「安静」的底色一致
const fs = require('fs');
const path = require('path');
const { app, Notification, shell } = require('electron');

const REPO = 'xiaojinyu868-w/meetmind';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 解析 "desktop-v1.2.3" → [1,2,3]；非桌面 tag 返回 null */
function parseDesktopTag(tag) {
  const match = /^desktop-v(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewer(candidate, current) {
  for (let i = 0; i < 3; i += 1) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

function dismissedFilePath() {
  return path.join(app.getPath('userData'), 'update-dismissed.json');
}

function readDismissedVersion() {
  try {
    return JSON.parse(fs.readFileSync(dismissedFilePath(), 'utf8')).version || null;
  } catch {
    return null;
  }
}

function writeDismissedVersion(version) {
  try {
    fs.writeFileSync(dismissedFilePath(), JSON.stringify({ version }));
  } catch {
    // ignore
  }
}

/** 按平台挑安装包：mac 区分 arm64/x64，win 拿 setup exe */
function pickAssetUrl(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const find = (suffix) => list.find((a) => typeof a.name === 'string' && a.name.endsWith(suffix));
  if (process.platform === 'darwin') {
    const asset = process.arch === 'arm64'
      ? find('mac-arm64.dmg') || find('mac-x64.dmg')
      : find('mac-x64.dmg') || find('mac-arm64.dmg');
    return asset?.browser_download_url || null;
  }
  if (process.platform === 'win32') {
    return find('win-setup.exe')?.browser_download_url || null;
  }
  return null;
}

async function fetchLatestDesktopRelease() {
  // 不取 /releases/latest：它可能是非桌面 release。取列表找第一个 desktop-v*
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=10`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'meetmind-desktop' },
      },
    );
    if (!response.ok) return null;
    const releases = await response.json();
    for (const release of Array.isArray(releases) ? releases : []) {
      const version = parseDesktopTag(release.tag_name);
      if (version && !release.draft) {
        return { version, tag: release.tag_name, assets: release.assets, pageUrl: release.html_url };
      }
    }
    return null;
  } catch {
    return null; // 断网/限流都安静跳过，下次再查
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdates() {
  const current = parseDesktopTag(`desktop-v${app.getVersion()}`);
  if (!current) return;
  const latest = await fetchLatestDesktopRelease();
  if (!latest || !isNewer(latest.version, current)) return;
  if (readDismissedVersion() === latest.tag) return; // 这个版本已经提示过

  const downloadUrl = pickAssetUrl(latest.assets) || latest.pageUrl;
  try {
    const notification = new Notification({
      title: `MeetMind 桌面端 ${latest.tag.replace('desktop-v', 'v')} 就绪`,
      body: '点开下载新版本；安装后旧版会被替换。',
      silent: true,
    });
    notification.on('click', () => {
      void shell.openExternal(downloadUrl);
    });
    notification.show();
    // 提示成功展示后再标记：通知服务不可用时不能静默吞掉这个版本的提醒
    writeDismissedVersion(latest.tag);
  } catch (err) {
    console.warn('[desktop] 更新提示不可用，已跳过', err);
  }
}

function startUpdateChecker() {
  // 启动后 20s 首查（避开启动高峰），之后每 4h 一次
  setTimeout(() => {
    void checkForUpdates();
  }, 20 * 1000);
  setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS).unref?.();
}

module.exports = { startUpdateChecker };
