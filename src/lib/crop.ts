import type { DisplayRect } from './types'

/**
 * 把图片元素中某个矩形区域裁剪出来，返回 JPEG dataURL。
 * rect 为相对图片显示容器的 CSS 坐标。
 */
export function cropImageToDataUrl(
  img: HTMLImageElement,
  rect: DisplayRect,
  maxDim = 1024,
): string | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return null
  const dw = img.clientWidth || nw
  const dh = img.clientHeight || nh
  const scaleX = nw / dw
  const scaleY = nh / dh

  let sx = rect.x * scaleX
  let sy = rect.y * scaleY
  let sw = rect.width * scaleX
  let sh = rect.height * scaleY

  sx = Math.max(0, sx)
  sy = Math.max(0, sy)
  sw = Math.min(nw - sx, sw)
  sh = Math.min(nh - sy, sh)

  if (sw < 8 || sh < 8) return null

  // 对齐到原始图像坐标的粗网格：相近的选框会裁出完全一致的图，
  // 使感知哈希（dHash）必然命中，而不是因边界差几像素导致失配。
  const GRID = 24
  const sx2 = Math.round(sx / GRID) * GRID
  const sy2 = Math.round(sy / GRID) * GRID
  const ex2 = Math.round((sx + sw) / GRID) * GRID
  const ey2 = Math.round((sy + sh) / GRID) * GRID
  sx = Math.min(Math.max(0, sx2), nw - 1)
  sy = Math.min(Math.max(0, sy2), nh - 1)
  sw = Math.max(1, Math.min(ex2, nw) - sx)
  sh = Math.max(1, Math.min(ey2, nh) - sy)

  // 控制输出尺寸，避免请求体积过大
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const outW = Math.max(1, Math.round(sw * scale))
  const outH = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  return canvas.toDataURL('image/jpeg', 0.7)
}
