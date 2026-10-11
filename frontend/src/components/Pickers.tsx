import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { duration, hm } from '../lib/time'

/**
 * Pick-or-type fields for times and unloading minutes. Click (or focus) opens a
 * list to pick from; typing still works for exact values. The list renders in a
 * portal, so a scrolling panel or the phone sheet never clips it.
 */

interface Choice {
  value: number
  label: string
  hint?: string
}

const STEP = 15
export const LAST_SLOT = 24 * 60 - STEP

/** 24-hour slots every 15 min from `from` to 23:45 */
function timeSlots(from = 0, relativeTo?: number): Choice[] {
  const out: Choice[] = []
  for (let m = Math.ceil(from / STEP) * STEP; m <= LAST_SLOT; m += STEP) {
    out.push({ value: m, label: hm(m), hint: relativeTo !== undefined ? `+${duration(m - relativeTo)}` : undefined })
  }
  return out
}

const parseTime = (s: string): number | null => {
  const t = s.trim()
  const full = /^([01]?\d|2[0-3]):?([0-5]\d)$/.exec(t)
  if (full) return Number(full[1]) * 60 + Number(full[2])
  const hour = /^([01]?\d|2[0-3]):?$/.exec(t)
  return hour ? Number(hour[1]) * 60 : null
}

const nearest = (choices: Choice[], v: number) =>
  choices.reduce((best, c, i) => (Math.abs(c.value - v) < Math.abs(choices[best].value - v) ? i : best), 0)

const coarse = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

type Variant = 'field' | 'mini'

interface ComboProps {
  label: string
  variant: Variant
  value: number
  display: string
  choices: Choice[]
  /** a typed value, or null if it isn't one */
  parse: (s: string) => number | null
  onChange: (v: number) => void
  /** e.g. "min" after the number */
  suffix?: string
  /** last row of the list that clears the field for typing */
  customLabel?: string
  /** the list is the main input on touch screens; skip the keyboard */
  listOnTouch?: boolean
  /** extra control inside the field, e.g. the Now button */
  extra?: ReactNode
  /** the list can be wider than the field, e.g. to fit "+3 h 15 min" */
  listWidth?: number
  className?: string
}

