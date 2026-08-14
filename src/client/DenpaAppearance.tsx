/**
 * DenpaPush 界面设置 section（设置页「界面」）：取色/壁纸/材质/字体/圆角/泛光阴影。
 * 复刻自电波推送 dashboard 的「界面设置」面板。
 */
import { useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DenpaSettings } from '../denpa-settings.ts'
import type { createDenpaStore } from './denpa-store.ts'
import css from './DenpaAppearance.module.css'

/** 注入面：设置写入 + 壁纸操作 + 文案。 */
export interface DenpaAppearanceInjected {
  /** 保存一个或多个字段（localStorage 持久化 + 立即应用）。 */
  save: (patch: Partial<DenpaSettings>) => void
  /** 恢复默认（清空字段 + 清除壁纸）。 */
  reset: () => void
  /** 上传壁纸（File → dataURL → localStorage + 应用）。 */
  uploadWallpaper: (file: File) => Promise<void>
  /** 移除壁纸。 */
  removeWallpaper: () => void
}

export type DenpaAppearanceComponentProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createDenpaStore>>
  & PropsLocale<'denpa-appearance'> & DenpaAppearanceInjected

/** 一个表单行：标签 + 控件。 */
function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={css.row}>
      <span className={css.label}>
        {props.label}
        {props.hint !== undefined && <span className={css.hint}>{props.hint}</span>}
      </span>
      {props.children}
    </label>
  )
}

/** 滑块行（值后缀实时显示）。 */
function SliderRow(props: {
  label: string; value: number; suffix: string; min: number; max: number; step?: number;
  onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <Row label={props.label} hint={`${props.value}${props.suffix}`}>
      <input
        type="range" className={css.slider} min={props.min} max={props.max} step={props.step ?? 1}
        value={props.value} disabled={props.disabled === true}
        onChange={(e) => { props.onChange(Number(e.target.value)) }}
      />
    </Row>
  )
}

/** 开关行。 */
function ToggleRow(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={props.label} {...(props.hint !== undefined ? { hint: props.hint } : {})}>
      <button
        type="button" role="switch" aria-checked={props.checked}
        className={clsx(css.toggle, props.checked && css.toggleOn)}
        onClick={() => { props.onChange(!props.checked) }}
      >
        <span className={css.toggleKnob} />
      </button>
    </Row>
  )
}

/** 颜色行（picker + 文本）。 */
function ColorRow(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={props.label}>
      <span className={css.colorWrap}>
        <input
          type="color" className={css.colorPicker} value={props.value}
          onChange={(e) => { props.onChange(e.target.value) }}
        />
        <input
          type="text" className={css.colorText} value={props.value} spellCheck={false}
          onChange={(e) => { props.onChange(e.target.value) }}
        />
      </span>
    </Row>
  )
}

