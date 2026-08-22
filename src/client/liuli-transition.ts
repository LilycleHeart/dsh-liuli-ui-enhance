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
/** 级联延迟步进（视口内可见锚点逐条递增）。30ms 步进让视口内组件有清晰
 *  的错峰，而不是整个消息列一起出现。 */
const CASCADE_STEP_MS = 30
/** 级联延迟上限：视口内最多约 20 个组件参与递增，其余 delay=0。 */
const CASCADE_CAP_MS = 600
/** 批量挂载合并窗口：窗口内多次 mutation 回调并入同一批统一级联（ms）。 */
const BATCH_WINDOW_MS = 400
/** 最近移除锚点 key 的保留窗口：同 key 在窗口内重新挂载视为「加载完成替换」，
 *  不再重播入场动画（避免对话页加载完后又播一次）。 */
const REMOVED_KEY_TTL_MS = 4000
/** 同列批量动画冷却：一次批量入场后，短时间内同列继续批量挂载（历史分批渲染）
 *  不再重播；只对批量追加生效（单条流式不受影响）。覆盖加载尾巴的批量追加。 */
const COLUMN_BATCH_COOLDOWN_MS = 15000
/** 列创建后的初始稳定窗口：窗口内到达的锚点按防抖合并（React 分帧提交会被并成
 *  同一批级联），避免首屏与「加载完成追加」被拆成两批、后批无动画直接显示。 */
const INITIAL_SETTLE_WINDOW_MS = 3000
/** 初始稳定窗口内的防抖时间：该时间内无新锚点到达才统一播放级联动画。
 *  配合「收集即隐藏」使用：锚点从挂载起就是透明待入场状态，动画晚播也不会
 *  先显示默认内容再消失重播。 */
