// DeepSeek Harness Web GUI 的 Electron 壳 —— 主进程
// 自包含桌面版 v0.2.0：完整 dsh 运行时打进 .app，免 Node.js 免下载
//
// 服务生命周期约定：
//   - npm start 会先跑 scripts/ensure-dsh.js：探测 127.0.0.1:3080，
//     没有则拉起 dsh web 并等待就绪，再启动本应用；
//   - 本进程只负责打开窗口加载页面；**退出应用时结束本应用拉起的 dsh web**
//     （通过 logs/dsh-web.pid 精确停止，复用的外部实例不受影响）。
//   - 直接 `electron .`（跳过前置脚本）时，这里也会兜底探测并拉起。
//
// 版本检查与升级：
//   - 启动时异步检查 npm registry（主源）+ GitHub releases（fallback），不阻塞启动
//   - 有新版本则通过 IPC 通知渲染进程，用户确认后原子升级（临时目录 swap）
//   - 升级失败保留旧版，提示错误信息
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const {
  DEFAULT_PORT,
  probePort,
  waitForServer,
  spawnDshServer,
  stopDshServer,
  resolveDshBin,
  ensureDshBin,
  resolveNodeBin,
  buildSpawnEnv,
  getLogDir,
  getVendorBin,
} = require('../scripts/dsh-server-lib');

const PORT = Number(process.env.DSH_DESKTOP_PORT || DEFAULT_PORT);
const APP_URL = `http://127.0.0.1:${PORT}`;

// DeepSeek 鲸鱼托盘图标（官方 SVG 32x32，运行时解码，无需额外资源文件）
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFfklEQVR4nO1XXYhVVRS+409ZWgQGkRUIUk+BhCCUDyQg5rCgt3vmnfs6B9Bgg8yyPNNpn2pKpseCp4iSF8mHnsI8Q0iDFD6IflD0TgQFQkSCkAoDk6I7K3vrd71vrH3O3vfee+3Mqj91YLHnnPW39a21vnYfVfr/2pShrzj/9hboq9ex8NY5QHmVT/vTW6S4/ievlH92U4a+4vrbV6CvXsPCW+cA5dU/9U9rUbH4nlM33H6r86SFbOoiRQfI2rbgiiK8TQRAV8BTD3yoDcCJ4JQiLB8YYMZS+f8AJzJ/5a+M5N7kgZ0A1cRZE1QqmZMrN8n6T9rgC8b5w5bTF7TBl0EDqjVMqoG5nMExZXBC5U3mwCSmBuk0tlpRkHDEBg1oQFgYra4uRKYLgYoETrqea8NnEocD2mB3csEml70NaWAQEn83wSfL5Ccl9kgufBxLOOJCurAsLI6XJgyUFWIUp0pLk0l5AW4XrI3LCSRJqME77toKsDzr3qJgvcMAY8of2AQXhTZ04zAFv7+zrB0V9pIOw1TIJxvkS7RhC3gDJh/OG6a5Ry1LGBIOOm/AYRPUuyp4Y42DBcznvPHzcGNBVK5J9EgCFtPs5PfOY8bgUJAPgKIT7ReiOqXG4HZlvjMFmuCKcU4pyMWGDkoMMAB8OUyhpxBb6pM8l2xCULVhAEUGEw5WO8FuwahwuEyYz3VbWG1aEH4v5wEQY3BG58LrqRD2q8mPe0nXGpAFJ2olfG3ADAA67Qjw85ULHtdNd1pMr7hApw3AQdKEa00wuG+8JsEFefWCDqN6Wu6yNsGqGGMa+c7p/mBQ91ABoRjJclD830+XgV0QRtCVGyH0id8WCLcWOAwRmAvB8Y1m6MbRUaVJzQQ4BYfVNQnuV4a3pvsUNBmLQak7iKyKnVem36tIC8EY5Ak+PfLDpZX3tNljAjuKAahknC7iiDKodcnrYkAxQO06O7lGk2257n6kk6GIF8GmGsxkcQiZbv1iCCHmOOFC1+gkGLCzSA1AuSrDR4NuVqZuFSUKCV4h1TJ2gHgGIYDR8COvwAR3Bh3o017VHgZWmuCMKaZ4AVznGm3IMMOVxRC8Al4qJgd+77Aa1aC/NNjM/8OQfv+IYp+9mkBxyTeKaxHwGOrEanBUCBEBPETXkuBsOm72C2QM7gSI958d/jVsYgx5Zw68KkiJQDUF5Z8o3WBsRlC6b0xbVVTFWnqDRPaMR9oE+SyRwh4TwBWhM5ru8OA+4TCFxIFINQWZabBqAIaU7jQGzp+uC7ItnByE7RbOICLyZSHOJadvoybaZDDgeOaUQSDmBjEGqAZOB/0uHqoIF8sHcuIAQN0KI2gO0FAeVhDBvqH8s4FIiy2mpkn0bMV1B7rTwIqClPN8JMZBWgqYyYRpDk58gm3GCq/Iwse6huOOMN0uXJ6h65qcpCEHf4yafLw2hGlDXe3xX4JlC1iuoFMSHOniAnpEF4sdsFiOJ4cFuCQXkDmXKmIXdT6KMqlEHVCGj0mWSTLhJwslFuPivByITGYJhAzgLme4RbcCS4ogE/Q3rCFRDyeKH+zYiJs02AN4IhnHCW0QsqbuRuIvHZxPBILguJjNskDr9d4P9kSqtPBYd1yISgbRRAJPM8FXA0IgSoIE100Yw4+m8SwkT8QHBcE2dXqA0Rr8T7fH+FrPZUhDqejEFJhkAggDX4k2YFjMSy97MbQiZHkDsOLLM/KNxjgVm5OR3Iwcbc1FE7suEMIR5+Lp1uNpr5B06I7VxuYaLjdeJxS3gv+28QzXcdvOyeLbqGMRXqO1Q+NgOaBQVNSOorWVBqHn+O0pa/422072n/wvzN6lsdm+1gsz1n+DHOx/wt+XDTwIAAAAABJRU5ErkJggg==';

