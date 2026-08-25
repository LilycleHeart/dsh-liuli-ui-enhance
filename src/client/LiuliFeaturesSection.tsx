/**
 * 琉璃 设置 section（设置页「功能」分区）：宽边模式 / 会话切换动画 / 声纹响应 /
 * 模型请求重试 / 切换会话默认历史加载。
 *
 * 与「外观」分区（LiuliAppearanceSection）共享同一个 liuli store 实例：
 * settings（宽边/动画/声纹）经 useStore 读取，模型重试与历史加载状态在合并
 * store 的 modelRetry / historyLoad 切片里，由下方两个展示行组件渲染。
 */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LiuliSettings } from '../liuli-settings.ts'
import { LIULI_SETTINGS_DEFAULTS } from '../liuli-settings.ts'
import type { createLiuliStore } from './liuli-store.ts'
import { SelectRow, SliderRow, ToggleRow } from './LiuliAppearance.tsx'
import { ModelRetryRow } from './ModelRetryRow.tsx'
import { HistoryLoadRow } from './HistoryLoadRow.tsx'
import css from './LiuliAppearance.module.css'

/** 注入面：功能类设置写入 + 模型重试/历史加载读写。 */
export interface LiuliFeaturesInjected {
  /** 保存一个或多个字段（localStorage 持久化 + 立即应用）。 */
  save: (patch: Partial<LiuliSettings>) => void
  /** 恢复默认（清空字段 + 清除壁纸）。 */
  reset: () => void
  /** 保存模型重试参数；返回错误信息（成功为 undefined）。 */
  modelRetrySave: (params: { maxRetries: number; initialDelayMs: number }) => Promise<string | undefined>
  /** 重新拉取模型重试聚合展示值。 */
  modelRetryReload: () => Promise<void>
  /** 读取当前持久化的历史加载批次数（并同步 store）。 */
  historyLoad: () => number
  /** 保存历史加载批次数（并同步 store）。 */
  historySave: (batches: number) => void
}

export type LiuliFeaturesComponentProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createLiuliStore>>
  & PropsLocale<'liuli-features'> & LiuliFeaturesInjected

