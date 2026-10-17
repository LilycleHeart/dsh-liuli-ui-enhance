# 琉璃适配 DSH 0.2.1-rc.2

本次以已安装的 `dsh-liuli-ui-enhance@0.1.2-rc.33` 对应源码为基线（`8fe1eb532972f413801b19a8884dba11ef1eadd8`，分支 `codex/dsh-020-rc2-compat`），升级到 `0.1.2-rc.34`。目标为官方 Windows Desktop 内置的 DSH `0.2.1-rc.2`。旧 `beta` 工作目录及其未提交修改未参与本次迁移。

## 变更

- DSH 开发依赖、运行时 peer 与内联 dockkit 统一到 `0.2.1-rc.2`；Cordis 为 `~4.0.5`，Schemastery 为 `~3.18.5`。
- 使用新的 `engines.dsh` 声明准确目标版本，更新原有兼容声明，不宣称旧版本兼容。
- 移除新版宿主已删除的 invariant 空伴生入口、导出、构建项和依赖。
- 补充 `TerminalBlockLabels.commandLine` 中文无障碍文案。
- 按新的工具调用联合类型读取名称和参数：准备阶段没有完整参数；执行阶段有 `argsRaw`；结果阶段从配对的 `call` 读取参数。保留嵌套调用和历史窗口裁切后的结果解析。
- 保留 dockkit 禁用装饰性滚动渐隐测量的补丁，并验证它应用于目标版本。