let mainWindow = null;
let tray = null;
let latestVersion = null; // npm registry 返回的最新版本号
let upgradeChecked = false;

// ========== 版本检查 ==========

// 从 vendor/dsh/package.json 读取当前安装的 dsh 版本
function readCurrentVersion() {
  const pkgPath = findVendorPackagePath();
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const raw = pkg.dependencies?.['@deepseek-ai/dsh'] || pkg.version || '0.0.0';
      // 去掉 npm semver range 前缀（^、~、>= 等）
      return raw.replace(/^[\^~>=<]+\s*/, '').trim();
    }
  } catch (_) {}
  return '0.0.0';
}

// 定位 vendor 的 package.json（打包后在 extraResources，开发模式在工程根目录）
function findVendorPackagePath() {
  const vendorPkg = path.join(
    process.resourcesPath || path.join(__dirname, '..'),
    'vendor', 'dsh', 'package.json'
  );
  // 开发模式下 extraResources 不生效，走工程根目录
  const devPkg = path.join(__dirname, '..', 'vendor', 'dsh', 'package.json');
  if (fs.existsSync(vendorPkg)) return vendorPkg;
  if (fs.existsSync(devPkg)) return devPkg;
  return null;
}

// HTTPS GET 简单封装（Node.js 内置，无第三方依赖）
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'dsh-desktop/0.2.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// 从 npm registry 获取 @deepseek-ai/dsh 的最新版本
async function checkNpmVersion() {
  try {
    const data = await httpsGet('https://registry.npmjs.org/@deepseek-ai/dsh/latest');
    return data.version;
  } catch (err) {
    console.log('[dsh-desktop] npm registry check failed:', err.message);
    return null;
  }
}

// 从 GitHub releases 获取最新版本（fallback）
async function checkGitHubVersion() {
  try {
    const data = await httpsGet('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest');
    // GitHub release tag_name 格式如 "v0.1.0-rc.5" 或 "dsh-0.1.0"
    const tag = data.tag_name || '';
    const match = tag.match(/[\d]+\.[\d]+\.[\d]+(-rc\.\d+)?/);
    return match ? match[0] : null;
  } catch (err) {
    console.log('[dsh-desktop] GitHub releases check failed:', err.message);
    return null;
  }
}

