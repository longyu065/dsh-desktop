'use strict';
// dsh web 服务探测与拉起的公共逻辑，供 ensure-dsh.js 与 electron/main.js 复用。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 3080;
const POLL_ATTEMPTS = 60;   // 最多等 60 秒
const POLL_INTERVAL = 1000; // 每秒探测一次

// 日志目录：工程下 logs/（当前工作区可写，避免依赖 ~/Library 权限）
function getLogDir() {
  const dir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 探测某端口是否有 HTTP 服务就绪
function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
      (res) => { res.resume(); resolve(true); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 轮询等待端口就绪，返回是否成功
async function waitForServer(port) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (await probePort(port)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  return false;
}

// 解析 dsh 可执行文件的真实路径（不依赖调用方 PATH），找不到返回 null。
// 查找顺序：DSH_BIN 显式指定 → PATH 中的 dsh → npx 缓存 → 常见安装位置。
function resolveDshBin() {
  // 1) 显式指定（最高优先级）
  if (process.env.DSH_BIN) return process.env.DSH_BIN;

  // 2) PATH 中查找（通过 sh -lc 走用户登录 shell 的 PATH）
  const which = spawnSync('sh', ['-lc', 'command -v dsh'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();

  // 3) npx 缓存：~/.npm/_npx/<hash>/node_modules/.bin/dsh（取最新的一个）
  const npxRoot = path.join(os.homedir(), '.npm', '_npx');
  try {
    if (fs.existsSync(npxRoot)) {
      const candidates = fs
        .readdirSync(npxRoot)
        .map((d) => path.join(npxRoot, d, 'node_modules', '.bin', 'dsh'))
        .filter((p) => fs.existsSync(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    }
  } catch (_) {}

  // 4) 常见安装位置兜底
  const common = [
    path.join(os.homedir(), '.local', 'bin', 'dsh'),
    '/usr/local/bin/dsh',
    '/opt/homebrew/bin/dsh',
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }

  // 5) 工程内 vendor（自动安装目录，见 ensureDshBin）
  const vendorBin = getVendorBin();
  if (fs.existsSync(vendorBin)) return vendorBin;

  return null;
}

// 工程内自动安装的 dsh 可执行文件路径：<工程>/vendor/dsh/node_modules/.bin/dsh
function getVendorBin() {
  return path.join(__dirname, '..', 'vendor', 'dsh', 'node_modules', '.bin', 'dsh');
}

// 在 PATH 中定位 npm（跨 sh -lc，覆盖 GUI 精简环境）
function findNpm() {
  const which = spawnSync('sh', ['-lc', 'command -v npm'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

// 确保 dsh 可用：有则返回其路径；没有则自动安装到工程内 vendor/dsh 并返回路径。
// 自动安装不污染全局、不依赖用户 PATH，首次启动多花一两分钟。
function ensureDshBin() {
  const found = resolveDshBin();
  if (found) return found;

  const npmPath = findNpm();
  if (!npmPath) {
    throw new Error('未找到 dsh 且未找到 npm，无法自动安装。请先安装 Node.js 或手动执行 npm i -g @deepseek-ai/dsh');
  }

  const vendorDir = path.join(__dirname, '..', 'vendor', 'dsh');
  console.log('[dsh-server] 未找到 dsh，正在自动安装 @deepseek-ai/dsh 到 vendor/dsh ...（首次约 1-2 分钟）');
  fs.mkdirSync(vendorDir, { recursive: true });
  const res = spawnSync(npmPath, ['install', '--prefix', vendorDir, '@deepseek-ai/dsh'], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  if (res.status !== 0) {
    throw new Error(`自动安装 dsh 失败（npm exit=${res.status}）。可手动执行：npm i -g @deepseek-ai/dsh`);
  }
  if (!fs.existsSync(getVendorBin())) {
    throw new Error('安装完成但未找到 dsh 可执行文件，请手动执行：npm i -g @deepseek-ai/dsh');
  }
  console.log('[dsh-server] ✅ dsh 已安装到 vendor/dsh');
  return getVendorBin();
}

// 拉起常驻的 dsh web（detached + unref，不随调用方退出），返回子进程。
// 日志落盘 logs/dsh-web.{stdout,stderr}.log，pid 写入 logs/dsh-web.pid。
// 找不到 dsh 时自动安装（见 ensureDshBin），仍失败则抛出带指引的错误。
function spawnDshServer(port) {
  const logDir = getLogDir();
  const outFd = fs.openSync(path.join(logDir, 'dsh-web.stdout.log'), 'a');
  const errFd = fs.openSync(path.join(logDir, 'dsh-web.stderr.log'), 'a');
  const dshCmd = ensureDshBin();
  console.log(`[dsh-server] 使用 dsh: ${dshCmd}`);
  const proc = spawn(dshCmd, ['web'], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env, PORT: String(port) },
  });
  proc.on('error', (err) => {
    console.error(`[dsh-server] 无法启动 ${dshCmd}: ${err.message}`);
  });
  try {
    fs.writeFileSync(path.join(logDir, 'dsh-web.pid'), String(proc.pid));
  } catch (_) {}
  proc.unref();
  return proc;
}

module.exports = {
  DEFAULT_PORT,
  POLL_ATTEMPTS,
  POLL_INTERVAL,
  probePort,
  waitForServer,
  spawnDshServer,
  resolveDshBin,
  ensureDshBin,
  getLogDir,
};
