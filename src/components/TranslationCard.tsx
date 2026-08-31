import type { AnimationEvent } from 'react'
import type { LocalTranslateResult } from '../lib/types'

interface Props {
  result: LocalTranslateResult
  onClose: () => void
  /** 是否正在退场动画中（关闭时由父级传入，播完再真正卸载） */
  leaving?: boolean
  onAnimationEnd?: (e: AnimationEvent<HTMLDivElement>) => void
}

export default function TranslationCard({ result, onClose, leaving, onAnimationEnd }: Props) {
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
    </div>
  )
}
