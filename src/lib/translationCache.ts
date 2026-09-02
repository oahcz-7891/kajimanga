import type { DisplayRect, ProviderKey, ProviderSettings, ReadMode, TranslateResult } from './types'

/** 缓存步骤：ocr = 图片→原文；translate = 原文→译文 */
export type CacheStep = 'ocr' | 'translate'

/**
 * OCR 图片缓存（两级）：
 *  1. 精确层：整页 128-bit blockhash + 归一化选区 rect → 同页同区域确定性命中，零误判
 *  2. 模糊层：裁剪图 128-bit blockhash（blockhash.io 算法），Hamming ≤ 容差命中，
 *     容忍同一片文字因压缩/重截图导致的细微差异
 * 检索结构：按 params 分桶维护内存 BK-tree（Hamming 最近邻），写入增量更新，
 *           首次查询时从 IndexedDB 懒构建，替代全表线性扫描。
 */

const DB_NAME = 'kajimanga-cache'
const STORE = 'translation'

/** 缓存条目有效期：30 天 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 128-bit blockhash 的 Hamming 距离阈值。
 * 实测（白底黑字的文字块）：不同内容/不同区域最小距离 3~7；
 * 同一区域因 24px 网格对齐重裁图几乎一致（距离 0~1）。
 * 因此取 2：只容忍同内容/同区域的细微差异，绝不把不同区域误判命中；
 * 宁可多走一次 API，也不返回错误结果。 */
export const BLOCKHASH_TOLERANCE = 2
/** blockhash 输出为 32 位 hex（128 bit），树索引据此过滤非模糊条目 */
const HASH_HEX_LEN = 32

interface CacheEntry {
  id: string
  /** 请求参数（provider/baseUrl/model/thinking/mode），用于隔离不同服务的缓存 */
  params: string
  /** 匹配键：OCR 模糊=裁剪图 blockhash / OCR 精确=pageKey / 翻译=原文全文 */
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

/** 请求参数 → 缓存 params 字符串（JSON 编码，避免分隔符冲突）
 * step 区分 OCR / 翻译两类缓存；翻译带 mode 隔离学习模式 */
export function buildParams(
  provider: ProviderKey,
  settings: ProviderSettings,
  step: CacheStep,
  mode?: ReadMode,
): string {
  return JSON.stringify([provider, settings.baseUrl, settings.model, settings.thinking, step, mode ?? null])
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

// ---------- 128-bit blockhash（blockhash.io 实现，method=2） ----------

const LUMINANCE_R = 0.299
const LUMINANCE_G = 0.587
const LUMINANCE_B = 0.114

/**
 * 从已解码的图片元素计算 128-bit blockhash（32 位 hex）。
 * 原理：缩放到 16×16 亮度网格，每行 16 格分成 8 组（每组左右两块），
 * 比较块均值得到 8bit/行 × 16 行 = 128 bit。对缩放、JPEG 重压缩、亮度变化鲁棒。
 * 同步执行（Canvas 缩放 + getImageData），适合在框选回调中直接调用。
 */
export function blockHashFromImage(img: HTMLImageElement, bits = 16, sub = 2): string {
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('图片未加载')
  const size = bits * sub
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取 canvas')
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  // 每格 sub×sub 采样点的平均亮度（灰度）
  const cells: number[] = []
  for (let y = 0; y < bits; y++) {
    for (let x = 0; x < bits; x++) {
      let sum = 0
      for (let dy = 0; dy < sub; dy++) {
        for (let dx = 0; dx < sub; dx++) {
          const i = ((y * sub + dy) * size + (x * sub + dx)) * 4
          sum += LUMINANCE_R * data[i] + LUMINANCE_G * data[i + 1] + LUMINANCE_B * data[i + 2]
        }
      }
      cells.push(sum / (sub * sub))
    }
  }

  // 每行 bits 格 → bits/2 组，组内左半均值 > 右半均值记 1
  const groupSize = bits / 2
  let hex = ''
  for (let y = 0; y < bits; y++) {
    let byte = 0
    for (let g = 0; g < bits / groupSize; g++) {
      let left = 0
      let right = 0
      for (let k = 0; k < groupSize / 2; k++) {
        left += cells[y * bits + g * groupSize + k]
        right += cells[y * bits + g * groupSize + groupSize / 2 + k]
      }
      byte = (byte << 1) | (left > right ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export interface BlockHashResult {
  hash: string
  width: number
  height: number
}

/** 解码一张 dataUrl 图片并计算 128-bit blockhash */
export function computeBlockHash(dataUrl: string): Promise<BlockHashResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const hash = blockHashFromImage(img)
        resolve({ hash, width: img.naturalWidth, height: img.naturalHeight })
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}

// ---------- BK-tree（Hamming 距离最近邻检索） ----------

const POPCOUNT = new Array<number>(256).fill(0)
for (let i = 1; i < 256; i++) POPCOUNT[i] = POPCOUNT[i >> 1] + (i & 1)

/** 两个 hex 字符串的 Hamming 距离（逐 nibble 异或后数 1 位） */
function hammingHex(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) {
    d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)]
  }
  return d
}

interface BKNode {
  hash: string
  children: Map<number, BKNode>
}

/** BK 树：支持容差内的 Hamming 最近邻查询，插入 O(log n)，查询剪枝 O(log n + k) */
class BKTree {
  private root: BKNode | null = null

  insert(hash: string) {
    if (!this.root) {
      this.root = { hash, children: new Map() }
      return
    }
    let node = this.root
    for (;;) {
      const d = hammingHex(hash, node.hash)
      if (d === 0) return
      const child = node.children.get(d)
      if (!child) {
        node.children.set(d, { hash, children: new Map() })
        return
      }
      node = child
    }
  }

  /** 返回与 query 距离最近且 ≤ tol 的条目，无则 null */
  search(query: string, tol: number): { hash: string; dist: number } | null {
    if (!this.root) return null
    let best: { hash: string; dist: number } | null = null
    const stack: BKNode[] = [this.root]
    while (stack.length) {
      const node = stack.pop()!
      const d = hammingHex(query, node.hash)
      if (d <= tol && (best === null || d < best.dist)) {
        best = { hash: node.hash, dist: d }
      }
      // BK-tree 剪枝：只深入距离在 [d - tol, d + tol] 内的子边
      for (const [edge, child] of node.children) {
        if (edge >= d - tol && edge <= d + tol) stack.push(child)
      }
    }
    return best
  }
}

/** 每个 params 一棵树（内存常驻），写入时增量 insert，首次查询时从 DB 懒构建 */
const ocrIndexes = new Map<string, BKTree>()

async function getOcrIndex(params: string): Promise<BKTree> {
  let tree = ocrIndexes.get(params)
  if (tree) return tree
  tree = new BKTree()
  const db = await openDb()
  for (const e of await readAll(db)) {
    // 只索引 128-bit blockhash（32 位 hex）的 OCR 模糊条目；
    // 精确层 pageKey / 文本缓存（hash 不同长度）不参与模糊匹配
    if (e.params === params && e.hash.length === HASH_HEX_LEN) tree.insert(e.hash)
  }
  ocrIndexes.set(params, tree)
  return tree
}

// ---------- 通用读写 ----------

function setCachedEntry(
  id: string,
  params: string,
  hash: string,
  result: TranslateResult,
): Promise<void> {
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

/** 按 id 精确读取，校验 params 与 TTL；命中则顺手刷新过期时间 */
function getById(db: IDBDatabase, id: string, params: string): Promise<CacheEntry | null> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => {
      const e = req.result as CacheEntry | undefined
      if (!e || e.params !== params || Date.now() - e.createdAt > CACHE_TTL_MS) {
        resolve(null)
        return
      }
      void setCachedEntry(e.id, e.params, e.hash, e.result).catch(() => {})
      resolve(e)
    }
    req.onerror = () => reject(req.error)
  })
}

