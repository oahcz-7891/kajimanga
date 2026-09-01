import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@primer/octicons-react'
import Toolbar from './components/Toolbar'
import MangaViewer from './components/MangaViewer'
import PageJump from './components/PageJump'
import SettingsModal from './components/SettingsModal'
import SettingsPage from './components/SettingsPage'
import { PROVIDERS, PROVIDER_THINKING, createDefaultConfigs, translateImage } from './lib/visionApi'
import {
  importManga,
  isPdf,
  isRar,
  isZip,
} from './lib/mangaImport'
import { generateCover } from './lib/cover'
import {
  deleteComic,
  loadShelf,
  saveComic,
  saveOrder,
  type CachedComic,
} from './lib/readingCache'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ConfigMap,
  type DisplayRect,
  type LocalTranslateResult,
  type ProviderKey,
  type ThinkingStrength,
} from './lib/types'

const STORAGE_KEY = 'kajimanga.config.v2'
const STORAGE_PROVIDER_KEY = 'kajimanga.provider.v1'
const APP_SETTINGS_KEY = 'kajimanga.app.v1'

function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>
      return { ...DEFAULT_APP_SETTINGS, ...saved }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_APP_SETTINGS }
}

/** 生成书籍 id：优先 crypto.randomUUID，老 iOS / 非 https 环境走兜底 */
function makeComicId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function loadProvider(): ProviderKey {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER_KEY)
    if (raw && (raw as ProviderKey) in PROVIDERS) return raw as ProviderKey
  } catch {
    /* ignore */
  }
  return 'qwen'
}

function loadConfigs(): ConfigMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ConfigMap>
      const out = createDefaultConfigs()
      for (const key of Object.keys(out) as ProviderKey[]) {
        const v = saved[key]
        if (v && typeof v === 'object') {
          out[key] = {
            baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : out[key].baseUrl,
            apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
            model: typeof v.model === 'string' ? v.model : '',
            thinking: (PROVIDER_THINKING[key] as ThinkingStrength[]).includes(v.thinking as ThinkingStrength)
              ? (v.thinking as ThinkingStrength)
              : out[key].thinking,
          }
        }
      }
      return out
    }
  } catch {
    /* ignore */
  }
  return createDefaultConfigs()
}

