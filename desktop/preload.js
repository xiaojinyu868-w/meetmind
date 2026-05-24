const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindCompanion', {
  setExpanded: (expanded) => ipcRenderer.invoke('companion:set-expanded', Boolean(expanded)),
  moveBy: (deltaX, deltaY) => ipcRenderer.invoke('companion:move-by', Number(deltaX), Number(deltaY)),
  openMeetMind: () => ipcRenderer.invoke('companion:open-meetmind'),
  quit: () => ipcRenderer.invoke('companion:quit'),
});
