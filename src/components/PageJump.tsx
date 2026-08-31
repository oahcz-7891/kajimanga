import { useEffect, useRef, useState } from 'react'

interface Props {
  current: number // 当前页（1 起）
  total: number
  onChange: (pageIndex: number) => void // 跳转，0 起
}

/** 页码跳转：点击“当前页码数字”变为输入框，回车确认、Esc 取消 */
export default function PageJump({ current, total, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(current))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(String(current))
      inputRef.current?.select()
    }
  }, [editing, current])

  const commit = () => {
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n)) {
      onChange(Math.min(Math.max(1, n), total) - 1)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="page-jump-input"
        type="number"
        min={1}
        max={total}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={commit}
      />
    )
  }

  return (
    <span className="page-info page-jump">
      <span
        className="page-jump-current"
        onClick={() => setEditing(true)}
        title="点击修改页码"
      >
        {current}
      </span>
      {' / '}
      <span>{total}</span>
    </span>
  )
}