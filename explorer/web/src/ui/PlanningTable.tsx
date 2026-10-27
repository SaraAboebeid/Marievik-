import { Card } from './kit'
import type { TimelineResponse } from '../types'

const msek = (n: number) => (n / 1e6).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const thousands = (n: number) => Math.round(n / 1000).toLocaleString('sv-SE')

/** The 10-year planning at a glance: one row per pathway (unchanged use, and each pathway of change) with its
 *  number of changes, the cost of the works and the people-hours over ten years. A row opens the full timeline. */
export function PlanningTable({ tl, title, onOpen }: {
  tl: TimelineResponse | null; title: string; onOpen: (id: string, segment: 1 | 2) => void
}) {
  if (!tl || tl.status !== 'ready') {
    const msg = !tl ? 'Loading…' : tl.status === 'failed' ? `Could not compute the pathways${tl.error ? `: ${tl.error}` : ''}.`
      : `Computing pathways… ${tl.done} / ${tl.total}`
    return <Card title={title}><p className="text-[12px] text-ink-2">{msg}</p></Card>
  }
  return (
    <Card title={title} right={<span className="font-mono text-[11px] text-ink">{tl.years[0]}–{tl.years[tl.years.length - 1]}</span>}>
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase text-muted">
            <th className="pb-1">Pathway</th><th className="pb-1 text-right">Changes</th>
            <th className="pb-1 text-right">Works MSEK</th><th className="pb-1 text-right">People-h k</th>
          </tr>
        </thead>
        <tbody>
          {tl.segments.map((s) => {
            const capex = s.totals?.capex_sek ?? s.events.reduce((a, e) => a + e.capex_sek, 0)
            return (
              <tr key={s.id} onClick={() => onOpen(s.id, s.segment)} title={`${s.summary ?? s.label} — click to open the full timeline`}
                className={`cursor-pointer border-t border-line hover:bg-sunken ${s.highlight ? 'font-semibold' : ''}`}>
                <td className="py-1 pr-1">{s.label}</td>
                <td className="text-right tabular-nums">{s.changes ?? s.events.length}</td>
                <td className="text-right tabular-nums">{capex ? msek(capex) : '–'}</td>
                <td className="text-right tabular-nums">{s.totals ? thousands(s.totals.people_hours_10y) : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-muted">Click a pathway to play it year by year.</p>
    </Card>
  )
}
