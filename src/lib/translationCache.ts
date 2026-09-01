import type { ProviderKey, ProviderSettings, ReadMode, TranslateResult } from './types'

/**
 * 翻译结果本地缓存（方案1：感知哈希 + 容差）。
 * 关键点：同一片文字、但裁剪/缩放/压缩略有差异的截图，用 dHash 比较 Hamming 距离，
 * 距离 ≤ 阈值即视为命中，从而跳过图像请求，省掉重复的「图像 token」。
 */

const DB_NAME = 'kajimanga-cache'
const STORE = 'translation'

/** 缓存条目有效期：30 天 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** dHash Hamming 距离阈值，越小越严格。漫画小字建议 6~10，需要实测 */
export const CACHE_TOLERANCE = 8

interface CacheEntry {
  id: string
  /** 请求参数（provider/baseUrl/model/thinking/mode），用于隔离不同服务的缓存 */
  params: string
  /** 64 位 dHash，0/1 字符串 */
  hash: string
  result: TranslateResult
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 请求参数 → 缓存 params 字符串（JSON 编码，避免分隔符冲突） */
export function buildParams(
  provider: ProviderKey,
  settings: ProviderSettings,
  mode: ReadMode,
): string {
  return JSON.stringify([provider, settings.baseUrl, settings.model, settings.thinking, mode])
}

/** 清空全部翻译缓存 */
export async function clearTranslationCache(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function readAll(db: IDBDatabase): Promise<CacheEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).openCursor()
    const out: CacheEntry[] = []
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        out.push(cursor.value as CacheEntry)
        cursor.continue()
      } else {
        resolve(out)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

function hamming(a: string, b: string): number {
  let dist = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) dist++
  return dist
}

/** 命中缓存则返回结果，否则 null */
export async function getCachedTranslation(
  params: string,
  hash: string,
): Promise<TranslateResult | null> {
  const db = await openDb()
  const entries = await readAll(db)
  const now = Date.now()
  let best: CacheEntry | null = null
  let bestDist = Infinity
  let matchedParams = 0
  let expired = 0
  for (const e of entries) {
    if (e.params !== params) continue
    matchedParams++
    if (now - e.createdAt > CACHE_TTL_MS) {
      expired++
      continue
    }
    const dist = hamming(e.hash, hash)
    if (dist < bestDist) {
      bestDist = dist
      best = e
    }
  }
  // 【临时诊断】定位“未显示命中”问题，定位后可删
  console.info(
    '[cache] query params=%s hash=%s | 库内条目=%d params匹配=%d 过期=%d | 最优距离=%s 阈值=%d → %s',
    params,
    hash,
    entries.length,
    matchedParams,
    expired,
    best ? String(bestDist) : '无',
    CACHE_TOLERANCE,
    best && bestDist <= CACHE_TOLERANCE ? '命中' : '未命中',
  )
  if (best && bestDist <= CACHE_TOLERANCE) {
    // 命中即视为复用，顺手刷新过期时间
    void setCachedEntry(best.params, best.hash, best.result)
    return best.result
  }
  return null
}

function setCachedEntry(params: string, hash: string, result: TranslateResult): Promise<void> {
  const id = `${params}|${hash}`
  const entry: CacheEntry = { id, params, hash, result, createdAt: Date.now() }
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(entry, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }, reject)
  })
}

/** 写入 /命中刷新 */
export function setCachedTranslation(
  params: string,
  hash: string,
  result: TranslateResult,
): Promise<void> {
  return setCachedEntry(params, hash, result)
}

const LUMINANCE_R = 0.299
const LUMINANCE_G = 0.587
const LUMINANCE_B = 0.114

/**
 * 按 OpenAI 兼容 high-detail 近似估算一张图的图像 token（约值）。
 * 170 基础 + 85 × 512 分块数；尺寸远小于 2048 的裁剪图直接按实际宽高计。
 */
export function estimateImageTokens(width: number, height: number): number {
  return 170 + 85 * Math.ceil(width / 512) * Math.ceil(height / 512)
}

export interface DHashResult {
  hash: string
  width: number
  height: number
}

/**
 * 计算一张 dataUrl 图片的 64 位 dHash（0/1 字符串）。
 * 缩放为 9×8 灰度图，逐行比较相邻像素亮度：左>右记为 1。
 * 失败（如非图片）会 reject。
 */
export function computeDHash(dataUrl: string): Promise<DHashResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const W = 9
        const H = 8
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('无法获取 canvas'))
          return
        }
        ctx.drawImage(img, 0, 0, W, H)
        const { data } = ctx.getImageData(0, 0, W, H)
        const gray: number[] = []
        for (let i = 0; i < W * H; i++) {
          const r = data[i * 4]
          const g = data[i * 4 + 1]
          const b = data[i * 4 + 2]
          gray.push(LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b)
        }
        let bits = ''
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W - 1; x++) {
            const left = gray[y * W + x]
            const right = gray[y * W + x + 1]
            bits += left > right ? '1' : '0'
          }
        }
        resolve({ hash: bits, width: img.naturalWidth, height: img.naturalHeight })
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}