// 比对版本号：返回 1（更新可用）、0（已是最新）、-1（本地更新但非常规情况）
function compareVersions(current, latest) {
  if (!latest || !current) return 0;
  // 简单语义化版本比较（去掉 rc 后缀的预发布标识）
  const clean = (v) => {
    const parts = v.split('-')[0].split('.').map(Number);
    return parts[0] * 10000 + parts[1] * 100 + parts[2];
  };
  const cl = clean(current);
  const ll = clean(latest);
  if (ll > cl) return 1;
  if (ll < cl) return -1;
  // 数字相同，但是 latest 有 rc 后缀而 current 没有 → latest 是预发布，不算升级
  const curHasRc = /-rc/.test(current);
  const latHasRc = /-rc/.test(latest);
  if (latHasRc && !curHasRc) return -1;
  if (!latHasRc && curHasRc) return 1;
  return 0;
}

// 执行版本检查（异步，不阻塞启动）
async function checkForUpdates() {
  if (upgradeChecked) return;
  upgradeChecked = true;

  const current = readCurrentVersion();
  console.log(`[dsh-desktop] 当前 dsh 版本: ${current}`);

  // 主源：npm registry
  let latest = await checkNpmVersion();

  // fallback：GitHub releases
  if (!latest) {
    console.log('[dsh-desktop] npm registry 不可用，尝试 GitHub releases...');
    latest = await checkGitHubVersion();
  }

  if (!latest) {
    console.log('[dsh-desktop] 版本检查失败：两个源均不可用，跳过');
    return;
  }

  console.log(`[dsh-desktop] 最新版本: ${latest}`);
  latestVersion = latest;

  const cmp = compareVersions(current, latest);
  if (cmp > 0) {
    console.log(`[dsh-desktop] 🆕 新版本可用: ${latest}（当前 ${current}）`);
    // 通知渲染进程
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { current, latest });
    }
  }
}

// ========== 升级流程 ==========

