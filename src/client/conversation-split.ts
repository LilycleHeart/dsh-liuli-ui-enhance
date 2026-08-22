/**
 * 对话页双容器拆分（advanced dock 模式）：
 *  - 官方 ConversationRoot 的 DOM 为
 *      div[data-phase]
 *      ├── div[data-slot="conversation.session.header"]  (inline style: display: contents)
 *      │   └── header
 *      └── div[data-conversation-scroll]                  (正文滚动卡片)
 *    两个子节点本身并列，但 header 槽位容器是 display: contents，视觉上
 *    不构成“容器”。本模块给这两个子节点打上稳定的数据属性标记，
 *    由 liuli-css.ts 把 header 槽位容器转成真正的 flex 容器、正文容器
 *    占满剩余空间 —— 不移动任何 React 管理的 DOM 节点，避免破坏宿主渲染。
 *  - 只在 advanced dock 模式（DockShellFrame 的 conversation 面板）内生效；
 *    兼容旧版结构（header 直接作为 div[data-phase] 子级）。
 */

const SPLIT_ATTR = 'data-liuli-conversation-split'
const HEADER_CONTAINER_ATTR = 'data-liuli-conversation-header-container'
const BODY_CONTAINER_ATTR = 'data-liuli-conversation-body-container'

/** 会话根：只在 dock conversation 面板内查找，避免影响普通三列模式。 */
const PHASE_SELECTOR = '[data-region-pane="region:conversation"] div[data-phase]'

/** 给一个 div[data-phase] 的直接子节点打容器标记。 */
function tagPhase(phase: HTMLElement): void {
  phase.setAttribute(SPLIT_ATTR, '')
  // 旧版结构：header 直接是 phase 子级；新版结构：header 包在 slot 占位 div 内。
  const headerHost =
    phase.querySelector<HTMLElement>(':scope > div[data-slot="conversation.session.header"]')
    ?? phase.querySelector<HTMLElement>(':scope > header')
  const bodyHost = phase.querySelector<HTMLElement>(':scope > [data-conversation-scroll]')
  if (headerHost !== null) headerHost.setAttribute(HEADER_CONTAINER_ATTR, '')
  if (bodyHost !== null) bodyHost.setAttribute(BODY_CONTAINER_ATTR, '')
}

/** 扫描 root 下所有 conversation 面板的会话根并标记。 */
export function tagConversationContainers(root: ParentNode): void {
  for (const phase of root.querySelectorAll<HTMLElement>(PHASE_SELECTOR)) tagPhase(phase)
}

/**
 * 启动 body 级观察：会话切换 / 面板重挂后新出现的会话根自动补标记。
 * 仅标记属性，CSS 负责容器布局；disposer 只断开观察，不撤销已打标记。
 */
export function startConversationSplit(): () => void {
  const scan = (): void => { tagConversationContainers(document) }

  const bodyObserver = new MutationObserver((mutations) => {
    let touched = false
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue
        if (added.matches(PHASE_SELECTOR) || added.querySelector(PHASE_SELECTOR) !== null) {
          touched = true
          break
        }
      }
      if (touched) break
    }
    if (touched) scan()
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })

  // 初始扫描：启动时 conversation 面板可能已经挂载。
  scan()

  return () => {
    bodyObserver.disconnect()
  }
}
