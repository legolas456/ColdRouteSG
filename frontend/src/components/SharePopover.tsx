import clsx from 'clsx'
import { Check, Globe2, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

interface Props {
  /** e.g. "Compare · MBFC" when the link can carry the current view */
  viewLabel?: string
  buildLink: (withView: boolean) => string
  onClose: () => void
  notify: (msg: string) => void
}

/**
 * Small popover under the Share button: which view, copy. The link opens the
 * sample run read-only; sharing a saved run of your own is not built yet.
 */
export function SharePopover({ viewLabel, buildLink, onClose, notify }: Props) {
  const [withView, setWithView] = useState(!!viewLabel)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // the parent passes a new arrow each render; read it through a ref
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const link = buildLink(withView && !!viewLabel)

  useEffect(() => {
    // the wrapper also holds the Share button, so clicking it toggles instead of re-opening
    const wrap = ref.current?.parentElement
    const onDown = (e: MouseEvent) => wrap && !wrap.contains(e.target as Node) && closeRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const copy = () => {
    const ok = () => {
      setCopied(true)
      notify('Link copied')
    }
    // the share link is not the address bar's: it carries the share and view
    const failed = () => notify('Could not copy the link · click it in the box to select it, then copy')
    if (!navigator.clipboard) return failed()
    navigator.clipboard.writeText(link).then(ok, failed)
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Share a preview"
      className="animate-rise absolute top-11 right-0 z-50 w-[360px] rounded-panel bg-panel p-4 shadow-float"
    >
      <div className="text-[14px] font-semibold">Share a preview</div>
      <p className="mt-0.5 text-[12px] text-fg-3">Opens a read-only view of the sample run. Sharing your own saved runs is not built yet.</p>

      <div className="mt-3.5 flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Globe2 size={14} strokeWidth={1.8} />
        </span>
        <span className="text-[13px] font-medium">Anyone with the link</span>
        <span className="ml-auto shrink-0 text-[12px] text-fg-3">can view</span>
      </div>

      {viewLabel && (
        <label className="mt-2 flex cursor-pointer items-center gap-2.5 pl-[5px] text-[12.5px]">
          <input type="checkbox" checked={withView} onChange={(e) => setWithView(e.target.checked)} className="size-3.5 accent-[var(--brand)]" />
          <span className="min-w-0 truncate">
            Open on my current view <span className="text-fg-3">· {viewLabel}</span>
          </span>
        </label>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          readOnly
          aria-label="Share link"
          value={link.replace(/^https?:\/\//, '')}
          onFocus={(e) => e.currentTarget.select()}
          className="num h-9 min-w-0 flex-1 rounded-control bg-subtle px-3 text-[12px] text-fg-2 shadow-[inset_0_0_0_1px_var(--border-main)] outline-none"
        />
        <Button
          variant={copied ? 'secondary' : 'primary'}
          className={clsx('w-[112px] justify-center')}
          icon={copied ? <Check size={14} strokeWidth={2.4} className="text-ok" /> : <Link2 size={14} strokeWidth={2} />}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </div>
  )
}