依据：[0.2.1-rc.1 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)、[0.2.1-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，以及准确版本的 npm 类型声明和本机官方 `app.asar` 包身份。技能未提供本段版本迁移卡，未将早期卡片冒充为本次升级依据。

## 验证记录

| 阶段 | 状态 | 证据或边界 |
|---|---|---|
| P01 来源与目标识别 | completed | 源码基线如上；官方桌面端与其内置 DSH 均为 `0.2.1-rc.2` |
| P02 DSH 差异审计 | skipped | 仅核对本插件涉及的发布说明、准确版本声明和实际行为；未执行全宿主 API/协议/数据格式审计 |
| P03 七类接触点扫描 | completed | 扫描源码、依赖、补丁、事件、服务、文件访问、界面、通道及子进程；启发式命中七类，不代表逐路径功能验收 |
| P04 源码迁移 | completed | 上述依赖、invariant、终端文案与工具调用类型变更 |
| P05 静态与针对性测试 | completed | 原依赖基线构建通过；目标版本构建通过；14 项测试通过；无原有构建失败豁免 |
| P06 Docker 冷启动 | skipped | 本机未发现 Docker；改用 Windows 上独立安装的准确版本真实 DSH 运行环境 |
| P07 真实功能路径 | completed | 点击官方设置中的深色主题；琉璃主题桥存在；外观设置可打开，材质设置刷新后保留；左右布局中的左侧栏可收起和展开 |
| P08 浏览器验证 | completed | Playwright 访问隔离主机；主题 DOM 挂载；插件管理页列出琉璃且开关启用；控制台零错误；测试证据位于 `output/playwright/` |
| P09 回滚方案 | completed | 保留旧源码、旧 tarball 和安装前配置备份；仅恢复本次拥有的文件，不重置整个仓库或用户配置 |

命令：

```powershell
pnpm install --frozen-lockfile --ignore-scripts # 旧依赖基线
pnpm build                                 # 旧依赖基线通过
pnpm install --ignore-scripts --registry=https://registry.npmjs.org
pnpm --config.verifyDepsBeforeRun=false run build
node --test tests/*.test.mjs
pnpm --config.ignoreScripts=true --config.verifyDepsBeforeRun=false pack --pack-destination .liuli-pack
```

`verifyDepsBeforeRun=false` 仅防止本机 pnpm 在运行构建命令前隐式重装并重复触发 prepare；依赖已显式安装，实际 build 仍完整执行 TypeScript 和 tsdown。

## 验证范围与安装

隔离测试使用新的 DSH_HOME 和真实 Web profile，没有复制用户凭据、会话或配置，也没有调用收费模型。主题切换和设置保存构成此 UI 插件的真实功能路径；未验证模型交互、全部文件预览、音频捕获、Electron 原生 IPC、全部拖拽排列或多版本兼容。

窗口顶栏切换依赖桌面壳窗口控制桥，单独升级主题包不能隐藏原生标题栏。`scripts/patch-official-window-controls.mjs` 已适配官方 Desktop `0.2.0-rc.2` 和 `0.2.1-rc.2`：先运行 `--check`，完全退出桌面端后再运行 `--apply`，然后重新启动。补丁按实际版本备份并校验 EXE/ASAR，恢复时使用 `--revert`。未安装窗口控制桥时，切换“窗口顶栏”设置不会产生对应外观变化。

安装采用带内容指纹的本地 tarball，保留旧包以便回退。桌面 profile 由 Electron 管理，不能用通用 `dsh --profile desktop` 启动。切换包之后需要桌面端重载或重启，以便宿主重新生成客户端模块清单。

本次未查询或注册命名中心，未发布 npm 或 GitHub Release。本地 tarball 不等同于已发布版本。

本机安装的详细备份路径和诊断记录仅保留在本地，不随源码发布。恢复时退出桌面应用，使用安装前备份恢复依赖清单和锁文件，再恢复旧插件目录；保留其他插件的原有构建产物，不覆盖后续用户配置。

## 与 master 集成

合并最新 master 时保留侧栏、拖拽和工作步骤样式修复；版本号冲突保留本次适配包的 0.1.2-rc.34。合并结果重新通过完整构建及 14 项测试（包含真实 Chrome 的侧栏和工作步骤显示测试），并对打包后的产物执行准确版本的真实 DSH 冷启动与浏览器挂载检查。

## 窗口顶栏补充验证

窗口补丁版本白名单与主窗口/预加载脚本锚点均已对照本机 `0.2.1-rc.2` 安装文件核对，准备后的代码通过语法检查。窗口顶栏补充修复后共 18 项测试通过，包括两个支持版本的检查、应用、重复应用、还原，解包脚本的原样恢复，以及版本/锚点漂移时拒绝写入。真实 Chrome 中连续两次在常驻与悬浮模式之间切换，核对顶栏节点、菜单可见性和 40px 内容留白。

用户确认退出后已在本机官方 Desktop 0.2.1-rc.2 应用补丁并重新启动。实际 dsh-app 页面中窗口控制桥可调用、琉璃窗控节点已挂载，原生最大化/还原命令正常。常驻/悬浮双向重复切换的自动化断言在真实 Chrome 的组件测试中完成；桌面客户端保留给用户继续使用，不自动操作会话内容。

## 0.1.2-rc.35：账号余额与全局页面

- 新增 `deepseek-account` 路由适配，读取宿主 Account Controller 的安全余额投影。调用携带当前宿主版本、语言及时区，与官方设置页使用同一接口；账号授权信息留在宿主，不借用 API Key 供应商配置。
- 页头分别显示充值余额与正数赠送余额，保留零余额、小于一分的提示及多币种区分。重复目录通知合并并发请求，切换会话、取消模型选择或卸载时丢弃旧结果。
- 新版插件页的 `installedPanel` / `tabPanel` 作为完整正文卡片承载各分组，保留独立页头与原生控件。
- 自动化搜索框由外层统一绘制材质和边框，内部图标与输入区居中对齐；320px 窄布局不产生横向溢出。

本轮完整构建与 23 项测试通过，包含账号余额适配、快速切换模型的竞态、实际 Chrome 的卡片和搜索框布局验证。准确版本的隔离 DSH 冷启动与前端挂载通过，控制台无错误。正式桌面 profile 只替换琉璃目录与其依赖清单/锁文件记录，其他依赖目录不重装。未启用 HMR 的客户端需重启加载新包。
