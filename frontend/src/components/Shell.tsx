import clsx from 'clsx'
import { Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, StatusPill } from './ui'

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

export function TopBar({
  status,
  primary,
  updatedAt,
  extra,
  onShare,
}: {
  status: ReactNode
  primary: ReactNode
  updatedAt: string
  extra?: ReactNode
  onShare?: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4 max-md:gap-2 max-md:px-3">
      <LogoMark className="shrink-0" />
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
      <span className="shrink-0 max-lg:hidden">
        <StatusPill tone="live">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-ok" />
          </span>
          NEA · LTA · HDB <span className="num">{updatedAt}</span>
        </StatusPill>
      </span>
      {extra}
      <Button variant="ghost" className="max-md:hidden" icon={<Share2 size={14} strokeWidth={1.8} />} onClick={onShare}>
        Share
      </Button>
      <span className="shrink-0">{primary}</span>
    </header>
  )
}
