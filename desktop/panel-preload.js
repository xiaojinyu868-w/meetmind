// 桌面小窗的安全桥：注入 window.meetmindDesktop 给 /companion 页面。
// 页面在普通浏览器里打开时这个对象是 undefined，壳能力按钮自动隐藏。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindDesktop', {
  // 触发与全局热键相同的「截鼠标所在屏 → 收进收集线」流程
  captureScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  // 显示壳内主窗口；path 限站内路径（如 '/app'、'/login'）
  showMain: (path) => ipcRenderer.invoke('desktop:show-main', typeof path === 'string' ? path : '/app'),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
});