/** 渲染 DenpaPush 界面设置 section。 */
export function DenpaAppearanceSection({
  useStore, t, save, reset, uploadWallpaper, removeWallpaper,
}: DenpaAppearanceComponentProps) {
  const state = useStore(s => s)
  const s = state.settings
  const wallpaper = state.wallpaper
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileLabel, setFileLabel] = useState<string>('')
  const [uploadError, setUploadError] = useState<string>('')

  const set = (patch: Partial<DenpaSettings>): void => { save(patch) }

  return (
    <div className={css.section}>
      <p className={css.desc}>{t('desc')}</p>

      <div className={css.grid}>
        <ToggleRow
          label={t('wideMode')}
          hint={t('wideModeHint')}
          checked={s.wide_mode}
          onChange={(v) => { set({ wide_mode: v }) }}
        />

        <Row label={t('colorMode')}>
          <select
            className={css.select} value={s.color_mode}
            onChange={(e) => { set({ color_mode: e.target.value as DenpaSettings['color_mode'] }) }}
          >
            <option value="dynamic">{t('colorMode.dynamic')}</option>
            <option value="static">{t('colorMode.static')}</option>
          </select>
        </Row>

        {s.color_mode === 'static' && (
          <ColorRow
            label={t('brandColor')}
            value={s.brand_color}
            onChange={(v) => { set({ brand_color: v }) }}
          />
        )}

        <Row label={t('bgMode')}>
          <select
            className={css.select} value={s.background_mode}
            onChange={(e) => { set({ background_mode: e.target.value as DenpaSettings['background_mode'] }) }}
          >
            <option value="theme">{t('bgMode.theme')}</option>
            <option value="brand_gradient">{t('bgMode.gradient')}</option>
            <option value="custom">{t('bgMode.custom')}</option>
            <option value="image">{t('bgMode.image')}</option>
          </select>
        </Row>

        {s.background_mode === 'image' && (
          <SliderRow
            label={t('scrim')} value={s.bg_scrim} suffix="%" min={0} max={80}
            onChange={(v) => { set({ bg_scrim: v }) }}
          />
        )}

        {s.background_mode === 'custom' && (
          <>
            <ColorRow
              label={t('customBg')}
              value={s.custom_background}
              onChange={(v) => { set({ custom_background: v }) }}
            />
            <ColorRow
              label={t('customBgDark')}
              value={s.custom_background_dark}
              onChange={(v) => { set({ custom_background_dark: v }) }}
            />
          </>
        )}

        <Row label={t('materialType')}>
          <select
            className={css.select} value={s.material_type}
            onChange={(e) => { set({ material_type: e.target.value as DenpaSettings['material_type'] }) }}
          >
            <option value="acrylic">{t('materialType.acrylic')}</option>
            <option value="mica">{t('materialType.mica')}</option>
          </select>
        </Row>

        <ToggleRow
          label={t('materialOn')}
          checked={s.acrylic_enabled}
          onChange={(v) => { set({ acrylic_enabled: v }) }}
        />

        {s.acrylic_enabled && (
          <>
            <SliderRow
              label={t('materialOpacity')} value={s.material_opacity} suffix="%" min={20} max={100}
              onChange={(v) => { set({ material_opacity: v }) }}
            />
            <SliderRow
              label={t('materialBlur')} value={s.material_blur} suffix="px" min={0} max={100}
              onChange={(v) => { set({ material_blur: v }) }}
            />
          </>
        )}

        <Row label={t('fontMode')}>
          <select
            className={css.select} value={s.font_mode}
            onChange={(e) => { set({ font_mode: e.target.value as DenpaSettings['font_mode'] }) }}
          >
            <option value="misans">{t('fontMode.misans')}</option>
            <option value="builtin">{t('fontMode.builtin')}</option>
          </select>
        </Row>

        <Row label={t('radius')} hint={`${s.corner_radius}px`}>
          <input
            type="number" className={css.number} min={0} max={40} value={s.corner_radius}
            onChange={(e) => { set({ corner_radius: Number(e.target.value) || 0 }) }}
          />
        </Row>

        <ToggleRow
          label={t('glowOn')}
          checked={s.glow_enabled}
          onChange={(v) => { set({ glow_enabled: v }) }}
        />

        <SliderRow
          label={t('glowStrength')} value={s.glow_intensity} suffix="%" min={0} max={100}
          disabled={!s.glow_enabled}
          onChange={(v) => { set({ glow_intensity: v }) }}
        />

        <ToggleRow
          label={t('shadowOn')}
          checked={s.shadow_enabled}
          onChange={(v) => { set({ shadow_enabled: v }) }}
        />

        <SliderRow
          label={t('shadowStrength')} value={s.shadow_intensity} suffix="%" min={0} max={100}
          disabled={!s.shadow_enabled}
          onChange={(v) => { set({ shadow_intensity: v }) }}
        />
      </div>

      {/* 壁纸 */}
      <div className={css.wallpaperBlock}>
        <div className={css.wallpaperTitle}>{t('wallpaper')}</div>
        <div className={css.wallpaperRow}>
          <input
            ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setFileLabel(file.name)
            }}
          />
          <button
            type="button" className={css.action} disabled={busy}
            onClick={() => { fileRef.current?.click() }}
          >
            {t('wallpaper.choose')}
          </button>
          <button
            type="button" className={clsx(css.action, css.actionPrimary)} disabled={busy || fileLabel === ''}
            onClick={async () => {
              const file = fileRef.current?.files?.[0]
              if (!file) return
              setBusy(true)
              setUploadError('')
              try {
                await uploadWallpaper(file)
                setFileLabel('')
                if (fileRef.current) fileRef.current.value = ''
              } catch (err) {
                setUploadError(err instanceof Error ? err.message : '上传失败')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? t('wallpaper.uploading') : t('wallpaper.upload')}
          </button>
          <button
            type="button" className={css.action} disabled={wallpaper === null}
            onClick={() => { removeWallpaper() }}
          >
            {t('wallpaper.remove')}
          </button>
        </div>
        {fileLabel !== '' && <div className={css.fileName}>{fileLabel}</div>}
        {uploadError !== '' && <div className={css.uploadError}>{uploadError}</div>}
        {wallpaper !== null && (
          <img className={css.preview} src={wallpaper} alt={t('wallpaper.preview')} />
        )}
      </div>

      <div className={css.footer}>
        <button
          type="button" className={clsx(css.action, css.actionPrimary)}
          onClick={() => { reset() }}
        >
          {t('reset')}
        </button>
      </div>
    </div>
  )
}