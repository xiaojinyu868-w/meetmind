// 桌面小窗的安全桥：注入 window.meetmindDesktop 给 /companion 页面。
// 页面在普通浏览器里打开时这个对象是 undefined，壳能力按钮自动隐藏。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindDesktop', {
  // 框选一块屏 → 收进口袋
  captureScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  // 与 ⌘⇧M 同一条流程：收下面前的东西
  captureSelection: () => ipcRenderer.invoke('desktop:capture-selection'),
  // 口袋窗里拖进 / 粘贴进的文字、HTML、网址
  dropClip: (dropped) => ipcRenderer.invoke('pocket:drop-clip', dropped),
  // 显示壳内主窗口；path 限站内路径（如 '/app'、'/login'）
  showMain: (path) => ipcRenderer.invoke('desktop:show-main', typeof path === 'string' ? path : '/app'),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
});
