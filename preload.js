// สะพานเชื่อมระหว่างหน้า Dashboard กับ main process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tikkies', {
  // เรียกคำสั่ง: window.tikkies.invoke('tiktok:connect', {username: 'xxx'})
  invoke: (cmd, payload) => ipcRenderer.invoke('cmd', { cmd, payload }),
  // รับ event สด: window.tikkies.onEvent(({event, data}) => ...)
  onEvent: (callback) => {
    const listener = (_e, msg) => callback(msg);
    ipcRenderer.on('bus-event', listener);
    return () => ipcRenderer.removeListener('bus-event', listener);
  }
});
