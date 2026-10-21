/**
 * 壁纸"编辑选区"里的坐标换算。
 *
 * 编辑态会把方向草稿画在图片层上（`transform: scale → rotate → scaleX`），选框也
 * 画在同一层里，所以屏幕指针必须逆变换回原图坐标，拖动才会跟手；否则鼠标往右，
 * 选框会沿旋转后的轴往下走。
 */

export type BgPointerRotation = 0 | 90 | 180 | 270

export interface BgViewTransform {
  /** 预览层（未变换）的像素宽高。 */
  width: number
  height: number
  rotate: BgPointerRotation
  flipX: boolean
  /** 转 90/270 时为 contain 缩放因子，其余为 1。 */
  scale: number
}

interface Point { x: number; y: number }

function rotatePoint(x: number, y: number, rotate: BgPointerRotation): Point {
  if (rotate === 90) return { x: -y, y: x }
  if (rotate === 180) return { x: -x, y: -y }
  if (rotate === 270) return { x: y, y: -x }
  return { x, y }
}

function unrotatePoint(x: number, y: number, rotate: BgPointerRotation): Point {
  if (rotate === 90) return { x: y, y: -x }
  if (rotate === 180) return { x: -x, y: -y }
  if (rotate === 270) return { x: -y, y: x }
  return { x, y }
}

/** 屏幕指针（相对预览框的归一化坐标）→ 原图归一化坐标。 */
export function pointerToImage(pointer: Point, view: BgViewTransform): Point {
  const width = view.width > 0 ? view.width : 1
  const height = view.height > 0 ? view.height : 1
  const scale = view.scale > 0 ? view.scale : 1
  let x = ((pointer.x - 0.5) * width) / scale
  let y = ((pointer.y - 0.5) * height) / scale
  const unrotated = unrotatePoint(x, y, view.rotate)
  x = unrotated.x
  y = unrotated.y
  if (view.flipX) x = -x
  return { x: 0.5 + x / width, y: 0.5 + y / height }
}

/** 原图归一化坐标 → 屏幕指针归一化坐标（渲染选框/测试往返用）。 */
export function imageToPointer(point: Point, view: BgViewTransform): Point {
  const width = view.width > 0 ? view.width : 1
  const height = view.height > 0 ? view.height : 1
  const scale = view.scale > 0 ? view.scale : 1
  let x = (point.x - 0.5) * width
  let y = (point.y - 0.5) * height
  if (view.flipX) x = -x
  const rotated = rotatePoint(x, y, view.rotate)
  return {
    x: 0.5 + (rotated.x * scale) / width,
    y: 0.5 + (rotated.y * scale) / height,
  }
}
