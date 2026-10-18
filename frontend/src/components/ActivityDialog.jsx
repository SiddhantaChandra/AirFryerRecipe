import { useEffect, useId, useRef } from 'react'

export function ActivityDialog({ title, children, onClose, busy = false }) {
  const dialog = useRef(null)
  const titleId = useId()
  const closing = useRef(onClose)
  closing.current = onClose
  useEffect(() => {
    const trigger = document.activeElement
    const node = dialog.current
    node.showModal()
    return () => {
      node.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      className="account-dialog activity-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const node = dialog.current
        const controls = [
          ...node.querySelectorAll(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ].filter((control) => control.getClientRects().length)
        const target = event.shiftKey ? controls.at(-1) : controls[0]
        const boundary = event.shiftKey ? controls[0] : controls.at(-1)
        if (
          document.activeElement === boundary ||
          !node.contains(document.activeElement)
        ) {
          event.preventDefault()
          target?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        closing.current()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  )
}
