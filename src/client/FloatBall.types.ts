/** 元素选择器插入面：把拾取的元素作为引用 chip 插入当前会话输入框。 */
import type { PickedElement } from './element-picker.ts'

export type InsertElementFn = (info: PickedElement) => void
