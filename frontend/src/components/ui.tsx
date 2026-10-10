import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  icon?: ReactNode
  kbd?: string
}

export function Button({ variant = 'secondary', size = 'md', icon, kbd, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-[background,box-shadow,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-ink text-on-ink hover:opacity-90',
        variant === 'secondary' && 'bg-panel text-fg shadow-[inset_0_0_0_1px_var(--border-dark)] hover:bg-subtle',
        variant === 'ghost' && 'text-fg-2 hover:bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {kbd && (
        <span
          className={clsx(
            'num ml-1 rounded-[4px] px-1 text-[10.5px]',
            variant === 'primary' ? 'bg-white/15 text-on-ink/80 dark:bg-black/10' : 'bg-hover text-fg-3',
          )}
        >
          {kbd}
        </span>
      )}
    </button>
  )
}

export function IconButton({
  className,
  children,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-8 items-center justify-center rounded-control text-fg-3 transition-colors hover:bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={clsx('inline-flex rounded-control bg-hover p-0.5', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex-1 rounded-[calc(var(--r-control)-2px)] font-medium transition-all duration-150',
            size === 'sm' ? 'h-6 px-2.5 text-[12px]' : 'h-7 px-3 text-[12.5px]',
            value === o.value ? 'bg-panel text-fg shadow-[0_0_0_1px_var(--border-main),0_1px_2px_#0000000d]' : 'text-fg-3 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'num inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10px] font-medium tracking-[0.06em] text-fg-2 shadow-[inset_0_0_0_1px_var(--border-dark)]',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ink' | 'live' }) {
  return (
    <span
      className={clsx(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
        tone === 'default' && 'bg-hover text-fg-2',
        tone === 'ink' && 'bg-ink text-on-ink',
        tone === 'live' && 'text-fg-3 shadow-[inset_0_0_0_1px_var(--border-main)]',
      )}
    >
      {children}
    </span>
  )
}

/** Three-step dot meter: monochrome way to show low / medium / high. */
export function DotMeter({ value, label }: { value: number; label: string }) {
  const level = value >= 0.66 ? 3 : value >= 0.33 ? 2 : 1
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${['low', 'medium', 'high'][level - 1]}`}>
      <span className="num text-[10px] text-fg-3">{label}</span>
      <span className="inline-flex gap-[2px]">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={clsx(
              'h-[8px] w-[3px] rounded-[1px]',
              i <= level ? (level === 3 ? 'bg-signal' : 'bg-fg-2') : 'bg-stronger',
            )}
          />
        ))}
      </span>
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="num rounded-[4px] bg-hover px-1 text-[10.5px] text-fg-3">{children}</span>
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px bg-line', className)} />
}
