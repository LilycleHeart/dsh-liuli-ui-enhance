# DSH 官方客户端 UI · 与琉璃主题视觉冲突审计

> 审计对象：客户端 `app.asar` 内 **43 个 `@deepseek-ai/dsh-client-ui-*` 包**（0.1.5-rc.1，来自 deepseek-harness 仓库 `packages/client/`）。
> 方法：15 个子代理并行静态审计每个包内联的 CSS module 文本，按同一套琉璃视觉基线判定（材质/取色/圆角/阴影/图标/层叠）。
> 结论：**256 条冲突**（high 55 / medium 110 / low 91）。high = 直接破坏磨砂材质或不随动态取色变化；medium = 圆角/阴影/层叠与琉璃阶梯不一致；low = 细节。

## 一、高危项（high 55 条）

| # | 包 | 位置 | 问题 | 证据 |
|---|---|---|---|---|
| 1 | dsh-client-ui-attachment | UploadIllustration (svg rect/path/circle, client.js L230-305) | 拖拽上传提示插画是 115x84 内联 SVG，卡片配色写死 #9CE5ED / #679EFE / #3964FE（官方亮蓝品牌色），线条与圆点写死 stroke/fill: white | `rect{...transform:"rotate(-22.7338 0 17.0742)",fill:"#9CE5ED"} ... rect{fill:"#679EFE"} ... rect{fill:"#3964FE` |
| 2 | dsh-client-ui-attachment | UploadDisabledIllustration (svg path, client.js L306-357) | 禁用态插画同样为内联 SVG，灰卡 #979DA6、警示卡 #F59E0B、标记 white 全部硬编码 | `path{...fill:"#979DA6"} path{...fill:"#F59E0B"} path{...fill:"white"} path{stroke:"white",strokeWidth:"3.5"}` |
| 3 | dsh-client-ui-attachment | ._3MtNeq_removeFailed | 上传失败时删除按钮前景色硬编码 #fff，未使用 --dsw-alias-label-primary-inverted | `._3MtNeq_removeFailed{background:var(--dsw-alias-state-error-primary,#d54941);color:#fff;opacity:1}` |
| 4 | dsh-client-ui-chat | .V0s2hW_turnStatus | 回合状态文字（Deep diving…）的 shimmer 渐变用静态层令牌 --dsw-static-deepseek-500/200 做品牌色，配 color:#0000 + background-clip:text | `background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(-` |
| 5 | dsh-client-ui-conversation | .JdJrwG_colorTools | 上下文统计面板里「工具」占用条/色块的取色是硬编码紫色字面量 #a78bfa | `.JdJrwG_colorTools{--meter-tint:#a78bfa}` |
| 6 | dsh-client-ui-conversation | .Q7WfXG_primary | 聊天发送圆钮前景写死 #fff 不透明白 | `.Q7WfXG_primary{background:var(--dsw-alias-button-info-fill);color:#fff;border:none;border-radius:999px;width:` |
| 7 | dsh-client-ui-conversation | .Q7WfXG_select | 模式选择器自带内联 SVG 折线箭头图案，描边色硬编码为 #81858C | `.Q7WfXG_select{appearance:none;background-color:#0000;background-image:url("data:image/svg+xml,%3Csvg ... stro` |
| 8 | dsh-client-ui-conversation | .Q7WfXG_cardWorkspaceTrigger:after | 输入卡「切换工作区」虚线描边用内联 SVG data URI 做 mask，虚线图案写死在图片里 | `content:"";background:var(--dsw-alias-border-l4);border-radius:22px;-webkit-mask:url("data:image/svg+xml,%3Csv` |
| 9 | dsh-client-ui-deliverables | .dAK66G_root（--deliverable-fill / --deliverable-hover） | 交付物卡铺的静态中性底色 --dsw-static-neutral-50/100/850/800 是 host 固定色 | `--deliverable-fill:var(--dsw-static-neutral-50);--deliverable-hover:var(--dsw-static-neutral-100);body[data-ds` |
| 10 | dsh-client-ui-deliverables | ._9x9ddq_output | 交付物输出段落用 --dsw-alias-bg-layer-1 铺满整块不透明底 | `._9x9ddq_output{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:pre-` |
| 11 | dsh-client-ui-cordis | .sbk6oW_business | cordis 业务卡内层用 --dsw-alias-bg-base 做实底 | `.sbk6oW_business{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);border-radiu` |
| 12 | dsh-client-ui-cordis | .sbk6oW_output / .GWuUma_output | 输出代码块底读取被琉璃重定义为实色的 --dsw-alias-markdown-code-block | `.GWuUma_output{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);bo` |
| 13 | dsh-client-ui-cordis | .GWuUma_inspectButton | 药丸状「查看」按钮用 --dsw-alias-bg-base 实底 | `.GWuUma_inspectButton{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);border-` |
| 14 | dsh-client-ui-goal | .zzK9Ca_objectiveInput | 目标条内联编辑输入框用不透明页面底色 var(--dsw-alias-bg-base) 作背景，在磨砂材质上挖出一块实色 | `border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);min-width:0;height:26px;color` |
| 15 | dsh-client-ui-message-feedback | .OYavZa_detail | 反馈弹窗内的多行输入框（textarea）用 --dsw-alias-bg-layer-1 铺整块不透明实底，没有琉璃磨砂配方 | `background:var(--dsw-alias-bg-layer-1);width:100%;min-height:116px;max-height:280px;color:var(--dsw-alias-labe` |
| 16 | dsh-client-ui-model-selection | .Ns6z9q_warning | 菜单内「模型组加载失败」警告条用不透明令牌铺整块实底，盖住菜单磨砂 | `.Ns6z9q_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}` |
| 17 | dsh-client-ui-model-selection | .Ns6z9q_menu | 模型菜单整块面板用实底令牌 var(--dsw-specific-menu) 作背景，自身没有琉璃磨砂配方 | `.Ns6z9q_menu{z-index:1100;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-bor` |
| 18 | dsh-client-ui-model-selection | .Ns6z9q_groupTitle | sticky 分组标题用实底令牌铺底，在磨砂菜单上压出不透明横条 | `.Ns6z9q_groupTitle{z-index:1;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);padding` |
| 19 | dsh-client-ui-open-in-app | AppIcon 回退图形：svg[viewBox="0 0 24 24"] > rect | 包内内联自绘 SVG 通用应用图标（宿主未提供 PNG 时渲染），属自带图标：svg viewBox="0 0 24 24"、strokeWidth 1.8 与 rect 几何全部硬编码在 JSX 里 | `children: (0, react_jsx_runtime.jsx)("rect", { 					x: 3, 					y: 3, 					width: 18, 					height: 18, 					rx:` |
| 20 | dsh-client-ui-permission-presets | .kVHzYW_chevron — permission-presets 消费的 primitives IconChevronDownOutline14 | 权限下拉药丸自带官方线性 SVG 雪佛龙图标（内联 path），不经任何图标令牌 | `jsx("svg", { width: size, height: size, viewBox: "0 0 14 14", fill: "none", children: jsx("path", { d: "M11.84` |
| 21 | dsh-client-ui-plan | .vJ_1Aq_close — plan chip 消费的 primitives IconCloseFill14 | plan mode 药丸的关闭叉自带官方 14x14 内联 SVG 图标 | `jsx("svg", { width: size, height: size, viewBox: "0 0 14 14", fill: "none", children: jsx("path", { d: "M10.60` |
| 22 | dsh-client-ui-primitives | .card（HoverCard.module.css） | 会话 hover 预览卡把表面色硬编码为组件级变量 #2C2C2E（亮暗同色） | `--dsw-hovercard-bg: #2C2C2E;   position: fixed;   z-index: 100;   ...   background: var(--dsw-hovercard-bg);  ` |
| 23 | dsh-client-ui-primitives | .copied（HoverCard.module.css） | hover 卡「已复制」反馈文字硬编码纯白 #FFFFFF | `.copied {   color: #FFFFFF;   font-size: 14px;   line-height: 20px;   text-align: center; }` |
| 24 | dsh-client-ui-primitives | .root（JsonTree.module.css） | JSON 树自带一套硬编码语法色板（另有 body[data-ds-dark-theme] 下的第二套 #5db0d7/#f28b82/#99c8ff…） | `--json-tree-property: #881391; --json-tree-string: #c41a16; --json-tree-number: #1c00cf; --json-tree-punctuati` |
| 25 | dsh-client-ui-primitives | .icon（FileTypeIcon.module.css） | 图片/视频文件类型色硬编码 rgb(139, 118, 246) 紫罗兰 | `.icon {   /* The design platform has no violet token matching the supplied image/video artwork. */   --dsh-fil` |
| 26 | dsh-client-ui-primitives | .list, .submenu（Menu.module.css） | 官方菜单卡走 --dsw-specific-menu，在琉璃下被重定义为不透明 bg-layer-3 | `padding: 4px;   border-radius: 20px;   background: var(--dsw-specific-menu);   box-shadow: var(--dsw-elevation` |
| 27 | dsh-client-ui-primitives | .wrap（Input.module.css） | 输入框外框用 --dsw-alias-bg-layer-1，琉璃把该令牌重定义为不透明色 | `.wrap {   ...   border: 0.5px solid var(--dsw-alias-border-l4);   border-radius: 8px;   background: var(--dsw-` |
| 28 | dsh-client-ui-primitives | 75 个 Icon* 内联 SVG 组件（primitives/index.js） | 整包自带 75 个内联 SVG 图标组件（官方 ic_ds_* 线性图标集），无一处走图标令牌 | `jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", children: [jsx("path", { d: "M7.2` |
| 29 | dsh-client-ui-primitives | CodeFileIcon / codeFileArtwork（primitives/index.js:2756） | 内嵌整套语言/品牌彩色 logo（Angular/React/Vue/Python…），含 139 处 fill/stroke 硬编码色值 | `jsx("rect", { x: "1", y: "1", width: "18", height: "18", rx: "4", fill: "#DD0031" }), jsx("path", { stroke: "#` |
| 30 | dsh-client-ui-primitives | span.katex-error 内联样式（primitives/index.js:8092） | 公式渲染失败回退用内联 style 硬编码 #cc0000 | `jsx("span", {   className: "katex-error",   style: { color: "#cc0000" },   title: String(error),   children: v` |
| 31 | dsh-client-ui-schedule | .EYZUfa_menu | 提醒目录弹层用实底令牌 var(--dsw-specific-menu) 作整块面板背景，没有琉璃磨砂配方（rgba(var(--liuli-acrylic-rgb),…) + var(--liuli-noise) + backdrop-filter），是不透明板 | `box-sizing:border-box;background:var(--dsw-specific-menu);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l` |
| 32 | settings-general | .MI-_Aa_panel | 设置模态面板用 --dsw-alias-bg-layer-2 作背景，该令牌被琉璃重定义为不透明实底（亮 #dde5ed / 暗 #283040），此处需要透明才能透出壁纸与亚克力磨砂 | `background:var(--dsw-alias-bg-layer-2);width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px)` |
| 33 | settings-general | IconDesktopSettings (SettingsRoot.js 内联 <svg>) | 包内自绘内联 SVG 图标（rect + path 硬编码路径），不经任何图标令牌/图标集 | `viewBox:"0 0 16 16",fill:"none",children:[jsx("rect",{x:"1.5",y:"2.5",width:"13",height:"9",rx:"1.5",stroke:"c` |
| 34 | dsh-client-ui-settings-models | .iwpW_G_selectInput (select 下拉箭头) | 自带 base64/SVG 箭头图片，且描边色硬编码为 #81858C | `.iwpW_G_selectInput{appearance:none;background-image:url("data:image/svg+xml,...path d='M3 4.5L6 7.5L9 4.5' st` |
| 35 | dsh-client-ui-settings-models | ModelListEditor IconChevron（jsx("svg")） | 自绘内联 svg path 图标，未走官方 primitives | `jsx("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",children:jsx("path",{d:"M6 3.5L10.5 8L6 12.5` |
| 36 | dsh-client-ui-settings-models | ModelListEditor IconTrash（jsx("svg")） | 自绘内联 svg path 图标（删除行按钮），未走官方 primitives | `jsx("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",children:jsx("path",{d:"M2.5 4h11M6.5 4V2.5h` |
| 37 | dsh-client-ui-sidebar-documentpreview | IconNowrapFill16（.cwCDea_tool 内换行切换按钮） | 自带内联 svg path 图标（侧栏文档预览工具栏的换行/不换行切换），未走琉璃统一的 Material Symbols 图标体系 | `<svg viewBox="0 0 24 24" fill="none"><path d="M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM14 9L19 ` |
| 38 | dsh-client-ui-sidebar-documentpreview | IconWrapFill16（.cwCDea_tool 内换行切换按钮，与 IconNowrapFill16 同源） | 同一个 icons.js 模块里第二个自带内联 svg path 图标（换行开启态） | `<svg viewBox="0 0 24 24"><path d="M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM6.75 5H11.5A6 6 0 0 ` |
| 39 | dsh-client-ui-sidebar-right | .L5GtOG_entry | 引导页入口胶囊用不透明底 var(--dsw-alias-bg-layer-1)（GuideBody.module.css） | `.L5GtOG_entry{...;text-align:left;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-bor` |
| 40 | dsh-client-ui-sidebar-right | .Ng7Ira_panel | 右侧栏根面板用不透明底 var(--dsw-alias-bg-base)（SidebarRight.module.css） | `.Ng7Ira_panel{z-index:10;background:var(--dsw-alias-bg-base);border-left:.5px solid var(--dsw-alias-border-l4)` |
| 41 | dsh-client-ui-skill | .uEzQxa_instructionsCard | Skill 说明卡用不透明底 var(--dsw-alias-markdown-code-block) | `.uEzQxa_instructionsCard{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code` |
| 42 | dsh-client-ui-skill | .uEzQxa_inspectButton | 查看按钮用不透明底 var(--dsw-alias-bg-base) | `.uEzQxa_inspectButton{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);color:v` |
| 43 | dsh-client-ui-theme | body (light) / body[data-ds-dark-theme] : --dsw-linear-gradient-think | 官方 theme 包把思考区渐变写死为不透明的 #fff / #151517，而不是引用语义令牌。琉璃只重定义了 --dsw-alias-* 层（liuli-palette.ts 未触碰 --dsw-linear-gradient-think），该渐变不会被壁纸取色或亚克力材质影响。 | `--dsw-linear-gradient-think:linear-gradient(180deg, #fff 20.19%, #fff0 100%); /* dark: #151517 20.19%, #151517` |
| 44 | dsh-client-ui-subagent | function SubagentSwitcherIcon() | 自带两段内联 svg path 作为 "切到父/子代理" 的指示图标，而不是调用官方图标集（IconChevron* 等）或琉璃统一的 Material Symbols。 | `jsxs("svg",{width:"16",height:"16",viewBox:"0 0 20 20",fill:"none",children:[jsx("path",{d:"M5.99951 12.7L8.95` |
| 45 | dsh-client-ui-trajectory | TrajectoryTable 内联组件 ToolWrenchIcon() 的 svg[data-role-icon="wrench"] | 包内自带手绘线性 SVG 图标（16 viewBox + stroke 描边扳手），非 Material Symbols | `jsx("svg",{width:"13",height:"13",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",chil` |
| 46 | dsh-client-ui-trajectory | TrajectoryTable 内联组件 InformationIcon() 的 svg[data-role-icon="information"] | 包内自带线性信息图标（circle + path，stroke 绘制），非官方图标组件、非 Material Symbols | `jsx("svg",{width:"14",height:"14",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.4",chil` |
| 47 | dsh-client-ui-trajectory | TrajectoryTable 内联组件 CompactedIcon() 的 svg[data-role-icon="compacted"] | 包内自带四向箭头压缩图标（4 条自绘 path），非 Material Symbols | `jsx("svg",{width:"13",height:"13",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",children:[jsx("path",{` |
| 48 | dsh-client-ui-trajectory | .MLq9Lq_assistantToolCallIcon（TrajectoryTable 工具调用行的内联 svg） | 包内自带 svg 扳手图标（24 viewBox、stroke 1.8）挂在 .assistantToolCallIcon 上 | `jsx("svg",{className:"…assistantToolCallIcon",width:"12",height:"12",viewBox:"0 0 24 24",children:jsx("path",{` |
| 49 | dsh-client-ui-trajectory | .MLq9Lq_toolCatalogIcon（ToolGlyph() 内联 svg，工具目录 summary 内） | 包内自带 svg 工具图标（与工具调用行同款 path，另一份拷贝） | `jsx("svg",{className:"…toolCatalogIcon",width:"12",height:"12",viewBox:"0 0 24 24",children:jsx("path",{d:"M14` |
| 50 | dsh-client-ui-trajectory | .J49NjG_toggleIcon（TrajectoryToolbar 时长切换按钮内的内联 svg 时钟） | 包内自带 svg 时钟图标（circle + path），非 Material Symbols | `jsx("svg",{className:"…toggleIcon",viewBox:"0 0 16 16",fill:"none",children:[jsx("circle",{cx:"8",cy:"8",r:"5.` |
| 51 | dsh-client-ui-trajectory | .J49NjG_actionIcon（TrajectoryToolbar 折叠/展开按钮） | 用 U+229E/U+229F 字符字形充当图标（折叠/展开），且字体被指定为代码字体栈 | `.J49NjG_actionIcon{color:var(--dsw-alias-label-tertiary);font:14px/14px var(--ds-font-family-code)} ｜ JSX: chi` |
| 52 | dsh-client-ui-workspace | .ozLDBG_hoverTitle | 硬编码纯白文字色 #fff（会话/工作区 hover 卡标题） | `.ozLDBG_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}` |
| 53 | dsh-client-ui-workspace | .ozLDBG_hoverPath | 硬编码浅灰文字色 #cfd3d6（hover 卡工作区路径） | `.ozLDBG_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}` |
| 54 | dsh-client-ui-workspace | .ozLDBG_hoverTime | 硬编码浅灰文字色 #cfd3d6（hover 卡相对时间） | `.ozLDBG_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}` |
| 55 | dsh-client-ui-workspace | .ozLDBG_hoverStatus | 硬编码中性灰 #adb2b8（hover 卡状态行） | `.ozLDBG_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}` |

