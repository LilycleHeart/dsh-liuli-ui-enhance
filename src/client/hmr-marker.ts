/**
 * HMR 自测标记：GUI 自测脚本（demo/verify-dock-shell-gui.mjs）在热重载用例里
 * 改写此常量以强制 bundle 内容变化（同内容重建不会触发 HMR 广播），
 * 并在用例结束后还原。运行时仅作为一个 data 属性展示，无副作用。
 */
export const HMR_MARKER = 'liuli-dock-v1'
