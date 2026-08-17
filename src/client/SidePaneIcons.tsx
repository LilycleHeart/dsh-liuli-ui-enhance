/**
 * ZCode 侧边面板图标：路径数据逐条取自 ZCode app.asar 渲染 bundle 内的 lucide 定义，
 * 与 ZCode 右侧面板 tab / 工具栏图标 1:1。lucide 渲染参数：
 * 24x24 viewBox，fill none，stroke currentColor，strokeWidth 2，round caps/joins。
 */

export interface IconProps {
  /** 宽高（px），默认 24。 */
  size?: number
  /** 附加类名。 */
  className?: string
}

/** lucide notepad-text（ZCode 原样路径）。 */
export const NotepadTextIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M8 2v4" />
    <path d="M12 2v4" />
    <path d="M16 2v4" />
    <rect width="16" height="18" x="4" y="4" rx="2" />
    <path d="M8 10h6" />
    <path d="M8 14h8" />
    <path d="M8 18h5" />
  </svg>
)

/** lucide message-square-text（ZCode 原样路径）。 */
export const MessageSquareTextIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
    <path d="M7 11h10" />
    <path d="M7 15h6" />
    <path d="M7 7h8" />
  </svg>
)

/** lucide bot（ZCode 原样路径）。 */
export const BotIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
)

/** lucide list-tree（ZCode 原样路径）。 */
export const ListTreeIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M8 5h13" />
    <path d="M13 12h8" />
    <path d="M13 19h8" />
    <path d="M3 10a2 2 0 0 0 2 2h3" />
    <path d="M3 5v12a2 2 0 0 0 2 2h3" />
  </svg>
)

/** lucide globe（ZCode 原样路径）。 */
export const GlobeIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
)

/** lucide file-diff（ZCode 原样路径）。 */
export const FileDiffIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M9 10h6" />
    <path d="M12 13V7" />
    <path d="M9 17h6" />
  </svg>
)

/** lucide map（ZCode 原样路径）。 */
export const MapIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
    <path d="M15 5.764v15" />
    <path d="M9 3.236v15" />
  </svg>
)

/** lucide palette（ZCode 原样路径）。 */
export const PaletteIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
)

/** lucide waypoints（ZCode 原样路径）。 */
export const WaypointsIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m10.586 5.414-5.172 5.172" />
    <path d="m18.586 13.414-5.172 5.172" />
    <path d="M6 12h12" />
    <circle cx="12" cy="20" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="20" cy="12" r="2" />
    <circle cx="4" cy="12" r="2" />
  </svg>
)

/** lucide bug（ZCode 原样路径）。 */
export const BugIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 20v-9" />
    <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
    <path d="M14.12 3.88 16 2" />
    <path d="M21 21a4 4 0 0 0-3.81-4" />
    <path d="M21 5a4 4 0 0 1-3.55 3.97" />
    <path d="M22 13h-4" />
    <path d="M3 21a4 4 0 0 1 3.81-4" />
    <path d="M3 5a4 4 0 0 0 3.55 3.97" />
    <path d="M6 13H2" />
    <path d="m8 2 1.88 1.88" />
    <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
  </svg>
)

/** lucide square-terminal（ZCode 原样路径）。 */
export const SquareTerminalIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </svg>
)

/** lucide file-code-corner（ZCode 原样路径）。 */
export const FileCodeCornerIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="m5 16-3 3 3 3" />
    <path d="m9 22 3-3-3-3" />
  </svg>
)

/** lucide plus（ZCode 原样路径）。 */
export const PlusIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
)

/** lucide chevrons-down（ZCode 原样路径）。 */
export const ChevronsDownIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m7 6 5 5 5-5" />
    <path d="m7 13 5 5 5-5" />
  </svg>
)

/** lucide panel-right-open（ZCode 原样路径）。 */
export const PanelRightOpenIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
    <path d="m10 15-3-3 3-3" />
  </svg>
)

/** lucide panel-right-close（ZCode 原样路径）。 */
export const PanelRightCloseIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
    <path d="m8 9 3 3-3 3" />
  </svg>
)

/** lucide search（ZCode 原样路径）。 */
export const SearchIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </svg>
)

/** lucide file（ZCode 原样路径）。 */
export const FileIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
  </svg>
)

/** lucide folder（ZCode 原样路径）。 */
export const FolderIcon = ({ size = 24, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

/** ZCode 仓库 Wiki 自绘图标（32x32 viewBox，三个圆角方块 + 对角线，fill currentColor）。 */
export const RepoWikiIcon = ({ size = 24, className }: IconProps) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={className} aria-hidden="true">
    <path d="M9.91922 3.2002H4.47922C3.77229 3.2002 3.19922 3.77327 3.19922 4.4802V9.9202C3.19922 10.6271 3.77229 11.2002 4.47922 11.2002H9.91922C10.6261 11.2002 11.1992 10.6271 11.1992 9.9202V4.4802C11.1992 3.77327 10.6261 3.2002 9.91922 3.2002Z" fill="currentColor" />
    <path d="M9.91922 20.7998H4.47922C3.77229 20.7998 3.19922 21.3729 3.19922 22.0798V27.5198C3.19922 28.2267 3.77229 28.7998 4.47922 28.7998H9.91922C10.6261 28.7998 11.1992 28.2267 11.1992 27.5198V22.0798C11.1992 21.3729 10.6261 20.7998 9.91922 20.7998Z" fill="currentColor" />
    <path d="M27.5208 3.2002H22.0808C21.3739 3.2002 20.8008 3.77327 20.8008 4.4802V9.9202C20.8008 10.6271 21.3739 11.2002 22.0808 11.2002H27.5208C28.2277 11.2002 28.8008 10.6271 28.8008 9.9202V4.4802C28.8008 3.77327 28.2277 3.2002 27.5208 3.2002Z" fill="currentColor" />
    <path d="M8 24L24 8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
  </svg>
)
