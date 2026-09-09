// 框选覆盖层安全桥：主进程推冻结帧，页面回框选结果 / 取消
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindRegion', {
  onFrame: (handler) => {
    ipcRenderer.removeAllListeners('region:frame');
    ipcRenderer.on('region:frame', (_event, payload) => handler(payload));
  },
  done: (rect) => ipcRenderer.send('region:done', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
});
