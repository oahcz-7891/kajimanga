import unrarWasmUrl from 'node-unrar-js/dist/js/unrar.wasm?url'

const IMG_EXTS = /\.(jpe?g|png|gif|webp|bmp)$/i

function ext(name: string) {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

export function isPdf(name: string) {
  return ext(name) === 'pdf'
}
export function isZip(name: string) {
  return ['zip', 'cbz'].includes(ext(name))
}
export function isRar(name: string) {
  return ['rar', 'cbr'].includes(ext(name))
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** 导入压缩包 / PDF，返回所有页面的 object URL */
export async function importManga(file: File): Promise<string[]> {
  const name = file.name.toLowerCase()
  if (isPdf(name)) return parsePdf(file)
  if (isZip(name)) return parseZip(file)
  if (isRar(name)) return parseRar(file)
  throw new Error(`不支持的文件类型：${file.name}`)
}

async function parseZip(file: File): Promise<string[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && IMG_EXTS.test(n))
    .sort(naturalCompare)
  const urls: string[] = []
  for (const n of names) {
    urls.push(URL.createObjectURL(await zip.files[n].async('blob')))
  }
  if (!urls.length) throw new Error('压缩包内没有图片')
  return urls
}

async function parseRar(file: File): Promise<string[]> {
  const { createExtractorFromData } = await import('node-unrar-js')
  // 提供 wasm 二进制，避免运行时 fetch 路径失效
  const wasmBinary = await fetch(unrarWasmUrl).then((r) => r.arrayBuffer())
  const extractor = await createExtractorFromData({
    data: await file.arrayBuffer(),
    wasmBinary,
  })
  const extracted = extractor.extract({
    files: (fh) => !fh.flags.directory && IMG_EXTS.test(fh.name),
  })
  const items: { name: string; data: Uint8Array }[] = []
  for (const f of extracted.files) {
    if (f.extraction) items.push({ name: f.fileHeader.name, data: f.extraction })
  }
  if (!items.length) throw new Error('压缩包内没有图片')
  items.sort((a, b) => naturalCompare(a.name, b.name))
  return items.map((it) =>
    URL.createObjectURL(new Blob([it.data as BlobPart], { type: 'image/*' })),
  )
}

async function parsePdf(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise

  const urls: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (blob) urls.push(URL.createObjectURL(blob))
  }
  if (!urls.length) throw new Error('PDF 中没有页面')
  return urls
}
