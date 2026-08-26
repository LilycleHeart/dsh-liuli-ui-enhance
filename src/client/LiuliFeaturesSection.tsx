/**
 * 琉璃 设置 section（设置页「功能」分区）：宽边模式 / 会话切换动画 / 声纹响应 /
 * 模型请求重试 / 切换会话默认历史加载。
 *
 * 与「外观」分区（LiuliAppearanceSection）共享同一个 liuli store 实例：
 * settings（宽边/动画/声纹）经 useStore 读取，模型重试与历史加载状态在合并
 * store 的 modelRetry / historyLoad 切片里，由下方两个展示行组件渲染。
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LiuliSettings, LiuliTerminalShell } from '../liuli-settings.ts'
import { LIULI_SETTINGS_DEFAULTS, TERMINAL_SHELL_IDS } from '../liuli-settings.ts'
import type { createLiuliStore } from './liuli-store.ts'
import { SelectRow, SliderRow, ToggleRow } from './LiuliAppearance.tsx'
import { ModelRetryRow } from './ModelRetryRow.tsx'
import { HistoryLoadRow } from './HistoryLoadRow.tsx'
import { ThinkingFillRow } from './ThinkingFillRow.tsx'
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
  /** 一键补全自定义提供商的思考等级声明；返回错误信息（成功为 undefined）。 */
  thinkingFillApply: () => Promise<string | undefined>
  /** 重新扫描待补全的自定义提供商/模型数量。 */
  thinkingFillReload: () => Promise<void>
}

export type LiuliFeaturesComponentProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createLiuliStore>>
  & PropsLocale<'liuli-features'> & LiuliFeaturesInjected

/** 终端 Shell 选项 → 功能设置页文案键（zh/en 键集对齐，见 locales.ts）。 */
function terminalShellLabelKey(id: LiuliTerminalShell):
  'terminalShell.default' | 'terminalShell.cmd' | 'terminalShell.powershell' | 'terminalShell.pwsh' | 'terminalShell.bash' {
  switch (id) {
    case 'cmd': return 'terminalShell.cmd'
    case 'powershell': return 'terminalShell.powershell'
    case 'pwsh': return 'terminalShell.pwsh'
    case 'bash': return 'terminalShell.bash'
    default: return 'terminalShell.default'
  }
}

