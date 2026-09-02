/**
 * 工作区「新建会话」后右侧详情列回弹：
 *
 * 官方行为：在项目会话里点击工作区行的「在“{workspace}”中新建会话」（aria-label
 * 来自 dsh-client-ui-workspace 的 actions.newSession.aria，zh「在“…”中新建会话」/
 * en「New session in …」）只打开新会话。官方 ui-layout 的 AppFrame 本会在「当前
 * 非 blank 会话」变化时自动 closeDetails（detailsSession 变化才触发，见
 * dsh-client-ui-layout client.js 的 AppFrame useLayoutEffect）；但从工作区「新建
 * 会话」的路径不切换当前会话，该 effect 不触发，右侧详情列保持打开不回（实测
 * 反馈即如此）。品牌区「新建会话」按钮不被本模块命中（label 正则只匹配工作区行）。
 *
 * 本模块在点击后（等官方按钮 onClick 先跑完）把右侧详情列收回：
 * - advanced（dock shell）：ctx.layout 是 DesktopLayoutState，closeDetails 把
 *   panels.details 置 0，dock 详情 shard 收成 0 宽（data-details-collapsed）；
 * - 兼容模式：ctx.layout 是跨插件 LayoutController，closeDetails 同样置 0，
 *   官方 _detailsCol 列收起。
 * closeDetails 是单向关闭（目标值 0 幂等），与 toggleSidebar 不同没有「已收起时
 * 再调会误展开」的风险；仍先用状态 / DOM 判断「详情已开」再关闭，避免无谓写入。
 */
import type { ClientContext } from './compat.ts'
// Type-only: 拉取 dsh-client-ui-layout 对 ctx.layout（含 openDetails/closeDetails）的类型合并。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** 收起（0 宽）与展开（≥300px）之间的判宽阈值。 */
const DETAILS_WIDTH_MIN = 120

/** 工作区「新建会话」按钮的 aria-label 匹配（zh/en 双 locale 官方文案）。
 *  品牌区「新建会话」（session.new.label）与其它按钮不匹配，不会误触发。 */
export function isWorkspaceNewSessionLabel(label: string): boolean {
  return /^在“.*”中新建会话$/.test(label) || /^New session in .+$/.test(label)
}

/** 右侧详情列当前是否打开：
 *  - advanced：ctx.layout 提供 getSnapshot（DesktopLayoutState），读 panels.details；
 *  - 兼容模式：跨插件 LayoutController 没有 getSnapshot，回退官方详情列
 *    _detailsCol 的 rect 宽度判断（列常驻挂载，闭合时 0 宽）。 */
export function isDetailsOpen(ctx: ClientContext): boolean {
  const face = ctx.layout as unknown as { getSnapshot?: () => { details: number } } | null
  const snap = face?.getSnapshot?.()
  if (snap !== undefined) return snap.details > 0
  const el = document.querySelector<HTMLElement>('[class*="_detailsCol"]')
  if (el === null) return false
  return el.getBoundingClientRect().width > DETAILS_WIDTH_MIN
}

/**
 * 挂载工作区「新建会话」详情列回弹：
 * - document 捕获阶段监听点击（先于官方按钮的 onClick / React 根监听）；
 * - 命中工作区新建会话按钮后 setTimeout(0) 延后到本次 click 事件完全派发完，
 *   官方流程（展开工作区组 + 打开新会话）不被中断；
 * - 延后回调里仅当右侧详情列处于打开态时调 ctx.layout.closeDetails() 收回。
 * 返回卸载函数（HMR / 插件卸载时清理监听与定时器）。
 */
export function startWorkspaceNewSessionCollapse(ctx: ClientContext): () => void {
  let timer = 0
  const onDocClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (target === null) return
    const button = target.closest<HTMLElement>('button[aria-label]')
    if (button === null) return
    if (!isWorkspaceNewSessionLabel(button.getAttribute('aria-label') ?? '')) return
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