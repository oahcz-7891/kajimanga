import {
  computeBlockHash,
  getCachedOCRExact,
  getCachedSimilarOCR,
  setCachedOCRExact,
  setCachedOCRHash,
  getCachedTextTranslation,
  setCachedTextTranslation,
  buildParams,
} from './translationCache'
import type {
  ConfigMap,
  ProviderKey,
  ProviderSettings,
  ReadMode,
  ThinkingStrength,
  TranslateResult,
} from './types'

/** 服务商预设（只到服务商级别，模型名由用户自行填写） */
export const PROVIDERS: Record<ProviderKey, { label: string; baseUrl: string; placeholderModel: string }> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    placeholderModel: '',
  },
  qwen: {
    label: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    placeholderModel: '',
  },
  kimi: {
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    placeholderModel: '',
  },
  custom: {
    label: '自定义 / 其它',
    baseUrl: '',
    placeholderModel: '',
  },
}

/** 各服务商支持的思考档位（只显示其实际支持的值） */
export const PROVIDER_THINKING: Record<ProviderKey, ThinkingStrength[]> = {
  deepseek: ['off', 'low', 'medium', 'high'],
  qwen: ['off', 'on'],
  kimi: ['off', 'on'],
  custom: ['off', 'low', 'medium', 'high'],
}

export const THINKING_LABELS: Record<ThinkingStrength, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  on: '开启',
}

/** 某个供应商的初始配置（未配置过时的默认值，无内置模型名） */
export function defaultSettings(key: ProviderKey): ProviderSettings {
  return {
    baseUrl: PROVIDERS[key].baseUrl,
    apiKey: '',
    model: '',
    thinking: PROVIDER_THINKING[key][0],
  }
}

/** 全量默认配置（每个供应商各自一份） */
export function createDefaultConfigs(): ConfigMap {
  return {
    deepseek: defaultSettings('deepseek'),
    qwen: defaultSettings('qwen'),
    kimi: defaultSettings('kimi'),
    custom: defaultSettings('custom'),
  }
}

/** OCR 步骤：只识别日文原文，不翻译 */
const OCR_PROMPT = [
  '你是漫画 OCR 助手。请识别图片里的所有日文文本，不要翻译。',
  '日文文本可能是竖版或横版，识别时请注意文本方向。',
  '竖版文字的右边可能是注音或小字，请不要识别这些注音或小字。',
  '横板文字的上面可能是注音或小字，请不要识别这些注音或小字。',
  '只返回一个 JSON 对象，不要输出其它内容，格式如下：',
  '返回的日文原文中单词或短语有汉字的，标注平假名',
  '{"text": "识别到的日文原文"}',
].join('\n')

/** 翻译步骤：纯文本，把已识别文本翻译成简体中文 */
const TRANSLATE_PROMPT = [
  '你是漫画翻译助手。请把下面给出的日文文本翻译成简体中文。',
  '这是从漫画中识别出的文本，根据文本的关键字，对漫画的内容进行合理的翻译',
  '只返回一个 JSON 对象，不要输出其它内容，格式如下：',
  '{"translated": "中文翻译"}',
].join('\n')

/** 翻译步骤（学习模式）：翻译 + 语法 / 单词解析 */
const LEARN_TRANSLATE_PROMPT = [
  '你是日语学习助手。请把下面给出的日文文本翻译成简体中文，并对文本进行学习解析。',
  '这是从漫画中识别出的文本，根据文本的关键字，对漫画的内容进行合理的翻译',
  '单词或短语中有汉字的，标注单词或短语的平假名',
  '只返回一个 JSON 对象，不要输出其它内容，格式如下：',
  '{"translated": "中文翻译", "grammar": "语法说明", "words": "单词和短语释义"}',
].join('\n')

