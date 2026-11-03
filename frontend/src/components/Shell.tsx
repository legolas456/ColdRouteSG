import clsx from 'clsx'
import { Loader2, Moon, PanelLeftClose, PanelLeftOpen, Share2, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Conditions } from '../lib/conditions'
import { hm } from '../lib/time'
import type { ThemeId } from '../lib/themes'
import { Button } from './ui'

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

const MODES: { value: ThemeId; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/**
 * Light / Dark. Until the user picks one, the app follows the system setting and
 * the matching option shows as selected. Phone: one button that flips the two.
 */
export function ThemeToggle({ mode, resolved, onChange }: { mode: ThemeMode; resolved: ThemeId; onChange: (m: ThemeMode) => void }) {
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex shrink-0 items-center gap-0.5 rounded-full bg-hover p-[3px] shadow-[inset_0_0_0_1px_var(--border-main)] max-md:hidden"
      >
        {MODES.map(({ value, label, icon: Icon }) => {
          const on = resolved === value
          return (
            <button
              key={value}
              role="radio"
              aria-checked={on}
              aria-label={label}
              title={mode === 'system' && on ? `${label} (matches your system)` : label}
              onClick={() => onChange(value)}
              className={clsx(
                'flex size-7 items-center justify-center rounded-full transition-[color,background-color,box-shadow] focus-visible:outline-offset-[-1px]',
                on ? 'bg-panel text-fg shadow-[0_1px_2px_rgba(28,25,23,0.12),0_0_0_1px_var(--border-dark)]' : 'text-fg-3 hover:bg-panel/70 hover:text-fg',
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

/**
 * Always in the same spot, so one click hides the panel and the next brings it
 * back. Icon plus a verb, so it reads as a control at a glance. "Hide plan" and
 * "Show plan" are the same length, so nothing next to it shifts when it flips.
 */
function PanelToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <button
      aria-expanded={!collapsed}
      title={`${collapsed ? 'Show' : 'Hide'} the plan panel  [`}
      onClick={onToggle}
      className={clsx(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-control pr-3 pl-2.5 text-[12.5px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] max-md:hidden',
        collapsed
          ? 'bg-brand-soft text-brand-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_45%,transparent)] hover:shadow-[inset_0_0_0_1.5px_var(--brand)]'
          : 'bg-panel text-fg-2 shadow-[inset_0_0_0_1px_var(--border-dark),0_1px_2px_rgba(16,24,40,0.05)] hover:bg-subtle hover:text-fg',
      )}
    >
      <Icon size={16} strokeWidth={1.8} />
      {collapsed ? 'Show plan' : 'Hide plan'}
    </button>
  )
}

/**
 * Which data the plan reads, and how fresh it is. Opens the Conditions panel.
 * Only a live, complete read gets the green pulse; recorded data never does.
 */
export function DataPill({
  conditions,
  loading,
  open,
  onClick,
}: {
  conditions: Pick<Conditions, 'mode' | 'source' | 'at' | 'traffic'>
  loading: boolean
  open: boolean
  onClick: () => void
}) {
  const { mode, source, at, traffic } = conditions
  const live = mode === 'live'
  const label = !live ? 'Recorded' : loading && source === 'recorded' ? 'Live' : source === 'recorded' ? 'Live unavailable' : source === 'mixed' ? 'Live · partial' : 'Live'
  const ok = live && source === 'live'
  return (
    <button
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${label} data${source !== 'recorded' || !live ? ` from ${hm(at)}` : ''}. Open conditions`}
      onClick={onClick}
      title={
        live
          ? `Planning with live NEA and HDB data${traffic ? (traffic.typical ? ' and typical LTA road speeds' : ' and LTA road speeds') : ''}. Open the live feeds.`
          : 'Planning with the recorded rainy morning (sample data). Open the live feeds.'
      }
      className={clsx(
        // phones: just the status dot, so the run title keeps its room
        'flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] max-md:w-[26px] max-md:justify-center max-md:px-0',
        open ? 'bg-hover text-fg shadow-[inset_0_0_0_1px_var(--border-dark)]' : 'text-fg-3 shadow-[inset_0_0_0_1px_var(--border-main)] hover:bg-hover hover:text-fg',
      )}
    >
      {loading ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <span className="relative flex size-1.5">
          {ok && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
          <span className={clsx('relative inline-flex size-1.5 rounded-full', ok ? 'bg-ok' : live ? 'bg-warn' : 'bg-fg-4')} />
        </span>
      )}
      <span className="max-md:hidden">{label}</span>
      {/* what the plan reads: LTA only when its road speeds were used, live or typical (cameras never feed the plan) */}
      {ok && <span className="max-xl:hidden">· NEA · HDB{traffic ? (traffic.typical ? ' · LTA typical' : ' · LTA') : ''}</span>}
      {(!live || source !== 'recorded') && <span className="num max-md:hidden">{hm(at)}</span>}
    </button>
  )
}

export function TopBar({
  status,
  primary,
  runDate = 'Fri 10 Oct',
  data,
  theme,
  panel,
  onShare,
  sharePopover,
  account,
}: {
  status: ReactNode
  primary: ReactNode
  /** short date of the run: the recorded morning, or today in Live mode */
  runDate?: string
  /** the data pill and, while open, the Conditions panel under it */
  data?: ReactNode
  theme: { mode: ThemeMode; resolved: ThemeId; onChange: (m: ThemeMode) => void }
  panel?: { collapsed: boolean; onToggle: () => void }
  onShare?: () => void
  /** rendered under the Share button while open */
  sharePopover?: ReactNode
  /** avatar on the far right, when the panel (which normally holds it) is not on screen */
  account?: ReactNode
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4 max-md:gap-2 max-md:px-3">
      <span title="ColdRoute SG" className="shrink-0">
        <LogoMark />
      </span>
      {panel && <PanelToggle {...panel} />}
      <span className="h-5 w-px shrink-0 bg-line-strong max-md:hidden" />
      <span className="text-fg-3 max-lg:hidden">Runs</span>
      <span className="text-fg-4 max-lg:hidden">/</span>
      {/* phones: no room next to status, data, theme and the primary action; the sheet shows the title */}
      <span className="min-w-0 truncate font-medium text-fg max-md:hidden">
        Morning run · {runDate}
      </span>
      <span className="shrink-0">{status}</span>
      <div className="flex-1" />
      {data && <div className="relative shrink-0">{data}</div>}
      <ThemeToggle {...theme} />
      {onShare && (
        <div className="relative max-md:hidden">
          <Button aria-expanded={!!sharePopover} icon={<Share2 size={14} strokeWidth={1.8} />} onClick={onShare}>
            Share
          </Button>
          {sharePopover}
        </div>
      )}
      <span className="shrink-0">{primary}</span>
      {account}
    </header>
  )
}
