/** 书架缓存：IndexedDB 保存多本已导入漫画（含封面缩略图与阅读进度） */

const DB_NAME = 'kajimanga'
const STORE = 'reading'
const ORDER_KEY = 'order'

export interface CachedComic {
  id: string
  name: string
  data: ArrayBuffer
  pageIndex: number
  totalPages: number
  cover: string // dataURL 封面缩略图；生成失败时为空串
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

/** 写入 / 更新一本漫画（按 id 索引） */
export async function saveComic(comic: CachedComic): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(comic, comic.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 删除一本漫画 */
export async function deleteComic(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 保存书架顺序（id 列表） */
export async function saveOrder(ids: string[]): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(ids, ORDER_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 读取整个书架（按保存顺序返回） */
export async function loadShelf(): Promise<CachedComic[]> {
  const db = await openDb()
  const get = <T,>(key: IDBValidKey): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })

  const ids = await get<string[]>(ORDER_KEY).catch(() => null)
  if (!ids || !ids.length) return []
  const out: CachedComic[] = []
  for (const id of ids) {
    const comic = await get<CachedComic>(id).catch(() => null)
    if (comic) out.push(comic)
  }
  return out
}