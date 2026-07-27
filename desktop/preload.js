const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindCompanion', {
  setExpanded: (expanded) => ipcRenderer.invoke('companion:set-expanded', Boolean(expanded)),
  moveBy: (deltaX, deltaY) => ipcRenderer.invoke('companion:move-by', Number(deltaX), Number(deltaY)),
  // v2：显示壳内主窗口并导航到 /app（取代 v1 的 shell.openExternal 外部浏览器）
  showMain: () => ipcRenderer.invoke('companion:show-main'),
  quit: () => ipcRenderer.invoke('companion:quit'),
});
