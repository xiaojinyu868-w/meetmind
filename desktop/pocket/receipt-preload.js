// 回执窗安全桥：主进程推 receipt:show，页面回 undo / hover / dismiss
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindReceipt', {
  onShow: (handler) => {
    ipcRenderer.removeAllListeners('receipt:show');
    ipcRenderer.on('receipt:show', (_event, payload) => handler(payload));
  },
  undo: () => ipcRenderer.invoke('receipt:undo'),
  hover: (hovering) => ipcRenderer.invoke('receipt:hover', Boolean(hovering)),
  dismiss: () => ipcRenderer.invoke('receipt:dismiss'),
});
