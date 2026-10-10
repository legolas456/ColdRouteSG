import clsx from 'clsx'
import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Share2, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ThemeId } from '../lib/themes'
import { Button, StatusPill } from './ui'

export type ThemeMode = 'system' | ThemeId

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={clsx('size-7', className)} aria-hidden>
      <rect width="28" height="28" rx="8" className="fill-brand" />
      <path
        d="M8 19.5c0-3 2.4-4.6 5-4.6h2.2c2.4 0 4.8-1.4 4.8-4.4"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="stroke-on-brand"
      />
      <circle cx="8" cy="19.5" r="2" className="fill-on-brand" />
      <circle cx="20" cy="9" r="2.6" fill="none" strokeWidth="1.6" className="stroke-on-brand" />
    </svg>
  )
}

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/** Desktop: System / Light / Dark. Phone: one button that flips light and dark. */
export function ThemeToggle({ mode, resolved, onChange }: { mode: ThemeMode; resolved: ThemeId; onChange: (m: ThemeMode) => void }) {
  return (
    <>
      <div role="radiogroup" aria-label="Appearance" className="flex shrink-0 items-center gap-0.5 rounded-full bg-hover p-0.5 max-md:hidden">
        {MODES.map(({ value, label, icon: Icon }) => {
          const on = mode === value
          return (
            <button
              key={value}
              role="radio"
              aria-checked={on}
              aria-label={label}
              title={value === 'system' ? `Match system (${resolved} now)` : label}
              onClick={() => onChange(value)}
              className={clsx(
                'flex size-7 items-center justify-center rounded-full transition-[color,background-color,box-shadow]',
                on ? 'bg-panel text-fg shadow-[0_1px_2px_rgba(28,25,23,0.10),inset_0_0_0_1px_var(--border-main)]' : 'text-fg-3 hover:text-fg',
              )}
            >
              <Icon size={14} strokeWidth={1.8} />
            </button>
          )
        })}
      </div>
      <button
        aria-label={resolved === 'dark' ? 'Switch to light' : 'Switch to dark'}
        onClick={() => onChange(resolved === 'dark' ? 'light' : 'dark')}
        className="flex size-8 shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-hover md:hidden"
      >
        {resolved === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
    </>
  )
}

/** Always in the same spot, so one click hides the panel and the next brings it back. */
function PanelToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <button
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      title={`${collapsed ? 'Show' : 'Hide'} panel  [`}
      onClick={onToggle}
      className="flex size-8 shrink-0 items-center justify-center rounded-control text-fg-3 transition-colors hover:bg-hover hover:text-fg max-md:hidden"
    >
      <Icon size={17} strokeWidth={1.7} />
    </button>
  )
}

export function TopBar({
  status,
  primary,
  updatedAt,
  theme,
  panel,
  onShare,
}: {
  status: ReactNode
  primary: ReactNode
  updatedAt: string
  theme: { mode: ThemeMode; resolved: ThemeId; onChange: (m: ThemeMode) => void }
  panel?: { collapsed: boolean; onToggle: () => void }
  onShare?: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4 max-md:gap-2 max-md:px-3">
      <LogoMark className="shrink-0" />
      {panel && <PanelToggle {...panel} />}
      <div className="flex items-baseline gap-2 max-md:hidden">
        <span className="font-serif text-[17px] tracking-[-0.01em] text-fg">coldroute</span>
        <span className="num text-[10px] text-fg-4">SG</span>
      </div>
      <span className="text-fg-4 max-md:hidden">/</span>
      <span className="text-fg-3 max-lg:hidden">Runs</span>
      <span className="text-fg-4 max-lg:hidden">/</span>
      <span className="min-w-0 truncate font-medium text-fg">
        Morning run<span className="max-md:hidden"> · Fri 10 Oct</span>
      </span>
      <span className="shrink-0">{status}</span>
      <div className="flex-1" />
      <span className="shrink-0 max-xl:hidden">
        <StatusPill tone="live">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-ok" />
          </span>
          NEA · LTA · HDB <span className="num">{updatedAt}</span>
        </StatusPill>
      </span>
      <ThemeToggle {...theme} />
      {onShare && (
        <Button variant="ghost" className="max-md:hidden" icon={<Share2 size={14} strokeWidth={1.8} />} onClick={onShare}>
          Share
        </Button>
      )}
      <span className="shrink-0">{primary}</span>
    </header>
  )
}
