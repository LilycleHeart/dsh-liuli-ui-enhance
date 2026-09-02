/**
 * 侧栏「DeepSeek logo」点击后右侧详细页（details 列）自动收回：
 *
 * 官方行为：侧栏 logoRow 里的品牌按钮（DeepSeek logo + 名称，aria-label 同
 * 「新建会话」session.new.label）点击只调 startSession() —— 打开新会话（回到
 * 开始页）。官方 ui-layout 的 AppFrame 本会在「当前非 blank 会话」变化时自动
 * closeDetails（detailsSession 变化才触发）；但点 logo 回到的是 blank 会话，
 * detailsSession 变 undefined，该 effect 提前 return，右侧详细页保持展开不回
 * （实测反馈即如此；与 workspace-new-session-collapse.ts 记录的是同一宿主行为，
 * 只是触发元素不同：工作区行 vs 品牌 logo）。
 *
 * 本模块在点击后（等官方按钮 onClick 先跑完）把右侧详细页收回：
 * - advanced（dock shell）：ctx.layout 是 DesktopLayoutState，closeDetails 把
 *   panels.details 置 0，dock 详情 shard 收成 0 宽（data-details-collapsed）；
 * - 兼容/Web：ctx.layout 是跨插件 LayoutController（attachPanels 重定向到琉璃
 *   同构 store），closeDetails 同样置 0，官方 _detailsCol 列收起。
 * closeDetails 是单向关闭（目标值 0 幂等），仍先用状态 / DOM 判断「详情已开」
 * 再关闭，避免无谓写入。只命中侧栏 logoRow 内的品牌按钮（button[class*="_brand"]），
 * 不误伤折叠钮（_toggle）/ 新建会话钮（_newSession）。
 */
import type { ClientContext } from './compat.ts'
// Type-only: 拉取 dsh-client-ui-layout 对 ctx.layout（含 openDetails/closeDetails）的类型合并。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { isDetailsOpen } from './workspace-new-session-collapse.ts'

/** 命中侧栏品牌按钮（DeepSeek logo）：logoRow 内的 brand 按钮。 */
export function isSidebarBrandButton(target: Element | null): boolean {
  if (target === null) return false
  const brand = target.closest<HTMLElement>('button[class*="_brand"]')
  if (brand === null) return false
  return brand.closest('[class*="_sidebarCol"] [class*="_logoRow"]') !== null
}

/**
 * 挂载「DeepSeek logo 点击后右侧详细页收回」：
 * - document 捕获阶段监听点击（先于官方按钮的 onClick / React 根监听）；
 * - 命中侧栏品牌按钮后 setTimeout(0) 延后到本次 click 事件完全派发完，
 *   官方流程（startSession 打开新会话）不被中断；
 * - 延后回调里仅当右侧详情列处于打开态时调 ctx.layout.closeDetails() 收回。
 * 返回卸载函数（HMR / 插件卸载时清理监听与定时器）。
 */
export function startSidebarLogoDetailsCollapse(ctx: ClientContext): () => void {
  let timer = 0
  const onDocClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (!isSidebarBrandButton(target)) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (isDetailsOpen(ctx)) ctx.layout.closeDetails()
    }, 0)
  }
  document.addEventListener('click', onDocClick, true)
  return () => {
    window.clearTimeout(timer)
    document.removeEventListener('click', onDocClick, true)
  }
}
