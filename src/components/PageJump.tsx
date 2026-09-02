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
      // iOS：先 focus 激活焦点/键盘，再在下一帧 select 全选（直接把 select 放同帧可能失效）
      const input = inputRef.current
      input?.focus()
      requestAnimationFrame(() => input?.select())
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
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
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