# 官方 DeepSeek Harness Desktop 0.1.7-rc.2 适配

本分支以官方 `@deepseek-ai/dsh-desktop` 0.1.7-rc.2 为目标，保留原 `beta` 分支供社区 DSH Desktop 2.0.13 使用。插件包版本为 `0.1.2-rc.3`，只声明与 dsh 0.1.7-rc.2 兼容。

## 接口迁移

- 会话列表不再携带 `current`。琉璃从 `retainedBy.mainView` 识别主视图会话，并通过 `uiWorkspace.openSession()` 导航。
- 后台作业由 Job Controller 提供；开发者工具面板订阅其会话作业流。完成提醒由 `uiSession.sessionStatus` 提供。
- 根布局使用 `main` 和 `rightbar` 槽位；PTC 子调用使用 `tool/ptc-dispatch-*` 事件。
- 图标名称、代码块文案和 dockkit 依赖已更新到 0.1.7-rc.2。琉璃禁用 dockkit 装饰性标签滚动渐隐的补丁保留在新版包上。

## 官方桌面壳边界

旧版的无边框补丁只允许在应用包名为 `dsh-plugin-desktop` 的社区客户端上运行。官方桌面端包名为 `@deepseek-ai/dsh-desktop`；插件在其 Host 中不会修改 `app.asar` 或执行补丁还原。

官方桌面端保留自己的标题栏和窗口控制。依赖社区壳私有窗口能力的操作需要在真实桌面端逐项验证，不能以编译通过代替功能验收。

## 构建与验证

在本分支运行 `pnpm install`、`pnpm run build`，再以 `pnpm pack` 生成本地安装包。安装到官方端后，检查插件行状态、设置页、会话与右栏、壁纸和主题切换，并重启确认持久化。测试前备份 profile；若启动失败，可从官方恢复对话框停用第三方插件，再恢复旧包。

当前已通过 TypeScript 检查与完整构建。官方桌面端的交互验收仍需完成。
