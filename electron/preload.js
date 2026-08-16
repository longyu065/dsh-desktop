// 预加载脚本：以最小暴露面提供渲染进程需要的少量桥接信息。
// 自包含桌面版 v0.2.0：
//   - 暴露版本信息 API（当前版本、最新版本、升级触发、重启）
//   - 当前 Web GUI 由 dsh 服务端注入 window.__DSH_BOOT__，不需要 Node 能力，
//     这里只暴露只读的版本标识和升级操作，保持 contextIsolation + sandbox 安全默认值。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // ===== 版本检查与升级 API =====

  // 获取版本信息（当前版本 + 最新版本）
  getVersionInfo: () => ipcRenderer.invoke('get-version-info'),

  // 手动触发版本检查（托盘菜单"检查更新"）
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // 触发升级（下载并安装最新版本）
  doUpgrade: () => ipcRenderer.invoke('do-upgrade'),

  // 重启应用（升级完成后调用）
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),

  // ===== 事件监听（主进程 → 渲染进程） =====

  // 注册更新可用回调：主进程检测到新版本后通知渲染进程
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, data) => {
      try {
        callback(data);
      } catch (_) {}
    });
  },
});