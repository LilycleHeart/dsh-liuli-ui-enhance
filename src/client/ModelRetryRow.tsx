/**
 * 模型请求重试行 —— 设置页「功能」分区（liuli-features）里的一个区块。
 *
 * 编辑模型请求的重试次数与重试等待时间（首次退避），写入由宿主各供应商
 * profile 持有的 retryPolicy.normal.{maxRetries, backoff.initialDelayMs}，
 * 由 @deepseek-ai/dsh-llm-retry 在 agent 失败步骤上执行。
 *
 * 纯展示组件：状态与写入面（reload/save）由「功能」分区从合并 store /
 * 注入面传入，本组件不直接持有槽位 store。
 *
 * 行为：
 * - 挂载时经 reload 拉取聚合展示值（首个已配置供应商的 retryPolicy +
 *   已配置供应商数量）。
 * - 改值后失焦/回车即保存（path-addressed settings.mutate，对每个已配置
 *   供应商写 retryPolicy 键；不碰密钥等其它字段）。
 * - 写入失败展示错误文本，不阻塞后续重试。
 */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelRetryState } from './model-retry-store.ts'
import css from './ModelRetryRow.module.css'

/** 展示面：模型重试状态 + 写入/刷新入口。 */
export interface ModelRetryRowProps {
  /** 聚合后的重试参数快照（来自功能分区合并 store）。 */
  state: ModelRetryState
  /** 功能分区命名空间的翻译函数（键带 modelRetry. 前缀）。 */
  t: TranslateNS<'liuli-features'>
  /** 保存重试次数与首次等待；返回错误信息（成功为 undefined）。 */
  save: (params: { maxRetries: number; initialDelayMs: number }) => Promise<string | undefined>
  /** 重新拉取聚合展示值。 */
  reload: () => Promise<void>
}

/** 数字输入行：标签 + 提示 + 数字输入框 + 单位。 */
function NumRow(props: {
  label: string
  hint?: string
  value: number
  unit?: string
  min: number
  max: number
  step?: number
  disabled?: boolean
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => { setDraft(String(props.value)) }, [props.value])
  const commit = (): void => {
    const v = Number(draft)
    if (Number.isFinite(v) && draft.trim() !== '') {
      const clamped = Math.max(props.min, Math.min(props.max, v))
      if (clamped !== props.value) props.onCommit(clamped)
      setDraft(String(clamped))
    } else {
      setDraft(String(props.value))
    }
  }
  return (
    <div className={css.row}>
      <span className={css.label}>
        {props.label}
        {props.hint !== undefined && <span className={css.hint}>{props.hint}</span>}
      </span>
      <span className={css.control}>
        <input
          type="number"
          className={css.numInput}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={draft}
          disabled={props.disabled === true}
          onChange={(e) => { setDraft(e.target.value) }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
        />
        {props.unit !== undefined && <span className={css.unit}>{props.unit}</span>}
      </span>
    </div>
  )
}

/**
 * 渲染模型请求重试行。
 * @param props - 状态 + 写入面。
 * @returns 行元素树。
 */
export function ModelRetryRow({ state, t, save, reload }: ModelRetryRowProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 挂载时拉取一次聚合展示值。
  useEffect(() => {
    let alive = true
    setBusy(true)
    setError('')
    void reload().finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [reload])

  const onSave = async (patch: { maxRetries?: number; initialDelayMs?: number }): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = {
        maxRetries: patch.maxRetries ?? state.maxRetries,
        initialDelayMs: patch.initialDelayMs ?? state.initialDelayMs,
      }
      const err = await save(next)
      if (err !== undefined) setError(err)
      else await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.group}>
      <div className={css.title}>{t('modelRetry.title')}</div>
      <NumRow
        label={t('modelRetry.maxRetries')}
        hint={t('modelRetry.maxRetriesHint')}
        value={state.maxRetries}
        min={0}
        max={20}
        unit={t('modelRetry.times')}
        disabled={busy}
        onCommit={(v) => { void onSave({ maxRetries: v }) }}
      />
      <NumRow
        label={t('modelRetry.initialDelay')}
        hint={t('modelRetry.initialDelayHint')}
        value={state.initialDelayMs}
        min={100}
        max={60_000}
        step={100}
        unit={t('modelRetry.ms')}
        disabled={busy}
        onCommit={(v) => { void onSave({ initialDelayMs: v }) }}
      />
      <div className={css.footer}>
        {error !== '' && <span className={css.error}>{error}</span>}
        {state.providerCount > 0 && (
          <span className={css.providerCount}>{t('modelRetry.providerCount').replace('{count}', String(state.providerCount))}</span>
        )}
      </div>
    </div>
  )
}
