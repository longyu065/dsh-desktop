# dsh-desktop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/longyu065/dsh-desktop/releases/tag/v0.1.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)]()

**中文** | [English](README.md)

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI（`dsh web`，本地 `127.0.0.1:3080`）包装成桌面应用（Electron 壳）。
**开箱即用**：拿过去只要 `npm install && npm start`，无需预装 dsh——没有会自动安装。

## 功能特性

- 🚀 **开箱即用**：自动定位/安装 `dsh`（`@deepseek-ai/dsh`），无需任何前置配置
- 🖥️ **原生桌面体验**：独立窗口 + macOS 菜单栏托盘（点红点隐藏、托盘显示/隐藏/退出）
- 🔄 **智能服务管理**：复用已有 `dsh web` 实例；没有则自动拉起服务，**退出应用时结束自己拉起的服务**
- 🐋 **DeepSeek 官方图标**：应用图标与托盘图标均为官方鲸鱼标识
- 📦 **一键打包**：electron-builder 产出 macOS `.app` / dmg / zip 与 Windows NSIS 安装包 / zip

## 原理

- `npm start` 先执行 `scripts/ensure-dsh.js`：
  1. **定位 dsh**（`resolveDshBin`，顺序）：`DSH_BIN` 环境变量 → PATH 中的 `dsh` →
     `~/.npm/_npx/*/node_modules/.bin/dsh` → 常见安装位置 → 工程内 `vendor/dsh`；
  2. **没有 dsh → 自动安装**（`ensureDshBin`）：`npm install --prefix vendor/dsh @deepseek-ai/dsh`，
     装进工程内 `vendor/`，不污染全局、不依赖用户 PATH（首次约 1-2 分钟）；
  3. 探测 `127.0.0.1:3080`——已有实例（命令行/本 GUI 启动的）→ "直接复用"；
     没有 → `spawn(dsh, ['web'])` 拉起**常驻**服务（detached，日志落 `logs/`），轮询就绪后启动 Electron。
- Electron 只当客户端：加载页面、托盘常驻（点红点隐藏，托盘菜单显示/隐藏/退出）。
- **退出 Electron 时结束本应用拉起的 dsh web**（通过 `logs/dsh-web.pid` 精确停止，并校验进程确为 dsh，防止 pid 复用误杀）。
  外部启动的实例（如终端命令行启动的）不受影响。
- 直接 `electron .`（`npm run start:raw`，跳过前置脚本）时，主进程也会兜底定位/安装/拉起。

## 开发运行

```bash
cd dsh-desktop
npm install        # 安装 electron（含二进制下载）
npm start          # 自动定位/安装 dsh → 确保服务在跑 → 打开桌面应用
```

> 手动指定 dsh：`DSH_BIN=/path/to/dsh npm start`。安装日志在 `vendor/dsh` 安装时的终端输出，
> 运行日志在 `logs/dsh-web.{stdout,stderr}.log`。

### 安装时的两个环境变通点（部分机器曾遇到）

1. `~/.npm` 缓存目录被 root 占用会导致 `npm install` 报 `EPERM`。临时方案：
   `npm install --cache /path/to/writable/npm-cache`
2. Electron 二进制下载默认写 `~/Library/Caches/electron`，若不可写，用
   `electron_config_cache` 指定替代缓存目录（install.js 读取的是这个变量，不是 `ELECTRON_CACHE`）：
   `electron_config_cache=/path/to/.electron-cache node node_modules/electron/install.js`

日常 `npm start` 在正常终端环境下无需这些变通。

## 打包

```bash
npm run dist        # macOS：dmg + zip
npm run dist:win    # Windows：NSIS 安装包 + zip（可从 macOS 交叉编译）
npm run dist:all    # 两者都打
```

打包说明：

- 开发/日常使用直接 `npm start` 即可；
- 发布版打包时**不包含** `vendor/dsh`（体积大），目标机器首次 `npm start` 会自动安装。
  如需完全离线自包含，可发布前把 `vendor/dsh` 一并打进 `extraResources`，并在主进程按
  `process.resourcesPath` 解析后传给 `DSH_BIN`。

## 目录结构

```
dsh-desktop/
├── package.json        # electron 依赖 + start/dist 脚本 + 打包配置
├── scripts/
│   ├── ensure-dsh.js   # start 前置：定位/安装 dsh → 探测 3080 → 无则拉起常驻服务
│   └── dsh-server-lib.js # 公共逻辑：dsh 定位/自动安装 / 端口探测 / 等待就绪 / 拉起
├── electron/
│   ├── main.js         # 主进程：兜底定位/安装/拉起、窗口、托盘（不管理服务生命周期）
│   └── preload.js      # 最小预加载桥（只读版本信息）
├── vendor/dsh/         # 自动安装的 dsh（首次 start 生成，可删，下次会自动重装）
├── logs/               # dsh web 运行日志与 pid（运行时生成）
├── build/              # 应用图标（icon.icns / icon.ico / icon.png）
└── release/            # 打包产物（electron-builder 输出）
```

## License

[MIT](LICENSE) © 2026 tiankunrui
