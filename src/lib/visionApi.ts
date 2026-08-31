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

const PROMPT = [
  '你是漫画翻译助手。请识别图片里的所有日文文本，并将其翻译成简体中文。',
  '日文文本可能是竖版或横版，识别时请注意文本方向。',
  '竖版文字的右边可能是注音或小字，请不要翻译这些注音或小字。',
  '横板文字的上面可能是注音或小字，请不要翻译这些注音或小字。',
  '只返回一个 JSON 对象，不要输出其它内容，格式如下：',
  '{"text": "识别到的日文原文", "translated": "中文翻译"}',
].join('\n')

const LEARN_PROMPT = [
  '你是日语学习助手。请识别图片里的日文文本，翻译成简体中文，并对文本进行学习解析。',
  '日文文本可能是竖版或横版，识别时请注意文本方向。',
  '竖版文字的右边可能是注音或小字，请不要翻译这些注音或小字。',
  '横板文字的上面可能是注音或小字，请不要翻译这些注音或小字。',
  '只返回一个 JSON 对象，不要输出其它内容，格式如下：',
  '{"text": "识别到的日文原文", "translated": "中文翻译", "grammar": "语法说明", "words": "单词和短语释义"}',
].join('\n')

function extractJson(s: string) {
  const cleaned = s.replace(/```(?:json)?/gi, '').trim()
  const m = cleaned.match(/\{[\s\S]*\}/)
  const candidate = m ? m[0] : cleaned
  try {
    const obj = JSON.parse(candidate)
    return typeof obj === 'object' ? (obj as Record<string, unknown>) : null
  } catch {
    return null
  }
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

/** 识别 + 翻译一张图片（OpenAI 兼容 /chat/completions） */
const REQUEST_TIMEOUT_MS = 30_000

export async function translateImage(
  provider: ProviderKey,
  settings: ProviderSettings,
  imageDataUrl: string,
  mode: ReadMode = 'translate',
  signal?: AbortSignal,
): Promise<TranslateResult> {
  const base = settings.baseUrl.replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const body = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: mode === 'learn' ? LEARN_PROMPT : PROMPT },
        ],
      },
    ],
    ...thinkingParams(provider, settings.thinking),
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
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
    const content = data?.choices?.[0]?.message?.content
    let raw = ''
    if (typeof content === 'string') raw = content
    else if (Array.isArray(content)) raw = content.map((c) => c?.text ?? '').join('')

    const parsed = extractJson(raw)
    if (parsed) {
      return {
        text: String(parsed.text ?? '').trim(),
        translated: String(parsed.translated ?? parsed.translation ?? '').trim(),
        grammar: parsed.grammar ? String(parsed.grammar).trim() : undefined,
        words: parsed.words ? String(parsed.words).trim() : undefined,
      }
    }
    return { text: '', translated: raw.trim() }
  } catch (e) {
    if (signal?.aborted) throw new Error('已取消')
    if (timedOut) throw new Error('请求超时')
    throw new Error('请求失败')
  } finally {
    clearTimeout(timer)
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
