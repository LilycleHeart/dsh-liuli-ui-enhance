/**
 * 右侧标签面板(SidePane)标签 ↔ Dockable 布局 的拖拽桥：
 *  - SidePane 标签 dragstart 时把标签序列化进 dataTransfer（SIDE_TAB_MIME）；
 *  - DockWorkspace / DockShellFrame 的 drop 读取它并映射成 dock 面板放入布局落点；
 *  - 布局侧 drop 成功后调用 markSideTabAccepted()，SidePane 在 dragend 时
 *    consumeSideTabAccepted() 消费它并关闭源标签 —— 实现"标签拆分到布局"的
 *    移动语义（内部排序不标记，标签保留）。
 */
import type { SidePaneTab } from './PreviewPanel.tsx'

export const SIDE_TAB_MIME = 'application/x-liuli-side-tab'

/** 请求右侧标签面板打开指定标签（dock 面板拖回详情页时恢复为 SidePane 标签）。 */
export const SIDE_TAB_OPEN_EVENT = 'liuli:side-tab-open'

export function openSidePaneTab(tab: SidePaneTab): void {
  window.dispatchEvent(new CustomEvent<SidePaneTab>(SIDE_TAB_OPEN_EVENT, { detail: tab }))
}

/** 标签拖拽是否已被布局接收（drop 成功由布局侧标记，dragend 由 SidePane 消费）。 */
let sideTabAccepted = false

export function markSideTabAccepted(): void {
  sideTabAccepted = true
}

export function consumeSideTabAccepted(): boolean {
  const taken = sideTabAccepted
  sideTabAccepted = false
  return taken
}

export function serializeSideTab(tab: SidePaneTab): string {
  return JSON.stringify({
    id: tab.id,
    type: tab.type,
    openedAt: tab.openedAt,
    rel: tab.rel,
    path: tab.path,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    childSessionId: tab.childSessionId,
    initialPrompt: tab.initialPrompt,
  })
}

export function parseSideTab(raw: string): SidePaneTab | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<SidePaneTab> | null | undefined
    if (parsed === null || typeof parsed !== 'object') return undefined
    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return undefined
    const tab: SidePaneTab = {
      id: parsed.id,
      type: parsed.type as SidePaneTab['type'],
      openedAt: typeof parsed.openedAt === 'number' ? parsed.openedAt : Date.now(),
    }
    if (typeof parsed.rel === 'string') tab.rel = parsed.rel
    if (typeof parsed.path === 'string') tab.path = parsed.path
    if (typeof parsed.url === 'string') tab.url = parsed.url
    if (typeof parsed.title === 'string') tab.title = parsed.title
    if (typeof parsed.favicon === 'string') tab.favicon = parsed.favicon
    if (typeof parsed.childSessionId === 'string') tab.childSessionId = parsed.childSessionId
    if (typeof parsed.initialPrompt === 'string') tab.initialPrompt = parsed.initialPrompt
    return tab
  } catch {
    return undefined
  }
}

export interface SideTabDockPanel {
  type: string
  title?: string
  state?: Record<string, unknown>
}

/**
 * SidePane 标签类型 → dock 面板类型映射（面板注册表复用同一批组件）。
 * 所有标签类型都有布局对应；依赖宿主 sidePaneHost 数据面的面板
 * （开发者工具/轨迹/计划/子智能体/辅助对话）由 DockWorkspace /
 * DockShellFrame 注入同一份数据面，在布局内渲染同构面板。
 */
export function sideTabToDockPanel(tab: SidePaneTab): SideTabDockPanel | undefined {
  switch (tab.type) {
    case 'treemapping': return { type: 'files' }
    case 'repo-wiki': return { type: 'wiki' }
    case 'git': return { type: 'git' }
    case 'browser': {
      const panel: SideTabDockPanel = { type: 'browser', state: { url: tab.url ?? '' } }
      if (tab.title !== undefined && tab.title !== '') panel.title = tab.title
      return panel
    }
    case 'code-viewer': {
      const panel: SideTabDockPanel = { type: 'code', state: { rel: tab.rel ?? '', path: tab.path ?? '' } }
      if (tab.title !== undefined && tab.title !== '') panel.title = tab.title
      return panel
    }
    case 'terminal': {
      const panel: SideTabDockPanel = { type: 'terminal' }
      if (tab.title !== undefined && tab.title !== '') panel.title = tab.title
      return panel
    }
    case 'whiteboard': return { type: 'whiteboard', state: { boardId: tab.id } }
    case 'developer-tools': return { type: 'developer-tools' }
    case 'trajectory': return { type: 'trajectory' }
    case 'plan': return { type: 'plan' }
    case 'subagents': return { type: 'subagents' }
    case 'side-chat': {
      const panel: SideTabDockPanel = {
        type: 'side-chat',
        state: {
          childSessionId: tab.childSessionId ?? '',
          initialPrompt: tab.initialPrompt ?? '',
        },
      }
      if (tab.title !== undefined && tab.title !== '') panel.title = tab.title
      return panel
    }
  }
}

/**
 * dock 面板类型 → SidePane 标签（与 sideTabToDockPanel 反向）。
 * 从详细页拆出的标签在 dock 布局里以面板形式存在；拖回详情页时需要还原成
 * SidePane 自己的标签，而不是与 region:details 合并成 dock 标签组。
 */
export function dockPanelToSideTab(panel: {
  id: string
  type: string
  title?: string
  state?: Record<string, unknown>
}): SidePaneTab | undefined {
  const base: SidePaneTab = { id: panel.id, type: 'git', openedAt: Date.now() }
  switch (panel.type) {
    case 'files': base.type = 'treemapping'; break
    case 'wiki': base.type = 'repo-wiki'; break
    case 'git': base.type = 'git'; break
    case 'browser':
      base.type = 'browser'
      base.url = typeof panel.state?.url === 'string' ? panel.state.url : ''
      if (panel.title !== undefined && panel.title !== '') base.title = panel.title
      break
    case 'code':
      base.type = 'code-viewer'
      base.rel = typeof panel.state?.rel === 'string' ? panel.state.rel : ''
      base.path = typeof panel.state?.path === 'string' ? panel.state.path : ''
      if (panel.title !== undefined && panel.title !== '') base.title = panel.title
      break
    case 'terminal':
      base.type = 'terminal'
      if (panel.title !== undefined && panel.title !== '') base.title = panel.title
      break
    case 'whiteboard':
      base.type = 'whiteboard'
      if (panel.title !== undefined && panel.title !== '') base.title = panel.title
      break
    case 'developer-tools':
      base.type = 'developer-tools'
      break
    case 'trajectory':
      base.type = 'trajectory'
      break
    case 'plan':
      base.type = 'plan'
      break
    case 'subagents':
      base.type = 'subagents'
      break
    case 'side-chat':
      base.type = 'side-chat'
      if (typeof panel.state?.childSessionId === 'string' && panel.state.childSessionId !== '') {
        base.childSessionId = panel.state.childSessionId
      }
      if (typeof panel.state?.initialPrompt === 'string' && panel.state.initialPrompt !== '') {
        base.initialPrompt = panel.state.initialPrompt
      }
      if (panel.title !== undefined && panel.title !== '') base.title = panel.title
      break
    default:
      return undefined
  }
  return base
}