/** 渲染 琉璃 功能设置 section。 */
export function LiuliFeaturesSection({
  useStore, t, save, reset, modelRetrySave, modelRetryReload, historyLoad, historySave,
}: LiuliFeaturesComponentProps) {
  const state = useStore(s => s)
  const s = state.settings
  const set = (patch: Partial<LiuliSettings>): void => { save(patch) }

  return (
    <div className={css.section}>
      <div className={css.grid}>
        <ToggleRow
          label={t('wideMode')}
          checked={s.wide_mode}
          onChange={(v) => { set({ wide_mode: v }) }}
        />

        <SelectRow
          label={t('transition')}
          value={s.transition_effect}
          options={[
            { value: 'rise', label: t('transition.rise') },
            { value: 'fade', label: t('transition.fade') },
            { value: 'drop', label: t('transition.drop') },
            { value: 'slide', label: t('transition.slide') },
            { value: 'zoom', label: t('transition.zoom') },
            { value: 'blur', label: t('transition.blur') },
            { value: 'spring', label: t('transition.spring') },
            { value: 'stagger', label: t('transition.stagger') },
            { value: 'staggerRise', label: t('transition.staggerRise') },
            { value: 'none', label: t('transition.none') },
          ]}
          onChange={(v) => { set({ transition_effect: v as LiuliSettings['transition_effect'] }) }}
        />

        <ToggleRow
          label={t('autoDriveBrowser')}
          hint={t('autoDriveBrowserHint')}
          checked={s.auto_drive_browser}
          onChange={(v) => { set({ auto_drive_browser: v }) }}
        />
      </div>

      {/* 非官方增强（兼容其它插件）：总开关 + 分组开关，启动时生效，改后需刷新页面 */}
      <div className={css.wallpaperBlock}>
        <div className={css.wallpaperTitle}>{t('unofficial.title')}</div>
        <div className={css.grid}>
          <ToggleRow
            label={t('unofficial.enabled')}
            hint={t('unofficial.enabledHint')}
            checked={s.unofficial_enabled}
            onChange={(v) => { set({ unofficial_enabled: v }) }}
          />
          <ToggleRow
            label={t('unofficial.layout')}
            hint={t('unofficial.layoutHint')}
            checked={s.unofficial_layout}
            onChange={(v) => { set({ unofficial_layout: v }) }}
          />
          <ToggleRow
            label={t('unofficial.desktop')}
            hint={t('unofficial.desktopHint')}
            checked={s.unofficial_desktop}
            onChange={(v) => { set({ unofficial_desktop: v }) }}
          />
          <ToggleRow
            label={t('unofficial.sidebar')}
            hint={t('unofficial.sidebarHint')}
            checked={s.unofficial_sidebar}
            onChange={(v) => { set({ unofficial_sidebar: v }) }}
          />
          <ToggleRow
            label={t('unofficial.browser')}
            hint={t('unofficial.browserHint')}
            checked={s.unofficial_browser}
            onChange={(v) => { set({ unofficial_browser: v }) }}
          />
          <ToggleRow
            label={t('unofficial.dom')}
            hint={t('unofficial.domHint')}
            checked={s.unofficial_dom}
            onChange={(v) => { set({ unofficial_dom: v }) }}
          />
        </div>
      </div>

      <div className={css.divider} />

      {/* 声纹响应（Nanoleaf Desktop 移植检测的参数，即时生效） */}
      <div className={css.wallpaperBlock}>
        <div className={css.wallpaperTitle}>{t('vp.title')}</div>
        <div className={css.grid}>
          <SliderRow
            label={t('vp.sensitivity')} value={s.vp_sensitivity} suffix="" min={0.01} max={1} step={0.01}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_sensitivity} tip={t('vp.tip.sensitivity')}
            onChange={(v) => { set({ vp_sensitivity: v }) }}
          />
          <SliderRow
            label={t('vp.beatGain')} value={s.vp_beat_gain} suffix="×" min={0} max={5} step={0.1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_gain} tip={t('vp.tip.beatGain')}
            onChange={(v) => { set({ vp_beat_gain: v }) }}
          />
          <SliderRow
            label={t('vp.beatDecay')} value={s.vp_beat_decay} suffix="" min={0.5} max={0.995} step={0.005}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_decay} tip={t('vp.tip.beatDecay')}
            onChange={(v) => { set({ vp_beat_decay: v }) }}
          />
          <SliderRow
            label={t('vp.beatMult')} value={s.vp_beat_mult} suffix="×" min={1} max={5} step={0.1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_mult} tip={t('vp.tip.beatMult')}
            onChange={(v) => { set({ vp_beat_mult: v }) }}
          />
          <SliderRow
            label={t('vp.pulseMult')} value={s.vp_pulse_mult} suffix="×" min={0.1} max={3} step={0.05}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_pulse_mult} tip={t('vp.tip.pulseMult')}
            onChange={(v) => { set({ vp_pulse_mult: v }) }}
          />
          <SliderRow
            label={t('vp.bassWeight')} value={s.vp_bass_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_bass_weight} tip={t('vp.tip.bassWeight')}
            onChange={(v) => { set({ vp_bass_weight: v }) }}
          />
          <SliderRow
            label={t('vp.midWeight')} value={s.vp_mid_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_mid_weight} tip={t('vp.tip.midWeight')}
            onChange={(v) => { set({ vp_mid_weight: v }) }}
          />
          <SliderRow
            label={t('vp.highWeight')} value={s.vp_high_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_high_weight} tip={t('vp.tip.highWeight')}
            onChange={(v) => { set({ vp_high_weight: v }) }}
          />
          <SliderRow
            label={t('vp.beatCooldown')} value={s.vp_beat_cooldown} suffix="ms" min={50} max={1000} step={10}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_cooldown} tip={t('vp.tip.beatCooldown')}
            onChange={(v) => { set({ vp_beat_cooldown: v }) }}
          />
          <SliderRow
            label={t('vp.pulseCooldown')} value={s.vp_pulse_cooldown} suffix="ms" min={50} max={1000} step={10}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_pulse_cooldown} tip={t('vp.tip.pulseCooldown')}
            onChange={(v) => { set({ vp_pulse_cooldown: v }) }}
          />
          <SliderRow
            label={t('vp.envSpeed')} value={s.vp_env_speed} suffix="" min={0} max={100} step={1}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_env_speed} tip={t('vp.tip.envSpeed')}
            onChange={(v) => { set({ vp_env_speed: v }) }}
          />
          <SliderRow
            label={t('vp.specSmooth')} value={s.vp_spec_smooth} suffix="" min={0.02} max={0.8} step={0.01}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_spec_smooth} tip={t('vp.tip.specSmooth')}
            onChange={(v) => { set({ vp_spec_smooth: v }) }}
          />
          <SliderRow
            label={t('vp.noiseGate')} value={s.vp_noise_gate} suffix="" min={0} max={0.2} step={0.005}
            defaultValue={LIULI_SETTINGS_DEFAULTS.vp_noise_gate} tip={t('vp.tip.noiseGate')}
            onChange={(v) => { set({ vp_noise_gate: v }) }}
          />
        </div>
      </div>

      <div className={css.divider} />

      {/* 模型请求重试（原通用分区行，归拢进功能分区） */}
      <ModelRetryRow state={state.modelRetry} t={t} save={modelRetrySave} reload={modelRetryReload} />

      <div className={css.divider} />

      {/* 切换会话默认历史加载（原通用分区行，归拢进功能分区） */}
      <HistoryLoadRow state={state.historyLoad} t={t} load={historyLoad} save={historySave} />

      <div className={css.footer}>
        <Button variant="primary" size="md" onClick={() => { reset() }}>
          {t('reset')}
        </Button>
      </div>
    </div>
  )
}
