// DeepSeek Harness Web GUI 的 Electron 壳 —— 主进程
// 服务生命周期约定：
//   - npm start 会先跑 scripts/ensure-dsh.js：探测 127.0.0.1:3080，
//     没有则拉起常驻的 dsh web 并等待就绪，再启动本应用；
//   - 本进程只负责打开窗口加载页面，退出时【不】杀掉 dsh web
//     （服务常驻，下次 start 直接复用；要停服务用 `pkill -f "dsh web"`）。
//   - 直接 `electron .`（跳过前置脚本）时，这里也会兜底探测并拉起。
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const {
  DEFAULT_PORT,
  probePort,
  waitForServer,
  spawnDshServer,
} = require('../scripts/dsh-server-lib');

const PORT = Number(process.env.DSH_DESKTOP_PORT || DEFAULT_PORT);
const APP_URL = `http://127.0.0.1:${PORT}`;

// DeepSeek 鲸鱼托盘图标（官方 SVG 32x32，运行时解码，无需额外资源文件）
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFfklEQVR4nO1XXYhVVRS+409ZWgQGkRUIUk+BhCCUDyOUjNPd+5xzZ7waNDEgcse71z5nflTqqYnwoYeoJ4XyoYeswB8KIaMfrB7EfCsIJcRAgrKwQhN15p61v1j7nH3vra5Og77VgsO555y99/rWt9b69r6Vyv92U4a+4vrbW6CvXsfCW+cA5VU+909jUfE8F7AbjbmB1etYOD2NBXOOm8ZtdYNl7WhLUEl6ddUgtTaEtebhA32VrpeNBhYnhOUDY1gZEVb0j2KJznCfMhhTxB8o4h818WcCQsavaWCx3OMMu2sTfCqsExyJ03D1wIS+MFARHteG92nDpxXhkiJ3RRm+og3/oAwu1CaBoSkgSsFxiic6kRYMRCkOD8t3y288RVjRzUTwUSUMKIukE7kMmsQd2vCeOHXeQZzJIp1LnuMUUIZzRZzLPbFYWy68KKyjLX+YTADJBJwm/r1KWO+dWqyOCQNVk9t4HBiewqtt5xtTd7u2ODK8E9DEuTbc0oZlgc4lz/6dg9yj1LPwU3U7olATZQr2SgDC2tCkB/6lavJbWgJJgWQcLO+VyZ9rU6KJXxveASji2cKhw1yXMuziDC4ZB6pNjIdkqhS6NuEBsDbMkQVL2iIq2NPWCZPnaxO430/QFuviFC1PaxG9mwcI1sRcOHSTAYS2eG/TzhJEwV5LnEcpnLCjDWy7/OLUve2LKnO55C7kXiZ7QHMBkXQRWjJXEcinw2CZavK7slZgSljQ5H6rmrzZbtuEsDxK3c/eIfG3mvgLqX5t+JpM8IsKEB/JP51HtizYVAoOrTiT9/yST0UTW3zhZr6uTqpmvmWgUdIe2l1brPMFQfxRd/9vTK+u0oSGMnxccpxkcIpcFxvsBLQ2fDGyOKAtnxWw2mK25inmzyPLJ6RrPLuW93ZrQZt+nWKz5Eobd7SXYkmXVAk1cSCMhJQIIz4yw6er1FrfP4p7NOGg1IJusk9HMg6nDLekuKPUvVgC8J3SAWDzEV8Ulr8bHcWS0umCoPmhSyRVmnCkZCsXBiQ6TXxOkzuqtufPeRGyfMKDIJ5tj5OaylDrFqQuBlpxUuRoppbNPNqtVsH85lNO1hbveCakossUaOJfkxS+sKoWazXx1fKbtKAEdymewkPtwuu2qsVqTXytyFPRRv39hcNuC8gLweJjZZ9LhFyIjjte2+Ye9HsF8ZkyPS0ZF1l83Du9lUplZAeWRhZnPQDik2FD6WUBRHUMD8eWz5eyLB3iPIuW/9AGF0XxfJ0Q556tNN/Wk/5gUYZ9pWRKrp7pzUJREwFgZPKtbbUrVVFasqiLokile6IUp9Y+e+HusEall8WE9SKXEkWU4nR/A/f6Dz3PBOhrg0hxuKA/L9uzo6AegHSCwWYZe/0TEsIhAockIpkkfS2O5GgVnMkWrQxeqY7hgTbwMayMU5wr1a4tVPLbtx5hz/UDCTZdfBwkPCIbhOxWZRvtlwNIABhneFIW1cS/6CZGwnS1HYNxxrMyLyimFyTCwQ7tcxzNpksQTzdRjTPMRKnLJX/a4qsoxWNtZwbHhHK/+xneF05CIrlRyrORZRGeGd96xEeVxWDYoue0eqhwQi1O+XLQ8MjyNWX4U2X4QNHzRXt58SKcFCcF+NZQnOKysFSbgNu0C67+vBetMwONy4X+3/AgW+mASDKsUeS+kRYK+32ZlnJ39FvrjHyTTUjkVhF/rw12Rwa7tOH3hS1l+BNl+PVoK+7qpONfMrFhBEsVYUobnJX8Dk3CSasKqHAmDIcMbfjryGBT5ZbZNBYEulQDdyrbGlSElxXxfm3yI9ryIUX8prJ4QY9hXQAtdy/bXVXffVidn2Ee/256jr2JPyZ/tWLxzs5YLBze3aK/YJX/rv0J35It09WI/DAAAAAASUVORK5CYII=';

let mainWindow = null;
let tray = null;

// ---------- 兜底：确保 dsh web 服务在跑（npm start 已由 ensure-dsh.js 保证） ----------
async function ensureDshServer() {
  if (await probePort(PORT)) return true;
  console.log(`[dsh-desktop] 端口 ${PORT} 无服务，兜底拉起 dsh web ...`);
  try {
    spawnDshServer(PORT);
  } catch (err) {
    console.error(`[dsh-desktop] ❌ ${err.message}`);
    app.exit(1);
    return false;
  }
  const ok = await waitForServer(PORT);
  if (!ok) {
    console.error(`[dsh-desktop] dsh web 未就绪，退出。日志见 logs/dsh-web.stderr.log`);
    app.exit(1);
    return false;
  }
  return true;
}

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(APP_URL);

  // 新开外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    // 点红点 → 隐藏到托盘而不是退出
    if (!app.isQuiting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- 托盘 ----------
function createTray() {
  tray = new Tray(nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64));
  tray.setToolTip('DeepSeek Harness');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => {
        if (!mainWindow) { createWindow(); return; }
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) { createWindow(); return; }
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  await ensureDshServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // 有托盘时保持后台运行（macOS 惯例）；真正退出由托盘菜单触发
  if (process.platform !== 'darwin' && app.isQuiting) app.quit();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  // 注意：不 kill dsh web —— 服务常驻，由 ensure-dsh.js 管理
});