## 二、中危项（medium 110 条，按包汇总）

### dsh-client-ui-primitives（14）
- **.card（HoverCard.module.css）** — fixed 定位的 hover 浮层只用 z-index: 100，与琉璃 z-index 阶梯相差 7 个数量级
- **.card（HoverCard.module.css）** — 浮层卡片固定 12px 圆角，不在琉璃圆角阶梯上
- **.list, .submenu（Menu.module.css）** — 菜单卡固定 20px 圆角，与琉璃菜单档位冲突
- **.list / .portal / .submenu（Menu.module.css）** — 菜单三个层级分别写死 z-index 100 / 101 / 1100，远低于琉璃弹出层 2147482500
- **.dialog（Modal.module.css）** — 对话框固定 24px 圆角 + 官方 elevation-prominent 阴影，不走琉璃卡片 14px / 辉光阴影配方
- **.root（Modal.module.css）** — 模态遮罩层 z-index: 1000，低于琉璃模态遮罩档 2147482800
- **.onboardingMask（OnboardingSurface.module.css）** — 遮罩底色与模糊全部硬编码，而同类 Modal 走的是 --dsw-alias-bg-mask-1 / --dsw-mask-blur 令牌
- **.onboardingOverlay（OnboardingSurface.module.css）** — 首启引导全屏层 z-index: 1100，与琉璃浮层阶梯冲突
- **.pill（Pill.module.css）** — 中性药丸用不透明 --dsw-alias-bg-layer-2 实底
- **.tag[data-tone='neutral']（Tag.module.css）** — 中性标签用不透明 --dsw-alias-bg-module-platform 实底
- **.toast（Toast.module.css）** — Toast z-index: 1100，琉璃 Toast 档位是 2147482900
- **.bubble（Tooltip.module.css）** — fixed 定位的 tooltip 用 z-index: 100
- **--dsl-diff-radius / --dsl-read-radius / --dsl-search-radius / --dsl-te** — 六类 markdown 代码/结果卡统一固定 12px 圆角，不走琉璃圆角令牌
- **.bannerWrap（markdown/CodeBlock.module.css）** — sticky 代码卡标题栏用 --dsw-alias-bg-base 铺底，与卡片自身底色令牌不同源