const INITIAL_SETTLE_MS = 400

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
  // 收集阶段可能已把锚点隐藏（opacity:0）等待合并；无论是否真正挂类，
  // 都先恢复默认透明，交给动画的 from 关键帧（backwards）或直接显示。
  el.style.removeProperty('opacity')
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
  /** 上次批量入场动画的时间戳（performance.now 基准）；用于同列冷却。 */
  lastBatchAt: number
  /** 列状态创建时间（performance.now 基准）；用于初始稳定窗口判断。 */
  createdAt: number
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
  /** 最近被移除的锚点 key → 移除时间戳（performance.now 基准）。 */
  const removedKeys = new Map<string, number>()

  const now = (): number => performance.now()

  /** 取“列的直接子元素锚点”（事件消息本体）。嵌套锚点一律不处理。 */
  const directAnchors = (col: HTMLElement): HTMLElement[] => {
    const anchors: HTMLElement[] = []
    for (const child of col.children) {
      if (child instanceof HTMLElement && child.hasAttribute('data-chat-anchor-key')) anchors.push(child)
    }
    return anchors
  }

  /** 从新增/移除节点中提取列的直接子锚点（对称处理 added 与 removed）。 */
  const anchorsOfNode = (node: HTMLElement): HTMLElement[] => {
    if (node.matches('[data-chat-flow]')) {
      // 列整批重挂载
      return directAnchors(node)
    }
    if (node.hasAttribute('data-chat-anchor-key') && node.parentElement?.matches('[data-chat-flow]')) {
      // 列的直接子锚点
      return [node]
    }
    // 列的祖先容器整批挂载：取容器内各列的直接子锚点
    const anchors: HTMLElement[] = []
    for (const col of node.querySelectorAll<HTMLElement>('[data-chat-flow]')) {
      anchors.push(...directAnchors(col))
    }
    return anchors
  }

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
    if (effect === 'none') {
      // 收集阶段可能已把锚点隐藏；动画被关闭时恢复可见。
      for (const el of ordered) el.style.removeProperty('opacity')
      return
    }
    const batch = ordered.length > 1
    // 只对视口内可见的锚点播放动画：视口外锚点直接恢复显示、不挂类。
    // 否则长会话切换时 180+ 个元素同时启动动画，主线程/合成器非常卡顿；
    // 视口外元素滚动到时已经就绪，用户不会感知。
    let visibleIndex = 0
    let animatedCount = 0
    const viewportBottom = window.innerHeight
    ordered.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const visible = rect.height > 0 && rect.bottom > 0 && rect.top < viewportBottom
      if (!visible) {
        // 视口外：直接显示（清除收集阶段的 opacity:0），不挂动画类。
        el.style.removeProperty('opacity')
        return
      }
      // 视口内：按文档序递增 delay（30ms 步进、600ms cap）。
      const delay = batch ? Math.min(visibleIndex * CASCADE_STEP_MS, CASCADE_CAP_MS) : 0
      visibleIndex += 1
      animatedCount += 1
      applyEnter(el, effect, delay)
    })
    if (batch && animatedCount > 0) state.lastBatchAt = now()
  }

  const observer = new MutationObserver((mutations) => {
    // 清理过期的 removed key 记录
    const t = now()
    for (const [key, at] of removedKeys) {
      if (t - at > REMOVED_KEY_TTL_MS) removedKeys.delete(key)
    }

    // 先记录本批被移除的锚点：同 key 稍后重新挂载视为替换，不重播动画。
    // 同时记录本批是否存在「锚点移除」——切换会话/替换重挂载会先移除旧锚点，
    // 此时冷却护栏不应生效（只有纯追加的历史分批渲染才走同列冷却）。
    let hasRemovedAnchors = false
    for (const mutation of mutations) {
      const target = mutation.target instanceof HTMLElement ? mutation.target : null
      for (const removed of mutation.removedNodes) {
        if (!(removed instanceof HTMLElement)) continue
        // 被移除的单个锚点 parentElement 已为 null，须借助 mutation.target
        // 判断它原本是否直接挂在 [data-chat-flow] 列下。
        if (removed.hasAttribute('data-chat-anchor-key') && target?.matches('[data-chat-flow]')) {
          hasRemovedAnchors = true
          const key = removed.dataset.chatAnchorKey ?? ''
          if (key !== '') removedKeys.set(key, t)
          continue
        }
        const removedAnchors = anchorsOfNode(removed)
        if (removedAnchors.length > 0) hasRemovedAnchors = true
        for (const anchor of removedAnchors) {
          const key = anchor.dataset.chatAnchorKey ?? ''
          if (key !== '') removedKeys.set(key, t)
        }
      }
    }

    // 再收集本批新增锚点（observe 在 body 上，subtree）。
    const addedQueue: Node[] = []
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) addedQueue.push(added)
    }
    if (addedQueue.length === 0) return
    const effect = currentEffect()
    if (effect === 'none') return

    // 先收集本批全部「列直接子锚点」，用于区分批量追加与单条流式。
    const batchAnchors: Array<{ anchor: HTMLElement; col: HTMLElement; key: string }> = []
    for (const node of addedQueue) {
      if (!(node instanceof HTMLElement)) continue
      for (const anchor of anchorsOfNode(node)) {
        const col = anchor.parentElement
        if (col === null || !col.matches('[data-chat-flow]')) continue
        batchAnchors.push({ anchor, col, key: anchor.dataset.chatAnchorKey ?? '' })
      }
    }
    const totalAdded = batchAnchors.length

    for (const { anchor, col, key } of batchAnchors) {
      // 1) 同 key 刚被移除又挂载（React 替换重挂载）：直接显示，不重播。
      const removedAt = key !== '' ? removedKeys.get(key) : undefined
      if (removedAt !== undefined && t - removedAt <= REMOVED_KEY_TTL_MS) {
        removedKeys.delete(key)
        continue
      }
      let state = columns.get(col)
      if (state === undefined) {
        state = { pending: new Map(), timer: null, lastBatchAt: -Infinity, createdAt: t }
        columns.set(col, state)
      }
      // 2) 同列刚播过一批动画且本批是「纯批量追加」（历史分批渲染的后续
      //    批次）：直接显示，不重播。单条流式（totalAdded === 1）始终动画；
      //    切换会话/替换会先移除旧锚点，走 removedKeys 或正常动画路径。
      if (!hasRemovedAnchors && totalAdded > 1 && t - state.lastBatchAt <= COLUMN_BATCH_COOLDOWN_MS) continue
      // 同 key 只保留先收集到的节点（同一事件只入场一次）。
      if (key !== '' && state.pending.has(key)) continue
      // 收集即隐藏：等待合并期间不让锚点以默认状态先显示，避免动画晚播时
      // 出现「先显示 → 又消失重播」的两次加载观感。reduce motion 时不隐藏。
      if (!reduceMotionQuery.matches) anchor.style.opacity = '0'
      state.pending.set(key, anchor)
      // 初始稳定窗口内：React 常把首屏 + 历史加载完成拆成多个 mutation
      // 批次提交，这里用防抖把窗口内到达的锚点并成同一批，保证级联覆盖
      // 全部组件；窗口结束后回到固定合并窗口（流式输出不受防抖拖慢）。
      if (t - state.createdAt < INITIAL_SETTLE_WINDOW_MS) {
        if (state.timer !== null) clearTimeout(state.timer)
        state.timer = setTimeout(() => flush(col), INITIAL_SETTLE_MS)
      } else if (state.timer === null) {
        state.timer = setTimeout(() => flush(col), BATCH_WINDOW_MS)
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
    removedKeys.clear()
  }
}
