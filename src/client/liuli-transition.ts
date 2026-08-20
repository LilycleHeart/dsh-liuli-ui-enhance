/**
 * 会话切换/新消息入场动画：官方 harness 的挂类逻辑在 ChatNodeSeat /
 * AssistantMarkdown 组件内部（插件无法修改组件源码），本模块用
 * MutationObserver 在消息列（[data-chat-flow]）的新增节点
 * （[data-chat-anchor-key]）上挂入场类，动画定义在 liuli.css。
 *
 * - 切换会话：消息列整批重挂载 → 按 DOM 顺序分配级联延迟（stagger）；
 * - 流式输出：每条新消息各自入场（无延迟）；
 * - 效果与开关：读 localStorage 的 transition_effect 设置（与设置页同源）。
 *
 * 级联逐条应用的健壮性要点（依据真实 GUI DOM 行为修正）：
 * - 只处理“列的直接子元素锚点”（事件消息本体）。消息卡片内部（如
 *   tool-call 的展开区）还会渲染一批无 kind 的嵌套锚点，若一并收集，
 *   同一事件会被重复挂类、级联延迟被嵌套节点占用——表现为“漏网之鱼”
 *   与顺序错乱；
 * - 一次整批挂载会被 React 拆成多个 MutationObserver 回调（并发/分帧
 *   提交），用合并窗口把窗口内的挂载并入同一批，级联延迟不因分帧重置；
 * - 级联顺序按 compareDocumentPosition 的文档序，而不是节点深度；
 * - 动画结束/取消后清理 data-liuli-entered 标记，重挂载或节点复用可
 *   再次入场（不清理则同一节点永久失去动画资格）；
 * - animationend 校验事件目标，避免消息内部子元素动画冒泡导致误清理。
 */
import {
  LIULI_LS_KEY, LIULI_SETTINGS_DEFAULTS, liuliSettingsOf,
  type LiuliTransitionEffect,
} from '../liuli-settings.ts'

/** 入场基础类（liuli.css 定义 animation 属性）。 */
const ENTER_CLASS = 'liuli-enter'
/** 效果类前缀：liuli-enter-<effect>。 */
const ENTER_EFFECT_PREFIX = 'liuli-enter-'
/** 级联延迟步进与上限（批量挂载时逐条递增）。 */
const CASCADE_STEP_MS = 60
const CASCADE_CAP_MS = 600
/** 批量挂载合并窗口：窗口内多次 mutation 回调并入同一批统一级联（ms）。 */
const BATCH_WINDOW_MS = 400

/** 读取当前生效的过渡效果（与设置页同一持久化键）。 */
function currentEffect(): LiuliTransitionEffect {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (raw !== null) return liuliSettingsOf(JSON.parse(raw)).transition_effect
  } catch (_) { /* 损坏则回落默认 */ }
  return LIULI_SETTINGS_DEFAULTS.transition_effect
}

/** prefers-reduced-motion（与 liuli.css 的媒体查询一致；匹配时不挂类，避免无动画事件残留标记）。 */
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * 给一个消息锚点挂入场类；动画结束/取消后清理类与标记（节点可再次入场）。
 * 内部子元素的 animationend 会冒泡到这里，必须校验事件目标。
 */
function applyEnter(el: HTMLElement, effect: LiuliTransitionEffect, delayMs: number): void {
  if (effect === 'none' || el.dataset.liuliEntered !== undefined) return
  if (reduceMotionQuery.matches) return
  el.dataset.liuliEntered = '1'
  el.classList.add(ENTER_CLASS, ENTER_EFFECT_PREFIX + effect)
  if (delayMs > 0) el.style.setProperty('--liuli-enter-delay', `${delayMs}ms`)
  const finish = (event: AnimationEvent): void => {
    if (event.target !== el) return
    el.classList.remove(ENTER_CLASS, ENTER_EFFECT_PREFIX + effect)
    el.style.removeProperty('--liuli-enter-delay')
    delete el.dataset.liuliEntered
    el.removeEventListener('animationend', finish)
    el.removeEventListener('animationcancel', finish)
  }
  el.addEventListener('animationend', finish)
  el.addEventListener('animationcancel', finish)
}

/** 文档序比较：compareDocumentPosition 比“节点深度”可靠（深度相同会退化）。 */
function byDocumentOrder(a: HTMLElement, b: HTMLElement): number {
  if (a === b) return 0
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1
}

