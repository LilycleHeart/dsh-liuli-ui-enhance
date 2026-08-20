/**
 * 右侧边栏图标：统一使用 Material Design 风格图标（24x24 viewBox，fill currentColor）。
 * 与 DSH 右侧面板 tab / 工具栏图标语义一一对应。
 */

export interface IconProps {
  /** 宽高（px），默认 24。 */
  size?: number
  /** 附加类名。 */
  className?: string
}

function MaterialIcon({ d, size = 24, className }: IconProps & { d: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

/** Material description（计划/文档）。 */
export const NotepadTextIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
  />
)

/** Material chat（辅助对话）。 */
export const MessageSquareTextIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"
  />
)

/** Material smart_toy（机器人）。 */
export const BotIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zm-2 10H6V7h12v12zm-9-6c-.83 0-1.5-.67-1.5-1.5S8.17 10 9 10s1.5.67 1.5 1.5S9.83 13 9 13zm7.5-1.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zM8 15h8v2H8v-2z"
  />
)

/** Material account_tree（子智能体目录）。 */
export const ListTreeIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M22 11V3h-8v4h-2V3H4v8h8V7h2v4h8zm-10 0H6V5h6v6zm8 0h-6V5h6v6zm-8 6v4h8v-8h-8v4zm-2 0H6v4h6v-4z"
  />
)

/** Material public（浏览器）。 */
export const GlobeIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3.4a15.7 15.7 0 0 0-1.2-5.3A8.03 8.03 0 0 1 19.9 11zM12 4.1c.9 1.2 1.9 3.4 2.4 6.9H9.6c.5-3.5 1.5-5.7 2.4-6.9zM4.1 13h3.4c.2 2 .7 3.8 1.2 5.3A8.03 8.03 0 0 1 4.1 13zm3.4-2H4.1a8.03 8.03 0 0 1 4.6-5.3A15.7 15.7 0 0 0 7.5 11zm4.5 8.9c-.9-1.2-1.9-3.4-2.4-6.9h4.8c-.5 3.5-1.5 5.7-2.4 6.9zm3.3-1.6c.6-1.5 1-3.3 1.2-5.3h3.4a8.03 8.03 0 0 1-4.6 5.3z"
  />
)

/** Material Git（审查图谱）。 */
export const FileDiffIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M12 2a3 3 0 0 1 3 3c0 1.3-.84 2.4-2 2.82v3.36a3.002 3.002 0 0 1 2 2.82 3 3 0 1 1-6 0c0-1.3.84-2.4 2-2.82V7.82A3.008 3.008 0 0 1 9 5a3 3 0 0 1 3-3zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
  />
)

/** Material map（Treemapping）。 */
export const MapIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"
  />
)

/** Material palette（画板）。 */
export const PaletteIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
  />
)

/** Material timeline（模型调用轨迹）。 */
export const WaypointsIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 6.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-3.56-6.55c-.16.05-.33.07-.51.07s-.35-.02-.51-.07l-3.56 6.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52L2.07 9.93C1.91 9.98 1.73 10 1.56 10 .66 10 0 9.34 0 8.44S.66 7 1.56 7s1.56.66 1.56 1.56c0 .18-.02.36-.07.52l3.56 6.55c.16-.05.33-.07.51-.07s.35.02.51.07l3.56-6.55c-.05-.16-.07-.34-.07-.52 0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l3.56 6.55c.16-.05.33-.07.51-.07 1.1 0 2 .9 2 2z"
  />
)

/** Material bug_report（开发者工具）。 */
export const BugIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-4 4v3c0 .22-.03.47-.07.7l-.1.65-.37.65c-.72 1.24-2.04 2-3.46 2s-2.74-.77-3.46-2l-.37-.64-.1-.66C8.03 15.48 8 15.23 8 15v-4c0-.23.03-.48.07-.7l.1-.65.37-.65c.72-1.24 2.04-2 3.46-2s2.74.77 3.46 2l.37.64.1.66c.04.22.07.47.07.7v3z"
  />
)

/** Material terminal（终端）。 */
export const SquareTerminalIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M4 5h16c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1zm3.6 3.2-2.1 2.1 2.1 2.1-1.4 1.4L2.7 10.3l3.5-3.5 1.4 1.4zM21.3 10.3l-3.5 3.5-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 3.5 3.5z"
  />
)

/** Material code（代码查看）。 */
export const FileCodeCornerIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"
  />
)

/** Material add（新增标签）。 */
export const PlusIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
  />
)

/** Material unfold_more（概览/搜索标签页）。 */
export const ChevronsDownIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"
  />
)

/** Material chevron_left（展开右侧面板）。 */
export const PanelRightOpenIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
  />
)

/** Material chevron_right（收起右侧面板）。 */
export const PanelRightCloseIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
  />
)

/** Material search（搜索）。 */
export const SearchIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
  />
)

/** Material description（文件）。 */
export const FileIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
  />
)

/** Material folder（文件夹）。 */
export const FolderIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
  />
)

/** Material menu_book（仓库 Wiki）。 */
export const RepoWikiIcon = (props: IconProps) => (
  <MaterialIcon
    {...props}
    d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"
  />
)
