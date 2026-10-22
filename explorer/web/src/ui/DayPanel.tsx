import { Badge, Section, Slider, Stat, StatGrid } from './kit'
import type { Occupancy } from '../studio/engine'

// what people are doing, stacked hour by hour
const BANDS: [keyof Occupancy['activity'], string, string][] = [
  ['desk', 'At a desk', 'var(--color-c1)'], ['meeting', 'In a meeting', 'var(--color-c2)'], ['focus', 'Focus room', 'var(--color-c3)'],
  ['food', 'Lunch on the floor', 'var(--color-c5)'], ['wc', 'WC', 'var(--color-c6)'], ['guests', 'Guests seated', 'var(--color-c2)'],
]
const pc = (v: number) => `${Math.round(v * 100)} %`

function DayChart({ o, hour, setHour }: { o: Occupancy; hour: number; setHour: (h: number) => void }) {
  const W = 300, Hh = 120, pad = 22, n = o.hours.length
  const top = Math.max(o.peak.planned, ...o.people.p90, 1) * 1.08
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad - 4)
  const y = (v: number) => Hh - 14 - (v / top) * (Hh - 22)
  const bands = BANDS.filter(([k]) => o.activity[k].some((v) => v > 0.05))
  const stack = o.hours.map(() => 0)
  const areas = bands.map(([k, , c]) => {
    const lo = stack.slice()
    o.activity[k].forEach((v, i) => { stack[i] += v })
    const pts = [...stack.map((v, i) => `${x(i)},${y(v)}`), ...lo.map((v, i) => `${x(i)},${y(v)}`).reverse()]
    return <polygon key={k} points={pts.join(' ')} fill={c} opacity={0.85} />
  })
  const hi = o.hours.indexOf(hour)
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full cursor-pointer select-none" role="img" aria-label="People on the floor through the day"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const i = Math.round((((e.clientX - r.left) / r.width) * W - pad) / ((W - pad - 4) / (n - 1)))
        setHour(o.hours[Math.max(0, Math.min(n - 1, i))])
      }}>
      {areas}
      <polyline points={o.people.p90.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--color-ink)" strokeWidth={1.2} strokeDasharray="3 2" />
      <line x1={pad} x2={W - 4} y1={y(o.peak.planned)} y2={y(o.peak.planned)} stroke="var(--color-serious)" strokeWidth={1} />
      <text x={W - 4} y={y(o.peak.planned) - 2} textAnchor="end" fontSize={8} fill="var(--color-serious)">planned {o.peak.planned}</text>
      {hi >= 0 && <line x1={x(hi)} x2={x(hi)} y1={6} y2={Hh - 14} stroke="var(--color-ink)" strokeWidth={1.5} />}
      {o.hours.map((h, i) => (i % 2 === 0 ? <text key={h} x={x(i)} y={Hh - 3} textAnchor="middle" fontSize={8} fill="var(--color-muted)">{h}</text> : null))}
      <text x={2} y={y(top / 1.08) + 3} fontSize={8} fill="var(--color-muted)">{Math.round(top / 1.08)}</text>
    </svg>
  )
}

function Finding({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <Badge tone={ok ? 'good' : warn ? 'warn' : 'serious'}>{ok ? 'OK' : 'Check'}</Badge><span>{children}</span>
    </li>
  )
}

