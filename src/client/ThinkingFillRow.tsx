/**
 * 思考等级自动补全行 —— 设置页「功能」分区（liuli-features）里的一个区块。
 *
 * 扫描所有 llm-pi-ai 自定义提供商：对缺失思考等级声明（模型 reasoningEfforts
 * 或提供商 compat.thinkingFormat / supportsReasoningEffort）的一键补全，
 * 写入由 thinking-fill-controller 经 path-addressed settings.mutate 落到配置
 * 文件（~/.dsh/settings.yaml 的 llm-pi-ai.providers.<路由>）。
 *
 * 纯展示组件：状态与写入面（reload/apply）由「功能」分区从合并 store /
 * 注入面传入，本组件不直接持有槽位 store。
 *
 * 行为：
 * - 挂载时经 reload 拉取待补全数量。
 * - providerCount>0 显示「一键补全」；补全成功后刷新展示并提示已补数量。
 * - 无待补全显示「已全部声明」+ 重新检测入口。
 * - 写入失败展示错误文本，不阻塞后续重试。
 */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThinkingFillState } from './thinking-fill-store.ts'
import css from './ThinkingFillRow.module.css'

/** 展示面：思考等级补全状态 + 写入/刷新入口。 */
export interface ThinkingFillRowProps {
  /** 待补全数量与读写态快照（来自功能分区合并 store）。 */
  state: ThinkingFillState
  /** 功能分区命名空间的翻译函数（键带 thinkingFill. 前缀）。 */
  t: TranslateNS<'liuli-features'>
  /** 一键补全；返回错误信息（成功为 undefined）。 */
  apply: () => Promise<string | undefined>
  /** 重新扫描待补全数量。 */
  reload: () => Promise<void>
}

/**
 * 渲染思考等级自动补全行。
 * @param props - 状态 + 写入面。
 * @returns 行元素树。
 */
export function ThinkingFillRow({ state, t, apply, reload }: ThinkingFillRowProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 挂载时扫描一次待补全数量。
  useEffect(() => {
    let alive = true
    setBusy(true)
    setError('')
    void reload().finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [reload])

  const onApply = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const err = await apply()
      if (err !== undefined) setError(err)
    } finally {
      setBusy(false)
    }
  }

  const onRescan = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const ready = state.status === 'ready' || state.status === 'idle'
  const needs = state.providerCount > 0

  return (
    <div className={css.group}>
      <div className={css.titleRow}>
        <span className={css.title}>{t('thinkingFill.title')}</span>
      </div>
      <div className={css.hint}>{t('thinkingFill.hint')}</div>
      <div className={css.footer}>
        {!!state.lastFilled && !needs && (
          <span className={css.done}>
            {t('thinkingFill.done').replace('{p}', String(state.lastFilled.providers)).replace('{m}', String(state.lastFilled.models))}
          </span>
        )}
        {needs && ready && (
          <span className={css.needs}>
            {t('thinkingFill.needs').replace('{p}', String(state.providerCount)).replace('{m}', String(state.modelCount))}
          </span>
        )}
        {!needs && ready && !state.lastFilled && (
          <span className={css.ok}>{t('thinkingFill.ok')}</span>
        )}
        {error !== '' && <span className={css.error}>{error}</span>}
        <span className={css.actions}>
          {needs && ready && (
            <button type="button" className={css.actionBtn} disabled={busy} onClick={() => { void onApply() }}>
              {t('thinkingFill.apply')}
            </button>
          )}
          <button type="button" className={css.ghostBtn} disabled={busy} onClick={() => { void onRescan() }}>
            {t('thinkingFill.rescan')}
          </button>
        </span>
      </div>
    </div>
  )
}