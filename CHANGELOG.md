# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 自动安装 dsh 失败的场景下，提示手动 `npm i -g @deepseek-ai/dsh` 的指引。

## [0.1.0] - 2026-08-13

### Added
- Electron 桌面壳：加载 DeepSeek Harness Web GUI（`dsh web`，`127.0.0.1:3080`）。
- `npm start` 前置 `ensure-dsh.js`：自动定位 dsh（DSH_BIN → PATH → npx 缓存 → 常见位置 → 工程内 vendor）。
- **自动安装 dsh**：本地没有时，`npm install --prefix vendor/dsh @deepseek-ai/dsh`，开箱即用。
- 服务生命周期管理：探测端口复用已有实例；无实例时拉起常驻服务（detached，日志落 `logs/`）。
- macOS 托盘：点红点隐藏到托盘、托盘菜单显示/隐藏/退出；退出不杀常驻 dsh web。
- DeepSeek 官方鲸鱼图标：应用图标（.icns）与托盘图标。
- electron-builder 打包配置：`.app` / dmg / zip。

[Unreleased]: https://github.com/longyu065/dsh-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/longyu065/dsh-desktop/releases/tag/v0.1.0
