import clsx from 'clsx'
import { ChevronRight, ChevronsUpDown, History, Loader2, LogOut, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { AUTH_ENABLED, setNewPassword, signInError, signInWithPassword } from '../lib/auth'
import { LogoMark } from './Shell'
import { Button } from './ui'

/**
 * Accounts: real ones from the Cognito user pool when the console is built with
 * it (lib/auth.ts), and the demo admin, who signs in instantly so the flow can
 * be shown without AWS.
 */
export interface User {
  name: string
  initials: string
  role: string
  email: string
  depot: string
  /** a Cognito account: its runs are saved; the demo account has none */
  account?: 'cognito'
}

const roleLine = (user: User) => [user.role, user.depot].filter(Boolean).join(' · ')

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

function AccountMenu({
  user,
  onSignOut,
  onRuns,
  onTeam,
  placement,
}: {
  user: User
  onSignOut: () => void
  onRuns?: () => void
  onTeam?: () => void
  placement: 'up' | 'down'
}) {
  const item = 'flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg'
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
        <span className="truncate">{roleLine(user)}</span>
      </div>
      {user.account === 'cognito' && (onRuns || onTeam) && (
        <div className="border-t border-line p-1.5">
          {onRuns && (
            <button role="menuitem" onClick={onRuns} className={item}>
              <History size={14} strokeWidth={1.8} /> Your runs
            </button>
          )}
          {onTeam && user.role === 'Admin' && (
            <button role="menuitem" onClick={onTeam} className={item}>
              <UsersRound size={14} strokeWidth={1.8} /> Team activity
            </button>
          )}
        </div>
      )}
      <div className="border-t border-line p-1.5">
        <button role="menuitem" onClick={onSignOut} className={item}>
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
  /** the signed-in user's saved runs, and for admins the team's activity */
  onRuns?: () => void
  onTeam?: () => void
}

/** Bottom of the panel: who is signed in, and the way to sign in or out. */
export function AccountBar({ user, onSignIn, onSignOut, onRuns, onTeam }: AccountProps) {
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
            <span className="block truncate text-[11.5px] text-fg-3">{roleLine(user)}</span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-fg-3" />
        </button>
      ) : (
        <button onClick={onSignIn} className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-hover">
          <Avatar user={null} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-tight font-medium">Sign in</span>
            <span className="block truncate text-[11.5px] text-fg-3">To save runs and plan them on AWS</span>
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
          onRuns={onRuns && (() => (setOpen(false), onRuns()))}
          onTeam={onTeam && (() => (setOpen(false), onTeam()))}
        />
      )}
    </div>
  )
}

/** Top bar version, for phones and when the panel is hidden. */
export function AccountButton({ user, onSignIn, onSignOut, onRuns, onTeam }: AccountProps) {
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
          onRuns={onRuns && (() => (setOpen(false), onRuns()))}
          onTeam={onTeam && (() => (setOpen(false), onTeam()))}
        />
      )}
    </div>
  )
}

const fieldClass =
  'h-9 w-full rounded-control border border-line bg-panel px-3 text-[13px] outline-none placeholder:text-fg-4 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]'

/** Email and password for a Cognito account, then a new password on its first sign-in. */
function PasswordSignIn({ busy, setBusy, onSignedIn }: { busy: boolean; setBusy: (b: boolean) => void; onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // set once Cognito asks for a new password (an account an admin created)
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = fresh === null ? await signInWithPassword(email, password) : await setNewPassword(fresh)
      if ('needsNewPassword' in result) {
        setFresh('')
        setBusy(false)
        return
      }
      onSignedIn(result.user)
    } catch (err) {
      setError(signInError(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-2.5">
      {fresh === null ? (
        <>
          <input
            autoFocus
            type="email"
            autoComplete="username"
            aria-label="Email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-fg-2">First sign-in: choose your own password.</p>
          <input
            autoFocus
            type="password"
            autoComplete="new-password"
            aria-label="New password"
            placeholder="New password"
            required
            minLength={10}
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            className={fieldClass}
          />
          <p className="text-[11.5px] text-fg-3">At least 10 characters, with upper and lower case letters and a number.</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-[12px] leading-relaxed text-bad">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-9 w-full">
        {busy ? <Loader2 size={15} className="animate-spin" /> : fresh === null ? 'Sign in' : 'Set password and sign in'}
      </Button>
    </form>
  )
}

/** Sign in with a Cognito account when the console has one set up, or as the demo admin. */
export function SignInDialog({ reason, onClose, onSignedIn }: { reason?: string; onClose: () => void; onSignedIn: (u: User) => void }) {
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!AUTH_ENABLED) first.current?.focus()
  }, [])
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
        <p className="mt-1 text-[13px] text-fg-3">
          {reason ?? (AUTH_ENABLED ? 'Use the account your admin created for you.' : 'Choose an account to continue.')}
        </p>

        {AUTH_ENABLED && (
          <>
            <PasswordSignIn busy={busy} setBusy={setBusy} onSignedIn={onSignedIn} />
            <div className="mt-4 flex items-center gap-3 text-[11.5px] text-fg-4">
              <span className="h-px flex-1 bg-line" />
              or try the demo
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <button
          ref={first}
          onClick={signIn}
          disabled={busy}
          className={clsx(
            'flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left shadow-[inset_0_0_0_1px_var(--border-dark)] transition-[box-shadow,background-color] hover:bg-hover hover:shadow-[inset_0_0_0_1.5px_var(--brand)] disabled:opacity-80',
            AUTH_ENABLED ? 'mt-3' : 'mt-5',
          )}
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
          {AUTH_ENABLED
            ? 'The demo account plans in this browser only; its runs are not saved.'
            : 'Demo sign-in. A deployed ColdRoute signs dispatchers in with their company account.'}
        </p>
      </div>
    </div>
  )
}
