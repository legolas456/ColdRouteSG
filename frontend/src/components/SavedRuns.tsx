import clsx from 'clsx'
import { History, Loader2, RotateCw, Trash2, UsersRound, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { deleteRun, listRuns, type SavedRun, teamActivity, type TeamActivity } from '../lib/history'
import { PROFILES } from '../lib/profiles'
import { Button } from './ui'

/** Saved runs and team activity: what the signed-in user's account keeps in AWS. */

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : '—'

function Dialog({ title, icon, onClose, wide, children }: { title: string; icon: ReactNode; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.32)] p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('animate-rise relative flex max-h-[min(640px,calc(100vh-32px))] w-full flex-col rounded-[16px] bg-panel shadow-float', wide ? 'max-w-[640px]' : 'max-w-[480px]')}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="text-fg-3">{icon}</span>
          <h2 className="flex-1 font-serif text-[19px] leading-tight tracking-[-0.02em]">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="flex size-7 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function Status({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error)
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-fg-3">
        <Loader2 size={15} className="animate-spin" /> Loading
      </div>
    )
  return (
    <div className="py-8 text-center">
      <p className="text-[13px] text-fg-2">{error}</p>
      <Button size="sm" className="mt-3" icon={<RotateCw size={13} />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** The signed-in user's saved runs, newest first: reopen one, or delete it. */
export function RunsDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (run: SavedRun) => Promise<void> }) {
  const [runs, setRuns] = useState<SavedRun[] | null>(null)
  // where the next page of older runs starts; null when there are no more
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setRuns(null)
    listRuns(20)
      .then((page) => (setRuns(page.runs), setNext(page.next)))
      .catch((e: Error) => setError(e.message))
  }, [])

  const loadMore = () => {
    if (!next) return
    setLoadingMore(true)
    listRuns(20, next)
      .then((page) => (setRuns((rs) => [...(rs ?? []), ...page.runs]), setNext(page.next)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false))
  }
  useEffect(() => load(), [load])

  const remove = (id: string) => {
    setBusy(id)
    deleteRun(id)
      .then(() => setRuns((rs) => rs?.filter((r) => r.route_id !== id) ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => (setBusy(null), setConfirming(null)))
  }

  const open = (run: SavedRun) => {
    setBusy(run.route_id)
    onOpen(run).catch((e: Error) => (setError(e.message), setBusy(null)))
  }

  return (
    <Dialog title="Your runs" icon={<History size={16} />} onClose={onClose}>
      {runs === null ? (
        <Status error={error} onRetry={load} />
      ) : runs.length === 0 ? (
        <p className="py-8 text-center text-[13px] leading-relaxed text-fg-3">
          No saved runs yet. Each plan you make while signed in is saved here.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {error && <li className="px-2 pb-2 text-[12px] text-bad">{error}</li>}
          {runs.map((run) => {
            const late = run.result.late_stops ?? 0
            const profile = PROFILES[run.request.profile]?.label ?? run.request.profile
            return (
              <li key={run.route_id} className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">
                    {run.depot_name} · departs {run.departure_time}
                  </div>
                  <div className="num mt-0.5 truncate text-[11.5px] text-fg-3">
                    {when(run.created_at)} · {run.stop_count} stops · {profile} · {Math.round(run.result.total_travel_minutes)} min drive ·{' '}
                    <span className={late ? 'text-bad' : undefined}>{late ? `${late} late` : 'on time'}</span>
                  </div>
                </div>
                {confirming === run.route_id ? (
                  <Button size="sm" className="text-bad" disabled={busy === run.route_id} onClick={() => remove(run.route_id)}>
                    Delete
                  </Button>
                ) : (
                  <button
                    aria-label="Delete this run"
                    onClick={() => setConfirming(run.route_id)}
                    className="flex size-7 items-center justify-center rounded-full text-fg-4 hover:bg-subtle hover:text-fg-2"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <Button size="sm" disabled={busy === run.route_id} onClick={() => open(run)}>
                  {busy === run.route_id && confirming !== run.route_id ? <Loader2 size={13} className="animate-spin" /> : 'Open'}
                </Button>
              </li>
            )
          })}
          {next && (
            <li className="flex justify-center px-2 pt-2">
              <Button size="sm" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? <Loader2 size={13} className="animate-spin" /> : 'Show older runs'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Dialog>
  )
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[10px] bg-subtle px-3 py-2.5">
      <div className="num text-[18px] leading-tight font-semibold">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-fg-3">{label}</div>
    </div>
  )
}

/** For admins: every dispatcher's saved runs, from route history. */
export function TeamDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<TeamActivity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    setData(null)
    teamActivity()
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => load(), [load])

  return (
    <Dialog title="Team activity" icon={<UsersRound size={16} />} onClose={onClose} wide>
      {!data ? (
        <Status error={error} onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
            <Tile label="Dispatchers" value={data.summary.total_drivers} />
            <Tile label="Runs planned" value={data.summary.total_routes} />
            <Tile label="Stops" value={data.summary.total_delivery_stops} />
            <Tile label="Pharma stops" value={data.summary.high_priority_deliveries} />
            <Tile label="Average drive" value={`${Math.round(data.summary.average_planned_travel_minutes)} min`} />
            <Tile label="Planned lateness" value={`${Math.round(data.summary.total_planned_lateness_minutes)} min`} />
          </div>
          {data.drivers.length > 0 && (
            <table className="mt-4 w-full text-left text-[12.5px]">
              <thead className="text-[11px] tracking-[0.04em] text-fg-3 uppercase">
                <tr className="border-b border-line">
                  <th className="py-1.5 font-medium">Dispatcher</th>
                  <th className="py-1.5 text-right font-medium">Runs</th>
                  <th className="py-1.5 text-right font-medium">Stops</th>
                  <th className="py-1.5 text-right font-medium max-sm:hidden">Avg drive</th>
                  <th className="py-1.5 text-right font-medium">Last run</th>
                </tr>
              </thead>
              <tbody className="num">
                {data.drivers.map((d) => (
                  <tr key={d.driver_id} className="border-b border-line last:border-0">
                    <td className="max-w-[200px] truncate py-2 pr-2">{d.email || d.driver_id}</td>
                    <td className="py-2 text-right">{d.routes}</td>
                    <td className="py-2 text-right">{d.stops}</td>
                    <td className="py-2 text-right max-sm:hidden">{Math.round(d.average_travel_minutes)} min</td>
                    <td className="py-2 text-right whitespace-nowrap">{when(d.last_route_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-[11.5px] leading-relaxed text-fg-4">Plans saved to route history, not completed deliveries.</p>
        </>
      )}
    </Dialog>
  )
}
