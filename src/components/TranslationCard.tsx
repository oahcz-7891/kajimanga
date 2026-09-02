import { useEffect, useRef, useState } from 'react'
import type { AnimationEvent } from 'react'
import type { LocalTranslateResult } from '../lib/types'

interface Props {
  result: LocalTranslateResult
  onClose: () => void
  /** 点击“重新识图并翻译”：重新识别（重发图）+ 重新翻译，跳过缓存 */
  onRetranslateFull: () => void
  /** 点击“重新翻译”：仅用当前识别文本重新翻译，不重新识图 */
  onRetranslateText: () => void
  /** 是否正在退场动画中（关闭时由父级传入，播完再真正卸载） */
  leaving?: boolean
  onAnimationEnd?: (e: AnimationEvent<HTMLDivElement>) => void
}

export default function TranslationCard({
  result,
  onClose,
  onRetranslateFull,
  onRetranslateText,
  leaving,
  onAnimationEnd,
}: Props) {
  // 复制原文：点击后短暂显示“已复制”
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  const handleCopy = async () => {
    if (!result.text) return
    const done = () => {
      setCopied(true)
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    }
    try {
      await navigator.clipboard.writeText(result.text)
      done()
    } catch {
      // 非 https / 老环境降级：隐藏 textarea + execCommand
      const ta = document.createElement('textarea')
      ta.value = result.text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        done()
      } catch {
        /* 复制失败不打扰 */
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  return (
    <div
      className={`result-card${leaving ? ' leaving' : ''}`}
      onAnimationEnd={onAnimationEnd}
    >      <div className="result-head">
        <span className="badge">译文</span>
        <button className="close-btn" onClick={onClose} title="关闭">
          关闭
        </button>
      </div>
      <div className="result-body">
      {result.text && (
        <div className="result-ref">
          <button
            className={`copy-btn${copied ? ' copied' : ''}`}
            onClick={handleCopy}
            title="复制日文原文"
          >
            {copied ? '已复制' : '复制原文'}
          </button>
        </div>
      )}
      {result.text && <div className="result-orig">{result.text}</div>}
      <div className="result-trans">{result.translated || '（未识别到译文）'}</div>
      {(result.grammar || result.words) && (
        <div className="result-learn">
          <div className="learn-title">学习解析</div>
          {result.grammar && (
            <div className="learn-block">
              <div className="learn-label">语法说明</div>
              <div className="learn-content">{result.grammar}</div>
            </div>
          )}
          {result.words && (
            <div className="learn-block">
              <div className="learn-label">单词 / 短语</div>
              <div className="learn-content">{result.words}</div>
            </div>
          )}
        </div>
      )}
      <div className="result-tokens">
        <div className="token-row">
          <span className="token-label">识图</span>
          <span>
            输入 <b>{result.ocrPromptTokens ?? 0}</b>
          </span>
          <span>
            输出 <b>{result.ocrCompletionTokens ?? 0}</b>
          </span>
        </div>
        <div className="token-row">
          <span className="token-label">翻译</span>
          <span>
            输入 <b>{result.translatePromptTokens ?? 0}</b>
          </span>
          <span>
            输出 <b>{result.translateCompletionTokens ?? 0}</b>
          </span>
        </div>
      </div>
      </div>
      <div className="result-actions">
        <button className="btn" onClick={onRetranslateFull} title="重新识别并翻译（跳过缓存）">
          重新识图并翻译
        </button>
        <button className="btn" onClick={onRetranslateText} title="用当前识别文本重新翻译">
          重新翻译
        </button>
      </div>
    </div>
  )
}
