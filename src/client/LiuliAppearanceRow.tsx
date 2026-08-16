/**
 * Liuli 定制版 Appearance Row —— 在官方基础上添加圆形过渡动画支持。
 *
 * 相比官方 AppearanceRow 的修改：
 * - 点击主题按钮时检测 __liuliThemeBridge__ 标记
 * - 若桥接就绪，触发 denpa:set-theme 事件（带坐标）
 * - 若桥接未就绪，降级为直接调用 setTheme（无动画）
 *
 * 这样做的原因：
 * 1. 保持 harness 官方代码不被修改
 * 2. liuli-theme 插件自包含所有定制逻辑
 * 3. 用户未安装 liuli-theme 时，仍能正常切换主题
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemeKey } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createLiuliAppearanceStore } from './liuli-appearance-store.ts'
import css from './LiuliAppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface LiuliAppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type LiuliAppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLiuliAppearanceStore>>
  & PropsLocale<'settings.theme'> & LiuliAppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Render the Liuli-enhanced Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function LiuliAppearanceRow({ t, setTheme, useStore }: LiuliAppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={(e) => {
              // 当前已选中的主题无需切换；其余走带坐标的圆形遮罩过渡
              // （denpa:set-theme → 琉璃主题事件桥 → startViewTransition）。
              // 主题插件未启用时事件无人接，降级为直连切换（无遮罩）。
              if (preference === id) return
              const bridgeReady = (window as unknown as { __liuliThemeBridge__?: boolean }).__liuliThemeBridge__ === true
              if (!bridgeReady) {
                setTheme(id)
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              window.dispatchEvent(new CustomEvent('denpa:set-theme', {
                detail: {
                  id,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                },
              }))
            }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
