#!/usr/bin/env node
'use strict';
// npm start 的前置步骤：判断本地 dsh web 是否已启动，没有则拉起并等待就绪。
// 退出码：0 = 服务就绪（可继续启动 Electron）；非 0 = 失败（中止启动）。
const {
  DEFAULT_PORT,
  POLL_ATTEMPTS,
  POLL_INTERVAL,
  probePort,
  waitForServer,
  spawnDshServer,
} = require('./dsh-server-lib');

const PORT = Number(process.env.DSH_DESKTOP_PORT || DEFAULT_PORT);

(async () => {
  if (await probePort(PORT)) {
    console.log(`[ensure-dsh] ✅ dsh web 已在端口 ${PORT} 运行，直接复用`);
    process.exit(0);
  }

  console.log(`[ensure-dsh] ⏳ 端口 ${PORT} 无服务，正在拉起 dsh web ...`);
  let proc;
  try {
    proc = spawnDshServer(PORT);
  } catch (err) {
    console.error(`[ensure-dsh] ❌ ${err.message}`);
    process.exit(1);
  }

  const ok = await waitForServer(PORT);
  if (!ok) {
    console.error(
      `[ensure-dsh] ❌ dsh web 未在 ${(POLL_ATTEMPTS * POLL_INTERVAL) / 1000}s 内就绪。` +
        `请检查 logs/dsh-web.stderr.log`
    );
    process.exit(1);
  }
  console.log(`[ensure-dsh] ✅ dsh web 已就绪（pid=${proc.pid}，端口 ${PORT}），日志在 logs/ 下`);
  process.exit(0);
})();
