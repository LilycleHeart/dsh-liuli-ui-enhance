/**
 * 模型请求重试行 —— 设置页「通用」分区里的一行（settings.general.item 槽位）。
 *
 * 编辑模型请求的重试次数与重试等待时间（首次退避），写入由宿主各供应商
 * profile 持有的 retryPolicy.normal.{maxRetries, backoff.initialDelayMs}，
 * 由 @deepseek-ai/dsh-llm-retry 在 agent 失败步骤上执行。
 *
 * 行为：
 * - 挂载时经 model-retry-controller 拉取聚合展示值（首个已配置供应商的
 *   retryPolicy + 已配置供应商数量）。
 * - 改值后失焦/回车即保存（path-addressed settings.mutate，对每个已配置
 *   供应商写 retryPolicy 键；不碰密钥等其它字段）。
 * - 写入失败展示错误文本，不阻塞后续重试。
 *
 * 只修改 dsh-liuli-ui-enhance 插件自身代码，不触碰宿主通用设置分区其它行。
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createModelRetryStore } from './model-retry-store.ts'
// model-retry-controller 的 load/save/cache 由 index.ts 经注入面接线，行组件不直接 import。
import css from './ModelRetryRow.module.css'

/** 注入面：保存重试参数。 */
export interface ModelRetryRowInjected {
  /** 保存重试次数与首次等待；返回错误信息（成功为 undefined）。 */
  save: (params: { maxRetries: number; initialDelayMs: number }) => Promise<string | undefined>
  /** 重新拉取聚合展示值。 */
  reload: () => Promise<void>
}

/** 完整组件 props：runtime share + store share + locale seat + 注入面。 */
export type ModelRetryRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createModelRetryStore>>
  & PropsLocale<'liuli-model-retry'> & ModelRetryRowInjected

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
 * @param props - 组合槽位 props。
 * @returns 行元素树。
 */
export function ModelRetryRow({ t, useStore, save, reload }: ModelRetryRowComponentProps) {
  const state = useStore(s => s)
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
      <div className={css.title}>{t('title')}</div>
      <NumRow
        label={t('maxRetries')}
        hint={t('maxRetriesHint')}
        value={state.maxRetries}
        min={0}
        max={20}
        unit={t('times')}
        disabled={busy}
        onCommit={(v) => { void onSave({ maxRetries: v }) }}
      />
      <NumRow
        label={t('initialDelay')}
        hint={t('initialDelayHint')}
        value={state.initialDelayMs}
        min={100}
        max={60_000}
        step={100}
        unit={t('ms')}
        disabled={busy}
        onCommit={(v) => { void onSave({ initialDelayMs: v }) }}
      />
      <div className={css.footer}>
        {error !== '' && <span className={css.error}>{error}</span>}
        {state.providerCount > 0 && (
          <span className={css.providerCount}>{t('providerCount').replace('{count}', String(state.providerCount))}</span>
        )}
      </div>
    </div>
  )
}
