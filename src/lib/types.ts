export type ThinkingStrength = 'off' | 'low' | 'medium' | 'high' | 'on'
export type ProviderKey = 'deepseek' | 'qwen' | 'kimi' | 'custom'

export interface ProviderSettings {
  baseUrl: string
  apiKey: string
  model: string
  thinking: ThinkingStrength
}

/** 每个供应商一份配置 */
export type ConfigMap = Record<ProviderKey, ProviderSettings>

export interface TranslateResult {
  text: string
  translated: string
  grammar?: string
  words?: string
}

/** OCR 步骤的结果：只识别日文原文，不翻译 */
export interface OcrResult {
  text: string
}

/** 翻译步骤的结果：只翻译已识别文本，不再识图 */
export interface TranslateTextResult {
  translated: string
  grammar?: string
  words?: string
}

/** 阅读 / 翻译模式 */
export type ReadMode = 'translate' | 'learn'

/** 识图 / 翻译两步流程的进行状态 */
export type TransPhase = 'idle' | 'recognizing' | 'translating'

/** 全局应用设置（不区分服务商） */
export interface AppSettings {
  doubleTapZoom: boolean
  doubleTapRatio: number
  mode: ReadMode
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  doubleTapZoom: true,
  doubleTapRatio: 2,
  mode: 'translate',
}

export const DOUBLE_TAP_RATIOS = [1.5, 2, 2.5, 3] as const

export const MODE_LABELS: Record<ReadMode, string> = {
  translate: '翻译模式',
  learn: '学习模式',
}

export const DOUBLE_TAP_LABELS: Record<number, string> = {
  1.5: '1.5 倍',
  2: '2 倍',
  2.5: '2.5 倍',
  3: '3 倍',
}

/** 选区矩形，坐标相对图片显示容器（CSS px） */
export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

export type LocalTranslateResult = TranslateResult & {
  rect: DisplayRect
  /** 本次识图（OCR）请求的输入 token（含图像 token）；缓存命中时缺省（= 0） */
  ocrPromptTokens?: number
  /** 本次识图（OCR）请求的输出 token；缓存命中时缺省（= 0） */
  ocrCompletionTokens?: number
  /** 本次翻译请求的输入 token；缓存命中时缺省（= 0） */
  translatePromptTokens?: number
  /** 本次翻译请求的输出 token；缓存命中时缺省（= 0） */
  translateCompletionTokens?: number
}
