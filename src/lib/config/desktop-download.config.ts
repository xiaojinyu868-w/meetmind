/**
 * 桌面端下载入口配置（landing page 下载区读取）。
 *
 * enabled = false：安装包尚未发布时整个下载区不渲染——不给用户半成品入口。
 * 首次 GitHub Release（desktop-v* tag → desktop-release.yml 自动构建上传）发布后：
 *   1. 把 enabled 改为 true
 *   2. 确认 version 与 desktop/package.json 一致
 * 下载 URL 用稳定文件名（electron-builder.yml 的 artifactName），
 * releases/latest/download/... 永远指向最新版，发新版不用改这里。
 */

const RELEASES_BASE = 'https://github.com/xiaojinyu868-w/meetmind/releases';

export const DESKTOP_DOWNLOAD = {
  enabled: true,
  version: '1.1.0',
  releasesPage: `${RELEASES_BASE}/latest`,
  macArm64: `${RELEASES_BASE}/latest/download/MeetMind-mac-arm64.dmg`,
  macIntel: `${RELEASES_BASE}/latest/download/MeetMind-mac-x64.dmg`,
  windows: `${RELEASES_BASE}/latest/download/MeetMind-win-setup.exe`,
} as const;