export default function App() {
  const [pages, setPages] = useState<string[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [selectionActive, setSelectionActive] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [shelf, setShelf] = useState<CachedComic[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [result, setResult] = useState<LocalTranslateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<ConfigMap>(loadConfigs)
  const [provider, setProvider] = useState<ProviderKey>(loadProvider)
  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [settingsIn, setSettingsIn] = useState(false)
  // 阅读层 mount / 展开状态（iOS 风格 push/pop 动画）
  const [readerMounted, setReaderMounted] = useState(false)
  const [readerIn, setReaderIn] = useState(false)
  // 打开新漫画/新图片时递增，用于触发阅读层缩放等临时状态重置
  const [readerNonce, setReaderNonce] = useState(0)
  const archiveInputRef = useRef<HTMLInputElement>(null)
  // 当前翻译请求的 AbortController，用于“取消翻译”
  const translateAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
  }, [configs])

  useEffect(() => {
    localStorage.setItem(STORAGE_PROVIDER_KEY, provider)
  }, [provider])

  useEffect(() => {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings))
  }, [appSettings])

  // 启动时读取书架缓存
  useEffect(() => {
    let alive = true
    void loadShelf()
      .then((list) => {
        if (alive) setShelf(list)
      })
      .catch(() => {
        /* 忽略缓存读取失败 */
      })
    return () => {
      alive = false
    }
  }, [])

  /** 打开阅读层：设好页面后挂载并触发 slide-in（双 rAF 与设置页动画同款） */
  const openReader = useCallback((urls: string[], id: string | null, idx: number) => {
    setPages(urls)
    setPageIndex(idx)
    setCurrentId(id)
    setResult(null)
    setError(null)
    setSelectionActive(false)
    setImportError(null)
    setReaderNonce((n) => n + 1)
    setReaderMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setReaderIn(true))
    })
  }, [])

  const handleImport = useCallback(
    async (file: File) => {
      setImportError(null)
      setImporting(true)
      try {
        const urls = await importManga(file)
        if (!urls.length) throw new Error('没有可导入的页面')
        // 存进书架：文件名 + 原始数据 + 阅读进度 + 首页封面缩略图
        const data = await file.arrayBuffer()
        const cover = urls[0] ? await generateCover(urls[0]).catch(() => '') : ''
        const comic: CachedComic = {
          id: makeComicId(),
          name: file.name,
          data,
          pageIndex: 0,
          totalPages: urls.length,
          cover,
        }
        setShelf((prev) => {
          const next = [comic, ...prev]
          void saveOrder(next.map((c) => c.id)).catch(() => {})
          return next
        })
        void saveComic(comic).catch(() => {})
        openReader(urls, comic.id, 0)
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e))
      } finally {
        setImporting(false)
      }
    },
    [openReader],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (!files.length) return
      const arch = files.find((f) => isPdf(f.name) || isZip(f.name) || isRar(f.name))
      if (arch) {
        void handleImport(arch)
        return
      }
      const imgs = files.filter((f) => f.type.startsWith('image/'))
      if (imgs.length) openReader(imgs.map((f) => URL.createObjectURL(f)), null, 0)
    },
    [handleImport, openReader],
  )

  const handleTranslate = useCallback(() => {
    if (!pages.length) return
    setResult(null)
    setError(null)
    setSelectionActive(true)
  }, [pages.length])

  const handleCancel = useCallback(() => setSelectionActive(false), [])
  const handleDismiss = useCallback(() => setResult(null), [])
  const handleErrorDismiss = useCallback(() => setError(null), [])

  // 翻页时同步写入对应漫画的进度
  useEffect(() => {
    if (!currentId || !pages.length) return
    setShelf((prev) =>
      prev.map((c) => (c.id === currentId ? { ...c, pageIndex, totalPages: pages.length } : c)),
    )
    const target = shelf.find((c) => c.id === currentId)
    if (target) {
      void saveComic({ ...target, pageIndex, totalPages: pages.length }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, pageIndex, pages.length])

  // 从书架继续阅读：重建文件 → 重新解压/渲染 → 跳到上次页码
  const handleContinue = useCallback(
    async (comic: CachedComic) => {
      setImporting(true)
      setImportError(null)
      try {
        const file = new File([comic.data], comic.name, { type: 'application/octet-stream' })
        const urls = await importManga(file)
        if (!urls.length) throw new Error('没有可导入的页面')
        const idx = Math.min(Math.max(0, comic.pageIndex), urls.length - 1)
        const updated: CachedComic = { ...comic, pageIndex: idx, totalPages: urls.length }
        setShelf((prev) => prev.map((c) => (c.id === comic.id ? updated : c)))
        void saveComic(updated).catch(() => {})
        openReader(urls, comic.id, idx)
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e))
      } finally {
        setImporting(false)
      }
    },
    [openReader],
  )

  // 从书架删除一本
  const handleDelete = useCallback(
    (id: string) => {
      setShelf((prev) => {
        const next = prev.filter((c) => c.id !== id)
        void saveOrder(next.map((c) => c.id)).catch(() => {})
        return next
      })
      void deleteComic(id).catch(() => {})
      if (currentId === id) setCurrentId(null)
    },
    [currentId],
  )

  // 返回书架：先触发收回动画，动画结束（handleReaderTransitionEnd）后再清空状态
  const handleBack = useCallback(() => {
    setReaderIn(false)
  }, [])
  const prev = useCallback(() => setPageIndex((i) => Math.max(0, i - 1)), [])
  const next = useCallback(
    () => setPageIndex((i) => Math.min(pages.length - 1, i + 1)),
    [pages.length],
  )

  // 设置保存：同时同步配置表和当前供应商
  const handleSaveSettings = useCallback((map: ConfigMap, p: ProviderKey) => {
    setConfigs(map)
    setProvider(p)
  }, [])

  const handleSaveAppSettings = useCallback((s: AppSettings) => {
    setAppSettings(s)
  }, [])

  // 移动端用设置页（iOS 风格 push 动画），桌面端用弹窗
  const openSettings = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      setSettingsMounted(true)
      // 双 rAF：确保初始 translateX(100%) 渲染后再加“打开”类，才能触发过渡动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSettingsIn(true))
      })
    } else {
      setSettingsOpen(true)
    }
  }, [])

  const closeSettings = useCallback(() => setSettingsIn(false), [])

  // 返回动画结束后再卸载设置页，避免页面瞬间消失
  const handleSettingsTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName === 'transform' && !settingsIn) {
        setSettingsMounted(false)
      }
    },
    [settingsIn],
  )

  // 阅读层收回动画结束后再卸载并清空，避免页面瞬间消失
  const handleReaderTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName === 'transform' && !readerIn) {
        for (const url of pages) {
          try {
            URL.revokeObjectURL(url)
          } catch {
            /* ignore */
          }
        }
        setPages([])
        setPageIndex(0)
        setCurrentId(null)
        setResult(null)
        setError(null)
        setSelectionActive(false)
        setImportError(null)
        setReaderMounted(false)
      }
    },
    [readerIn, pages],
  )

  // 最近一次裁剪，供“重新翻译”复用（不必重新框选）
  const lastCropRef = useRef<{ dataUrl: string; rect: DisplayRect } | null>(null)

  const doTranslate = useCallback(
    async (dataUrl: string, rect: DisplayRect, forceRefresh: boolean) => {
      setSelectionActive(false)
      const settings = configs[provider]
      if (!settings.apiKey) {
        setError('请先在设置里填写 API Key')
        return
      }
      if (!settings.model) {
        setError('请先在设置里填写模型名')
        return
      }
      const controller = new AbortController()
      translateAbortRef.current = controller
      setTranslating(true)
      setResult(null)
      setError(null)
      try {
        const r = await translateImage(
          provider,
          settings,
          dataUrl,
          appSettings.mode,
          controller.signal,
          forceRefresh,
        )
        setResult({ ...r, rect })
      } catch (e) {
        // 用户主动取消翻译：不弹错误
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (translateAbortRef.current === controller) translateAbortRef.current = null
        setTranslating(false)
      }
    },
    [configs, provider, appSettings.mode],
  )

  const handleCrop = useCallback(
    async (dataUrl: string, rect: DisplayRect) => {
      lastCropRef.current = { dataUrl, rect }
      await doTranslate(dataUrl, rect, false)
    },
    [doTranslate],
  )

  // 重新翻译：不查缓存，强制走 API，成功后照常写缓存
  const handleRetranslate = useCallback(() => {
    const last = lastCropRef.current
    if (last) void doTranslate(last.dataUrl, last.rect, true)
  }, [doTranslate])

  // 取消翻译：中断进行中的请求
  const handleCancelTranslate = useCallback(() => {
    translateAbortRef.current?.abort()
    translateAbortRef.current = null
    setTranslating(false)
    setSelectionActive(false)
  }, [])

  const current = pages[pageIndex]

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* 导入失败才提示，导入中不再打扰（点击漫画进入时静默解压） */}
      {importError && <div className="toast toast-error">{importError}</div>}

      {/* ===== 基础层：书架 ===== */}
      <div className={`nav-layer ${readerIn || settingsIn ? 'nav-layer-back' : ''}`}>
        {/* 阅读层推出时压暗书架层 */}
        <div className={`reader-shade ${readerIn ? 'reader-shade-show' : ''}`} />

        <Toolbar
          hasPages={false}
          pageIndex={0}
          totalPages={0}
          selectionActive={false}
          translating={false}
          onTranslate={handleTranslate}
          onPrev={prev}
          onNext={next}
          onJumpTo={setPageIndex}
          onBack={handleBack}
          onCancelSelection={handleCancel}
          onOpenSettings={openSettings}
        />

        <MangaViewer
          src={undefined}
          pageIndex={0}
          resetToken={0}
          selectionActive={false}
          translating={false}
          result={null}
          error={null}
          shelf={shelf}
          continuing={importing}
          doubleTapZoom={appSettings.doubleTapZoom}
          doubleTapRatio={appSettings.doubleTapRatio}
          onContinue={handleContinue}
          onDelete={handleDelete}
          onCrop={handleCrop}
          onDismiss={handleDismiss}
          onErrorDismiss={handleErrorDismiss}
          onRetranslate={handleRetranslate}
          onCancelTranslate={handleCancelTranslate}
          onEmptyImport={() => archiveInputRef.current?.click()}
          onPrev={prev}
          onNext={next}
        />

        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,.cbz,.rar,.cbr,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImport(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* ===== 阅读层：iOS 风格 push / pop，与设置页动画一致 ===== */}
      {readerMounted && (
        <div
          className={`reader-layer ${readerIn ? (settingsIn ? 'reader-layer-back' : 'reader-layer-open') : ''}`}
          onTransitionEnd={handleReaderTransitionEnd}
        >
          <Toolbar
            hasPages={pages.length > 0}
            pageIndex={pageIndex}
            totalPages={pages.length}
            selectionActive={selectionActive}
            translating={translating}
            onTranslate={handleTranslate}
            onPrev={prev}
            onNext={next}
            onJumpTo={setPageIndex}
            onBack={handleBack}
            onCancelSelection={handleCancel}
            onOpenSettings={openSettings}
          />

          <MangaViewer
            src={current}
            pageIndex={pageIndex}
            resetToken={readerNonce}
            selectionActive={selectionActive}
            translating={translating}
            result={result}
            error={error}
            shelf={shelf}
            continuing={importing}
            doubleTapZoom={appSettings.doubleTapZoom}
            doubleTapRatio={appSettings.doubleTapRatio}
            onContinue={handleContinue}
            onDelete={handleDelete}
            onCrop={handleCrop}
            onDismiss={handleDismiss}
            onErrorDismiss={handleErrorDismiss}
            onRetranslate={handleRetranslate}
            onCancelTranslate={handleCancelTranslate}
            onEmptyImport={() => archiveInputRef.current?.click()}
            onPrev={prev}
            onNext={next}
          />

          {/* 移动端底部翻页导航（桌面端隐藏，桌面用顶栏 nav） */}
          <nav className="nav-bottom">
            <button
              className="icon-btn"
              onClick={prev}
              disabled={!pages.length || pageIndex <= 0}
              title="上一页"
            >
              <ChevronLeftIcon size={22} />
            </button>
            {pages.length > 0 && (
              <PageJump current={pageIndex + 1} total={pages.length} onChange={setPageIndex} />
            )}
            <button
              className="icon-btn"
              onClick={next}
              disabled={!pages.length || pageIndex >= pages.length - 1}
              title="下一页"
            >
              <ChevronRightIcon size={22} />
            </button>
          </nav>
        </div>
      )}

      {/* 设置页遮罩（压暗下方内容） */}
      <div className={`nav-shade ${settingsIn ? 'nav-shade-show' : ''}`} />

      {settingsOpen && (
        <SettingsModal
          configs={configs}
          provider={provider}
          appSettings={appSettings}
          onSave={handleSaveSettings}
          onAppSettingsSave={handleSaveAppSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {settingsMounted && (
        <div
          className={`nav-layer-front ${settingsIn ? 'nav-layer-front-open' : ''}`}
          onTransitionEnd={handleSettingsTransitionEnd}
        >
          <SettingsPage
            configs={configs}
            provider={provider}
            appSettings={appSettings}
            onSave={handleSaveSettings}
            onAppSettingsSave={handleSaveAppSettings}
            onBack={closeSettings}
          />
        </div>
      )}
    </div>
  )
}
