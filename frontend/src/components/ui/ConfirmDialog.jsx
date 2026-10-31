import { useEffect, useRef } from 'react'
import { Button } from './Button'

// Native <dialog> gives a focus trap, Escape to close and an inert background for free.
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'danger', pending = false, onConfirm, onCancel }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
      aria-labelledby="confirm-dialog-title"
      className="w-[calc(100%-2rem)] max-w-md rounded border border-rule bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/30"
    >
      <div className="p-6">
        <h2 id="confirm-dialog-title" className="heading">{title}</h2>
        <div className="mt-2 text-sm text-ink-2">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
