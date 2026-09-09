/**
 * 桌面端下载入口配置（landing page 下载区读取）。
 *
 * enabled = false：安装包尚未发布时整个下载区不渲染——不给用户半成品入口。
 * 首次 GitHub Release（desktop-v* tag → desktop-release.yml 自动构建上传）发布后：
 *   1. 把 enabled 改为 true
 *   2. 确认 version 与 desktop/package.json 一致
 * 下载 URL 用稳定文件名（electron-builder.yml 的 artifactName），
 * releases/latest/download/... 永远指向最新版，发新版不用改这里。
 *
 * 2026-09-09：GitHub Actions 因账号 billing lock 不可用，Windows 包在服务器上用 `make desktop-dist-win`（docker + wine）出，
 * 拷到 public/downloads/ 自托管（gitignored）；macOS 的 dmg 只能在 Mac 上打，仍指向 GitHub 上最新 Release。
 * 两个平台版本可能不同，所以版本按平台各写各的，landing 每张卡各显示自己的。
 */

const RELEASES_BASE = 'https://github.com/xiaojinyu868-w/meetmind/releases';

export const DESKTOP_DOWNLOAD = {
  enabled: true,
  /** 兼容旧引用：整体版本取 Windows（当前最新） */
  version: '1.4.0',
  windowsVersion: '1.4.0',
  macVersion: '1.1.0',
  releasesPage: `${RELEASES_BASE}/latest`,
  macArm64: `${RELEASES_BASE}/latest/download/MeetMind-mac-arm64.dmg`,
  macIntel: `${RELEASES_BASE}/latest/download/MeetMind-mac-x64.dmg`,
  windows: '/downloads/MeetMind-win-setup.exe',
} as const;