// ---------- OCR 精确层（整页 hash + 归一化 rect） ----------

/**
 * 生成精确层匹配键：整页 blockhash + 选区相对页面的百分比坐标（1% 精度）。
 * 同一页同一区域（±1% 内）必然命中同一 key，零误判。
 */
export function buildPageKey(pageHash: string, rect: DisplayRect, imgW: number, imgH: number): string {
  const r = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100)))
  const rx = r(rect.x / imgW)
  const ry = r(rect.y / imgH)
  const rw = r(rect.width / imgW)
  const rh = r(rect.height / imgH)
  return `${pageHash}|${rx}|${ry}|${rw}|${rh}`
}

/** 精确层命中（同页同区域）则返回识别原文，否则 null */
export async function getCachedOCRExact(
  params: string,
  pageKey: string,
): Promise<TranslateResult | null> {
  const db = await openDb()
  const e = await getById(db, `${params}|${pageKey}`, params)
  return e ? e.result : null
}

/** 写入精确层缓存 */
export function setCachedOCRExact(
  params: string,
  pageKey: string,
  text: string,
): Promise<void> {
  return setCachedEntry(`${params}|${pageKey}`, params, pageKey, {
    text,
  } as TranslateResult)
}

// ---------- OCR 模糊层（裁剪图 blockhash + BK-tree） ----------

/** 容差内最近命中则返回识别原文，否则 null（查内存 BK-tree，不再全表扫描） */
export async function getCachedSimilarOCR(
  params: string,
  hash: string,
): Promise<TranslateResult | null> {
  const tree = await getOcrIndex(params)
  const hit = tree.search(hash, BLOCKHASH_TOLERANCE)
  if (!hit) return null
  const db = await openDb()
  const e = await getById(db, `${params}|${hit.hash}`, params)
  return e ? e.result : null
}

/** 写入模糊层缓存并增量更新 BK-tree */
export function setCachedOCRHash(
  params: string,
  hash: string,
  text: string,
): Promise<void> {
  ocrIndexes.get(params)?.insert(hash)
  return setCachedEntry(`${params}|${hash}`, params, hash, { text } as TranslateResult)
}

// ---------- 翻译文本层（原文→译文，精确匹配） ----------

/** 精确读取原文→译文缓存（翻译步骤，key 即原文全文） */
export async function getCachedTextTranslation(
  params: string,
  text: string,
): Promise<TranslateResult | null> {
  const db = await openDb()
  const e = await getById(db, text, params)
  return e ? e.result : null
}

/** 写入原文→译文缓存（翻译步骤） */
export function setCachedTextTranslation(
  params: string,
  text: string,
  result: TranslateResult,
): Promise<void> {
  return setCachedEntry(text, params, text, result)
}
