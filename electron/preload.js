// 预加载脚本：以最小暴露面提供渲染进程需要的少量桥接信息。
// 当前 Web GUI 由 dsh 服务端注入 window.__DSH_BOOT__，不需要 Node 能力，
// 这里只暴露只读的版本标识，保持 contextIsolation + sandbox 安全默认值。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