### dsh-client-ui-trajectory（6）
- **.MLq9Lq_requestBoundaryControl:after（悬浮标签）** — 硬编码黑色投影 #0000001f
- **@media (width<=760px) .MLq9Lq_details（详情抽屉）** — 抽屉式浮层用硬编码阴影 #00000024
- **.MLq9Lq_toolCallNameTypeface** — 硬编码字体栈与字号（Menlo,Consolas,Liberation Mono,PingFang SC,Microsoft YaHei）
- **.MLq9Lq_turnLabel** — 固定 8px 字号（低于琉璃字阶下限 10px）
- **.J49NjG_toggle, .J49NjG_action（TrajectoryToolbar 20px 高按钮）** — 固定 3px 圆角（不在琉璃圆角阶梯）
- **.J49NjG_search（TrajectoryToolbar 搜索框）** — 输入/搜索框 4px 圆角 + 发丝描边，未走琉璃输入框配方

### dsh-client-ui-user-questions（6）
- **.QOsGLa_card（QuestionComposer 接管输入位的浮卡）** — 卡片固定 20px 圆角（≤720px 为 16px），不在琉璃圆角阶梯
- **.gtAFBG_card（带 warn 条的同位卡片）** — 卡片固定 20px 圆角（≤720px 为 16px），与 QOsGLa_card 同病
- **.QOsGLa_title** — 固定 16px / 15px 标题字号，不在琉璃字阶内
- **.QOsGLa_badge** — 徽章把该令牌当『浅色底』用，但琉璃把它重定义为不透明高对比前景色，导致文字对比度崩坏
- **.QOsGLa_card, .gtAFBG_card（阴影）** — 阴影用两个不同的宿主 elevation 令牌，未走琉璃阴影 + 品牌泛光配方
- **.QOsGLa_option, .QOsGLa_customRow（圆角）** — 40px 选项行固定 12px 圆角

