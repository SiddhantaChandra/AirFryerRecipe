import { useEffect, useId, useRef, useState } from 'react'

export function DebouncedSearch({ label, value, onSubmit, maxLength = 240 }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [composition, setComposition] = useState(false)
  const composing = useRef(false)
  const callback = useRef(onSubmit)
  callback.current = onSubmit
  useEffect(() => { setText(value) }, [value])
  useEffect(() => {
    if (composition || text === value) return
    const timer = setTimeout(() => callback.current(text), 300)
    return () => clearTimeout(timer)
  }, [text, value, composition])
  return <form role="search" className="search-control" onSubmit={event => {
    event.preventDefault()
    if (!composing.current) callback.current(text)
  }}>
    <label htmlFor={id}>{label}</label>
    <div><input id={id} type="search" value={text} maxLength={maxLength}
      onChange={event => setText(event.target.value)}
      onCompositionStart={() => { composing.current = true; setComposition(true) }}
      onCompositionEnd={event => { composing.current = false; setComposition(false); setText(event.currentTarget.value) }}
      onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault() }} />
      {text && <button type="button" onClick={() => { setText(''); callback.current('') }} aria-label={`Clear ${label.toLowerCase()}`}>Clear</button>}
    </div>
  </form>
}