// 找一个可用的 npm（系统 PATH 或常见位置），用于升级时的 npm install
function findNpmForUpgrade() {
  // 优先用系统 npm
  const which = require('child_process').spawnSync('sh', ['-lc', 'command -v npm'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  // 常见位置兜底
  const common = [
    path.join(require('os').homedir(), '.local', 'bin', 'npm'),
    '/opt/homebrew/bin/npm',
    '/usr/local/bin/npm',
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 执行升级：npm install 到临时目录，成功后原子 swap
async function performUpgrade(targetVersion) {
  const npmBin = findNpmForUpgrade();
  if (!npmBin) {
    throw new Error('未找到 npm，无法执行升级。请先安装 Node.js 或手动升级');
  }

  const vendorDir = path.join(__dirname, '..', 'vendor', 'dsh');
  const vendorNew = path.join(__dirname, '..', 'vendor', 'dsh-new');
  const vendorBackup = path.join(__dirname, '..', 'vendor', 'dsh-backup');

  // 1. 清理旧临时目录
  try { fs.rmSync(vendorNew, { recursive: true, force: true }); } catch (_) {}

  console.log(`[dsh-desktop] 正在升级 @deepseek-ai/dsh 到 ${targetVersion}...`);
  console.log(`[dsh-desktop] npm install --prefix ${vendorNew} @deepseek-ai/dsh@${targetVersion}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(npmBin, [
      'install',
      '--prefix', vendorNew,
      `@deepseek-ai/dsh@${targetVersion}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`npm 启动失败: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // 清理失败的临时目录
        try { fs.rmSync(vendorNew, { recursive: true, force: true }); } catch (_) {}
        reject(new Error(`npm install 失败 (exit=${code}): ${stderr.slice(-500)}`));
        return;
      }

      // 2. 原子 swap：旧目录 → backup，新目录 → vendor/dsh
      try {
        // 删除旧 backup
        try { fs.rmSync(vendorBackup, { recursive: true, force: true }); } catch (_) {}

        // 旧 vendor/dsh → vendor/dsh-backup
        if (fs.existsSync(vendorDir)) {
          fs.renameSync(vendorDir, vendorBackup);
        }

        // 新 vendor/dsh-new → vendor/dsh
        fs.renameSync(vendorNew, vendorDir);

        // 清理 backup（成功则不需要回滚）
        try { fs.rmSync(vendorBackup, { recursive: true, force: true }); } catch (_) {}

        console.log(`[dsh-desktop] ✅ 升级完成：${targetVersion}`);
        resolve(true);
      } catch (swapErr) {
        // swap 失败：尝试恢复 backup
        console.error(`[dsh-desktop] 原子 swap 失败: ${swapErr.message}`);
        try {
          if (fs.existsSync(vendorBackup)) {
            fs.rmSync(vendorDir, { recursive: true, force: true });
            fs.renameSync(vendorBackup, vendorDir);
          }
        } catch (rollbackErr) {
          console.error(`[dsh-desktop] 回滚也失败: ${rollbackErr.message}`);
        }
        reject(new Error(`升级文件操作失败: ${swapErr.message}`));
      }
    });
  });
}

// IPC 处理器：渲染进程触发升级
ipcMain.handle('do-upgrade', async () => {
  if (!latestVersion) {
    throw new Error('无可用更新');
  }
  try {
    await performUpgrade(latestVersion);
    return { success: true, version: latestVersion };
  } catch (err) {
    console.error(`[dsh-desktop] 升级失败: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPC 处理器：获取版本信息
ipcMain.handle('get-version-info', () => {
  return {
    current: readCurrentVersion(),
    latest: latestVersion,
  };
});

// IPC 处理器：检查更新（用户手动触发）
ipcMain.handle('check-for-updates', async () => {
  upgradeChecked = false; // 允许重新检查
  await checkForUpdates();
  return {
    current: readCurrentVersion(),
    latest: latestVersion,
    updateAvailable: latestVersion && compareVersions(readCurrentVersion(), latestVersion) > 0,
  };
});

// IPC 处理器：重启应用（升级完成后）
ipcMain.handle('relaunch-app', () => {
  app.relaunch();
  app.exit(0);
});

// ========== 兜底：确保 dsh web 服务在跑 ==========
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

// ========== 窗口 ==========
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

// ========== 托盘 ==========
function createTray() {
  tray = new Tray(nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64));
  tray.setToolTip('DeepSeek Harness');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => {
        if (!mainWindow) { createWindow(); return; }
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      } },
    { type: 'separator' },
    { label: '检查更新', click: async () => {
        upgradeChecked = false;
        await checkForUpdates();
        if (latestVersion && compareVersions(readCurrentVersion(), latestVersion) > 0) {
          const result = await dialog.showMessageBox(mainWindow || undefined, {
            type: 'info',
            title: '更新可用',
            message: `新版本 v${latestVersion} 可用，当前 v${readCurrentVersion()}，是否升级？`,
            buttons: ['立即升级', '稍后再说'],
            defaultId: 0,
          });
          if (result.response === 0) {
            try {
              await performUpgrade(latestVersion);
              dialog.showMessageBox(mainWindow || undefined, {
                type: 'info',
                title: '升级完成',
                message: '升级完成，需要重启应用才能生效，是否立即重启？',
                buttons: ['立即重启', '稍后再说'],
                defaultId: 0,
              }).then((r) => {
                if (r.response === 0) {
                  app.relaunch();
                  app.exit(0);
                }
              });
            } catch (err) {
              dialog.showErrorBox('升级失败', err.message);
            }
          }
        }
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

// ========== 生命周期 ==========
app.whenReady().then(async () => {
  // 打包后 __dirname 在只读的 asar 内，日志/pid 必须落到 userData 可写目录
  if (app.isPackaged) {
    process.env.DSH_DESKTOP_DATA_DIR = app.getPath('userData');
  }
  await ensureDshServer();
  createWindow();
  createTray();

  // 异步版本检查（不阻塞启动）
  setTimeout(() => checkForUpdates(), 3000); // 延迟 3 秒，让窗口先加载完毕

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // 有托盘时保持后台运行（macOS 惯例）；真正退出由托盘菜单触发
  if (process.platform !== 'darwin' && app.isQuiting) app.quit();
});

app.on('before-quit', (e) => {
  app.isQuiting = true;
  // 结束 dsh web 服务（本应用拉起的 + 监听 3080 的外部实例），异步等待完成后真正退出
  if (!app._dshStopping) {
    app._dshStopping = true;
    e.preventDefault();
    stopDshServer(PORT)
      .catch(() => {})
      .finally(() => {
        app.quit();
      });
  }
});