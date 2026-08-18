/**
 * Dockable Workspace 状态仓库：
 *  - 包裹纯布局模型（dock-model.ts），提供 subscribe/getSnapshot（React 18
 *    useSyncExternalStore 直接可用）；
 *  - 每次变更自动落 localStorage（防抖 250ms）——刷新/HMR 重载后恢复；
 *  - 命名槽位（保存/恢复 Workspace）+ JSON 导出/导入。
 */
import {
  addPanel, createPanel, defaultLayout, emptyLayout, moveFloat, movePanel,
  parseDockLayout, patchPanel, removePanel, resizeSplit, resizeSplitTo, serializeDockLayout,
  setActivePanel, updateFloat,
  type DockLayout, type DropTarget,
} from './dock-model.ts'

export const DOCK_LS_KEY = 'liuli.dock.v1'
export const DOCK_SLOTS_KEY = 'liuli.dock.slots.v1'

export interface DockSlotEntry {
  layout: DockLayout
  updatedAt: number
}

type SlotMap = Record<string, DockSlotEntry>

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null || raw === '') return undefined
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 存储满/隐私模式：静默 */ }
}

export class DockStore {
  private state: DockLayout
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 自动保存开关（测试/导入期间可挂起）。 */
  public autoSave = true

  constructor(initial?: DockLayout) {
    if (initial !== undefined) {
      this.state = initial
    } else {
      // 落盘结构是 { v, savedAt, layout } 信封；兼容裸布局旧数据。
      const saved = readJson(DOCK_LS_KEY) as { layout?: unknown } | undefined
      const payload = saved !== undefined && typeof saved === 'object' && saved !== null && 'layout' in saved
        ? saved.layout
        : saved
      this.state = payload === undefined ? defaultLayout() : parseDockLayout(payload)
    }
  }

  getSnapshot = (): DockLayout => this.state

  subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private commit(next: DockLayout): void {
    this.state = next
    for (const listener of this.listeners) listener()
    if (!this.autoSave) return
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      writeJson(DOCK_LS_KEY, { v: 1, savedAt: Date.now(), layout: this.state })
    }, 250)
  }

  /** 立即同步落盘（页面关闭前）。 */
  flush(): void {
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null }
    writeJson(DOCK_LS_KEY, { v: 1, savedAt: Date.now(), layout: this.state })
  }

  /* ── 布局操作 ── */

  addPanel(type: string, title?: string, state?: Record<string, unknown>, targetNodeId?: string): string {
    const scratch = emptyLayout()
    scratch.seq = this.state.seq
    const panel = createPanel(scratch, type, title, state)
    const placed = addPanel({ ...this.state, seq: scratch.seq }, panel, targetNodeId)
    this.commit(placed)
    return panel.id
  }

  closePanel(panelId: string): void {
    this.commit(removePanel(this.state, panelId))
  }

  move(panelId: string, target: DropTarget): void {
    this.commit(movePanel(this.state, panelId, target))
  }

  moveFloat(floatId: string, target: DropTarget, tabId?: string): void {
    this.commit(moveFloat(this.state, floatId, target, tabId))
  }

  setActive(containerId: string, panelId: string): void {
    this.commit(setActivePanel(this.state, containerId, panelId))
  }

  resize(nodeId: string, dividerIndex: number, ratioDelta: number): void {
    this.commit(resizeSplit(this.state, nodeId, dividerIndex, ratioDelta))
  }

  /** 拖拽缩放（幂等）：把分割线左侧/上侧子级比例直接设为 ratio。 */
  resizeTo(nodeId: string, dividerIndex: number, ratio: number): void {
    this.commit(resizeSplitTo(this.state, nodeId, dividerIndex, ratio))
  }

  patch(panelId: string, statePatch: Record<string, unknown> | undefined, title?: string): void {
    this.commit(patchPanel(this.state, panelId, statePatch, title))
  }

  moveFloatBox(floatId: string, box: { x: number; y: number; w: number; h: number }): void {
    this.commit(updateFloat(this.state, floatId, box))
  }

  /** 重置为默认布局。 */
  reset(): void {
    this.commit(defaultLayout())
  }

  /** 清空为单面板布局（给定面板类型兜底）。 */
  clear(type = 'notes'): void {
    const scratch = emptyLayout()
    const panel = createPanel(scratch, type)
    const next = addPanel({ ...emptyLayout(), seq: scratch.seq }, panel)
    this.commit(next)
  }

  /* ── 保存 / 恢复（命名槽位）── */

  listSlots(): Array<{ name: string; updatedAt: number }> {
    const slots = (readJson(DOCK_SLOTS_KEY) ?? {}) as SlotMap
    return Object.entries(slots)
      .map(([name, entry]) => ({ name, updatedAt: entry.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveSlot(name: string): boolean {
    const key = name.trim()
    if (key === '') return false
    const slots = (readJson(DOCK_SLOTS_KEY) ?? {}) as SlotMap
    slots[key] = { layout: this.state, updatedAt: Date.now() }
    writeJson(DOCK_SLOTS_KEY, slots)
    return true
  }

  loadSlot(name: string): boolean {
    const slots = (readJson(DOCK_SLOTS_KEY) ?? {}) as SlotMap
    const entry = slots[name]
    if (entry === undefined) return false
    this.commit(parseDockLayout(entry.layout))
    return true
  }

  deleteSlot(name: string): boolean {
    const slots = (readJson(DOCK_SLOTS_KEY) ?? {}) as SlotMap
    if (slots[name] === undefined) return false
    delete slots[name]
    writeJson(DOCK_SLOTS_KEY, slots)
    return true
  }

  /* ── 导出 / 导入 ── */

  exportJSON(): string {
    return serializeDockLayout(this.state)
  }

  importJSON(text: string): boolean {
    let parsed: unknown
    try { parsed = JSON.parse(text) as unknown } catch { return false }
    const layout = parseDockLayout(parsed)
    if (layout.root === null && layout.floats.length === 0) return false
    this.commit(layout)
    return true
  }
}
