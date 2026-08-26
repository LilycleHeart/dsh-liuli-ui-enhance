/**
 * 会话切换/新消息入场动画：官方 harness 的挂类逻辑在 ChatNodeSeat /
 * AssistantMarkdown 组件内部（插件无法修改组件源码），本模块用
 * MutationObserver 在消息列（官方 [data-chat-flow]，以及本插件自绘的
 * 信息流 [data-liuli-chat-flow]，两者列结构等价）的新增节点
 * （官方 [data-chat-anchor-key] / 自绘 [data-liuli-chat-anchor-key]，
 * 均须是列的直接子元素）上挂入场类，动画定义在 liuli.css。
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
 * - 例外：带 data-liuli-cascade-text 的文本级联容器（自绘信息流的文本块）
 *   是**刻意**收集的——容器整体在收集期隐藏，其内部 markdown 块级元素
 *   （顶层段落/代码块/列表/引用/表格/标题）展开为级联单元逐段入场，
 *   而不是把整段文本当一个块一次性播放；
 * - 一次整批挂载会被 React 拆成多个 MutationObserver 回调（并发/分帧
 *   提交），用合并窗口把窗口内的挂载并入同一批，级联延迟不因分帧重置；
 * - 切换会话/整体重载会先移除旧锚点再挂新内容：移除被归属到**列**并
 *   记录 removedAt，窗口内（VIEW_SWITCH_WINDOW_MS）同列追加视为
 *   「新视图」——不做同 key 快速重挂载抑制（A→B→A、seq 复用的 key 也
 *   照样重新级联），更不会出现多批次只播第一批、其余整块出现的问题；
 * - 不存在「批量冷却」：pending 只收集本批新增锚点，从不对既有行重播，
 *   冷却反而会让分批渲染/切换的部分组件丢失动画；
 * - 同 key 快速重挂载（加载完成替换、React 替换重挂载）仍由 removedKeys
 *   抑制不重播；视图切换时按 isConnected 用新节点顶替旧视图残留的
 *   pending 项，同 key 不阻塞新内容；removedKeys 是全局 Map，自绘面用
 *   useId 前缀的 key 避免跨实例冲突；
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
 *  不再重播入场动画（避免对话页加载完后又播一次）。仅对「无视图切换上下文」
 *  的整列重挂载生效；列内移除后的追加走视图切换路径，不受此抑制。 */
const REMOVED_KEY_TTL_MS = 2500
/** 视图切换窗口：列内锚点被移除后，该窗口内同列追加的新内容视为「切换/重载
 *  进来的新视图」——不做同 key 重挂载抑制（快速 A→B→A、自绘面 seq 复用的
 *  key 都重新级联），统一按新内容入场。覆盖切换时新消息分批挂载的整个加载期。 */
const VIEW_SWITCH_WINDOW_MS = 15000
/** 列创建后的初始稳定窗口：窗口内到达的锚点按防抖合并（React 分帧提交会被并成
 *  同一批级联），避免首屏与「加载完成追加」被拆成两批、后批无动画直接显示。 */
const INITIAL_SETTLE_WINDOW_MS = 3000
/** 初始稳定窗口内的防抖时间：该时间内无新锚点到达才统一播放级联动画。
 *  配合「收集即隐藏」使用：锚点从挂载起就是透明待入场状态，动画晚播也不会
 *  先显示默认内容再消失重播。 */
const INITIAL_SETTLE_MS = 400

/** 消息列选择器：官方会话列 [data-chat-flow]，以及本插件自绘信息流
 *  （侧边栏助手 / /btw 答案卡）的 [data-liuli-chat-flow]。两者列结构等价：
 *  锚点都必须是列的直接子元素。 */
const FLOW_SELECTOR = '[data-chat-flow], [data-liuli-chat-flow]'

/** 文本级联容器标记：锚点带此属性时，收集容器内部 markdown 块级元素
 *  （段落/代码块/列表/引用/表格/标题）作为级联单元逐段入场，而不是把
 *  整个文本块当一个整体播一次动画。容器本身在收集期间隐藏、flush 时
 *  恢复显示，单元用 animation-fill-mode: backwards 在各自延迟期内保持
 *  from 关键帧（不可见），因此不会出现「先显示 → 又消失重播」。 */
const CASCADE_TEXT_ATTR = 'data-liuli-cascade-text'
/** 文本级联的块级单元选择器（markdown 顶层块元素）。 */
const TEXT_UNIT_SELECTOR = 'p, pre, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6'

/** 是否消息锚点：官方 [data-chat-anchor-key] 或自绘 [data-liuli-chat-anchor-key]。 */
function isAnchor(el: HTMLElement): boolean {
  return el.hasAttribute('data-chat-anchor-key') || el.hasAttribute('data-liuli-chat-anchor-key')
}

/** 读取锚点 key（两种属性二选一；removedKeys 是全局 Map，自绘面用
 *  useId 前缀的 key 避免跨实例冲突）。 */
