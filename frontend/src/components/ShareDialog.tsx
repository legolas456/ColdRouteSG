import clsx from 'clsx'
import { Building2, Check, ChevronDown, Globe2, Link2, Lock, Truck, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui'

type Role = 'edit' | 'view'
type Access = 'restricted' | 'workspace' | 'anyone'
type Expiry = 'never' | '24h' | '7d'

interface Member {
  id: string
  name: string
  sub: string
  initials: string
  /** owner and driver rows have a fixed label instead of a role picker */
  fixed?: string
  role?: Role
  team?: boolean
  driver?: boolean
}

// Mock workspace directory. A real build would call the user/team API.
const DIRECTORY: Member[] = [
  { id: 'mei', name: 'Mei Ling Tan', sub: 'meiling@coldroute.sg · Planner', initials: 'MT' },
  { id: 'raj', name: 'Rajesh Kumar', sub: 'raj@coldroute.sg · Ops lead', initials: 'RK' },
  { id: 'nur', name: 'Nurul Huda', sub: 'nurul@coldroute.sg · Night dispatcher', initials: 'NH' },
  { id: 'qa', name: 'Pharma QA', sub: 'Team · 3 people · audits cold-chain logs', initials: 'QA', team: true },
  { id: 'wj', name: 'Tan Wei Jie', sub: 'weijie@nuh.com.sg · NUH Pharmacy receiving', initials: 'WJ' },
]

const INITIAL: Member[] = [
  { id: 'me', name: 'Fiona Lim', sub: 'fiona@coldroute.sg', initials: 'FL', fixed: 'Owner' },
  { id: 'ops', name: 'Ops team', sub: 'Team · 6 dispatchers on shift', initials: 'OT', role: 'edit', team: true },
  { id: 'drv', name: 'Ahmad R.', sub: 'Driver · Van SGX 4821K', initials: 'AR', fixed: 'Driver app', driver: true },
]

const ACCESS: Record<Access, { icon: ReactNode; label: string; hint: string }> = {
  restricted: {
    icon: <Lock size={15} strokeWidth={1.8} />,
    label: 'Restricted',
    hint: 'Only the people above can open the link.',
  },
  workspace: {
    icon: <Building2 size={15} strokeWidth={1.8} />,
    label: 'ColdRoute SG workspace',
    hint: 'Anyone in the workspace with the link can view.',
  },
  anyone: {
    icon: <Globe2 size={15} strokeWidth={1.8} />,
    label: 'Anyone with the link',
    hint: 'No sign-in needed, e.g. for a customer or an auditor. View only.',
  },
}

const EXPIRY: Record<Expiry, string> = { never: 'Never expires', '24h': 'Expires in 24 h', '7d': 'Expires in 7 days' }

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

interface Props {
  title: string
  meta: string
  /** e.g. "Compare · MBFC" when the link can carry the current view */
  viewLabel?: string
  buildLink: (withView: boolean) => string
  onClose: () => void
  notify: (msg: string) => void
}

export function ShareDialog({ title, meta, viewLabel, buildLink, onClose, notify }: Props) {
  const [members, setMembers] = useState<Member[]>(INITIAL)
  const [query, setQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('view')
  const [access, setAccess] = useState<Access>('workspace')
  const [expiry, setExpiry] = useState<Expiry>('7d')
  const [withView, setWithView] = useState(!!viewLabel)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // the parent passes a new arrow each render; read it through a ref so the
  // effect below runs once (otherwise every toast would steal focus back)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const link = buildLink(withView && !!viewLabel)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const taken = new Set(members.map((m) => m.id))
    return DIRECTORY.filter((p) => !taken.has(p.id) && (p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q))).slice(0, 4)
  }, [query, members])

  const invite = (p?: Member) => {
    const person =
      p ??
      suggestions[0] ??
      (isEmail(query)
        ? { id: query.trim(), name: query.trim(), sub: 'Invitation pending', initials: query.trim().slice(0, 2).toUpperCase() }
        : null)
    if (!person) return
    setMembers((m) => [...m, { ...person, role: inviteRole }])
    setQuery('')
    notify(`Invited ${person.name} · can ${inviteRole} · email sent`)
    inputRef.current?.focus()
  }

  const copy = () => {
    const ok = () => {
      setCopied(true)
      notify(access === 'restricted' ? 'Link copied · only people with access can open it' : 'Link copied')
    }
    navigator.clipboard?.writeText(link).then(ok, ok)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,16,12,0.32)] p-4 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="animate-rise flex max-h-[min(720px,calc(100dvh-32px))] w-[500px] max-w-full flex-col overflow-hidden rounded-panel bg-panel shadow-float max-md:max-h-[92dvh] max-md:w-full max-md:rounded-b-none"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="share-title" className="text-[15px] font-semibold">
              Share “{title}”
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-fg-3">{meta}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="-mr-1.5 flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {/* invite */}
          <div className="relative px-5">
            <div className="flex items-center gap-2">
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-control bg-panel pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--border-dark)] focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)]">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  placeholder="Add people, teams or an email"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
                />
                <RoleSelect value={inviteRole} onChange={setInviteRole} />
              </div>
              <Button variant="primary" disabled={!suggestions.length && !isEmail(query)} onClick={() => invite()}>
                Invite
              </Button>
            </div>
            {suggestions.length > 0 && (
              <ul className="animate-rise absolute right-5 left-5 z-10 mt-1 overflow-hidden rounded-control bg-panel p-1 shadow-float">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => invite(p)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                      <Avatar m={p} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{p.name}</span>
                        <span className="block truncate text-[11.5px] text-fg-3">{p.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* people */}
          <div className="eyebrow px-5 pt-4 pb-1">People with access</div>
          <ul className="px-3">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-hover">
                <Avatar m={m} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">
                    {m.name}
                    {m.id === 'me' && <span className="font-normal text-fg-3"> (you)</span>}
                  </div>
                  <div className="truncate text-[11.5px] text-fg-3">{m.sub}</div>
                </div>
                {m.fixed ? (
                  <span className="pr-1 text-[12px] text-fg-3" title={m.driver ? 'Gets the route on the driver app when you dispatch' : undefined}>
                    {m.fixed}
                  </span>
                ) : (
                  <RoleSelect
                    value={m.role ?? 'view'}
                    onChange={(role) => setMembers((all) => all.map((x) => (x.id === m.id ? { ...x, role } : x)))}
                    onRemove={() => {
                      setMembers((all) => all.filter((x) => x.id !== m.id))
                      notify(`Removed ${m.name}`)
                    }}
                  />
                )}
              </li>
            ))}
          </ul>

          {/* general access */}
          <div className="eyebrow px-5 pt-4 pb-1.5">General access</div>
          <div className="flex items-start gap-3 px-5">
            <span
              className={clsx(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                access === 'restricted' ? 'bg-hover text-fg-2' : 'bg-ok-soft text-ok',
              )}
            >
              {ACCESS[access].icon}
            </span>
            <div className="min-w-0 flex-1">
              <label className="relative inline-flex items-center gap-1 rounded-md py-0.5 pr-1 text-[13px] font-medium hover:bg-hover">
                <select
                  aria-label="General access"
                  value={access}
                  onChange={(e) => setAccess(e.target.value as Access)}
                  className="cursor-pointer appearance-none bg-transparent pr-4 outline-none [field-sizing:content]"
                >
                  {(Object.keys(ACCESS) as Access[]).map((a) => (
                    <option key={a} value={a}>
                      {ACCESS[a].label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-1 text-fg-3" />
              </label>
              <p className="text-[12px] text-fg-3">{ACCESS[access].hint}</p>
            </div>
            {access !== 'restricted' && <span className="pt-1 text-[12px] text-fg-3">Can view</span>}
          </div>

          {viewLabel && (
            <label className="mx-5 mt-4 flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 shadow-[inset_0_0_0_1px_var(--border-main)] hover:bg-hover">
              <input type="checkbox" checked={withView} onChange={(e) => setWithView(e.target.checked)} className="size-3.5 accent-[var(--brand)]" />
              <span className="min-w-0 flex-1 text-[12.5px]">
                Open on my current view <span className="text-fg-3">· {viewLabel}</span>
              </span>
            </label>
          )}

          <div className="flex items-start gap-2 px-5 pt-3 pb-4 text-[11.5px] text-fg-3">
            <Users size={13} className="mt-[1px] shrink-0" />
            <span>
              People open a read-only snapshot of this plan, with data from 09:05. They can make their own copy to edit. The driver only gets the
              route when you dispatch it.
            </span>
          </div>
        </div>

        {/* link */}
        <div className="flex items-center gap-2 border-t border-line bg-subtle px-5 py-3 max-md:flex-wrap max-md:pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control bg-panel px-3 shadow-[inset_0_0_0_1px_var(--border-main)] max-md:basis-full">
            <Link2 size={14} className="shrink-0 text-fg-3" />
            <input
              readOnly
              aria-label="Share link"
              value={link.replace(/^https?:\/\//, '')}
              onFocus={(e) => e.currentTarget.select()}
              className="num min-w-0 flex-1 bg-transparent text-[12px] text-fg-2 outline-none"
            />
          </div>
          <label className="relative flex h-9 items-center rounded-control text-[12px] text-fg-2 hover:bg-hover max-md:flex-1">
            <select
              aria-label="Link expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as Expiry)}
              className="h-full cursor-pointer appearance-none bg-transparent pr-6 pl-2 outline-none [field-sizing:content]"
            >
              {(Object.keys(EXPIRY) as Expiry[]).map((x) => (
                <option key={x} value={x}>
                  {EXPIRY[x]}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-1.5 text-fg-3" />
          </label>
          <Button
            variant={copied ? 'secondary' : 'primary'}
            className="max-md:flex-1"
            icon={copied ? <Check size={14} strokeWidth={2.4} className="text-ok" /> : <Link2 size={14} strokeWidth={2} />}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Avatar({ m }: { m: Member }) {
  return (
    <span
      className={clsx(
        'num flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        m.driver ? 'bg-ink text-on-ink' : m.team ? 'bg-hover text-fg-2' : m.id === 'me' ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-fg',
      )}
    >
      {m.driver ? <Truck size={14} strokeWidth={1.8} /> : m.team ? <Users size={14} strokeWidth={1.8} /> : m.initials}
    </span>
  )
}

function RoleSelect({ value, onChange, onRemove }: { value: Role; onChange: (r: Role) => void; onRemove?: () => void }) {
  return (
    <label className="relative flex h-7 shrink-0 items-center rounded-md text-[12px] text-fg-2 hover:bg-hover">
      <select
        aria-label="Role"
        value={value}
        onChange={(e) => (e.target.value === 'remove' ? onRemove?.() : onChange(e.target.value as Role))}
        className="h-full cursor-pointer appearance-none bg-transparent pr-6 pl-2 outline-none [field-sizing:content]"
      >
        <option value="edit">Can edit</option>
        <option value="view">Can view</option>
        {onRemove && <option value="remove">Remove access</option>}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-1.5 text-fg-3" />
    </label>
  )
}