### dsh-client-ui-attachment（5）
- **._3MtNeq_card** — 文件卡固定 16px 圆角（另有 240x64 固定尺寸）
- **._4YQqxW_thumbnail / .VJgcGW_thumbnail / .i4LD0q_frame** — 缩略图/图片瓦片固定 16px 圆角（三处同值）
- **.YT86xG_mask** — 拖拽遮罩用固定 backdrop-filter:blur(10px) 与固定 z-index:1000 的全屏 fixed 层
- **.kiyf9q_backdrop** — 图片灯箱 backdrop 固定 z-index:1000
- **.kiyf9q_image** — 灯箱原图容器固定 12px 圆角（配官方 --dsw-shadow-lv3）

### dsh-client-ui-conversation（5）
- **.uPhUma_root** — 会话列根元素铺 --dsw-alias-bg-base 不透明底
- **.JdJrwG_panel** — 上下文统计浮层是 z-index:100 的 absolute 面板，未 portal 到 body
- **.uPhUma_root[data-phase=active] .uPhUma_composerSeat** — 对话态输入区常驻一条渐隐到不透明 --dsw-alias-bg-base 的渐变遮罩
- **.rUhRIG_chip** — 引用 chip 固定 6px 圆角（插件已另有 0.9 亚克力 + 描边覆盖）
- **.Oae22q_file / .Oae22q_thumb / .Oae22q_editor** — 附件停靠区的文件 chip、缩略图、重命名输入框统一铺 --dsw-alias-bg-base 实底 + 6px 圆角

