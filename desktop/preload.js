const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmindCompanion', {
  setExpanded: (expanded) => ipcRenderer.invoke('companion:set-expanded', Boolean(expanded)),
  moveBy: (deltaX, deltaY) => ipcRenderer.invoke('companion:move-by', Number(deltaX), Number(deltaY)),
  // v2：显示壳内主窗口并导航到 /app（取代 v1 的 shell.openExternal 外部浏览器）
  showMain: () => ipcRenderer.invoke('companion:show-main'),
  // v3： toggle 桌面小窗（/companion 面板：随手记、随口问、截图）
  togglePanel: () => ipcRenderer.invoke('companion:toggle-panel'),
  // v4：旁听开关——主进程驱动隐藏主窗口里的网页 Recorder（loopback 系统声）
  // 宠物右键最小菜单：打开主窗口 / 退出（交互即姿态，其余一概不放）
  toggleListen: () => ipcRenderer.invoke('pet:toggle-listen'),
  // 拖图片到宠物身上 → 收集线
  dropFiles: (files) => ipcRenderer.invoke('pet:drop-files', files),
  // 右键最小菜单（打开主窗口 / 退出）
  showPetMenu: () => ipcRenderer.invoke('pet:menu'),
  // 捕获成功的吞食动画（截图进收集线后由主进程推来）
  onGulp: (handler) => ipcRenderer.on('pet:gulp', () => handler()),
  // 姿态圆钮：扩/缩宠物窗口给圆钮腾位置（底部锚定，宠物不动）
  setDock: (open) => ipcRenderer.invoke('pet:set-dock', Boolean(open)),
  // 圆钮「收下这一页」：与全局热键同一条截图流程
  captureScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  // 右键菜单动作回投（问 / 旁听 / 收下）
  onPetAction: (handler) => ipcRenderer.on('pet:action', (_e, action) => handler(action)),
  quit: () => ipcRenderer.invoke('companion:quit'),
});
