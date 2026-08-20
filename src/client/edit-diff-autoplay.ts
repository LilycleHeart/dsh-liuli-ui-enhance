/**
 * 琉璃主题 · 对话页 edit/write 工具行自动展开 + diff 注入。
 *
 * [live-check] 2026-08-20 轮次卡片联调标记（用户在 GUI 中确认卡片渲染）。
 *
 * 上游 ui-tool 的 ToolRow 把 diff 放在可折叠 body 里（默认收起，点行展开）；
 * 且当前 DSH 版本 tool/result 事件不携带视图/meta，行内没有 DiffBlock。
 * 本模块：
 * - 把带 diff 的 edit/write 行自动展开一次（行行标记，虚拟化重挂载后重试）；
 * - 展开后若仍无 diff 内容，从 TurnFileCard 维护的 path→hunks 缓存
 *   （window.__liuliDiffCache，由 edit/write 参数合成）取该文件的最新 hunks，
 *   注入一个简化的 +/− diff 视图。
 */
import type { FileDiffHunk } from './TurnFileCard.tsx'

interface InjectedRow extends HTMLElement {
  dataset: {
    liuliDiffAuto?: string
    liuliDiffInjected?: string
  }
}

/** 把一个 hunk 渲染成简化的 +/− 行。 */
function renderHunk(hunk: FileDiffHunk): string {
  const rows: string[] = []
  if (hunk.oldText !== null && hunk.oldText !== '') {
    rows.push(...hunk.oldText.split('\n').map(line => '-' + line))
  }
  if (hunk.newText !== '') {
    rows.push(...hunk.newText.split('\n').map(line => '+' + line))
  }
  return rows.join('\n')
}

/** 从工具行的摘要里取文件路径（edit/write 的摘要是一个 file link）。 */
function rowFilePath(row: HTMLElement): string | null {
  const link = row.querySelector<HTMLElement>('[class*="fileLink"], [class*="summary"]')
  const text = link?.textContent?.trim() ?? ''
  if (text === '') return null
  return text
}

/** 把 diff 注入到已展开行的 bodyWrap（插到 ioCard 之前）。 */
function injectDiff(row: HTMLElement, hunks: readonly FileDiffHunk[]): boolean {
  if (hunks.length === 0) return false
  const wrap = row.querySelector<HTMLElement>('[class*="bodyWrap"]')
  if (wrap === null) return false
  if (wrap.querySelector('[data-liuli-injected-diff]') !== null) return false
  const pre = document.createElement('pre')
  pre.setAttribute('data-liuli-injected-diff', '')
  const style = [
    'margin:0',
    'padding:6px 8px',
    'font-size:11px',
    'line-height:16px',
    'font-family:var(--ds-font-family-code, ui-monospace, monospace)',
    'white-space:pre',
    'overflow-x:auto',
    'color:var(--dsw-alias-label-primary, inherit)',
  ].join(';')
  pre.style.cssText = style
  pre.textContent = renderHunk(hunks[0]!)
  wrap.insertBefore(pre, wrap.firstChild)
  return true
}

/** 启动编辑 diff 自动展开 + 注入的 MutationObserver；返回清理函数。 */
export function startEditDiffAutoExpand(): () => void {
  let raf = 0
  const tick = (): void => {
    raf = 0
    const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroll === null) return
    const rows = scroll.querySelectorAll<InjectedRow>('[data-tool="edit"], [data-tool="write"]')
    const cache = window.__liuliDiffCache
    for (const row of rows) {
      if (row.dataset.liuliDiffAuto !== '1') {
        row.dataset.liuliDiffAuto = '1'
        const target = row.querySelector<HTMLElement>('[data-expandable]')
        if (target !== null) {
          const body = row.querySelector<HTMLElement>('[class*="diffBody"]')
          const already = body !== null && body.getClientRects().length > 0
          if (!already) target.click()
        }
      }
      // 展开后若仍无 diff 卡片，注入简化 diff（来自参数合成缓存）。
      if (row.dataset.liuliDiffInjected !== '1') {
        const hasReal = row.querySelector<HTMLElement>('[class*="diffBody"]') !== null
          || row.querySelector('[data-liuli-injected-diff]') !== null
        if (!hasReal && cache !== undefined) {
          const path = rowFilePath(row)
          if (path !== null) {
            const hunks = cache.get(path)
            if (hunks !== undefined && hunks.length > 0 && injectDiff(row, hunks)) {
              row.dataset.liuliDiffInjected = '1'
            }
          }
        }
      }
    }
  }
  const schedule = (): void => {
    if (raf === 0) raf = requestAnimationFrame(tick)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()
  return () => {
    observer.disconnect()
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}
