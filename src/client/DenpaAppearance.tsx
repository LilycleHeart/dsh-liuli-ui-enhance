/**
 * DenpaPush 界面设置 section（设置页「界面」）：取色/壁纸/材质/字体/圆角/泛光阴影。
 * 复刻自电波推送 dashboard 的「界面设置」面板。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, Input, Menu, IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DenpaBgArea, DenpaSettings } from '../denpa-settings.ts'
import { bgGeometry } from './denpa-runtime.ts'
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

/** 下拉行：Menu + trigger（与通用设置的权限选择器同款外观）。 */
function SelectRow(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const label = props.options.find(o => o.value === props.value)?.label ?? props.value
  return (
    <Row label={props.label}>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={props.options.map(o => ({ id: o.value, label: o.label }))}
        selectedId={props.value}
        onSelect={(id) => {
          setOpen(false)
          if (id !== props.value) props.onChange(id)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            {label}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </Row>
  )
}
/** 壁纸预览：按实际窗口比例显示效果（fit/选区所见即所得），可框选自定义选区。 */
function WallpaperPreview(props: {
  src: string
  fit: DenpaSettings['bg_fit']
  area: DenpaBgArea | null
  onArea: (area: DenpaBgArea) => void
  onClearArea: () => void
  t: TranslateNS<'denpa-appearance'>
}) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [winRatio, setWinRatio] = useState(() => window.innerWidth / window.innerHeight)
  const [selectMode, setSelectMode] = useState(false)
  const [selBox, setSelBox] = useState<DenpaBgArea | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onResize = (): void => { setWinRatio(window.innerWidth / window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  /** 指针位置 → 预览归一化坐标（0..1，与图坐标 1:1 对应）。 */
  const norm = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = stageRef.current
    if (el === null) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  const onDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const p0 = norm(e)
    if (p0 === null) return
    drag.current = p0
    setSelBox({ x: p0.x, y: p0.y, w: 0, h: 0 })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (d === null) return
    const p = norm(e)
    if (p === null) return
    setSelBox({
      x: Math.min(d.x, p.x),
      y: Math.min(d.y, p.y),
      w: Math.abs(p.x - d.x),
      h: Math.abs(p.y - d.y),
    })
  }

  const onUp = (): void => {
    const d = drag.current
    drag.current = null
    if (d === null) return
    if (selBox !== null && selBox.w > 0.04 && selBox.h > 0.04) {
      props.onArea({ x: selBox.x, y: selBox.y, w: selBox.w, h: selBox.h })
    }
    setSelectMode(false)
    setSelBox(null)
  }

  const g = bgGeometry(props.fit, props.area)
  const stageStyle: React.CSSProperties = {
    aspectRatio: winRatio,
    width: 'min(100%, calc(220px * ' + winRatio + '))',
  }
  const effectStyle: React.CSSProperties = {
    backgroundImage: 'url("' + props.src + '")',
    backgroundSize: g.size,
    backgroundPosition: g.position,
    backgroundRepeat: 'no-repeat',
  }

  return (
    <>
      <div className={css.previewActions}>
        <span className={css.previewHint}>{props.t('area.hint')}</span>
        {selectMode ? (
          <Button variant="primary" size="sm"
            onClick={() => { setSelectMode(false); setSelBox(null) }}
          >
            {props.t('area.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" disabled={props.fit !== 'cover'}
              onClick={() => { setSelectMode(true); setSelBox(null) }}
            >
              {props.t('area.reselect')}
            </Button>
            {props.area !== null && (
              <Button variant="ghost" size="sm" onClick={props.onClearArea}>
                {props.t('area.clear')}
              </Button>
            )}
          </>
        )}
      </div>
      <div
        ref={stageRef}
        className={css.previewStage + (selectMode ? ' ' + css.selecting : '')}
        style={stageStyle}
        onPointerDown={selectMode ? onDown : undefined}
        onPointerMove={selectMode ? onMove : undefined}
        onPointerUp={selectMode ? onUp : undefined}
      >
        {selectMode ? (
          <>
            <img className={css.previewFull} src={props.src} alt="" draggable={false} />
            {selBox !== null && selBox.w > 0 && (
              <div
                className={css.previewCropBox}
                style={{
                  left: selBox.x * 100 + '%',
                  top: selBox.y * 100 + '%',
                  width: selBox.w * 100 + '%',
                  height: selBox.h * 100 + '%',
                }}
              />
            )}
          </>
        ) : (
          <div className={css.previewEffect} style={effectStyle} />
        )}
      </div>
      {props.fit !== 'cover' && <div className={css.previewNote}>{props.t('area.disabled')}</div>}
    </>
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
        <Input
          type="text" value={props.value} spellCheck={false}
          className={css.colorTextWrap ?? ''}
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

        <SelectRow
          label={t('colorMode')}
          value={s.color_mode}
          options={[
            { value: 'dynamic', label: t('colorMode.dynamic') },
            { value: 'static', label: t('colorMode.static') },
          ]}
          onChange={(v) => { set({ color_mode: v as DenpaSettings['color_mode'] }) }}
        />

        {s.color_mode === 'static' && (
          <ColorRow
            label={t('brandColor')}
            value={s.brand_color}
            onChange={(v) => { set({ brand_color: v }) }}
          />
        )}

        <SelectRow
          label={t('bgMode')}
          value={s.background_mode}
          options={[
            { value: 'theme', label: t('bgMode.theme') },
            { value: 'brand_gradient', label: t('bgMode.gradient') },
            { value: 'custom', label: t('bgMode.custom') },
            { value: 'image', label: t('bgMode.image') },
          ]}
          onChange={(v) => { set({ background_mode: v as DenpaSettings['background_mode'] }) }}
        />

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

        <SelectRow
          label={t('materialType')}
          value={s.material_type}
          options={[
            { value: 'acrylic', label: t('materialType.acrylic') },
            { value: 'mica', label: t('materialType.mica') },
          ]}
          onChange={(v) => { set({ material_type: v as DenpaSettings['material_type'] }) }}
        />

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

        <SelectRow
          label={t('fontMode')}
          value={s.font_mode}
          options={[
            { value: 'misans', label: t('fontMode.misans') },
            { value: 'builtin', label: t('fontMode.builtin') },
          ]}
          onChange={(v) => { set({ font_mode: v as DenpaSettings['font_mode'] }) }}
        />

        <Row label={t('radius')} hint={`${s.corner_radius}px`}>
          <Input
            type="number" min={0} max={40} value={s.corner_radius}
            className={css.inputWrap ?? ''}
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
          <Button variant="ghost" size="md" disabled={busy} onClick={() => { fileRef.current?.click() }}>
            {t('wallpaper.choose')}
          </Button>
          <Button
            variant="primary" size="md" disabled={busy || fileLabel === ''}
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
          </Button>
          <Button variant="ghost" size="md" disabled={wallpaper === null} onClick={() => { removeWallpaper() }}>
            {t('wallpaper.remove')}
          </Button>
        </div>

        <SelectRow
          label={t('bgFit')}
          value={s.bg_fit}
          options={[
            { value: 'cover', label: t('bgFit.cover') },
            { value: 'contain', label: t('bgFit.contain') },
            { value: 'stretch', label: t('bgFit.stretch') },
          ]}
          onChange={(v) => { set({ bg_fit: v as DenpaSettings['bg_fit'] }) }}
        />

        {wallpaper !== null && (
          <WallpaperPreview
            src={wallpaper}
            fit={s.bg_fit}
            area={s.bg_area}
            onArea={(area) => { set({ bg_area: area }) }}
            onClearArea={() => { set({ bg_area: null }) }}
            t={t}
          />
        )}
        {fileLabel !== '' && <div className={css.fileName}>{fileLabel}</div>}
        {uploadError !== '' && <div className={css.uploadError}>{uploadError}</div>}
      </div>

      <div className={css.footer}>
        <Button variant="primary" size="md" onClick={() => { reset() }}>
          {t('reset')}
        </Button>
      </div>
    </div>
  )
}