import clsx from 'clsx'
import { ChevronRight, ChevronsUpDown, Loader2, LogOut, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LogoMark } from './Shell'

/**
 * Mock accounts. In production this is company single sign-on; the demo signs
 * in instantly with a fixed admin so the flow can be shown end to end.
 */
export interface User {
  name: string
  initials: string
  role: string
  email: string
  depot: string
}

export const DEMO_ADMIN: User = {
  name: 'Fiona Lim',
  initials: 'FL',
  role: 'Admin',
  email: 'fiona.lim@coldroute.sg',
  depot: 'Jurong Cold Store',
}

function Avatar({ user, size = 28 }: { user: User | null; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={clsx(
        'num flex shrink-0 items-center justify-center rounded-full font-semibold',
        user ? 'bg-brand text-on-brand' : 'bg-subtle text-fg-3 shadow-[inset_0_0_0_1px_var(--border-dark)]',
      )}
    >
      {user ? <span style={{ fontSize: size * 0.38 }}>{user.initials}</span> : <UserRound size={size * 0.52} strokeWidth={1.8} />}
    </span>
  )
}

/** Closes on outside click and Escape. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])
  return ref
}

function AccountMenu({ user, onSignOut, placement }: { user: User; onSignOut: () => void; placement: 'up' | 'down' }) {
  return (
    <div
      role="menu"
      className={clsx(
        'animate-rise absolute z-50 w-[248px] overflow-hidden rounded-panel bg-panel shadow-float',
        placement === 'up' ? 'bottom-[calc(100%+6px)] left-0' : 'top-[calc(100%+6px)] right-0',
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-3">
        <Avatar user={user} size={34} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{user.name}</div>
          <div className="truncate text-[11.5px] text-fg-3">{user.email}</div>
        </div>
      </div>
      <div className="mx-3.5 mb-3 flex items-center gap-1.5 rounded-[7px] bg-subtle px-2.5 py-1.5 text-[11.5px] text-fg-2">
        <ShieldCheck size={13} strokeWidth={2} className="shrink-0 text-ok" />
        <span className="truncate">
          {user.role} · {user.depot}
        </span>
      </div>
      <div className="border-t border-line p-1.5">
        <button
          role="menuitem"
          onClick={onSignOut}
          className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <LogOut size={14} strokeWidth={1.8} /> Sign out
        </button>
      </div>
    </div>
  )
}

interface AccountProps {
  user: User | null
  onSignIn: () => void
  onSignOut: () => void
}

/** Bottom of the panel: who is signed in, and the way to sign in or out. */
export function AccountBar({ user, onSignIn, onSignOut }: AccountProps) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative shrink-0 border-t border-line px-3 py-2.5">
      {user ? (
        <button
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={clsx('flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors', open ? 'bg-hover' : 'hover:bg-hover')}
        >
          <Avatar user={user} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium">{user.name}</span>
            <span className="block truncate text-[11.5px] text-fg-3">
              {user.role} · {user.depot}
            </span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-fg-3" />
        </button>
      ) : (
        <button onClick={onSignIn} className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-hover">
          <Avatar user={null} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-tight font-medium">Sign in</span>
            <span className="block truncate text-[11.5px] text-fg-3">To dispatch runs and share them</span>
          </span>
          <ChevronRight size={14} className="shrink-0 text-fg-3" />
        </button>
      )}
      {open && user && (
        <AccountMenu
          user={user}
          placement="up"
          onSignOut={() => {
            setOpen(false)
            onSignOut()
          }}
        />
      )}
    </div>
  )
}

/** Top bar version, for phones and when the panel is hidden. */
export function AccountButton({ user, onSignIn, onSignOut }: AccountProps) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  if (!user)
    return (
      <button
        onClick={onSignIn}
        className="h-8 shrink-0 rounded-control px-2.5 text-[13px] font-medium whitespace-nowrap text-fg-2 hover:bg-hover hover:text-fg"
      >
        Sign in
      </button>
    )
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        aria-label={`Account: ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex rounded-full transition-shadow', open ? 'shadow-[0_0_0_3px_var(--brand-soft)]' : 'hover:shadow-[0_0_0_3px_var(--bg-hover)]')}
      >
        <Avatar user={user} size={30} />
      </button>
      {open && (
        <AccountMenu
          user={user}
          placement="down"
          onSignOut={() => {
            setOpen(false)
            onSignOut()
          }}
        />
      )}
    </div>
  )
}

/** Mock sign-in: pick the demo admin. Real deployments use company SSO here. */
export function SignInDialog({ reason, onClose, onSignedIn }: { reason?: string; onClose: () => void; onSignedIn: (u: User) => void }) {
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const signIn = () => {
    setBusy(true)
    window.setTimeout(() => onSignedIn(DEMO_ADMIN), 650)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.32)] p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-rise relative w-full max-w-[380px] rounded-[16px] bg-panel p-6 shadow-float"
      >
        <button
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg"
        >
          <X size={15} />
        </button>
        <LogoMark />
        <h2 id="signin-title" className="mt-4 font-serif text-[22px] leading-tight tracking-[-0.02em]">
          Sign in to ColdRoute
        </h2>
        <p className="mt-1 text-[13px] text-fg-3">{reason ?? 'Choose an account to continue.'}</p>

        <button
          ref={first}
          onClick={signIn}
          disabled={busy}
          className="mt-5 flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left shadow-[inset_0_0_0_1px_var(--border-dark)] transition-[box-shadow,background-color] hover:bg-hover hover:shadow-[inset_0_0_0_1.5px_var(--brand)] disabled:opacity-80"
        >
          <Avatar user={DEMO_ADMIN} size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              {DEMO_ADMIN.name}
              <span className="num rounded-full bg-brand-soft px-1.5 py-[1px] text-[9.5px] font-semibold tracking-[0.06em] text-brand-fg">ADMIN</span>
            </span>
            <span className="block truncate text-[12px] text-fg-3">{DEMO_ADMIN.email}</span>
          </span>
          {busy ? <Loader2 size={16} className="shrink-0 animate-spin text-fg-3" /> : <ChevronRight size={16} className="shrink-0 text-fg-3" />}
        </button>

        <p className="mt-4 text-[11.5px] leading-relaxed text-fg-4">
          Demo sign-in. A deployed ColdRoute signs dispatchers in with their company account.
        </p>
      </div>
    </div>
  )
}