### dsh-client-ui-directory-picker-browse（5）
- **.HzweGa_loadingFloat** — 绝对定位在文件列表右下的加载提示用 bg-layer-2 不透明实底，且完全没有圆角
- **.HzweGa_createInput** — 新建文件夹输入框 44px 高 + 22px 圆角（全药丸形），不在琉璃输入框形状档内
- **.HzweGa_createInput** — 输入框 outline:none 且本包没有任何 :focus 规则，键盘焦点没有品牌反馈
- **.HzweGa_row** — 28px 高目录列表行（button）写死 6px 圆角
- **.HzweGa_header** — 对话框头部分隔线用最强档 border-l3（.HzweGa_footerBar 的 border-top、.HzweGa_divider 的竖线同值）

### dsh-client-ui-settings-models（5）
- **.iwpW_G_rowCard** — 卡片圆角写死 16px，不在琉璃圆角阶梯（卡片档 = var(--liuli-radius) 14px）
- **.iwpW_G_addCard, .iwpW_G_setupCard** — 卡片圆角写死 12px，不在琉璃阶梯（10px 内嵌小卡 / 14px 卡片）
- **.iwpW_G_editor** — 以 var(--dsw-alias-bg-module-platform) 作卡片实底（琉璃把该令牌定义为不透明色）
- **.iwpW_G_addButton** — 44px 高按钮写死 16px 圆角，既非 999px 药丸档也非 10px 控件档
- **.iwpW_G_input** — 输入框实底用不透明令牌 var(--dsw-alias-bg-layer-1)，未走磨砂输入底

