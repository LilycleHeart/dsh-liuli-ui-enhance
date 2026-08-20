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
 * 返回 undefined 表示该标签类型无布局对应（开发者工具/轨迹/计划/子智能体/
 * 辅助对话依赖宿主 sidePaneHost 数据面，布局内无同构面板），标签只能内部排序。
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
    default: return undefined
  }
}
