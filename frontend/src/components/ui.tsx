import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'tonal'
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
        variant === 'primary' && 'bg-brand text-on-brand shadow-[0_1px_2px_rgba(16,24,40,0.08),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-brand-hover',
        variant === 'secondary' && 'bg-panel text-fg shadow-[inset_0_0_0_1px_var(--border-dark)] hover:bg-subtle',
        variant === 'ghost' && 'text-fg-2 hover:bg-hover hover:text-fg',
        // the panel's main action when the screen already has a solid primary
        variant === 'tonal' &&
          'bg-brand-soft text-brand-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_26%,transparent)] hover:bg-[color-mix(in_srgb,var(--brand)_15%,transparent)]',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {kbd && (
        <span
          className={clsx(
            'num ml-1 rounded-[4px] px-1 text-[10.5px] max-md:hidden',
            variant === 'primary' ? 'bg-white/20 text-on-brand/90 dark:bg-black/15' : 'bg-hover text-fg-3',
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

/**
 * Pick one of a few options (a radio group). The chosen option is a white key
 * with a brand ring; the others sit in a visible track and light up on hover.
 * Labels never wrap: they truncate, so the control keeps one height.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
  label,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  label?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('inline-flex gap-0.5 rounded-control bg-hover p-[3px] shadow-[inset_0_0_0_1px_var(--border-main)]', className)}
    >
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              'min-w-0 flex-1 truncate whitespace-nowrap rounded-[calc(var(--r-control)-3px)] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-offset-[-1px]',
              size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
              on
                ? 'bg-panel text-brand-fg shadow-[0_0_0_1.5px_var(--brand),0_1px_2px_rgba(16,24,40,0.08)]'
                : 'text-fg-2 hover:bg-panel/70 hover:text-fg',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Switch between views of the same thing. Underlined tabs on a hairline, sized
 * to their labels, so they never squeeze or wrap; they scroll if space runs out.
 */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange: (v: T) => void
  className?: string
  label?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx('no-scrollbar flex gap-3 overflow-x-auto shadow-[inset_0_-1px_0_var(--border-main)]', className)}
    >
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={clsx(
              '-mx-1 flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-[6px] border-b-2 px-1 text-[13px] font-medium transition-colors focus-visible:outline-offset-[-2px]',
              on ? 'border-brand text-fg' : 'border-transparent text-fg-3 hover:border-line-strong hover:text-fg',
            )}
          >
            {o.label}
          </button>
        )
      })}
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

export function StatusPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ink' | 'live' | 'brand' | 'ok' }) {
  return (
    <span
      className={clsx(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
        tone === 'default' && 'bg-hover text-fg-2',
        tone === 'ink' && 'bg-ink text-on-ink',
        tone === 'live' && 'text-fg-3 shadow-[inset_0_0_0_1px_var(--border-main)]',
        tone === 'brand' && 'bg-brand-soft text-brand-fg',
        tone === 'ok' && 'bg-ok-soft text-ok',
      )}
    >
      {children}
    </span>
  )
}

/** Three-step meter: grey for low, amber for medium, red for high. Colour only appears when it needs attention. */
const CARGO_DOT: Record<string, string> = { PHARMA: 'bg-pharma', FROZEN: 'bg-frozen', CHILLED: 'bg-chilled' }

/** Cargo class: neutral pill with a coloured dot, so three classes read apart without shouting. */
export function CargoTag({ cargo, className }: { cargo: string; className?: string }) {
  return (
    <span
      className={clsx(
        'num inline-flex h-[18px] items-center gap-1 rounded-full bg-subtle px-1.5 text-[9.5px] font-medium tracking-[0.06em] text-fg-2',
        className,
      )}
    >
      <span className={clsx('size-[6px] rounded-full', CARGO_DOT[cargo] ?? 'bg-fg-4')} />
      {cargo}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="num rounded-[4px] bg-hover px-1 text-[10.5px] text-fg-3">{children}</span>
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px bg-line', className)} />
}
