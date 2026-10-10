import clsx from 'clsx'
import { BarChart3, Building2, Radio, Route, Settings, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, StatusPill } from './ui'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={clsx('size-7', className)} aria-hidden>
      <rect width="28" height="28" rx="8" className="fill-ink" />
      <path
        d="M8 19.5c0-3 2.4-4.6 5-4.6h2.2c2.4 0 4.8-1.4 4.8-4.4"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="stroke-on-ink"
      />
      <circle cx="8" cy="19.5" r="2" className="fill-on-ink" />
      <circle cx="20" cy="9" r="2.6" fill="none" strokeWidth="1.6" className="stroke-on-ink" />
    </svg>
  )
}

const NAV = [
  { icon: Route, label: 'Runs', active: true },
  { icon: Radio, label: 'Live' },
  { icon: Building2, label: 'Customers' },
  { icon: BarChart3, label: 'Insights' },
]

export function NavRail() {
  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line bg-canvas py-3">
      <LogoMark className="mb-4" />
      {NAV.map(({ icon: Icon, label, active }) => (
        <button
          key={label}
          title={label}
          className={clsx(
            'group relative flex size-10 items-center justify-center rounded-[10px] transition-colors',
            active ? 'bg-strong text-fg' : 'text-fg-3 hover:bg-hover hover:text-fg',
          )}
        >
          <Icon size={18} strokeWidth={1.6} />
          <span className="pointer-events-none absolute left-12 z-50 rounded-md bg-black/90 px-2 py-1 text-[11px] whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100">
            {label}
          </span>
        </button>
      ))}
      <div className="mt-auto flex flex-col items-center gap-2">
        <button title="Settings" className="flex size-10 items-center justify-center rounded-[10px] text-fg-3 hover:bg-hover hover:text-fg">
          <Settings size={18} strokeWidth={1.6} />
        </button>
        <div className="flex size-8 items-center justify-center rounded-full bg-strong text-[11px] font-semibold text-fg-2">FL</div>
      </div>
    </nav>
  )
}

export function TopBar({
  status,
  primary,
  updatedAt,
  extra,
}: {
  status: ReactNode
  primary: ReactNode
  updatedAt: string
  extra?: ReactNode
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-5">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-[17px] tracking-[-0.01em] text-fg">coldroute</span>
        <span className="num text-[10px] text-fg-4">SG</span>
      </div>
      <span className="text-fg-4">/</span>
      <span className="text-fg-3">Runs</span>
      <span className="text-fg-4">/</span>
      <span className="font-medium text-fg">Morning run · Fri 10 Oct</span>
      {status}
      <div className="flex-1" />
      <StatusPill tone="live">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-fg-3 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-fg-2" />
        </span>
        NEA · LTA · HDB <span className="num">{updatedAt}</span>
      </StatusPill>
      {extra}
      <Button variant="ghost" icon={<Share2 size={14} strokeWidth={1.8} />}>
        Share
      </Button>
      {primary}
    </header>
  )
}
