# 琉璃 · Liuli Theme

DeepSeek Harness 的 **DenpaPush（电波推送）风格界面主题**插件。
复刻电波推送 dashboard 的视觉语言：M3 动态取色、壁纸磨砂材质、声纹可视化、
日/夜圆形遮罩切换——并把整个主题做成一个可独立安装、可 git 发布的插件包。

> 包名 `@deepseek-ai/liuli-theme` · 版本 `0.1.0`（发布名 **liuli-theme**，版本 **0.1**）

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 🎨 M3 动态取色 | 从壁纸提取 Material 3 调色板（material-color-utilities），映射为 `--dsw-alias-*` 令牌；亮/暗双主题独立派生 |
| 🖼️ 壁纸背景 | 上传图片 → 压缩为 dataURL 持久化到 localStorage；壁纸模式 + 暗色遮罩（仅暗色主题叠加） |
| 🪟 磨砂材质 | 亚克力 / 云母两种材质，透明度、模糊强度可调（backdrop-filter 与噪声纹理） |
| 🔊 声纹可视化 | 会话 header 背景 canvas：空闲态品牌色流动波形；点击按钮经 `getDisplayMedia` 授权后监听系统/标签页音频，真实频谱驱动柱状图与波形振幅 |
| 🌗 日/夜切换 | header 圆形按钮 + 设置页外观行，`startViewTransition` 圆形遮罩过渡 |
| 📏 header 拉伸 | header 底部垂直拖拽手柄，高度记忆到 localStorage，刷新/切换会话自动恢复 |
| ⚙️ 设置「界面」分区 | 16 项设置（取色/背景/材质/字体/圆角/泛光/阴影/壁纸），即时生效、自动保存 |

全部设置随浏览器持久化（`denpa:settings` / `denpa:wallpaper` / `denpa:header-height`），不依赖服务端。

## 安装

插件随 Harness 客户端包构建；在 web-app 的浏览器插件清单（`cordis.patch.yml` 的 `dsh.client` 行区）加入：

```yaml
- id: liuli-theme
  name: '@deepseek-ai/liuli-theme'
```

宿主会从 `/plugins/@deepseek-ai/liuli-theme/client.js` 服务并自动加载。移除该行即回到素版外观（shell 的
外观行降级为直连切换，无圆形遮罩）。

依赖宿主主题服务（`ctx.theme`，由 `dsh-client-ui-theme` 提供）：偏好持久化与 `theme/change` 事件由
宿主承担，本插件只消费。host 侧无任何行为（纯 UI 插件）。

## 构建

```bash
pnpm --filter @deepseek-ai/liuli-theme bundle
```

产出 `lib/index.js`（node 半）+ `lib/client.js`（浏览器半，closure-factory 产物）。

## 结构

```
packages/client/liuli-theme/
├── package.json              # 包声明：dsh.client.inject 平台模块、exports["./client"]
├── tsdown.config.ts          # clientBundle 预设（node 半 + 浏览器半）
├── src/
│   ├── index.ts              # node 半：空 apply（使插件进入宿主 Loader）
│   ├── invariant.ts          # 包级 invariant 伴生（无运行时检查）
│   └── client/
│       ├── index.ts          # 浏览器入口：CSS 注入 + 设置分区 + 事件桥 + header slots
│       ├── denpa.css         # 主题令牌源（亮/暗双主题 + 铬色样式 + 圆形遮罩动画）
│       ├── denpa-css.ts      # denpa.css 的字符串化拷贝（运行时注入 <style>，幂等）
│       ├── denpa-settings.ts # 16 项设置 schema 与默认值
│       ├── denpa-store.ts    # 设置表单 store（ui-slots EngineStore）
│       ├── denpa-palette.ts  # M3 调色板 → DSH 令牌映射（body 内联变量）
│       ├── denpa-runtime.ts  # 设置应用运行时（含 isDark 竞态保护 + seq 令牌）
│       ├── DenpaAppearance.tsx / .module.css   # 设置页「界面」分区
│       ├── HeaderEffects.tsx / .module.css     # 声纹/监听/主题切换/拉伸手柄（单例引擎）
│       ├── locales.ts        # denpa-appearance 文案（zh/en）
│       └── vendor/material-color-utilities.js  # Material 3 取色库（vendored）
└── README.md
```

## 与宿主 shell 的配合

主题是运行时注入的，但宿主 shell 保留了少量配套：

- `dsh-client-ui-conversation`：header 的 `.titleRow` 带 `position: relative; z-index: 1`，
  使插件注入的声纹背景 canvas（absolute, z-index: 0）铺满 header 而标题行浮于其上；
  `header.actions / header.utilities / header.tabs` 三个 slot 就是本插件四个 header 组件的挂点。
- `dsh-client-ui-theme`：Appearance 外观行点击时 dispatch `denpa:set-theme`（带坐标），
  由本插件的事件桥接 `startViewTransition` 圆形遮罩；桥未就绪时降级直连切换。

## 许可

MIT
