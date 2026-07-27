const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindCompanion', {
  setExpanded: (expanded) => ipcRenderer.invoke('companion:set-expanded', Boolean(expanded)),
  moveBy: (deltaX, deltaY) => ipcRenderer.invoke('companion:move-by', Number(deltaX), Number(deltaY)),
  // v2：显示壳内主窗口并导航到 /app（取代 v1 的 shell.openExternal 外部浏览器）
  showMain: () => ipcRenderer.invoke('companion:show-main'),
  // v3： toggle 桌面小窗（/companion 面板：随手记、随口问、截图）
  togglePanel: () => ipcRenderer.invoke('companion:toggle-panel'),
  quit: () => ipcRenderer.invoke('companion:quit'),
});