/** 渲染 琉璃 功能设置 section。 */
export function LiuliFeaturesSection({
  useStore, t, save, reset, modelRetrySave, modelRetryReload, historyLoad, historySave,
  thinkingFillApply, thinkingFillReload,
}: LiuliFeaturesComponentProps) {
  // 高级设置折叠状态（默认收起，展开后才显示参数调节）
  const [vpAdvancedOpen, setVpAdvancedOpen] = useState(false)

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
          tip={t('autoDriveBrowserHint')}
          checked={s.auto_drive_browser}
          onChange={(v) => { set({ auto_drive_browser: v }) }}
        />

        <SelectRow
          label={t('terminalShell')}
          value={s.terminal_shell}
          options={TERMINAL_SHELL_IDS.map(id => ({
            value: id,
            label: t(terminalShellLabelKey(id)),
          }))}
          onChange={(v) => { set({ terminal_shell: v as LiuliSettings['terminal_shell'] }) }}
        />
      </div>

      {/* 非官方增强（兼容其它插件）：总开关 + 分组开关，启动时生效，改后需刷新页面 */}
      <div className={css.wallpaperBlock}>
        <div className={css.wallpaperTitle}>{t('unofficial.title')}</div>
        <div className={css.grid}>
          <ToggleRow
            label={t('unofficial.enabled')}
            tip={t('unofficial.enabledHint')}
            checked={s.unofficial_enabled}
            onChange={(v) => { set({ unofficial_enabled: v }) }}
          />
          <ToggleRow
            label={t('unofficial.layout')}
            tip={t('unofficial.layoutHint')}
            checked={s.unofficial_layout}
            onChange={(v) => { set({ unofficial_layout: v }) }}
          />
          <ToggleRow
            label={t('unofficial.desktop')}
            tip={t('unofficial.desktopHint')}
            checked={s.unofficial_desktop}
            onChange={(v) => { set({ unofficial_desktop: v }) }}
          />
          <ToggleRow
            label={t('unofficial.sidebar')}
            tip={t('unofficial.sidebarHint')}
            checked={s.unofficial_sidebar}
            onChange={(v) => { set({ unofficial_sidebar: v }) }}
          />
          <ToggleRow
            label={t('unofficial.browser')}
            tip={t('unofficial.browserHint')}
            checked={s.unofficial_browser}
            onChange={(v) => { set({ unofficial_browser: v }) }}
          />
          <ToggleRow
            label={t('unofficial.dom')}
            tip={t('unofficial.domHint')}
            checked={s.unofficial_dom}
            onChange={(v) => { set({ unofficial_dom: v }) }}
          />
        </div>
      </div>

      <div className={css.divider} />

      {/* 声纹响应（Nanoleaf Desktop 移植检测的参数，即时生效；总开关关闭后停止监听并隐藏页头波形，参数保留） */}
      <div className={css.wallpaperBlock}>
        <ToggleRow
          label={t('vp.title')}
          hint={t('vp.enabledHint')}
          checked={s.vp_enabled}
          onChange={(v) => { set({ vp_enabled: v }) }}
        />
        <div className={css.vpAdvanced}>
          <button
            type="button"
            className={css.vpAdvancedHeader}
            aria-expanded={vpAdvancedOpen}
            onClick={() => { setVpAdvancedOpen(!vpAdvancedOpen) }}
          >
            {t('vp.advanced')}
            <svg
              className={css.vpAdvancedChevron + (vpAdvancedOpen ? ' ' + css.vpAdvancedChevronOpen : '')}
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
            >
              <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {vpAdvancedOpen && (
            <div className={css.grid}>
              <ToggleRow
                label={t('vp.beatSync')}
                tip={t('vp.beatSyncHint')}
                checked={s.vp_beat_sync}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_sync: v }) }}
              />
              <SliderRow
                label={t('vp.fluxMult')} value={s.vp_flux_mult} suffix="×" min={0.5} max={4} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_flux_mult} tip={t('vp.tip.fluxMult')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_flux_mult: v }) }}
              />
              <SliderRow
                label={t('vp.sensitivity')} value={s.vp_sensitivity} suffix="" min={0.01} max={1} step={0.01}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_sensitivity} tip={t('vp.tip.sensitivity')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_sensitivity: v }) }}
              />
              <SliderRow
                label={t('vp.beatGain')} value={s.vp_beat_gain} suffix="×" min={0} max={5} step={0.1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_gain} tip={t('vp.tip.beatGain')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_gain: v }) }}
              />
              <SliderRow
                label={t('vp.beatDecay')} value={s.vp_beat_decay} suffix="" min={0.5} max={0.995} step={0.005}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_decay} tip={t('vp.tip.beatDecay')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_decay: v }) }}
              />
              <SliderRow
                label={t('vp.beatMult')} value={s.vp_beat_mult} suffix="×" min={1} max={5} step={0.1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_mult} tip={t('vp.tip.beatMult')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_mult: v }) }}
              />
              <SliderRow
                label={t('vp.pulseMult')} value={s.vp_pulse_mult} suffix="×" min={0.1} max={3} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_pulse_mult} tip={t('vp.tip.pulseMult')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_pulse_mult: v }) }}
              />
              <SliderRow
                label={t('vp.bassWeight')} value={s.vp_bass_weight} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_bass_weight} tip={t('vp.tip.bassWeight')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_bass_weight: v }) }}
              />
              <SliderRow
                label={t('vp.midWeight')} value={s.vp_mid_weight} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_mid_weight} tip={t('vp.tip.midWeight')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_mid_weight: v }) }}
              />
              <SliderRow
                label={t('vp.highWeight')} value={s.vp_high_weight} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_high_weight} tip={t('vp.tip.highWeight')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_high_weight: v }) }}
              />
              <SliderRow
                label={t('vp.beatCooldown')} value={s.vp_beat_cooldown} suffix="ms" min={50} max={1000} step={10}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_cooldown} tip={t('vp.tip.beatCooldown')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_cooldown: v }) }}
              />
              <SliderRow
                label={t('vp.pulseCooldown')} value={s.vp_pulse_cooldown} suffix="ms" min={50} max={1000} step={10}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_pulse_cooldown} tip={t('vp.tip.pulseCooldown')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_pulse_cooldown: v }) }}
              />
              <SliderRow
                label={t('vp.envSpeed')} value={s.vp_env_speed} suffix="" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_env_speed} tip={t('vp.tip.envSpeed')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_env_speed: v }) }}
              />
              <SliderRow
                label={t('vp.specSmooth')} value={s.vp_spec_smooth} suffix="" min={0.02} max={0.8} step={0.01}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_spec_smooth} tip={t('vp.tip.specSmooth')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_spec_smooth: v }) }}
              />
              <SliderRow
                label={t('vp.noiseGate')} value={s.vp_noise_gate} suffix="" min={0} max={0.2} step={0.005}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_noise_gate} tip={t('vp.tip.noiseGate')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_noise_gate: v }) }}
              />
              <SliderRow
                label={t('vp.lines')} value={s.vp_lines} suffix="" min={8} max={48} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_lines} tip={t('vp.tip.lines')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_lines: v }) }}
              />
              <SliderRow
                label={t('vp.idleSpeed')} value={s.vp_idle_speed} suffix="" min={0} max={0.05} step={0.001}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_idle_speed} tip={t('vp.tip.idleSpeed')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_idle_speed: v }) }}
              />
              <SliderRow
                label={t('vp.amplitude')} value={s.vp_amplitude} suffix="×" min={0.2} max={2.5} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_amplitude} tip={t('vp.tip.amplitude')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_amplitude: v }) }}
              />
              <SliderRow
                label={t('vp.mainAmp')} value={s.vp_main_amp} suffix="px" min={10} max={120} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_main_amp} tip={t('vp.tip.mainAmp')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_main_amp: v }) }}
              />
              <SliderRow
                label={t('vp.glow')} value={s.vp_glow} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_glow} tip={t('vp.tip.glow')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_glow: v }) }}
              />
              <SliderRow
                label={t('vp.lineAlpha')} value={s.vp_line_alpha} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_line_alpha} tip={t('vp.tip.lineAlpha')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_line_alpha: v }) }}
              />
              <SliderRow
                label={t('vp.edgeFade')} value={s.vp_edge_fade} suffix="" min={0.5} max={1} step={0.01}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_edge_fade} tip={t('vp.tip.edgeFade')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_edge_fade: v }) }}
              />
              <SliderRow
                label={t('vp.bassEvent')} value={s.vp_bass_event} suffix="×" min={0} max={3} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_bass_event} tip={t('vp.tip.bassEvent')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_bass_event: v }) }}
              />
              <SliderRow
                label={t('vp.midEvent')} value={s.vp_mid_event} suffix="×" min={0} max={3} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_mid_event} tip={t('vp.tip.midEvent')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_mid_event: v }) }}
              />
              <SliderRow
                label={t('vp.highEvent')} value={s.vp_high_event} suffix="×" min={0} max={3} step={0.05}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_high_event} tip={t('vp.tip.highEvent')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_high_event: v }) }}
              />
              <SliderRow
                label={t('vp.beatWindow')} value={s.vp_beat_window} suffix="" min={10} max={120} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_beat_window} tip={t('vp.tip.beatWindow')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_beat_window: v }) }}
              />
              <SliderRow
                label={t('vp.pulseWindow')} value={s.vp_pulse_window} suffix="" min={40} max={400} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_pulse_window} tip={t('vp.tip.pulseWindow')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_pulse_window: v }) }}
              />
              <SliderRow
                label={t('vp.noiseRate')} value={s.vp_noise_rate} suffix="" min={0.0001} max={0.01} step={0.0001}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_noise_rate} tip={t('vp.tip.noiseRate')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_noise_rate: v }) }}
              />
              <SliderRow
                label={t('vp.driveSmooth')} value={s.vp_drive_smooth} suffix="" min={0.01} max={0.9} step={0.01}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_drive_smooth} tip={t('vp.tip.driveSmooth')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_drive_smooth: v }) }}
              />
              <SliderRow
                label={t('vp.presenceSpeed')} value={s.vp_presence_speed} suffix="%" min={0} max={100} step={1}
                defaultValue={LIULI_SETTINGS_DEFAULTS.vp_presence_speed} tip={t('vp.tip.presenceSpeed')}
                disabled={!s.vp_enabled}
                onChange={(v) => { set({ vp_presence_speed: v }) }}
              />
            </div>
          )}
        </div>
      </div>

      <div className={css.divider} />

      {/* 模型请求重试（原通用分区行，归拢进功能分区） */}
      <ModelRetryRow state={state.modelRetry} t={t} save={modelRetrySave} reload={modelRetryReload} />

      <div className={css.divider} />

      {/* 切换会话默认历史加载（原通用分区行，归拢进功能分区） */}
      <HistoryLoadRow state={state.historyLoad} t={t} load={historyLoad} save={historySave} />

      <div className={css.divider} />

      {/* 思考等级自动补全（自定义提供商添加后自动声明 reasoningEfforts/compat） */}
      <ThinkingFillRow state={state.thinkingFill} t={t} apply={thinkingFillApply} reload={thinkingFillReload} />

      <div className={css.footer}>
        <Button variant="primary" size="md" onClick={() => { reset() }}>
          {t('reset')}
        </Button>
      </div>
    </div>
  )
}
