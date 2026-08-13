# dsh-desktop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/longyu065/dsh-desktop/releases/tag/v0.1.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)]()

**English** | [中文](README.zh.md)

A desktop shell (Electron) for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI (`dsh web`, served at `127.0.0.1:3080` by default).
**Zero-config**: clone it, run `npm install && npm start` — if `dsh` isn't installed, the app installs it for you.

## Features

- 🚀 **Zero-config startup** — auto-locates or auto-installs `dsh` (`@deepseek-ai/dsh`); no prerequisites beyond Node.js
- 🖥️ **Native desktop experience** — standalone window + macOS menu-bar tray (hide-to-tray on close; show/hide/quit from the tray)
- 🔄 **Smart server management** — reuses an existing `dsh web` instance; spawns a resident server when none is running; keeps it alive after the app quits
- 🐋 **Official DeepSeek icon** — app and tray icons use the official whale mark
- 📦 **One-command packaging** — electron-builder produces `.app` / dmg / zip for macOS and an NSIS installer + zip for Windows

## How it works

`npm start` first runs `scripts/ensure-dsh.js`:

1. **Locate `dsh`** (`resolveDshBin`, in order): `DSH_BIN` env var → `dsh` on `PATH` → `~/.npm/_npx/*/node_modules/.bin/dsh` → common install locations → project-local `vendor/dsh`
2. **No `dsh`? Auto-install** (`ensureDshBin`): runs `npm install --prefix vendor/dsh @deepseek-ai/dsh` into the project — no global install, no dependence on the user's `PATH` (first run takes ~1–2 min)
3. **Probe `127.0.0.1:3080`** — an existing instance (started by CLI or this app) is reused; otherwise a **resident** server is spawned (`detached`, logs to `logs/`) and the app waits until the port is ready before opening the window.

The Electron process is a pure client: it loads the page and owns the tray. Quitting the app does **not** kill `dsh web` — the server stays resident so the next `npm start` opens instantly. Stop it with `pkill -f "dsh web"`.

Running `electron .` directly (`npm run start:raw`, skipping the preflight) still triggers the same locate/install/spawn fallback from the main process.

## Getting started

```bash
cd dsh-desktop
npm install        # installs Electron (downloads binary)
npm start          # locate/install dsh → ensure server → open the app
```

> Pin a specific dsh binary: `DSH_BIN=/path/to/dsh npm start`.
> Install output goes to your terminal during `vendor/dsh` setup; runtime logs live in `logs/dsh-web.{stdout,stderr}.log`.

### Known environment quirks (seen on some machines)

1. `~/.npm` cache owned by root breaks `npm install` with `EPERM`. Workaround:
   `npm install --cache /path/to/writable/npm-cache`
2. Electron's binary download writes to `~/Library/Caches/electron` by default; if that's not writable, point it elsewhere with
   `electron_config_cache` (note: this is the variable `install.js` reads — not `ELECTRON_CACHE`):
   `electron_config_cache=/path/to/.electron-cache node node_modules/electron/install.js`

None of these matter for a normal `npm start`.

## Packaging

```bash
npm run dist        # macOS: dmg + zip
npm run dist:win    # Windows: NSIS installer + zip (cross-compile from macOS)
npm run dist:all    # both
```

Notes:

- For everyday use just `npm start`.
- Released builds do **not** bundle `vendor/dsh` (it's large); the target machine auto-installs it on first `npm start`.
  For a fully offline, self-contained build, ship `vendor/dsh` via `extraResources` and point `DSH_BIN` at `process.resourcesPath` in the main process.

## Project layout

```
dsh-desktop/
├── package.json          # deps, start/dist scripts, build config
├── scripts/
│   ├── ensure-dsh.js     # preflight: locate/install dsh → probe 3080 → spawn resident server
│   └── dsh-server-lib.js # shared logic: dsh locate/install, port probe, readiness wait, spawn
├── electron/
│   ├── main.js           # main process: fallback locate/install/spawn, window, tray
│   └── preload.js        # minimal preload bridge (read-only version info)
├── vendor/dsh/           # auto-installed dsh (created on first start; safe to delete)
├── logs/                 # dsh web logs & pid (runtime)
├── build/                # app icons (icon.icns, icon.ico, icon.png)
└── release/              # packaging output (electron-builder)
```

## License

[MIT](LICENSE) © 2026 tiankunrui
