# 官方 DeepSeek Harness Desktop 0.1.7-rc.2 适配

本分支以官方 `@deepseek-ai/dsh-desktop` 0.1.7-rc.2 为目标，保留原 `beta` 分支供社区 DSH Desktop 2.0.13 使用。插件包版本为 `0.1.2-rc.5`，只声明与 dsh 0.1.7-rc.2 兼容。

## 接口迁移

- 会话列表不再携带 `current`。琉璃从 `retainedBy.mainView` 识别主视图会话，并通过 `uiWorkspace.openSession()` 导航。
- 后台作业由 Job Controller 提供；开发者工具面板订阅其会话作业流。完成提醒由 `uiSession.sessionStatus` 提供。
- 根布局使用 `main` 和 `rightbar` 槽位；PTC 子调用使用 `tool/ptc-dispatch-*` 事件。
- 官方 0.1.7 将会话页头改为根作用域 `conversation.header`；独立页头面板按新槽位搬移真实 `<header>`，避免顶部空卡片和正文内重复页头。
- 图标名称、代码块文案和 dockkit 依赖已更新到 0.1.7-rc.2。琉璃禁用 dockkit 装饰性标签滚动渐隐的补丁保留在新版包上。

## 官方桌面壳边界

旧版的无边框补丁只允许在应用包名为 `dsh-plugin-desktop` 的社区客户端上运行。官方桌面端包名为 `@deepseek-ai/dsh-desktop`；插件在其 Host 中不会修改 `app.asar` 或执行补丁还原。

默认保留官方标题栏。需要琉璃悬浮按钮时，可显式运行独立的 Windows 官方壳补丁；它只支持 0.1.7-rc.2，不会由插件自动执行。

```powershell
node scripts/patch-official-window-controls.mjs --check
# 完全退出官方桌面端后应用，再启动桌面端
node scripts/patch-official-window-controls.mjs --apply
# 完全退出后恢复原壳
node scripts/patch-official-window-controls.mjs --revert
```

补丁备份安装目录内的 EXE 和 app.asar 到 `liuli-window-controls-backup-0.1.7-rc.2`。它修改主窗口为无边框、增加四项窗口动作的 IPC 白名单，沿用官方发送者校验，并同步 ASAR 哈希；修改后的 EXE 不再匹配厂商原签名。应用升级会覆盖补丁，新版本必须重新适配，不能直接套用。还原时检查文件哈希，拒绝覆盖已升级的应用。

插件识别官方桥接后启用右上角悬浮胶囊：平时隐藏，移入右上角显示。左上角菜单预留独立一行，避免与 Logo 重叠。插件未加载时，预加载脚本提供常驻窗口按钮兜底。

## 构建与验证

在本分支运行 `pnpm install`、`pnpm run build`，再以 `pnpm pack` 生成本地安装包。安装到官方端后，检查插件行状态、设置页、会话与右栏、壁纸和主题切换，并重启确认持久化。测试前备份 profile；若启动失败，可从官方恢复对话框停用第三方插件，再恢复旧包。

当前已通过 TypeScript 检查与完整构建。0.1.2-rc.5 已安装到官方桌面端；真实窗口验证悬浮唤出、隐藏、最大化、向下还原及最小化后恢复。左上角菜单与 Logo 已分行。此前 rc.4 已确认顶部空白页头消失，标题与声纹在同一页头卡片中显示。关闭到托盘、设置页、会话切换和右栏交互的完整验收仍需完成。