### dsh-client-ui-sidebar-right（5）
- **.L5GtOG_entry** — 入口胶囊固定圆角 24px，落在琉璃圆角阶梯之外
- **.L5GtOG_entryTitle** — 入口标题固定字号 15px，不在琉璃字阶内
- **.GzLz_G_button** — 展开按钮 28×28 用 border-radius:28px 做成正圆（ExpandButton.module.css）
- **.Ng7Ira_iconButton** — 右侧栏工具图标按钮 28×28 用 border-radius:28px 做成正圆
- **.Ng7Ira_floatHost** — 全屏浮动宿主用固定 position:fixed;inset:0;z-index:60，为后代建立 60 层的层叠上下文

### dsh-client-ui-workspace（5）
- **.SJMXQW_sectionHeader** — 固定圆角 12px，落在琉璃圆角阶梯之外
- **.SJMXQW_renameInput** — 固定圆角 22px（按 44px 高写死的药丸值），不读 --liuli-radius-sm
- **.SJMXQW_searchExpanded** — 圆角写死 10px 字面量，而非 var(--liuli-radius-sm)
- **.SJMXQW_iconButton, .SJMXQW_search, .SJMXQW_searchButton, .SJMXQW_clea** — 侧栏 28×28 / 24×24 图标按钮一律用 border-radius:50% 正圆，并额外带琉璃全库未使用的 corner-shape:round
- **.SJMXQW_searchInput** — 自写 outline:none，全文件无任何 :focus / :focus-within 规则补可见焦点

### dsh-client-ui-chat（4）
- **.VnbZpq_bubble** — 用户消息气泡圆角写死 22px
- **.VnbZpq_fileCard** — 附件文件卡圆角写死 16px（既非卡片档 14px 也非控件档 10px），且令牌回退值是硬编码色 #0000001f
- **.V0s2hW_toBottom** — 「回到底部」浮钮用 --dsw-alias-button-floating-fill 实底，没有亚克力/噪声/磨砂
- **.PvW7sq_preview** — 轮次导航悬浮预览卡用 --dsw-alias-bg-layer-1 铺不透明实底，无磨砂配方

### dsh-client-ui-subagent（4）
- **.tcG1Aq_menu** — 代理切换菜单圆角硬编码为 20px。
- **.tcG1Aq_menu** — fixed 定位的浮层只给了 z-index:100。
- **.tcG1Aq_trigger, .tcG1Aq_switcherTrigger** — 28px 高的可点击触发器圆角硬编码为 6px。
- **.tcG1Aq_row, .tcG1Aq_clickarea** — 菜单项 / 点击区圆角硬编码 8px。

### dsh-client-ui-cordis（3）
- **.fU-zVq_panel** — fixed 弹出的 cordis 清单面板只给 z-index:30
- **.fU-zVq_panel** — 弹出面板固定 12px 圆角且无描边，只有 host 阴影
- **.fU-zVq_row / .GWuUma_output / .sbk6oW_message** — cordis 卡片内嵌块固定 8px / 12px 圆角并统一用 .5px 描边

### input-trigger（3）
- **.iRJKyq_menu** — 斜杠/@ 触发器的候选菜单固定 border-radius:20px，超出琉璃圆角阶梯（弹层大卡 14px、菜单面板 10–12px、控件 10px）
- **.iRJKyq_menu** — 菜单浮层固定 z-index:100，远低于琉璃浮层阶梯；且未 portal 到 body，直接渲染在 conversation.input.overlay 里
- **.iRJKyq_menu** — 菜单底色走 --dsw-specific-menu，而琉璃把该令牌重定义为不透明实底（bg-layer-3），拿不到亚克力磨砂

### jobs（3）
- **.ro6IpW_menu** — 后台任务列表浮层固定 border-radius:20px，超出琉璃圆角阶梯
- **.ro6IpW_menu** — 后台任务浮层固定 z-index:100，与琉璃浮层阶梯相差 7 个数量级
- **.ro6IpW_menu** — 浮层底色走 --dsw-specific-menu，琉璃把该令牌重定义为不透明实底，磨砂材质被盖住