function ComboField({ label, variant, value, display, choices, parse, onChange, suffix, customLabel, listOnTouch, extra, listWidth, className }: ComboProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [custom, setCustom] = useState(false)
  const box = useRef<HTMLLabelElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const rows = customLabel ? choices.length + 1 : choices.length
  const selected = choices.findIndex((c) => c.value === value)

  const show = () => {
    setActive(selected >= 0 ? selected : nearest(choices, value))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setCustom(false)
  }
  const commitDraft = () => {
    if (draft !== null) {
      const v = parse(draft)
      if (v !== null) onChange(v)
    }
    setDraft(null)
  }
  const pick = (i: number) => {
    if (customLabel && i === choices.length) {
      // keep focus, empty the field and let the user type
      setCustom(true)
      setDraft('')
      setOpen(false)
      input.current?.focus()
      return
    }
    onChange(choices[i].value)
    setDraft(null)
    close()
    input.current?.blur()
  }

  // keep the active row in view
  useLayoutEffect(() => {
    if (!open || !list.current) return
    const el = list.current.querySelector<HTMLElement>(`[data-row="${active}"]`)
    if (!el) return
    const l = list.current
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight + 4
  }, [open, active])

  // centre the current value when the list opens
  useLayoutEffect(() => {
    if (!open || !list.current) return
    const el = list.current.querySelector<HTMLElement>(`[data-row="${active}"]`)
    if (el) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.offsetHeight / 2
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mini = variant === 'mini'
  const text = draft ?? display
  return (
    <label
      ref={box}
      className={clsx(
        'group/field block cursor-pointer rounded-control transition-shadow',
        mini ? 'bg-panel px-2 py-1' : 'px-2.5 py-1.5 hover:bg-hover',
        open || custom
          ? 'shadow-[inset_0_0_0_1.5px_var(--brand)]'
          : 'shadow-[inset_0_0_0_1px_var(--border-dark)] hover:shadow-[inset_0_0_0_1px_var(--text-4)] focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)]',
        className,
      )}
      onMouseDown={(e) => {
        // a click on the field toggles the list; the input keeps focus either way.
        // React bubbles events from the portal list and the extra button here too: skip those.
        const t = e.target as HTMLElement
        if (t === input.current || !box.current?.contains(t) || t.closest('button')) return
        e.preventDefault()
        input.current?.focus()
        if (open) close()
        else show()
      }}
    >
      <span className={clsx('block text-fg-3', mini ? 'text-[10px]' : 'text-[10.5px]')}>{label}</span>
      <span className={clsx('flex items-center gap-1', mini ? 'text-[12.5px]' : 'h-5 text-[13px] leading-5 font-medium')}>
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <input
            ref={input}
            value={text}
            inputMode={listOnTouch && !custom && coarse() ? 'none' : 'numeric'}
            spellCheck={false}
            autoComplete="off"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="listbox"
            placeholder={custom ? 'Type' : undefined}
            onFocus={() => !custom && show()}
            onClick={(e) => {
              e.stopPropagation()
              if (!open && !custom) show()
            }}
            onBlur={() => {
              commitDraft()
              close()
            }}
            onChange={(e) => {
              setDraft(e.target.value)
              const v = parse(e.target.value)
              if (v !== null && choices.length) setActive(nearest(choices, v))
              if (!open && !custom) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                if (!open) return show()
                setActive((a) => Math.max(0, Math.min(rows - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                // a typed value wins over the highlighted row
                if (draft !== null && draft.trim() !== '' && parse(draft) !== null) {
                  commitDraft()
                  close()
                  input.current?.blur()
                } else if (open) pick(active)
                else input.current?.blur()
              } else if (e.key === 'Escape') {
                // close the list only; the app's Escape (deselect the stop) waits for the next press
                if (open || custom || draft !== null) e.stopPropagation()
                setDraft(null)
                close()
                input.current?.blur()
              }
            }}
            style={{ width: `${(text.length || 4) + 0.4}ch` }}
            className="num min-w-0 bg-transparent outline-none placeholder:text-fg-4"
          />
          {suffix && <span className="text-fg-3">{suffix}</span>}
        </span>
        {extra}
        <ChevronDown
          size={mini ? 12 : 14}
          className={clsx('shrink-0 text-fg-3 transition-transform duration-150 group-hover/field:text-fg-2', open && 'rotate-180')}
        />
      </span>
      {open && (
        <Popover anchor={box} minWidth={listWidth}>
          <div ref={list} role="listbox" aria-label={label} className="scroll-thin max-h-[288px] overflow-y-auto p-1">
            {choices.map((c, i) => (
              <Row key={c.value} i={i} on={i === selected} active={i === active} onPick={pick} onHover={setActive}>
                <span className="num">{c.label}</span>
                {c.hint && <span className="num ml-auto pl-3 text-[11px] whitespace-nowrap text-fg-4">{c.hint}</span>}
              </Row>
            ))}
            {customLabel && (
              <>
                <div className="mx-2 my-1 h-px bg-line" />
                <Row i={choices.length} on={selected < 0} active={active === choices.length} onPick={pick} onHover={setActive}>
                  <span>{customLabel}</span>
                  {selected < 0 && <span className="num ml-auto pl-3 text-[11px] whitespace-nowrap text-fg-4">{suffix ? `${display} ${suffix}` : display}</span>}
                </Row>
              </>
            )}
          </div>
        </Popover>
      )}
    </label>
  )
}

function Row({
  i,
  on,
  active,
  onPick,
  onHover,
  children,
}: {
  i: number
  on: boolean
  active: boolean
  onPick: (i: number) => void
  onHover: (i: number) => void
  children: ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={on}
      data-row={i}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onPick(i)
      }}
      onMouseEnter={() => onHover(i)}
      className={clsx(
        'flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[12.5px]',
        active && 'bg-hover',
        on ? 'font-medium text-brand-fg' : 'text-fg',
      )}
    >
      <span className="flex w-3.5 shrink-0 justify-center">{on && <Check size={12} strokeWidth={2.2} />}</span>
      {children}
    </div>
  )
}

/** Fixed-position layer under (or above, if there is no room) its anchor; follows scrolling. */
function Popover({ anchor, minWidth = 132, children }: { anchor: React.RefObject<HTMLElement | null>; minWidth?: number; children: ReactNode }) {
  type Pos = { left: number; top?: number; bottom?: number; width: number }
  const measure = (): Pos | null => {
    const el = anchor.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const vh = window.visualViewport?.height ?? window.innerHeight
    const width = Math.max(r.width, minWidth)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    const below = vh - r.bottom
    return below >= 304 || below >= r.top ? { left, top: r.bottom + 4, width } : { left, bottom: vh - r.top + 4, width }
  }
  // measured on the first render, so the list exists when the field scrolls it to the value
  const [pos, setPos] = useState<Pos | null>(measure)
  useEffect(() => {
    const place = () => setPos(measure())
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])
  if (!pos) return null
  return createPortal(
    <div
      className="animate-rise fixed z-50 overflow-hidden rounded-panel bg-panel shadow-float"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  )
}

/** A time of day: pick a 15-minute slot or type any HH:MM. */
export function TimePicker({
  label,
  value,
  onChange,
  after,
  variant = 'mini',
  extra,
  className,
}: {
  label: string
  value: number
  onChange: (m: number) => void
  /** list only times after this one, with "+4 h" hints (a window's closing time) */
  after?: number
  variant?: Variant
  extra?: ReactNode
  className?: string
}) {
  const choices = after === undefined ? timeSlots() : timeSlots(after + STEP, after)
  return (
    <ComboField
      label={label}
      variant={variant}
      value={value}
      display={hm(value)}
      choices={choices}
      listWidth={after === undefined ? undefined : 184}
      parse={(s) => {
        const v = parseTime(s)
        return v === null || (after !== undefined && v <= after) ? null : v
      }}
      onChange={onChange}
      listOnTouch
      extra={extra}
      className={className}
    />
  )
}

export const UNLOAD_CHOICES = [5, 10, 15, 20, 30, 45, 60]

/** Minutes to unload: the usual durations, or Custom to type any number. */
export function MinutesPicker({ label, value, onChange, className }: { label: string; value: number; onChange: (m: number) => void; className?: string }) {
  return (
    <ComboField
      label={label}
      variant="mini"
      value={value}
      display={String(value)}
      suffix="min"
      choices={UNLOAD_CHOICES.map((m) => ({ value: m, label: duration(m) }))}
      parse={(s) => (/^\d{1,3}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 240 ? Number(s) : null)}
      onChange={onChange}
      customLabel="Custom…"
      listOnTouch
      listWidth={156}
      className={className}
    />
  )
}