/** Simulated working days on the furnished floor: who is in hour by hour, and where the layout pinches. */
export function DayPanel({ occ, busy, hour, setHour, attendance, setAttendance, demand, setDemand, showUse, onShowUse }: {
  occ: Occupancy | null; busy: boolean; hour: number; setHour: (h: number) => void
  attendance: number | null; setAttendance: (v: number | null) => void; demand: number; setDemand: (v: number) => void
  showUse: boolean; onShowUse: () => void
}) {
  const o = occ
  return (
    <Section id="studio-day" title="A day on this floor" right={<Badge tone="warn">{busy ? 'simulating…' : 'uncalibrated'}</Badge>}>
      {!o ? <p className="text-[12px] text-muted">{busy ? 'Simulating working days…' : 'No simulation yet.'}</p> : (
        <>
          <p className="mb-2 text-[12px] leading-snug text-ink-2">
            {o.days} simulated working days, minute by minute. {o.kind === 'work'
              ? `${o.staff} people on the books, each with their own habit of coming in; desks, meetings, focus rooms, lunch and WCs compete.`
              : 'Guests arrive to fill the catalogue’s hourly profile, take a free seat or are turned away.'}
          </p>
          {o.kind === 'work' ? (
            <label className="mb-2 block text-[12px] text-ink-2">
              <span className="mb-0.5 flex justify-between">
                <span>Share of staff in at the peak{attendance === null ? ' (catalogue)' : ''}</span>
                <span className="font-mono text-ink">{pc(attendance ?? o.attendance ?? 0.7)}</span>
              </span>
              <Slider value={attendance ?? o.attendance ?? 0.7} min={0.3} max={1} step={0.05} onChange={(v) => setAttendance(v)} />
            </label>
          ) : (
            <label className="mb-2 block text-[12px] text-ink-2">
              <span className="mb-0.5 flex justify-between"><span>Guest demand against the catalogue profile</span><span className="font-mono text-ink">{demand.toFixed(2)}×</span></span>
              <Slider value={demand} min={0.3} max={2} step={0.1} onChange={setDemand} />
            </label>
          )}
          <DayChart o={o} hour={hour} setHour={setHour} />
          <div className="mb-2 mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-muted">
            {BANDS.filter(([k]) => o.activity[k].some((v) => v > 0.05)).map(([k, label, c]) => (
              <span key={k} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2.5 rounded-sm" style={{ background: c }} />{label}</span>
            ))}
            <span>- - busiest day in ten</span>
          </div>
          <label className="mb-2 block text-[12px] text-ink-2">
            <span className="mb-0.5 flex justify-between"><span>Hour shown on the plan</span><span className="font-mono text-ink">{String(hour).padStart(2, '0')}:00</span></span>
            <Slider value={hour} min={o.hours[0]} max={o.hours[o.hours.length - 1]} step={1} onChange={setHour} />
          </label>
          <button type="button" onClick={onShowUse} aria-pressed={showUse}
            className={`mb-2.5 w-full rounded-md border-2 border-edge px-2 py-1 text-[12.5px] font-semibold ${showUse ? 'bg-surface' : 'bg-coral text-[#202020]'}`}>
            {showUse ? 'Back to the furniture' : 'Show how busy each room is'}
          </button>
          <StatGrid>
            <Stat label="people at the peak (typical day)" value={Math.round(o.peak.mean)} sub={`busiest day ${o.peak.max}`} />
            <Stat label="person-hours a day" value={Math.round(o.personHours)} sub={`${o.m2PerPersonHour} m² per person-hour`} />
            <Stat label="walked per person a day" value={Math.round(o.walk.perPersonDay)} unit="m" />
            <Stat label="planned for (fire figure)" value={o.peak.planned} sub={`legal maximum ${o.peak.legalMax}`} />
          </StatGrid>
          <ul className="mt-2.5 space-y-1.5">
            {o.desks && (o.desks.shared
              ? <Finding ok={o.desks.shortDays < 0.1}>Shared desks ({o.desks.n}): short on {pc(o.desks.shortDays)} of days, {o.desks.withoutDesk} people a day without one</Finding>
              : <Finding ok={o.desks.useAtPeak >= 0.6} warn>Own desks ({o.desks.n}): only {pc(o.desks.useAtPeak)} in use at the peak, so desk sharing could free space</Finding>)}
            {o.meetings && <Finding ok={o.meetings.deniedShare < 0.1}>Meetings: {pc(o.meetings.deniedShare)} of {o.meetings.perDay} bookings a day find no free room{o.meetings.tooBigShare > 0 ? ` (${pc(o.meetings.tooBigShare)} too big for any room)` : ''}</Finding>}
            {o.focus && (o.focus.rooms
              ? <Finding ok={o.focus.deniedShare < 0.1}>Focus rooms ({o.focus.rooms}): {pc(o.focus.deniedShare)} of {o.focus.perDay} calls a day find none free</Finding>
              : <Finding ok={false} warn>No focus rooms: {o.focus.perDay} calls a day are taken at the desk</Finding>)}
            {o.food && (o.food.seats
              ? <Finding ok={o.food.crowding <= 1}>Lunch: {Math.round(o.food.peakMean)} people at once for {o.food.seats} pantry and lounge seats</Finding>
              : <Finding ok={false} warn>No pantry seats: lunch on the floor is eaten at the desk</Finding>)}
            {o.guests && <Finding ok={o.guests.turnedAwayShare < 0.05}>{Math.round(o.guests.coversPerDay)} guests a day; {Math.round(o.guests.turnedAwayPerDay)} turned away ({pc(o.guests.turnedAwayShare)}); {pc(o.guests.peakFill)} of usable seats taken at the busiest hour</Finding>}
            <Finding ok={o.wc.waitP90 <= 2}>WCs ({o.wc.cubicles}): one visit in ten waits {o.wc.waitP90} min or more; worst wait of a typical day {o.wc.worstDay} min</Finding>
          </ul>
          {o.meetings && o.meetings.rooms.length > 0 && (
            <table className="mt-2.5 w-full text-[11.5px]">
              <thead><tr className="text-left font-mono text-[10px] uppercase text-muted"><th className="pb-1">Meeting room</th><th className="pb-1 text-right">Seats</th><th className="pb-1 text-right">Booked</th><th className="pb-1 text-right">Filled</th></tr></thead>
              <tbody>
                {o.meetings.rooms.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-0.5">{r.name}</td><td className="text-right tabular-nums">{r.cap}</td>
                    <td className="text-right tabular-nums">{pc(r.bookedShare)}</td>
                    <td className={`text-right tabular-nums ${r.avgFill < 0.4 ? 'text-serious' : ''}`}>{pc(r.avgFill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted">{o.note}</p>
        </>
      )}
    </Section>
  )
}
