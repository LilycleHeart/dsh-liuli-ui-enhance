# 琉璃 · dsh-liuli-ui-enhance

<div align="center">

[GitHub](https://github.com/LilycleHeart/dsh-liuli-ui-enhance) ｜ [简体中文](README.md) ｜ [English](README_EN.md)

<br>

<img src="https://img.shields.io/badge/version-0.1.0-8b5cf6.svg" alt="version">
<img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license">
<img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript">
<img src="https://img.shields.io/badge/React-18-61dafb.svg" alt="React">
<img src="https://img.shields.io/badge/ESM-yes-yellow.svg" alt="ESM">

<br>
<br>

DeepSeek Harness 的 **Material Design 3 × Fluent 2 融合主题**插件：动态取色、壁纸磨砂、声纹可视化、Dockable 工作台。

</div>

## 截图

![开始页亮色预览](docs/preview-start-light.png)

## 特性

- 🎨 M3 动态取色
- 🖼️ 壁纸与磨砂材质
- 🔊 声纹可视化
- 🌗 日/夜切换
- 🧩 Dockable 工作台
- 🖥️ 右侧边栏
- 🌐 内嵌浏览器
- 🎛️ 无边框窗口按钮
- 🎯 元素选择器
- 🔍 开发者工具（悬浮球，Electron 侧边 DevTools）
- ⚙️ 21 项界面设置（含面板留白滑条、状态色来源）

完整功能见 [docs/features.md](docs/features.md)。

## 安装

> 前置条件：已安装 [Node.js](https://nodejs.org) 20+ 与 [pnpm](https://pnpm.io/installation)，
> 且启动过一次 DSH Desktop（首次启动会生成 `~/.dsh/profiles/desktop`）。

```bash
pnpm install            # 首次：安装依赖并构建 lib/（install:desktop 也会自动补这步）
pnpm install:desktop
pnpm patch:desktop      # 推荐：win32 无边框补丁（自动补丁失败不阻断插件）
```

> 插件尚未发布到 npm，DSH 内置市场也不接受 GitHub 安装目标；请使用本仓库的
> `pnpm install:desktop` 手动安装。

详见 [docs/install.md](docs/install.md)。

## 文档

- [功能详解](docs/features.md)
- [样式规范](docs/style-guide.md)
- [安装与构建](docs/install.md)
- [浏览器自动化](docs/browser-use.md)

## License

MIT
