/**
 * DenpaPush 界面设置 section（设置页「界面」）：取色/壁纸/材质/字体/圆角/泛光阴影。
 * 复刻自电波推送 dashboard 的「界面设置」面板。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { createPortal } from 'react-dom'
import {
  Button, Input, Menu, IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DenpaBgArea, DenpaSettings } from '../denpa-settings.ts'
import { DENPA_SETTINGS_DEFAULTS } from '../denpa-settings.ts'
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

/** 悬浮功能描述（portal 浮层）：渲染到 body，fixed 定位，永不被设置面板
 *  滚动容器裁剪；上方空间不足时自动翻转到图标下方。 */
function Tip({ text }: { text: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const show = (): void => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const tw = Math.min(280, window.innerWidth - 16)
    const left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))
    const below = r.top < 96 // 上方空间不足 → 翻转到下方
    setPos({ left, top: below ? r.bottom + 8 : r.top - 8, below })
  }
  const hide = (): void => { setPos(null) }
  return (
    <>
      <span
        ref={wrapRef}
        className={css.tipWrap}
        role="note"
        onMouseOver={show}
        onMouseOut={(e) => {
          // 移入子元素（svg）时不隐藏；relatedTarget 不在图标内才隐藏
          const rt = e.relatedTarget
          if (!(rt instanceof Node) || !wrapRef.current?.contains(rt)) hide()
        }}
      >
        <svg className={css.tipIcon} viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 6.3v3.4M7 4.2v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      {pos !== null && createPortal(
        <div
          className={css.tipPortal}
          style={{
            left: pos.left,
            top: pos.top,
            maxWidth: Math.min(280, window.innerWidth - 16),
            transform: pos.below ? undefined : 'translateY(-100%)',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}

/** 一个表单行：标签 + 控件；tip 提供指针悬浮功能描述（ⓘ 图标）。 */
function Row(props: { label: string; hint?: string; tip?: string | undefined; children: ReactNode }) {
  return (
    <label className={css.row}>
      <span className={css.label}>
        {props.label}
        {props.tip !== undefined && <Tip text={props.tip} />}
        {props.hint !== undefined && <span className={css.hint}>{props.hint}</span>}
      </span>
      {props.children}
    </label>
  )
}

/** 滑块行（可越界数字输入 + 独立复位，仅值≠默认时显示复位）。 */
function SliderRow(props: {
  label: string
  value: number
  suffix: string
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  disabled?: boolean
  /** 提供后显示独立复位按钮（仅当值偏离默认时出现）。 */
  defaultValue?: number
  /** 指针悬浮功能描述（ⓘ）。 */
  tip?: string
}) {
  const changed = props.defaultValue !== undefined && Math.abs(props.value - props.defaultValue) > 1e-9
  return (
    <Row label={props.label} hint={`${props.value}${props.suffix}`} tip={props.tip}>
      <div className={css.sliderWrap}>
        <input
          type="range" className={css.slider} min={props.min} max={props.max} step={props.step ?? 1}
          value={Math.min(props.max, Math.max(props.min, props.value))} disabled={props.disabled === true}
          onChange={(e) => { props.onChange(Number(e.target.value)) }}
        />
        {/* 数字输入框：不受滑条 min/max 限制，可输入任意值（运行时安全兜底） */}
        <input
          type="number" className={css.numInput} step={props.step ?? 1} disabled={props.disabled === true}
          value={props.value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v) && e.target.value.trim() !== '') props.onChange(v)
          }}
        />
        {changed && (
          <button
            type="button" className={css.resetBtn} title={props.label}
            aria-label="恢复该参数默认值"
            onClick={() => {
              // changed 为真时 defaultValue 必然存在（见上方条件）。
              if (props.defaultValue !== undefined) props.onChange(props.defaultValue)
            }}
          >
            ↺
          </button>
        )}
      </div>
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
  const [imgRatio, setImgRatio] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selBox, setSelBox] = useState<DenpaBgArea | null>(null)
  const [displayArea, setDisplayArea] = useState<DenpaBgArea | null>(props.area)
  const drag = useRef<
    | { mode: 'create'; start: { x: number; y: number }; prev: DenpaBgArea | null }
    | { mode: 'move'; offsetX: number; offsetY: number; box: DenpaBgArea }
    | { mode: 'resize'; box: DenpaBgArea; corner: 'tl' | 'tr' | 'bl' | 'br' }
    | null
  >(null)

  useEffect(() => {
    const onResize = (): void => { setWinRatio(window.innerWidth / window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  // 读取图片原始宽高比：框选模式下按原图比例显示，避免被拉伸。
  useEffect(() => {
    let alive = true
    setImgRatio(null)
    const img = new Image()
    img.onload = () => {
      if (alive && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImgRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = props.src
    return () => { alive = false }
  }, [props.src])

  // 同步外部已保存的选区；同时本地在“完成选区”后立即更新，避免依赖 store 刷新延迟。
  useEffect(() => {
    setDisplayArea(props.area)
  }, [props.area])

  /** 指针位置 → 图片归一化坐标（0..1）。容器按完整壁纸比例构建，直接 1:1 对应。 */
  const norm = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = stageRef.current
    if (el === null) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }

  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

  // 框选要保持“实际窗口比例”：在原图坐标系中，w/h = 窗口宽高比 / 图片宽高比。
  const cropRatio = imgRatio !== null && imgRatio > 0 ? winRatio / imgRatio : 1

  /** 把已有选区转换为指定比例（保留面积与中心，并限制在 0..1 内）。 */
  const normalizeAreaToRatio = (area: DenpaBgArea, ratio: number): DenpaBgArea => {
    const safeRatio = Math.max(0.05, Math.min(20, ratio))
    const areaSize = Math.max(area.w * area.h, 0.04 * 0.04)
    let w = Math.sqrt(areaSize * safeRatio)
    let h = Math.sqrt(areaSize / safeRatio)
    const scale = Math.min(1, 1 / w, 1 / h)
    w *= scale
    h *= scale
    const cx = area.x + area.w / 2
    const cy = area.y + area.h / 2
    return {
      x: clamp(cx - w / 2, 0, 1 - w),
      y: clamp(cy - h / 2, 0, 1 - h),
      w,
      h,
    }
  }

  /** 从起点向指针方向创建指定比例的选区（自动限制在图片范围内）。 */
  const createArea = (start: { x: number; y: number }, p: { x: number; y: number }, ratio: number): DenpaBgArea => {
    const safeRatio = Math.max(0.05, Math.min(20, ratio))
    const dx = p.x - start.x
    const dy = p.y - start.y
    const dirX = dx >= 0 ? 1 : -1
    const dirY = dy >= 0 ? 1 : -1
    const maxW = dirX > 0 ? 1 - start.x : start.x
    const maxH = dirY > 0 ? 1 - start.y : start.y
    const w = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * safeRatio), maxW, maxH * safeRatio)
    const h = w / safeRatio
    return {
      x: dirX > 0 ? start.x : start.x - w,
      y: dirY > 0 ? start.y : start.y - h,
      w,
      h,
    }
  }

  /** 从固定角拖动缩放选区，保持窗口比例。corner 为被拖动的角。 */
  const resizeArea = (
    box: DenpaBgArea,
    corner: 'tl' | 'tr' | 'bl' | 'br',
    p: { x: number; y: number },
    ratio: number,
  ): DenpaBgArea => {
    const safeRatio = Math.max(0.05, Math.min(20, ratio))
    const fixed = {
      x: corner === 'tl' || corner === 'bl' ? box.x + box.w : box.x,
      y: corner === 'tl' || corner === 'tr' ? box.y + box.h : box.y,
    }
    const dirX = corner === 'tr' || corner === 'br' ? 1 : -1
    const dirY = corner === 'bl' || corner === 'br' ? 1 : -1
    const distX = Math.abs(p.x - fixed.x)
    const distY = Math.abs(p.y - fixed.y)
    const maxW = dirX > 0 ? 1 - fixed.x : fixed.x
    const maxH = dirY > 0 ? 1 - fixed.y : fixed.y
    const w = Math.min(Math.max(distX, distY * safeRatio), maxW, maxH * safeRatio)
    const h = w / safeRatio
    return {
      x: dirX > 0 ? fixed.x : fixed.x - w,
      y: dirY > 0 ? fixed.y : fixed.y - h,
      w,
      h,
    }
  }

  /** 当前实际窗口大小对应的默认选区：图片坐标系中与窗口同比例的最大居中区域（Cover 下即整窗视图）。
      预留 0.002 边距：既避免选区恰好铺满图片时背景公式除零，也保证选区低于 bgGeometry 的
      0.999 门槛——若钳到 0.999 会被当作"无选区"忽略，壁纸与预览都不会跟随选区变化。 */
  const windowArea = (): DenpaBgArea | null => {
    if (imgRatio === null || imgRatio <= 0) return null
    const maxW = Math.min(0.998, imgRatio > winRatio ? winRatio / imgRatio : 1)
    const maxH = Math.min(0.998, imgRatio > winRatio ? 1 : imgRatio / winRatio)
    return { x: (1 - maxW) / 2, y: (1 - maxH) / 2, w: maxW, h: maxH }
  }

  // 每次重新框选都默认框为当前实际窗口大小（不再沿用上一次保存的选区），
  // 用户再拖角/拖动微调出想要的区域。
  const startSelect = (): void => {
    setSelBox(windowArea())
    setSelectMode(true)
  }

  const onDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    if (imgRatio === null) return
    const p0 = norm(e)
    if (p0 === null) return
    const box = selBox
    if (box !== null && box.w > 0 && p0.x >= box.x && p0.x <= box.x + box.w && p0.y >= box.y && p0.y <= box.y + box.h) {
      const edge = 0.03
      const nearLeft = Math.abs(p0.x - box.x) < edge
      const nearRight = Math.abs(p0.x - (box.x + box.w)) < edge
      const nearTop = Math.abs(p0.y - box.y) < edge
      const nearBottom = Math.abs(p0.y - (box.y + box.h)) < edge
      if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
        const corner = `${nearLeft ? 'l' : 'r'}${nearTop ? 't' : 'b'}` as 'tl' | 'tr' | 'bl' | 'br'
        drag.current = { mode: 'resize', box, corner }
      } else {
        // 框内拖动一律为移动（整窗默认框无法移动时自然无操作，属标准裁剪行为）；
        // 缩小整窗默认框请拖角手柄。
        drag.current = { mode: 'move', offsetX: p0.x - box.x, offsetY: p0.y - box.y, box }
      }
    } else {
      drag.current = { mode: 'create', start: p0, prev: box }
      setSelBox({ x: p0.x, y: p0.y, w: 0, h: 0 })
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (d === null) return
    const p = norm(e)
    if (p === null) return
    if (d.mode === 'create') {
      setSelBox(createArea(d.start, p, cropRatio))
    } else if (d.mode === 'resize') {
      setSelBox(resizeArea(d.box, d.corner, p, cropRatio))
    } else {
      const box = d.box
      const x = clamp(p.x - d.offsetX, 0, 1 - box.w)
      const y = clamp(p.y - d.offsetY, 0, 1 - box.h)
      setSelBox({ ...box, x, y })
    }
  }

  const onUp = (): void => {
    const d = drag.current
    drag.current = null
    if (d === null) return
    if (d.mode === 'create') {
      // 拖拽完成后停留在框选模式，方便继续移动微调；点“完成选区”再保存。
      // 若只是误点（未形成有效选框），恢复进入创建前的选区。
      setSelBox(prev => (prev !== null && prev.w > 0.04 && prev.h > 0.04 ? prev : d.prev))
    }
  }

  const onDone = (): void => {
    if (selBox !== null && selBox.w > 0.04 && selBox.h > 0.04) {
      const next = normalizeAreaToRatio(selBox, cropRatio)
      props.onArea(next)
      setDisplayArea(next)
    }
    setSelectMode(false)
    setSelBox(null)
  }

  const g = bgGeometry(props.fit, props.area, imgRatio, winRatio)
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
  const imageAspect = imgRatio ?? 1
  // 完整壁纸层：铺满容器（容器按图片比例构建，图片不变形，上下超出的部分可见）。
  const fullImageStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'url("' + props.src + '")',
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
  }
  // 非框选：Cover 且有选区时，展示完整壁纸 + 静态选框（选区外暗色遮罩）。
  const viewportBox = displayArea !== null && imgRatio !== null && imgRatio > 0 && props.fit === 'cover'
    ? normalizeAreaToRatio(displayArea, cropRatio)
    : null
  // 统一容器：选择态与非选择态完全一致（宽度按窗口、高度按完整壁纸比例），
  // 进入框选时容器不变，只是选框变为可交互。
  const contextStyle: React.CSSProperties = {
    width: stageStyle.width,
    aspectRatio: imageAspect,
  }
  return (
    <>
      <div className={css.previewActions}>
        <span className={css.previewHint}>{props.t('area.hint')}</span>
        {selectMode ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setSelBox(windowArea()) }}>
              {props.t('area.reselect')}
            </Button>
            <Button variant="primary" size="sm" onClick={onDone}>
              {props.t('area.done')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" disabled={props.fit !== 'cover' || imgRatio === null}
              onClick={startSelect}
            >
              {props.t('area.reselect')}
            </Button>
            {displayArea !== null && (
              <Button variant="ghost" size="sm" onClick={() => { setDisplayArea(null); props.onClearArea() }}>
                {props.t('area.clear')}
              </Button>
            )}
          </>
        )}
      </div>
      {selectMode ? (
        <div
          ref={stageRef}
          className={css.previewContext + ' ' + css.selecting}
          style={contextStyle}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {imgRatio !== null ? (
            <div className={css.previewFull} style={fullImageStyle}>
              {selBox !== null && selBox.w > 0 && (
                <div
                  className={css.previewCropBox}
                  style={{
                    left: selBox.x * 100 + '%',
                    top: selBox.y * 100 + '%',
                    width: selBox.w * 100 + '%',
                    height: selBox.h * 100 + '%',
                  }}
                >
                  <span className={css.cropHandle + ' ' + css.cropHandleTl} />
                  <span className={css.cropHandle + ' ' + css.cropHandleTr} />
                  <span className={css.cropHandle + ' ' + css.cropHandleBl} />
                  <span className={css.cropHandle + ' ' + css.cropHandleBr} />
                </div>
              )}
            </div>
          ) : (
            <div className={css.previewLoading} />
          )}
        </div>
      ) : viewportBox !== null ? (
        <div
          ref={stageRef}
          className={css.previewContext}
          style={contextStyle}
        >
          {/* 完整壁纸层：铺满容器，上下超出的部分可见。 */}
          <div className={css.previewFull} style={fullImageStyle} />
          {/* 原来的选框样式：选区外暗色遮罩，静态展示当前选区。 */}
          <div
            className={css.previewCropBox}
            style={{
              left: viewportBox.x * 100 + '%',
              top: viewportBox.y * 100 + '%',
              width: viewportBox.w * 100 + '%',
              height: viewportBox.h * 100 + '%',
              pointerEvents: 'none',
            }}
          />
        </div>
      ) : (
        <div
          ref={stageRef}
          className={css.previewStage}
          style={stageStyle}
        >
          {/* 无选区：按实际窗口比例铺满渲染真实壁纸效果，与真实壁纸所见即所得。 */}
          <div className={css.previewEffect} style={effectStyle} />
        </div>
      )}
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

      {/* 声纹响应（Nanoleaf Desktop 移植检测的参数，即时生效） */}
      <div className={css.wallpaperBlock}>
        <div className={css.wallpaperTitle}>{t('vp.title')}</div>
        <div className={css.grid}>
          <SliderRow
            label={t('vp.sensitivity')} value={s.vp_sensitivity} suffix="" min={0.01} max={1} step={0.01}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_sensitivity} tip={t('vp.tip.sensitivity')}
            onChange={(v) => { set({ vp_sensitivity: v }) }}
          />
          <SliderRow
            label={t('vp.beatGain')} value={s.vp_beat_gain} suffix="×" min={0} max={5} step={0.1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_beat_gain} tip={t('vp.tip.beatGain')}
            onChange={(v) => { set({ vp_beat_gain: v }) }}
          />
          <SliderRow
            label={t('vp.beatDecay')} value={s.vp_beat_decay} suffix="" min={0.5} max={0.995} step={0.005}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_beat_decay} tip={t('vp.tip.beatDecay')}
            onChange={(v) => { set({ vp_beat_decay: v }) }}
          />
          <SliderRow
            label={t('vp.beatMult')} value={s.vp_beat_mult} suffix="×" min={1} max={5} step={0.1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_beat_mult} tip={t('vp.tip.beatMult')}
            onChange={(v) => { set({ vp_beat_mult: v }) }}
          />
          <SliderRow
            label={t('vp.pulseMult')} value={s.vp_pulse_mult} suffix="×" min={0.1} max={3} step={0.05}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_pulse_mult} tip={t('vp.tip.pulseMult')}
            onChange={(v) => { set({ vp_pulse_mult: v }) }}
          />
          <SliderRow
            label={t('vp.bassWeight')} value={s.vp_bass_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_bass_weight} tip={t('vp.tip.bassWeight')}
            onChange={(v) => { set({ vp_bass_weight: v }) }}
          />
          <SliderRow
            label={t('vp.midWeight')} value={s.vp_mid_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_mid_weight} tip={t('vp.tip.midWeight')}
            onChange={(v) => { set({ vp_mid_weight: v }) }}
          />
          <SliderRow
            label={t('vp.highWeight')} value={s.vp_high_weight} suffix="%" min={0} max={100} step={1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_high_weight} tip={t('vp.tip.highWeight')}
            onChange={(v) => { set({ vp_high_weight: v }) }}
          />
          <SliderRow
            label={t('vp.beatCooldown')} value={s.vp_beat_cooldown} suffix="ms" min={50} max={1000} step={10}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_beat_cooldown} tip={t('vp.tip.beatCooldown')}
            onChange={(v) => { set({ vp_beat_cooldown: v }) }}
          />
          <SliderRow
            label={t('vp.pulseCooldown')} value={s.vp_pulse_cooldown} suffix="ms" min={50} max={1000} step={10}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_pulse_cooldown} tip={t('vp.tip.pulseCooldown')}
            onChange={(v) => { set({ vp_pulse_cooldown: v }) }}
          />
          <SliderRow
            label={t('vp.envSpeed')} value={s.vp_env_speed} suffix="" min={0} max={100} step={1}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_env_speed} tip={t('vp.tip.envSpeed')}
            onChange={(v) => { set({ vp_env_speed: v }) }}
          />
          <SliderRow
            label={t('vp.specSmooth')} value={s.vp_spec_smooth} suffix="" min={0.02} max={0.8} step={0.01}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_spec_smooth} tip={t('vp.tip.specSmooth')}
            onChange={(v) => { set({ vp_spec_smooth: v }) }}
          />
          <SliderRow
            label={t('vp.noiseGate')} value={s.vp_noise_gate} suffix="" min={0} max={0.2} step={0.005}
            defaultValue={DENPA_SETTINGS_DEFAULTS.vp_noise_gate} tip={t('vp.tip.noiseGate')}
            onChange={(v) => { set({ vp_noise_gate: v }) }}
          />
        </div>
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
