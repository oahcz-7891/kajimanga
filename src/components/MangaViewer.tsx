import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BookIcon } from '@primer/octicons-react'
import { cropImageToDataUrl } from '../lib/crop'
import type { CachedComic } from '../lib/readingCache'
import type { DisplayRect, LocalTranslateResult } from '../lib/types'
import TranslationCard from './TranslationCard'

interface MangaViewerProps {
  src?: string
  /** 当前页码（用于判断翻页方向） */
  pageIndex: number
  /** 每次打开新漫画/拖入新图片时递增，触发缩放等临时状态重置 */
  resetToken: number
  selectionActive: boolean
  translating: boolean
  result: LocalTranslateResult | null
  error: string | null
  shelf: CachedComic[]
  continuing: boolean
  doubleTapZoom: boolean
  doubleTapRatio: number
  onContinue: (comic: CachedComic) => void
  onDelete: (id: string) => void
  onCrop: (dataUrl: string, rect: DisplayRect) => void
  onDismiss: () => void
  onEmptyImport: () => void
  onPrev: () => void
  onNext: () => void
}

export default function MangaViewer({
  src,
  pageIndex,
  resetToken,
  selectionActive,
  translating,
  result,
  error,
  shelf,
  continuing,
  doubleTapZoom,
  doubleTapRatio,
  onContinue,
  onDelete,
  onCrop,
  onDismiss,
  onEmptyImport,
  onPrev,
  onNext,
}: MangaViewerProps) {
  const [box, setBox] = useState<DisplayRect | null>(null)
  const [zoom, setZoom] = useState<{ scale: number; tx: number; ty: number }>({
    scale: 1,
    tx: 0,
    ty: 0,
  })
  // 双击缩放过渡动画开关（仅双语切换时启用，拖动平移保持即时）
  const [zoomTween, setZoomTween] = useState(false)
  // 翻页动画：turn 记录旧页与方向（1=下一页从右滑入，-1=上一页从左滑入），动画结束清除
  const [turn, setTurn] = useState<{ from: string; dir: -1 | 1 } | null>(null)
  const [lastPage, setLastPage] = useState<{ src: string | null; idx: number; token: number }>({
    src: null,
    idx: pageIndex,
    token: resetToken,
  })
  const turnTimerRef = useRef<number | undefined>(undefined)

  // src 可能为 undefined（书架层），统一归一化为 null，避免比较产生死循环
  const currentSrc = src ?? null

  // 渲染阶段检测 src 变化：先记录旧页再切新页，保证动画从第一帧开始（避免闪一下）
  if (lastPage.token !== resetToken) {
    // 打开新漫画/新图片：不播翻页动画，直接重置记录
    setLastPage({ src: currentSrc, idx: pageIndex, token: resetToken })
    setTurn(null)
    window.clearTimeout(turnTimerRef.current)
  } else if (currentSrc !== lastPage.src) {
    const prev = lastPage
    setLastPage({ src: currentSrc, idx: pageIndex, token: resetToken })
    if (prev.src && currentSrc) {
      setTurn({ from: prev.src, dir: pageIndex > prev.idx ? 1 : -1 })
      window.clearTimeout(turnTimerRef.current)
      turnTimerRef.current = window.setTimeout(() => setTurn(null), 600)
    }
  }

  useEffect(() => {
    return () => window.clearTimeout(turnTimerRef.current)
  }, [])

  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageInnerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  const tapRef = useRef<{ t: number; x: number; y: number } | null>(null)

  // 打开新漫画 / 双击设置变更 → 完全重置缩放（进入选区不重置，保留当前缩放进行翻译）
  useEffect(() => {
    setBox(null)
    setZoom({ scale: 1, tx: 0, ty: 0 })
    setZoomTween(false)
    panRef.current = null
    tapRef.current = null
  }, [resetToken, doubleTapZoom])

  // 翻页：缩放只对当前页有效，切页后恢复原大小
  useEffect(() => {
    setZoom({ scale: 1, tx: 0, ty: 0 })
    setZoomTween(false)
  }, [src])

  if (!src) {
    return (
      <div className="empty bookshelf">
        <div className="shelf-import">
          <button className="btn primary big" onClick={onEmptyImport} disabled={continuing}>
            <BookIcon size={16} /> 导入漫画
          </button>
          <span className="shelf-import-hint">支持 ZIP / CBZ / RAR / CBR / PDF</span>
        </div>

        {shelf.length === 0 ? (
          <div className="shelf-empty">书架还是空的，导入一部漫画开始吧</div>
        ) : (
          <div className="shelf-grid">
            {shelf.map((c) => (
              <div key={c.id} className="book-card">
                <div className="book-cover" onClick={() => onContinue(c)}>
                  {c.cover ? (
                    <img src={c.cover} alt={c.name} />
                  ) : (
                    <BookIcon size={28} />
                  )}
                  <button
                    className="book-delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(c.id)
                    }}
                    aria-label="删除"
                    title="从书架删除"
                  >
                    ×
                  </button>
                </div>
                <div className="book-name">{c.name}</div>
                <div className="book-progress">
                  {c.totalPages > 0 ? `第 ${c.pageIndex + 1} / ${c.totalPages} 页` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function toLocalPoint(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionActive) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    startRef.current = toLocalPoint(e)
    setBox({ x: startRef.current.x, y: startRef.current.y, width: 0, height: 0 })
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionActive || !startRef.current) return
    const p = toLocalPoint(e)
    const s = startRef.current
    setBox({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    })
  }

  // 把舞台坐标的选区矩形逆变换回未缩放布局坐标（跟随缩放/平移，裁剪结果与所见一致）
  function toImageRect(rect: DisplayRect): DisplayRect {
    const stage = stageRef.current
    const inner = stageInnerRef.current
    const img = imgRef.current
    if (!stage || !inner || !img) return rect
    const w = img.clientWidth
    const h = img.clientHeight
    if (!w || !h) return rect
    const stageRect = stage.getBoundingClientRect()
    const innerRect = inner.getBoundingClientRect()
    // stage-inner 左上角与中心在舞台坐标中的位置
    const ox = innerRect.left - stageRect.left
    const oy = innerRect.top - stageRect.top
    const cx = ox + w / 2
    const cy = oy + h / 2
    const { scale: S, tx, ty } = zoom
    // transform 为 scale(S) translate(tx,ty)：视觉位置 q = C + S*(p + O - C) + S*t
    // 逆变换 p = (q - C)/S + (w/2, h/2) - t
    const mapX = (qx: number) => (qx - cx) / S + w / 2 - tx
    const mapY = (qy: number) => (qy - cy) / S + h / 2 - ty
    const x1 = mapX(rect.x)
    const y1 = mapY(rect.y)
    const x2 = mapX(rect.x + rect.width)
    const y2 = mapY(rect.y + rect.height)
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    }
  }

  // 布局坐标 → 视口坐标（正变换，缩放/平移后结果卡片仍显示在框选处的视觉位置）
  function toViewportRect(rect: DisplayRect): DisplayRect {
    const stage = stageRef.current
    const inner = stageInnerRef.current
    const img = imgRef.current
    if (!stage || !inner || !img) return rect
    const w = img.clientWidth
    const h = img.clientHeight
    if (!w || !h) return rect
    const stageRect = stage.getBoundingClientRect()
    const innerRect = inner.getBoundingClientRect()
    // stage-inner 相对 stage 的偏移 O 与中心 C
    const ox = innerRect.left - stageRect.left
    const oy = innerRect.top - stageRect.top
    const cx = ox + w / 2
    const cy = oy + h / 2
    const { scale: S, tx, ty } = zoom
    // 布局 p → 视觉 q（stage 坐标）：q = C + S*(p - (w/2, h/2)) + S*t
    const mapX = (px: number) => cx + S * (px - w / 2) + S * tx
    const mapY = (py: number) => cy + S * (py - h / 2) + S * ty
    const x1 = stageRect.left + mapX(rect.x)
    const y1 = stageRect.top + mapY(rect.y)
    const x2 = stageRect.left + mapX(rect.x + rect.width)
    const y2 = stageRect.top + mapY(rect.y + rect.height)
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    }
  }

  function onPointerUp() {
    const s = startRef.current
    startRef.current = null
    if (s && box && box.width >= 8 && box.height >= 8 && imgRef.current) {
      const rect = toImageRect(box)
      const dataUrl = cropImageToDataUrl(imgRef.current, rect)
      if (dataUrl) onCrop(dataUrl, rect)
    }
    setBox(null)
  }

  // ---------- 双击缩放 + 拖动平移 ----------
  function toggleZoom() {
    setZoomTween(true)
    setZoom((z) =>
      z.scale <= 1
        ? { scale: doubleTapRatio, tx: 0, ty: 0 }
        : { scale: 1, tx: 0, ty: 0 },
    )
  }

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (selectionActive || !doubleTapZoom) return
    // 双击检测：300ms 内两次相近的点击 → 切换缩放
    const now = Date.now()
    const prev = tapRef.current
    if (prev && now - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 50) {
      tapRef.current = null
      toggleZoom()
      return
    }
    tapRef.current = { t: now, x: e.clientX, y: e.clientY }
    // 放大状态：开始拖动平移（拖动保持即时，不需要缩放动画）
    if (zoom.scale > 1) {
      setZoomTween(false)
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      panRef.current = { startX: e.clientX, startY: e.clientY, tx: zoom.tx, ty: zoom.ty }
    }
  }

  function onStagePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = panRef.current
    if (!p || zoom.scale <= 1) return
    const stage = e.currentTarget.getBoundingClientRect()
    const img = imgRef.current
    const w = img?.clientWidth ?? stage.width
    const h = img?.clientHeight ?? stage.height
    // 注意：transform 为 scale(S) translate(tx,ty)，translate 在缩放后的坐标系，
    // 实际视觉位移 = S*tx，所以边界要除以 S 才能让图片边缘精确贴住舞台边缘
    const maxX = w * zoom.scale > stage.width ? (w * zoom.scale - stage.width) / (2 * zoom.scale) : 0
    const maxY = h * zoom.scale > stage.height ? (h * zoom.scale - stage.height) / (2 * zoom.scale) : 0
    const tx = Math.min(maxX, Math.max(-maxX, p.tx + (e.clientX - p.startX)))
    const ty = Math.min(maxY, Math.max(-maxY, p.ty + (e.clientY - p.startY)))
    setZoom((z) => (z.scale <= 1 ? z : { ...z, tx, ty }))
  }

  function onStagePointerUp() {
    panRef.current = null
  }


  return (
    <div className="viewer">
      <div
        ref={stageRef}
        className="stage"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <div ref={stageInnerRef} className="stage-inner">
          {/* 翻页动画：推页式，旧页同向滑出、新页相对滑入（与阅读层 push/pop 同款滑动感） */}
          {turn && (
            <div
              key="turn-old"
              className={`turn-old-wrap turn-exit-${turn.dir > 0 ? 'next' : 'prev'}`}
            >
              <img
                src={turn.from}
                alt=""
                className="turn-old-img"
                style={{
                  transform: `scale(${zoom.scale}) translate(${zoom.tx}px, ${zoom.ty}px)`,
                  transformOrigin: 'center center',
                }}
              />
            </div>
          )}
          <div
            key="turn-new"
            className={`turn-new-wrap${turn ? ` turn-enter-${turn.dir > 0 ? 'next' : 'prev'}` : ''}`}
            onAnimationEnd={(e) => {
              if (e.animationName.startsWith('turn-in')) setTurn(null)
            }}
          >
            <img
              ref={imgRef}
              src={src}
              alt="漫画页"
              className={zoomTween ? 'zoom-anim' : undefined}
              onTransitionEnd={(e) => {
                if (e.propertyName === 'transform' && zoomTween) setZoomTween(false)
              }}
              style={{
                transform: `scale(${zoom.scale}) translate(${zoom.tx}px, ${zoom.ty}px)`,
                transformOrigin: 'center center',
              }}
            />
          </div>

          {result && !translating && (
            <TranslationCard
              result={{ ...result, rect: toViewportRect(result.rect) }}
              onClose={onDismiss}
            />
          )}
          {error && !translating && (
            <div className="trans-error">
              <span className="badge">错误</span>
              <div className="trans-error-msg">{error}</div>
            </div>
          )}
        </div>

        {/* 选区层：铺满舞台，缩放时也能框选整幅画面 */}
        {selectionActive && (
          <div
            className="selection-layer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            {!box && <div className="selection-hint">选择翻译区域</div>}
            {box && (
              <div
                className="selection-box"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                }}
              />
            )}
          </div>
        )}

        {/* 左右热区：点击翻页（选区时隐藏避免干扰框选；缩放时保留，边缘翻页，平移从中间起手） */}
        {!selectionActive && (
          <div className="hotzones">
            <button
              className="hotzone hotzone-left"
              onClick={onPrev}
              aria-label="上一页"
              title="上一页"
            >
              <span className="hotzone-arrow" />
            </button>
            <button
              className="hotzone hotzone-right"
              onClick={onNext}
              aria-label="下一页"
              title="下一页"
            >
              <span className="hotzone-arrow" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
