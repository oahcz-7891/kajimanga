import type { LocalTranslateResult } from '../lib/types'

interface Props {
  result: LocalTranslateResult
  onClose: () => void
}

export default function TranslationCard({ result, onClose }: Props) {
  const { rect } = result
  // 卡片放在选区右侧（rect 为视口坐标），并钳制在屏幕可视范围内，缩放/平移后也不会跑出屏幕
  const left = Math.max(8, Math.min(rect.x + rect.width + 10, window.innerWidth - 500))
  const top = Math.min(Math.max(8, rect.y), Math.max(8, window.innerHeight - 240))

  return (
    <div className="result-card" style={{ left, top }}>
      <div className="result-head">
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