### dsh-client-ui-message-feedback（3）
- **.OYavZa_detail** — 输入框固定 16px 圆角，越过琉璃控件圆角档
- **.OYavZa_dialog.OYavZa_dialog** — 弹窗卡片固定 18px 圆角 + 固定 38px 内部行距，并用双类选择器抬高特异性
- **.OYavZa_submit** — 弹窗全宽主按钮固定 18px 圆角

### dsh-client-ui-settings-plugin-inventory（3）
- **.MT6gCq_card** — 列表卡以 var(--dsw-alias-bg-layer-3) 为实底（琉璃定义为不透明色），无磨砂材质
- **.MT6gCq_search input** — 搜索输入框实底用不透明令牌 var(--dsw-alias-bg-layer-1)
- **.MT6gCq_switcher** — 下拉触发器用不透明 bg-module-platform 实底，未走亚克力配方

### dsh-client-ui-settings-plugins（3）
- **.BDWblG_card** — 插件卡以 var(--dsw-alias-bg-layer-3) 为实底（琉璃下为不透明色），无磨砂材质
- **.BDWblG_card（圆角部分）** — 卡片圆角写死 16px，不在琉璃阶梯（卡片档 14px），且不随 --liuli-radius
- **._1LQEeW_input** — 输入框实底用不透明令牌 var(--dsw-alias-bg-layer-3)，未走磨砂输入底

### dsh-client-ui-tool（3）
- **.WXmFEW_ioSection::-webkit-scrollbar-thumb / .MISisG_ioSection::-webki** — 工具卡片的输入/输出滚动区重写了 scrollbar-thumb，但未声明 background，也未使用琉璃的滚动条令牌；其中 #0000 为硬编码透明色。
- **.PcOAmq_card** — 卡片圆角硬编码 12px 且未使用 --liuli-radius；8/16px 的 padding-inline 也偏宽。
- **.WXmFEW_ioCard, .MISisG_ioCard** — 输入/输出内嵌卡圆角硬编码 12px。

### dsh-client-ui-theme（3）
- **.OlZvdG_themeCube** — 外观设置里的主题选择方块圆角硬编码 20px。
- **.RpkBcW_stepper** — 36px 高的数字步进器圆角硬编码 18px（胶囊）。
- **.RpkBcW_arrow** — 17x12px 微型上下箭头按钮圆角硬编码 3px。

### dsh-client-ui-agent-preset（2）
- **.bC90nG_iconButton::after（data-tip 气泡）** — 自绘 tooltip 用 label-primary 作底、bg-layer-3 作字色（反色搭配）
- **.bC90nG_card / .bC90nG_cardMain / .bC90nG_creatorButton** — 预设卡与“新建”虚线按钮固定 20px 圆角（内层 12px）

### dsh-client-ui-commands（2）
- **._1q_ULW_card** — 命令参数下拉菜单面板圆角写死 20px
- **._1q_ULW_search** — 搜索框描边用 --dsw-alias-border-inverted，而琉璃在亮色主题把它定义为全透明

### dsh-client-ui-deliverables（2）
- **.dAK66G_fileIcon** — 48px 文件图标框再刷一层 --deliverable-fill，与父卡同一不透明底色
- **.dAK66G_file** — 交付物卡固定 18px 圆角

### dsh-client-ui-goal（2）
- **.zzK9Ca_objectiveInput** — 26px 高输入框写死 6px 圆角，落在琉璃「18–22px 迷你按钮/代码段」档而非输入框档
- **.zzK9Ca_iconBtn** — 28×28 图标按钮用 999px 全圆角（正圆），与琉璃方向圆角工具按钮体系不一致

### layout（2）
- **._1qAH1q_handle** — 列宽拖拽手柄固定 z-index:11，低于琉璃宿主手柄层（50–60）与 frame 内所有浮层
- **._1qAH1q_overlayLayer** — shell.overlay 浮层落点只有 z-index:20，与琉璃浮层档位（1000 / 2147482400 / 2147482500）严重脱节

### dsh-client-ui-model-selection（2）
- **.Ns6z9q_menu** — 菜单浮层写死 z-index:1100 且 position:fixed（JS 里 createPortal 到 document.body）
- **.Ns6z9q_menu** — 菜单面板固定 20px 圆角，不在琉璃圆角阶梯内（菜单 10–12px / 卡片 14px）

### dsh-client-ui-schedule（2）
- **.EYZUfa_menu** — 弹层 position:fixed + z-index:100（图标 createPortal 到 document.body），与琉璃 z-index 阶梯相差七个数量级
- **.EYZUfa_menu** — 菜单面板固定 20px 圆角，不在琉璃圆角阶梯内（菜单/浮层 10–12px、卡片 14px、控件 10px）

### settings-general（2）
- **.MI-_Aa_panel** — 设置面板固定 border-radius:32px，远超琉璃圆角阶梯的面板/弹层大卡档 var(--liuli-radius) 14px
- **.MI-_Aa_overlay** — 全屏模态遮罩固定 z-index:1000，落在琉璃浮层层叠表最低档 2147482400 之下