type ColumnState = {
  /** 窗口内收集到的待入场锚点（按 data-chat-anchor-key 去重）。 */
  pending: Map<string, HTMLElement>
  /** 合并窗口定时器。 */
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * 启动入场动画观察器：
 * - 监听 body 子树新增节点，把消息锚点按所属列分组收集；
 * - 同一合并窗口（BATCH_WINDOW_MS）内的挂载并入一批，按 DOM 文档序统一级联；
 * - 单条（流式）无延迟入场；批量逐条递增延迟。
 * @returns disposer（插件 fiber 卸载时断开观察器并清定时器）。
 */
export function startLiuliTransition(): () => void {
  const columns = new Map<HTMLElement, ColumnState>()

  /** 合并窗口到点：把本列窗口内收集的锚点按文档序统一级联。 */
  const flush = (col: HTMLElement): void => {
    const state = columns.get(col)
    if (state === undefined) return
    state.timer = null
    if (!col.isConnected) {
      // 列已卸载，丢弃残留状态
      columns.delete(col)
      return
    }
    if (state.pending.size === 0) return
    const effect = currentEffect()
    const ordered = [...state.pending.values()].sort(byDocumentOrder)
    state.pending.clear()
    if (effect === 'none') return
    const batch = ordered.length > 1
    ordered.forEach((el, index) => {
      applyEnter(el, effect, batch ? Math.min(index * CASCADE_STEP_MS, CASCADE_CAP_MS) : 0)
    })
  }

  // MutationObserver 回调里收集本次新增节点（observe 在 body 上，subtree）。
  let mutationQueue: Node[] = []
  const observer = new MutationObserver((mutations) => {
    mutationQueue = []
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) mutationQueue.push(added)
    }
    if (mutationQueue.length === 0) return
    const effect = currentEffect()
    if (effect === 'none') return
    // 收集本次挂载涉及的列：新增节点自身是列、是列的后代（锚点），
    // 或是列的祖先容器（React 整批重挂载会话视图时 added 是外层容器，
    // closest 向上找不到列——必须向下查 [data-chat-flow]）。
    const touchedCols = new Set<HTMLElement>()
    for (const node of mutationQueue) {
      if (!(node instanceof HTMLElement)) continue
      const up = node.closest<HTMLElement>('[data-chat-flow]')
      if (up !== null) touchedCols.add(up)
      if (node.matches('[data-chat-flow]')) touchedCols.add(node)
      for (const col of node.querySelectorAll<HTMLElement>('[data-chat-flow]')) touchedCols.add(col)
    }
    if (touchedCols.size === 0) return
    // 只取“列的直接子元素锚点”（事件消息本体）：整批挂载时取列的所有
    // 直接子锚点；追加时取新增的直接子锚点；嵌套锚点（tool-call 卡片
    // 内的子步骤等）一律不处理，同一事件只对顶层锚点做入场动画。
    for (const node of mutationQueue) {
      if (!(node instanceof HTMLElement)) continue
      let anchors: HTMLElement[] = []
      if (node.matches('[data-chat-flow]')) {
        // 列整批重挂载
        for (const child of node.children) {
          if (child instanceof HTMLElement && child.hasAttribute('data-chat-anchor-key')) anchors.push(child)
        }
      } else if (node.hasAttribute('data-chat-anchor-key') && node.parentElement?.matches('[data-chat-flow]')) {
        // 列的直接子锚点新增（流式/追加）
        anchors = [node]
      } else {
        // 列的祖先容器整批挂载：取容器内各列的直接子锚点
        for (const col of node.querySelectorAll('[data-chat-flow]')) {
          for (const child of col.children) {
            if (child instanceof HTMLElement && child.hasAttribute('data-chat-anchor-key')) anchors.push(child)
          }
        }
      }
      for (const anchor of anchors) {
        const col = anchor.parentElement
        if (col === null || !col.matches('[data-chat-flow]')) continue
        let state = columns.get(col)
        if (state === undefined) {
          state = { pending: new Map(), timer: null }
          columns.set(col, state)
        }
        // 同 key 只保留先收集到的节点（同一事件只入场一次）。
        const key = anchor.dataset.chatAnchorKey ?? ''
        if (key !== '' && state.pending.has(key)) continue
        state.pending.set(key, anchor)
        if (state.timer === null) {
          state.timer = setTimeout(() => flush(col), BATCH_WINDOW_MS)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const state of columns.values()) {
      if (state.timer !== null) clearTimeout(state.timer)
    }
    columns.clear()
  }
}
