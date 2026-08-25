/**
 * 切换会话默认历史加载量 —— 设置页「功能」分区（liuli-features）里的一个区块。
 *
 * 调节切换会话时插件自动点击“加载更早消息”按钮的批次数。宿主默认只预载
 * 少量历史（通常两轮），这里允许用户调大，让每个会话打开时自动加载更多轮。
 *
 * 纯展示组件：状态与写入面（load/save）由「功能」分区从合并 store /
 * 注入面传入，本组件不直接持有槽位 store。
 *
 * 持久化在 localStorage（liuli:history-load-batches），只影响插件自身行为。
 */
import { useEffect } from 'react'
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HistoryLoadState } from './history-load-store.ts'
import css from './HistoryLoadRow.module.css'

/** 展示面：历史加载状态 + 读取/保存入口。 */
export interface HistoryLoadRowProps {
  /** 当前持久化批次数快照（来自功能分区合并 store）。 */
  state: HistoryLoadState
  /** 功能分区命名空间的翻译函数（键带 historyLoad. 前缀）。 */
  t: TranslateNS<'liuli-features'>
  /** 读取当前持久化的批次数（并同步 store）。 */
  load: () => number
  /** 保存批次数（并同步 store）。 */
  save: (batches: number) => void
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
 * 渲染切换会话默认历史加载量行。
 * @param props - 状态 + 读写面。
 * @returns 行元素树。
 */
export function HistoryLoadRow({ state, t, load, save }: HistoryLoadRowProps) {
  // 挂载时同步一次当前持久化值。
  useEffect(() => {
    load()
  }, [load])

  return (
    <div className={css.group}>
      <div className={css.title}>{t('historyLoad.title')}</div>
      <NumRow
        label={t('historyLoad.batches')}
        hint={t('historyLoad.batchesHint')}
        value={state.batches}
        min={0}
        max={20}
        unit={t('historyLoad.rounds')}
        onCommit={(v) => { save(v) }}
      />
      {state.error !== '' && <div className={css.error}>{state.error}</div>}
    </div>
  )
}
