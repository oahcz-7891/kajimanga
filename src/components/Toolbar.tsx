import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GearIcon,
  XIcon,
} from '@primer/octicons-react'
import type { TransPhase } from '../lib/types'
import PixelK from './PixelK'
import PageJump from './PageJump'

interface ToolbarProps {
  hasPages: boolean
  pageIndex: number
  totalPages: number
  selectionActive: boolean
  phase: TransPhase
  onTranslate: () => void
  onPrev: () => void
  onNext: () => void
  onJumpTo: (pageIndex: number) => void
  onBack: () => void
  onCancelSelection: () => void
  onOpenSettings: () => void
}

export default function Toolbar(props: ToolbarProps) {
  const {
    hasPages,
    pageIndex,
    totalPages,
    selectionActive,
    phase,
    onTranslate,
    onPrev,
    onNext,
    onJumpTo,
    onBack,
    onCancelSelection,
    onOpenSettings,
  } = props

  return (
    <header className="toolbar">
      <div className="toolbar-leading">
        {hasPages && (
          <button
            className="icon-btn"
            onClick={onBack}
            title="返回"
            aria-label="返回"
          >
            <ChevronLeftIcon size={20} />
          </button>
        )}
        <div className="toolbar-brand">
          <PixelK />
          Kajimanga
        </div>
      </div>

      <div className="toolbar-actions">
        <div className="nav nav-toolbar">
          <button
            className="icon-btn"
            onClick={onPrev}
            disabled={!hasPages || pageIndex <= 0}
            title="上一页"
          >
            <ChevronLeftIcon size={20} />
          </button>
          {hasPages && (
            <PageJump current={pageIndex + 1} total={totalPages} onChange={onJumpTo} />
          )}
          <button
            className="icon-btn"
            onClick={onNext}
            disabled={!hasPages || pageIndex >= totalPages - 1}
            title="下一页"
          >
            <ChevronRightIcon size={20} />
          </button>
        </div>

        {hasPages &&
          (selectionActive ? (
            <button className="btn" onClick={onCancelSelection}>
              <XIcon size={16} /> 取消选区
            </button>
          ) : (
            <button
              className={`btn${phase === 'idle' ? ' primary' : ''}`}
              onClick={onTranslate}
              disabled={phase !== 'idle'}
            >
              {phase === 'recognizing'
                ? '识图中…'
                : phase === 'translating'
                  ? '翻译中…'
                  : '识图'}
            </button>
          ))}

        <button className="icon-btn" onClick={onOpenSettings} title="设置">
          <GearIcon size={20} />
        </button>
      </div>
    </header>
  )
}