function anchorKeyOf(el: HTMLElement): string {
  return el.getAttribute('data-chat-anchor-key') ?? el.getAttribute('data-liuli-chat-anchor-key') ?? ''
}

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
  /** 窗口内收集到的待入场锚点（按 key 去重）。 */
  pending: Map<string, HTMLElement>
  /** 文本级联容器（收集期间隐藏、flush 时恢复显示，其内部块级单元逐段动画）。 */
  textGroups: Set<HTMLElement>
  /** 合并窗口定时器。 */
  timer: ReturnType<typeof setTimeout> | null
  /** 最近一次「列内锚点被移除」的时间戳（performance.now 基准；-Infinity 表示
   *  从未移除）。移除后同列追加视为视图切换（见 VIEW_SWITCH_WINDOW_MS）。 */
  removedAt: number
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
      if (child instanceof HTMLElement && isAnchor(child)) anchors.push(child)
    }
    return anchors
  }

  /** 从新增节点中提取列的直接子锚点（仅 added 使用；移除路径单独归属到列）。 */
  const anchorsOfNode = (node: HTMLElement): HTMLElement[] => {
    if (node.matches(FLOW_SELECTOR)) {
      // 列整批重挂载
      return directAnchors(node)
    }
    if (isAnchor(node) && node.parentElement?.matches(FLOW_SELECTOR)) {
      // 列的直接子锚点
      return [node]
    }
    // 列的祖先容器整批挂载：取容器内各列的直接子锚点
    const anchors: HTMLElement[] = []
    for (const col of node.querySelectorAll<HTMLElement>(FLOW_SELECTOR)) {
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
    // 先恢复收集期间隐藏的文本级联容器；其内部单元按各自延迟
    // （backwards 填充）逐段入场，容器恢复显示不会「先透出再消失」。
    if (state.textGroups.size > 0) {
      for (const wrapper of state.textGroups) wrapper.style.removeProperty('opacity')
      state.textGroups.clear()
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
      applyEnter(el, effect, delay)
    })
  }

  const observer = new MutationObserver((mutations) => {
    const t = now()
    // 清理过期的 removed key 记录
    for (const [key, at] of removedKeys) {
      if (t - at > REMOVED_KEY_TTL_MS) removedKeys.delete(key)
    }

    // 记录「列内锚点被移除」：切换会话/整体重载会先移除旧锚点，同列稍后追加
    // 的新内容据此识别为「新视图」——不做同 key 抑制、不丢弃动画资格。
    // 被移除锚点的 key 同时进 removedKeys（供整列重挂载路径的加载替换识别）。
    // 若列本身已随整批移除（detached），其状态无后续用途，直接清掉
    // （含隐藏中的文本容器恢复），避免切换会话后残留过期列状态。
    const markColumnRemoval = (col: HTMLElement): void => {
      if (!col.isConnected) {
        const stale = columns.get(col)
        if (stale !== undefined) {
          if (stale.timer !== null) clearTimeout(stale.timer)
          for (const wrapper of stale.textGroups) wrapper.style.removeProperty('opacity')
          columns.delete(col)
        }
        return
      }
      let state = columns.get(col)
      if (state === undefined) {
        state = { pending: new Map(), textGroups: new Set(), timer: null, removedAt: t, createdAt: t }
        columns.set(col, state)
      } else {
        state.removedAt = t
      }
    }
    for (const mutation of mutations) {
      const target = mutation.target instanceof HTMLElement ? mutation.target : null
      for (const removed of mutation.removedNodes) {
        if (!(removed instanceof HTMLElement)) continue
        if (isAnchor(removed) && target?.matches(FLOW_SELECTOR)) {
          // 列的直接子锚点被移除：列即 target（removed 的 parentElement 已为 null）
          const key = anchorKeyOf(removed)
          if (key !== '') removedKeys.set(key, t)
          markColumnRemoval(target)
          continue
        }
        if (removed.matches(FLOW_SELECTOR)) {
          // 列整批重挂载：记录其直接锚点，并清理该列及其内嵌子列（assistant
          // 消息子列等）的过期状态
          for (const anchor of directAnchors(removed)) {
            const key = anchorKeyOf(anchor)
            if (key !== '') removedKeys.set(key, t)
          }
          markColumnRemoval(removed)
          for (const inner of removed.querySelectorAll<HTMLElement>(FLOW_SELECTOR)) {
            markColumnRemoval(inner)
          }
          continue
        }
        // 列的祖先容器整批移除：归属到容器内各列
        for (const col of removed.querySelectorAll<HTMLElement>(FLOW_SELECTOR)) {
          for (const anchor of directAnchors(col)) {
            const key = anchorKeyOf(anchor)
            if (key !== '') removedKeys.set(key, t)
          }
          markColumnRemoval(col)
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

    // 先收集本批全部「列直接子锚点」。文本级联容器（data-liuli-cascade-text）
    // 不直接入列：容器整体隐藏，其内部 markdown 块级元素展开为级联单元（见下）。
    const batchAnchors: Array<{ anchor: HTMLElement; col: HTMLElement; key: string }> = []
    const textGroupWrappers: Array<{ wrapper: HTMLElement; col: HTMLElement }> = []
    for (const node of addedQueue) {
      if (!(node instanceof HTMLElement)) continue
      for (const anchor of anchorsOfNode(node)) {
        const col = anchor.parentElement
        if (col === null || !col.matches(FLOW_SELECTOR)) continue
        if (anchor.hasAttribute(CASCADE_TEXT_ATTR)) {
          textGroupWrappers.push({ wrapper: anchor, col })
          continue
        }
        batchAnchors.push({ anchor, col, key: anchorKeyOf(anchor) })
      }
    }

    // 列状态实用函数
    const stateOf = (col: HTMLElement): ColumnState => {
      let state = columns.get(col)
      if (state === undefined) {
        state = { pending: new Map(), textGroups: new Set(), timer: null, removedAt: -Infinity, createdAt: t }
        columns.set(col, state)
      }
      return state
    }
    /** 视图切换：该列在窗口内被移除过锚点，这批追加属于换进来的「新视图」。 */
    const isViewSwitch = (state: ColumnState): boolean =>
      state.removedAt !== -Infinity && t - state.removedAt <= VIEW_SWITCH_WINDOW_MS

    // 文本级联容器展开：容器本身收集期间隐藏（不透出文本），内部「最外层」
    // 块级单元（排除嵌套在其它单元内的，如 blockquote 里的 p、ul 里的 li）
    // 作为锚点逐段入场，单元 key 用 `<容器key>:u<j>` 保证全局唯一。
    // 视图切换（换会话）时不做同 key 抑制——新会话的文本照样逐段级联；
    // 非切换的同 key 快速重挂载（加载完成替换）整体跳过不重播。
    for (const { wrapper, col } of textGroupWrappers) {
      const state = stateOf(col)
      const wrapperKey = anchorKeyOf(wrapper)
      if (isViewSwitch(state)) {
        if (wrapperKey !== '') removedKeys.delete(wrapperKey)
      } else {
        const removedAt = wrapperKey !== '' ? removedKeys.get(wrapperKey) : undefined
        if (removedAt !== undefined && t - removedAt <= REMOVED_KEY_TTL_MS) {
          removedKeys.delete(wrapperKey)
          continue
        }
      }
      const matched = wrapper.querySelectorAll<HTMLElement>(TEXT_UNIT_SELECTOR)
      const units: HTMLElement[] = []
      for (const unit of matched) {
        if (units.some((p) => p.contains(unit))) continue
        units.push(unit)
      }
      if (units.length === 0) continue
      // 收集即隐藏：等待合并期间容器不透出文本（单元的 backwards 填充会在
      // 各自延迟期内保持不可见；flush 恢复容器显示后不会「先显示再消失」）。
      if (!reduceMotionQuery.matches) wrapper.style.opacity = '0'
      state.textGroups.add(wrapper)
      for (let j = 0; j < units.length; j++) {
        const unit = units[j]
        if (unit === undefined) continue
        batchAnchors.push({ anchor: unit, col, key: `${wrapperKey}:u${j}` })
      }
      // 保证 flush 一定会发生：即使单元随后被去重跳过，
      // 容器也要恢复显示（否则文本永久透明）。
      if (t - state.createdAt < INITIAL_SETTLE_WINDOW_MS) {
        if (state.timer !== null) clearTimeout(state.timer)
        state.timer = setTimeout(() => flush(col), INITIAL_SETTLE_MS)
      } else if (state.timer === null) {
        state.timer = setTimeout(() => flush(col), BATCH_WINDOW_MS)
      }
    }

    for (const { anchor, col, key } of batchAnchors) {
      const state = stateOf(col)
      const viewSwitch = isViewSwitch(state)
      if (viewSwitch) {
        // 视图切换：同 key 快速重挂载抑制作废（新对话/新内容复用相同 key
        // （如自绘面 `<surfaceId>:<seq>` 序号从头开始）也重新级联入场）。
        if (key !== '') removedKeys.delete(key)
      } else {
        // 同 key 刚被移除又挂载（React 替换重挂载/整列重挂载的加载完成替换）：
        // 直接显示，不重播。
        const removedAt = key !== '' ? removedKeys.get(key) : undefined
        if (removedAt !== undefined && t - removedAt <= REMOVED_KEY_TTL_MS) {
          removedKeys.delete(key)
          continue
        }
      }
      // 同 key 只保留先收集到的节点（同一事件只入场一次）；若已有条目是旧视图
      // 残留（已卸载），用新节点顶替，不阻塞新内容。
      const existing = key !== '' ? state.pending.get(key) : undefined
      if (existing !== undefined && existing.isConnected) continue
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