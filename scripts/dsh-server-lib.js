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

// 日志目录：优先 DSH_DESKTOP_DATA_DIR（打包后指向 app userData，可写），
// 否则退回工程下 logs/（开发模式，当前工作区可写）。
function getLogDir() {
  const base = process.env.DSH_DESKTOP_DATA_DIR || path.join(__dirname, '..');
  const dir = path.join(base, 'logs');
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
// 查找顺序：DSH_BIN → PATH → npx 缓存 → 常见位置 → 自安装(vendor) → 预装(extraResources)。
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

  // 5) 自安装 vendor（自动安装目录，见 ensureDshBin）
  const vendorBin = getVendorBin();
  if (fs.existsSync(vendorBin)) return vendorBin;

  // 6) 打包 preload 的 dsh（extraResources 里的预装版）
  //    开发模式没有 resourcesPath，跳过。
  const extraBin = path.join(process.resourcesPath || '', 'vendor', 'dsh', 'node_modules', '.bin', 'dsh');
  if (extraBin.startsWith('/') && fs.existsSync(extraBin)) return extraBin;

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

// 解析 node 可执行文件真实路径（打包 app 从 Finder 启动时 PATH 精简，找不到 node）
function resolveNodeBin() {
  if (process.env.DSH_NODE_BIN) return process.env.DSH_NODE_BIN;
  const which = spawnSync('sh', ['-lc', 'command -v node'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const common = [
    path.join(os.homedir(), '.local', 'bin', 'node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 构造 spawn 环境：把常见 bin 目录注入 PATH，供 dsh 内部子进程使用。
// 用 process.execPath 执行时不再依赖系统 node，但 dsh 内部可能用 git/brew 等。
function buildSpawnEnv(port) {
  const extraDirs = [
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
  ].filter(Boolean);
  const PATH = [...new Set([...extraDirs, process.env.PATH || ''])].filter(Boolean).join(':');
  return { ...process.env, PATH, PORT: String(port) };
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
//
// 核心：用 process.execPath（Electron 主进程）作为 node 来执行 dsh——
// 打包后 .app 的 process.execPath = Electron 可执行文件（内置 Node.js），
// 不依赖系统 PATH 中的 node，也不依赖 dsh 的 shebang（#!/usr/bin/env node）。
// 开发模式下 process.execPath = 系统 node，同样有效。
function spawnDshServer(port) {
  const logDir = getLogDir();
  const outFd = fs.openSync(path.join(logDir, 'dsh-web.stdout.log'), 'a');
  const errFd = fs.openSync(path.join(logDir, 'dsh-web.stderr.log'), 'a');
  const dshCmd = ensureDshBin();
  const env = buildSpawnEnv(port);

  console.log(`[dsh-server] 使用 process.execPath 执行 dsh: ${dshCmd}`);
  const proc = spawn(process.execPath, [dshCmd, 'web'], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env,
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

// 校验某 pid 确实是 dsh 进程（防止 pid 被系统复用后误杀其他程序）。
// ps 可用时严格校验命令行；ps 不可用（受限环境）时按 pid 文件信任（存活即视为 dsh）。
function isDshProcess(pid) {
  try { process.kill(pid, 0); } catch (_) { return false; } // 进程不存在
  try {
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (out.status === 0 && out.stdout) return /dsh/.test(out.stdout);
    return true; // ps 不可用 → 信任 pid 文件
  } catch (_) {
    return true;
  }
}

// 找出监听指定端口的进程 pid 列表（macOS/Linux 用 lsof，Windows 用 netstat）
function findPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
      if (out.status !== 0) return [];
      const pids = new Set();
      for (const line of out.stdout.split('\n')) {
        if (line.includes(`:${port}`) && /LISTENING|ESTABLISHED/.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (/^\d+$/.test(pid)) pids.add(Number(pid));
        }
      }
      return [...pids];
    }
    const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
    if (out.status !== 0) return [];
    return out.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
  } catch (_) {
    return [];
  }
}

// 结束单个进程：SIGTERM 优雅退出，超时后 SIGKILL
async function killProcess(pid, timeoutMs) {
  try { process.kill(pid, 'SIGTERM'); } catch (_) { return; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // 存活则继续等
      await new Promise((r) => setTimeout(r, 200));
    } catch (_) {
      return; // 已退出
    }
  }
  try { process.kill(pid, 'SIGKILL'); } catch (_) {}
}

// 结束 dsh web 服务（应用退出时调用）。
// 覆盖两类进程：① logs/dsh-web.pid 记录的（本应用拉起的）；② 当前监听目标端口的 dsh 进程
// （复用的外部实例也会被结束，保证关掉应用后 3080 不再可访问）。
async function stopDshServer(port = DEFAULT_PORT, timeoutMs = 4000) {
  const stopped = new Set();

  // ① pid 文件记录的（本应用拉起的）
  const pidFile = path.join(getLogDir(), 'dsh-web.pid');
  let pid = null;
  try {
    pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  } catch (_) {}
  try { fs.unlinkSync(pidFile); } catch (_) {}
  if (pid && Number.isFinite(pid) && pid > 0 && isDshProcess(pid)) {
    console.log(`[dsh-server] 应用退出，结束本应用拉起的 dsh web (pid=${pid}) ...`);
    await killProcess(pid, timeoutMs);
    stopped.add(pid);
  }

  // ② 监听目标端口的 dsh 进程（含复用的外部实例）
  const portPids = findPidsOnPort(port);
  for (const ppid of portPids) {
    if (stopped.has(ppid)) continue;
    if (!isDshProcess(ppid)) continue; // 非 dsh 进程不误杀
    console.log(`[dsh-server] 应用退出，结束监听端口 ${port} 的 dsh web (pid=${ppid}) ...`);
    await killProcess(ppid, timeoutMs);
    stopped.add(ppid);
  }

  if (stopped.size === 0) {
    console.log('[dsh-server] 没有需要结束的 dsh web 进程（端口未被占用）');
  } else {
    console.log(`[dsh-server] ✅ 已结束 ${stopped.size} 个 dsh web 进程`);
  }
  return true;
}

module.exports = {
  DEFAULT_PORT,
  POLL_ATTEMPTS,
  POLL_INTERVAL,
  probePort,
  waitForServer,
  spawnDshServer,
  stopDshServer,
  findPidsOnPort,
  resolveDshBin,
  ensureDshBin,
  resolveNodeBin,
  buildSpawnEnv,
  getLogDir,
};
