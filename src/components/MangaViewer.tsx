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
  onErrorDismiss: () => void
  onCancelTranslate: () => void
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
  onErrorDismiss,
  onCancelTranslate,
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
  // 翻页动画：turn 记录旧页与方向（1=下一页从右滑入，-1=上一页从左滑入）
  // animOn 两帧法：翻页先无过渡瞬移到屏幕外（start 类，图片借机解码），下一帧再加过渡类滑入（enter 类）
  const [turn, setTurn] = useState<{ from: string; dir: -1 | 1 } | null>(null)
  const [animOn, setAnimOn] = useState(false)
  const [lastPage, setLastPage] = useState<{ src: string | null; idx: number; token: number }>({
    src: null,
    idx: pageIndex,
    token: resetToken,
  })
  const turnTimerRef = useRef<number | undefined>(undefined)

  // src 可能为 undefined（书架层），统一归一化为 null，避免比较产生死循环
  const currentSrc = src ?? null

  // 渲染阶段检测 src 变化：先记录旧页再切新页，保证动画从第一帧开始（避免闪一下）
  // web 端（宽屏）翻页不做推页动画，直接切页；移动端保留推页动画
  const desktopNoAnim =
    typeof window !== 'undefined' && window.matchMedia('(min-width: 641px)').matches
  if (lastPage.token !== resetToken) {
    // 打开新漫画/新图片：不播翻页动画，直接重置记录
    setLastPage({ src: currentSrc, idx: pageIndex, token: resetToken })
    setTurn(null)
    setAnimOn(false)
    window.clearTimeout(turnTimerRef.current)
  } else if (currentSrc !== lastPage.src) {
    const prev = lastPage
    setLastPage({ src: currentSrc, idx: pageIndex, token: resetToken })
    if (prev.src && currentSrc) {
      if (desktopNoAnim) {
        // web 端：直接切页，不播动画
        setTurn(null)
        setAnimOn(false)
        window.clearTimeout(turnTimerRef.current)
      } else {
        setTurn({ from: prev.src, dir: pageIndex > prev.idx ? 1 : -1 })
        setAnimOn(false)
        window.clearTimeout(turnTimerRef.current)
        turnTimerRef.current = window.setTimeout(() => {
          setTurn(null)
          setAnimOn(false)
        }, 600)
      }
    }
  }

  // turn 出现后等两帧：先以静止帧渲染新页（start 类，图片开始解码），再挂过渡类播放滑入动画
  useEffect(() => {
    if (!turn) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setAnimOn(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [turn])

  useEffect(() => {
    return () => window.clearTimeout(turnTimerRef.current)
  }, [])

  // -------- 报错卡片：入场动画 + 5s 自动关闭（带退场动画） --------
  const [errorVisible, setErrorVisible] = useState(false)
  const [errorLeaving, setErrorLeaving] = useState(false)
  const errorTimerRef = useRef<number | undefined>(undefined)

  const dismissError = () => {
    setErrorLeaving(true)
    window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => {
      setErrorVisible(false)
      onErrorDismiss()
    }, 300)
  }

  // 错误出现时：显示卡片并启动 5s 自动关闭；错误清除/翻译开始时重置
  useEffect(() => {
    if (!error || translating) return
    setErrorVisible(true)
    setErrorLeaving(false)
    window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(dismissError, 5000)
    return () => window.clearTimeout(errorTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, translating])

  useEffect(() => {
    return () => window.clearTimeout(errorTimerRef.current)
  }, [])

  // -------- 译文结果卡片：玻璃弹性弹入，关闭时先播退场动画再卸载 --------
  const [resultLeaving, setResultLeaving] = useState(false)
  const resultTimerRef = useRef<number | undefined>(undefined)

  const closeResultCard = () => {
    setResultLeaving(true)
    window.clearTimeout(resultTimerRef.current)
    resultTimerRef.current = window.setTimeout(() => {
      setResultLeaving(false)
      onDismiss()
    }, 300)
  }

  useEffect(() => {
    return () => window.clearTimeout(resultTimerRef.current)
  }, [])

  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageInnerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  const tapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  // 双指捏合缩放：活动指针表 + 捏合起点
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{
    dist: number
    scale: number
    tx: number
    ty: number
    cx: number // 两指中心（视口坐标）
    cy: number
  } | null>(null)

  // 打开新漫画 / 双击设置变更 → 完全重置缩放（进入选区不重置，保留当前缩放进行翻译）
  useEffect(() => {
    setBox(null)
    setZoom({ scale: 1, tx: 0, ty: 0 })
    setZoomTween(false)
    panRef.current = null
    tapRef.current = null
    pointersRef.current.clear()
    pinchRef.current = null
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
          <button
            className={`btn big${continuing ? '' : ' primary'}`}
            onClick={onEmptyImport}
            disabled={continuing}
          >
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
    // 记录活动指针
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // 双指 → 开始捏合缩放（清掉双击 / 平移状态，缩放动画改为即时）
    if (pointersRef.current.size >= 2) {
      tapRef.current = null
      panRef.current = null
      const pts = [...pointersRef.current.values()]
      pinchRef.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: zoom.scale,
        tx: zoom.tx,
        ty: zoom.ty,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      }
      setZoomTween(false)
      e.preventDefault()
      // 两根手指都捕获，避免移出舞台时丢失
      for (const id of pointersRef.current.keys()) {
        ;(e.currentTarget as HTMLElement).setPointerCapture(id)
      }
      return
    }

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
    // 更新活动指针位置
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 双指捏合：以两指中心为锚点缩放（图片跟手）
    const pinch = pinchRef.current
    if (pinch) {
      const pts = [...pointersRef.current.values()]
      if (pts.length >= 2) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const cx = (pts[0].x + pts[1].x) / 2
        const cy = (pts[0].y + pts[1].y) / 2
        if (dist > 0) {
          setZoom((z) => {
            const scale = Math.min(4, Math.max(1, pinch.scale * (dist / pinch.dist)))
            const stage = stageRef.current
            const inner = stageInnerRef.current
            const img = imgRef.current
            if (!stage || !inner || !img) return z
            const w = img.clientWidth
            const h = img.clientHeight
            if (!w || !h) return z
            const stageRect = stage.getBoundingClientRect()
            const innerRect = inner.getBoundingClientRect()
            const Cx = innerRect.left - stageRect.left + w / 2
            const Cy = innerRect.top - stageRect.top + h / 2
            const qx = cx - stageRect.left
            const qy = cy - stageRect.top
            const S0 = pinch.scale
            // 两指中心对应的布局点 p（用起点缩放 / 平移反解）：p = (q - C)/S + (w/2, h/2) - t
            const px = (qx - Cx) / S0 + w / 2 - pinch.tx
            const py = (qy - Cy) / S0 + h / 2 - pinch.ty
            // 缩放后让 p 仍显示在 q：t = (q - C)/S - (p - (w/2, h/2))
            const tx = (qx - Cx) / scale - (px - w / 2)
            const ty = (qy - Cy) / scale - (py - h / 2)
            return { scale, tx, ty }
          })
        }
        return
      }
    }

    // 单指平移
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

  function onStagePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId)
    // 少于两指 → 结束捏合
    if (pointersRef.current.size < 2) pinchRef.current = null
    // 还剩一指且处于放大状态：无缝转成单指平移
    if (pointersRef.current.size === 1 && zoom.scale > 1) {
      const [pt] = [...pointersRef.current.values()]
      panRef.current = { startX: pt.x, startY: pt.y, tx: zoom.tx, ty: zoom.ty }
    } else {
      panRef.current = null
    }
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
              key={`old-${turn.from}`}
              className={`turn-old-wrap${animOn ? ` turn-exit-${turn.dir > 0 ? 'next' : 'prev'}` : ''}`}
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
          {/* 固定元素不重建（img 复用，换 src 无空白帧）；翻页时先挂 start 类瞬移到屏幕外，两帧后挂 enter 类过渡滑入 */}
          <div
            className={`turn-new-wrap${turn ? (animOn ? ` turn-enter-${turn.dir > 0 ? 'next' : 'prev'}` : ` turn-start-${turn.dir > 0 ? 'next' : 'prev'}`) : ''}`}
            onTransitionEnd={(e) => {
              // 翻页过渡结束（忽略图片自身的缩放过渡）
              if (e.target === e.currentTarget && e.propertyName === 'transform' && turn && animOn) {
                setTurn(null)
                setAnimOn(false)
              }
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

          {translating && (
            <div className="translating-card">
              <button className="close-btn" onClick={onCancelTranslate} title="取消翻译">
                取消翻译
              </button>
            </div>
          )}

          {result && !translating && (
            <TranslationCard
              result={{ ...result, rect: toViewportRect(result.rect) }}
              leaving={resultLeaving}
              onAnimationEnd={(e) => {
                if (e.animationName === 'result-card-out' && resultLeaving) {
                  setResultLeaving(false)
                  onDismiss()
                }
              }}
              onClose={closeResultCard}
            />
          )}
          {error && !translating && errorVisible && (
            <div
              className={`trans-error${errorLeaving ? ' leaving' : ''}`}
              onAnimationEnd={(e) => {
                if (e.animationName === 'trans-error-out' && errorLeaving) {
                  setErrorVisible(false)
                  onErrorDismiss()
                }
              }}
            >
              <div className="trans-error-head">
                <span className="badge">错误</span>
                <button className="close-btn" onClick={dismissError} title="关闭">
                  关闭
                </button>
              </div>
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