### dsh-client-ui-sidebar（2）
- **.x-Wl6W_newSession** — 侧栏「新建会话」主按钮用不透明中性 elevated-fill 实底 + 12px 固定圆角 + 0.5px 发丝描边，不是琉璃主按钮配方（品牌实底 + var(--liuli-radius-sm) 10px + var(--liuli-glow-brand)）；--dsw-alias-button-elevated-fill 已被琉璃重定义为不透明色，会盖
- **.x-Wl6W_buildVersion** — 品牌区版本角标字号 6px、行高 10px、盒高 10px、圆角 2px，远低于琉璃字阶最小档（角标/badge 10px/16px），圆角也落在「细指示条 2px」档而非徽标档

### dsh-client-ui-skill（2）
- **.uEzQxa_instructionsHeader** — 说明卡标题条用不透明底 var(--dsw-alias-markdown-code-block-banner)
- **.uEzQxa_instructionsCard** — 说明卡固定圆角 12px，落在琉璃圆角阶梯之外

### dsh-client-ui-approval（1）
- **.nY9qbq_card** — 审批卡固定 20px 圆角，阴影走官方 --dsw-shadow-lv2

### dsh-client-ui-sidebar-documentpreview（1）
- **.cwCDea_body** — 文本预览正文用 var(--dsw-font-mono, ui-monospace, monospace)，而 --dsw-font-mono 在宿主里从未被定义（app.asar 及全部官方 UI 包中只有引用、无定义），实际回落 generic monospace，绕过琉璃代码字体 var(--ds-font-family-code)

## 三、低危项（low 91 条）

- dsh-client-ui-trajectory：7 条
- dsh-client-ui-chat：6 条
- input-trigger：5 条
- settings-general：5 条
- dsh-client-ui-settings-models：5 条
- dsh-client-ui-settings-plugins：5 条
- dsh-client-ui-sidebar-documentpreview：5 条
- dsh-client-ui-workspace：5 条
- jobs：4 条
- dsh-client-ui-commands：3 条
- dsh-client-ui-conversation：3 条
- dsh-client-ui-primitives：3 条
- dsh-client-ui-settings-plugin-inventory：3 条
- dsh-client-ui-approval：2 条
- dsh-client-ui-agent-preset：2 条
- dsh-client-ui-deliverables：2 条
- dsh-client-ui-cordis：2 条
- dsh-client-ui-goal：2 条
- dsh-client-ui-directory-picker-browse：2 条
- dsh-client-ui-open-in-app：2 条
- dsh-client-ui-schedule：2 条
- dsh-client-ui-sidebar-files：2 条
- dsh-client-ui-sidebar-right：2 条
- dsh-client-ui-skill：2 条
- dsh-client-ui-user-questions：2 条
- dsh-client-ui-attachment：1 条
- layout：1 条
- dsh-client-ui-message-feedback：1 条
- dsh-client-ui-model-selection：1 条
- dsh-client-ui-plan：1 条
- dsh-client-ui-sidebar：1 条
- dsh-client-ui-theme：1 条
- dsh-client-ui-workflow-run：1 条

## 四、原始数据

每条发现的完整 JSON（package / selector / css / issue / severity / why）存放在本机临时目录的
`ui-audit/<组名>.json` 中（共 15 个文件，未纳入仓库）。
## 五、修复记录（自动修复轮次）

已把 high / medium 中**可通过 CSS 覆盖**的项写成规则，追加到 `src/client/liuli-css.ts` 末尾（15 组、约 2368 行，由 15 个子代理并行产出、主代理合并）。

**修复方式**：只覆盖视觉属性（背景材质 / 颜色 / 圆角 / 阴影 / z-index），不改官方包、不动布局与交互。
**覆盖范围**：high 中除「内联 SVG 图标、语言品牌 logo」外的项 ＋ medium 中的圆角与 z-index 阶梯项。
**跳过项**：primitives 的 75 个内联图标、品牌彩色 logo、纯品牌识别元素、以及 low 级别的细节项。

**验证**：
- `pnpm build` 通过（tsc + tsdown）
- 部署后插件正常加载（无失败页），主题样式表 199 KB / 372 条规则生效
- 抽查：聊天发送钮前景色已从硬编码 `#fff` 变为随主题动态取色的值
- 帧层与官方右栏结构完好（4 个区域面板 + 官方右栏宿主）

**官方升级后复核**：各覆盖块首注释写明了来源包与解决的问题，按其中的类名前缀逐条对照即可；若官方改了类名，覆盖会**安全失效**（回落到官方样式），不会错位。

**合并时的两个坑（供后续自动化参考）**：
1. CSS 注释里出现反引号会截断 `liuli-css.ts` 的模板字符串 → 合并脚本需先把反引号替换掉；
2. CSS 中的反斜杠转义（如 `\201C`）在 JS 模板字符串里需写成 `\\`，另需清理零宽字符 / 不换行空格。