function extractJson(s: string) {
  let cleaned = s.replace(/```(?:json)?/gi, '').trim()
  const tryParse = (x: string): Record<string, unknown> | null => {
    try {
      const obj = JSON.parse(x)
      return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  // 候选：1) 整体；2) 提取可能被文字包裹的 { ... }
  const candidates: string[] = [cleaned]
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    candidates.push(cleaned.slice(start, end + 1))
  }

  for (const c of candidates) {
    const obj = tryParse(c)
    if (obj) return obj
  }
  return null
}

/**
 * 把模型返回的任意 JSON 值安全转为可读字符串：
 * 字符串→去首尾空格；数组→逐项转字符串换行合并；对象→「key：value」每行一条（不带大括号）；
 * 空内容（null/undefined/空串/{} /[]）→ undefined（调用方不显示该字段）
 */
function fieldToString(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') {
    const s = v.trim()
    return s || undefined
  }
  if (Array.isArray(v)) {
    const parts = v
      .map((item) => {
        if (item == null) return ''
        if (typeof item === 'string') return item.trim()
        if (typeof item === 'object') return fieldToString(item) ?? ''
        return String(item)
      })
      .filter((s) => s.length > 0)
    const s = parts.join('\n').trim()
    return s || undefined
  }
  if (typeof v === 'object') {
    try {
      // 普通对象：转「key：value」每行一条，避免大括号 JSON
      const lines: string[] = []
      for (const [k, val] of Object.entries(v)) {
        if (val == null) continue
        let vv: string
        if (typeof val === 'string') vv = val.trim()
        else if (typeof val === 'object') vv = fieldToString(val) ?? ''
        else vv = String(val)
        if (vv) lines.push(`${k}：${vv}`)
      }
      const s = lines.join('\n').trim()
      return s || undefined
    } catch {
      return undefined
    }
  }
  const s = String(v).trim()
  return s || undefined
}

/**
 * 归一化历史缓存里可能是 JSON 字符串的字段（对象曾被 JSON.stringify 写成带大括号的文本）。
 * 有 JSON 标记时现场解析再转换，兼容旧数据而无需重新调 API。
 */
function normalizeField(s: string | undefined): string | undefined {
  if (!s) return undefined
  const t = s.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      const out = fieldToString(JSON.parse(t))
      if (out) return out
    } catch {
      /* 不是合法 JSON，原样返回 */
    }
  }
  return t || undefined
}

/** 历史 bug 可能写入缓存的坏值（对象被 String() 化成 "[object Object]"） */
function hasBadString(s: unknown): boolean {
  return typeof s === 'string' && s.includes('[object Object]')
}

/** 根据服务商和思考强度生成请求体里的参数 */
function thinkingParams(provider: ProviderKey, thinking: ThinkingStrength): Record<string, unknown> {
  if (thinking === 'off') return {}
  switch (provider) {
    case 'deepseek':
      return { thinking: { type: 'enabled' }, reasoning_effort: thinking }
    case 'qwen':
      return { enable_thinking: true }
    case 'kimi':
      return { thinking: { type: 'enabled' } }
    default:
      return { reasoning_effort: thinking }
  }
}

/** 识别 + 翻译一张图片（两步分离前的旧接口，已废弃） */

const REQUEST_TIMEOUT_MS = 30_000

interface ChatMessage {
  role: 'user'
  content:
    | string
    | Array<{ type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }>
}

/** OpenAI 兼容 /chat/completions 公共请求：返回内容原文 + 本次请求的输入 / 输出 token */
async function chatCompletion(
  settings: ProviderSettings,
  messages: ChatMessage[],
  extras: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> {
  const base = settings.baseUrl.replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const body = {
    model: settings.model,
    temperature: 0.2,
    messages,
    ...extras,
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  // 外部取消（用户点“取消翻译”）与内部超时共用同一个 AbortController
  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error('请求失败')
    }

    const data = await res.json()
    const usage = data?.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined
    const promptTokens = usage?.prompt_tokens
    const completionTokens = usage?.completion_tokens
    const content = data?.choices?.[0]?.message?.content
    if (typeof content === 'string') return { content, promptTokens, completionTokens }
    if (Array.isArray(content))
      return {
        content: content.map((c) => c?.text ?? '').join(''),
        promptTokens,
        completionTokens,
      }
    return { content: '', promptTokens, completionTokens }
  } catch (e) {
    if (signal?.aborted) throw new Error('已取消')
    if (timedOut) throw new Error('请求超时')
    throw new Error('请求失败')
  } finally {
    clearTimeout(timer)
  }
}

export interface OcrImageResult {
  text: string
  /** 本次识别请求的输入 token（含图像 token；缓存命中时为 undefined = 0） */
  promptTokens?: number
  /** 本次识别请求的输出 token */
  completionTokens?: number
}

/**
 * 第一步：识别（OCR）。发图识别日文原文，不翻译。
 * pageKey：精确层匹配键（整页 hash + 归一化 rect），由阅读器框选时生成；
 * 有 pageKey 时先查精确层（零误判），再查 blockhash 模糊层，最后走 API。
 */
export async function ocrImage(
  provider: ProviderKey,
  settings: ProviderSettings,
  imageDataUrl: string,
  signal?: AbortSignal,
  forceRefresh = false,
  pageKey?: string,
): Promise<OcrImageResult> {
  const cacheParams = buildParams(provider, settings, 'ocr')

  // 1) 精确层：同页同区域（页 hash + 归一化 rect）确定性命中，零误判
  if (!forceRefresh && pageKey) {
    const exact = await getCachedOCRExact(cacheParams, pageKey).catch(() => null)
    if (exact && exact.text && !hasBadString(exact.text)) {
      return { text: exact.text }
    }
  }

  // 2) 模糊层：裁剪图 128-bit blockhash，容差内命中（容忍重截图 / 压缩差异）
  const bh = await computeBlockHash(imageDataUrl).catch((e) => {
    console.warn('[cache] computeBlockHash 失败，本次跳过缓存:', e)
    return null
  })
  if (!forceRefresh && bh) {
    const cached = await getCachedSimilarOCR(cacheParams, bh.hash).catch(() => null)
    if (cached && cached.text && !hasBadString(cached.text)) {
      return { text: cached.text }
    }
  }

  const { content: raw, promptTokens, completionTokens } = await chatCompletion(
    settings,
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: OCR_PROMPT },
        ],
      },
    ],
    thinkingParams(provider, settings.thinking),
    signal,
  )
  const parsed = extractJson(raw)
  const text = parsed ? (fieldToString(parsed.text) ?? '') : raw.trim()
  // 成功才写缓存，失败 / 取消不写（精确层 + 模糊层各写一份）
  if (text) {
    if (bh) void setCachedOCRHash(cacheParams, bh.hash, text).catch(() => {})
    if (pageKey) void setCachedOCRExact(cacheParams, pageKey, text).catch(() => {})
  }
  return { text, promptTokens, completionTokens }
}

export interface TranslateTextApiResult {
  translated: string
  grammar?: string
  words?: string
  /** 本次翻译请求的输入 token */
  promptTokens?: number
  /** 本次翻译请求的输出 token */
  completionTokens?: number
}

/** 第二步：翻译。纯文本（不携带图片），把已识别文本翻译成简体中文 */
export async function translateText(
  provider: ProviderKey,
  settings: ProviderSettings,
  text: string,
  mode: ReadMode = 'translate',
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<TranslateTextApiResult> {
  // 先查原文→译文缓存（forceRefresh=true 时跳过查询，强制走 API）
  const cacheParams = buildParams(provider, settings, 'translate', mode)
  if (!forceRefresh) {
    const cached = await getCachedTextTranslation(cacheParams, text).catch(() => null)
    // 过滤旧坏缓存（含 [object Object] 视为无效，走 API 重新翻译）
    if (
      cached &&
      !hasBadString(cached.translated) &&
      !hasBadString(cached.grammar) &&
      !hasBadString(cached.words)
    ) {
      return {
        translated: normalizeField(cached.translated) ?? '',
        grammar: normalizeField(cached.grammar),
        words: normalizeField(cached.words),
      }
    }
  }

  const prompt = mode === 'learn' ? LEARN_TRANSLATE_PROMPT : TRANSLATE_PROMPT
  const { content: raw, promptTokens, completionTokens } = await chatCompletion(
    settings,
    [{ role: 'user', content: `${prompt}\n\n待翻译的日文文本：\n${text}` }],
    thinkingParams(provider, settings.thinking),
    signal,
  )
  const parsed = extractJson(raw)
  let result: TranslateResult
  if (parsed) {
    result = {
      text,
      translated: fieldToString(parsed.translated ?? parsed.translation ?? '') ?? '',
      grammar: fieldToString(parsed.grammar),
      words: fieldToString(parsed.words),
    }
  } else {
    result = { text, translated: raw.trim() }
  }
  // 成功才写缓存，失败/取消不写
  void setCachedTextTranslation(cacheParams, text, result).catch(() => {})
  return {
    translated: result.translated,
    grammar: result.grammar,
    words: result.words,
    promptTokens,
    completionTokens,
  }
}

export interface TestConnectionResult {
  ok: boolean
  message: string
}

/** 测试连接：用当前配置发一个最小的请求，验证 URL / Key / 模型名是否可用 */
export async function testConnection(
  provider: ProviderKey,
  settings: ProviderSettings,
): Promise<TestConnectionResult> {
  const base = settings.baseUrl.replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    })
    const ms = Date.now() - start
    if (res.ok) {
      return { ok: true, message: `连接正常，耗时 ${ms}ms` }
    }
    const detail = await res.text().catch(() => '')
    return { ok: false, message: `HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}（${ms}ms）` }
  } catch (e) {
    const ms = Date.now() - start
    if (controller.signal.aborted) {
      return { ok: false, message: `连接超时（15s）：${url}` }
    }
    return { ok: false, message: `连接失败：${e instanceof Error ? e.message : String(e)}（${ms}ms）` }
  } finally {
    clearTimeout(timer)
  }
}
