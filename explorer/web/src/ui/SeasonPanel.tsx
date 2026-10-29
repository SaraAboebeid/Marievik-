import { useEffect, useMemo, useRef, useState } from 'react'
import type { FloorPayload } from '../types'
import { KINDS, PROGRAMME, SEASONS, ZONES, fmtHour, nightOf, onAt, streetLife, sunAt, unitProgram, weatherAt } from '../seasons'

// Seasons & hours: one day in each season at Marievik, morning to the next morning, played or scrubbed. The
// viewer (viewer/seasonShow.ts) draws it; this bar is the clock, the day's programme per place, and what's on now.

const H0 = 6, H1 = 30   // the day runs 06:00 → 06:00
const SPEEDS = [0.5, 1, 2, 4]

export function SeasonPanel({ floors, onClock, onOrbit, onClose }: {
  floors: FloorPayload[]
  onClock: (season: number, hour: number, labels: boolean) => void
  onOrbit: (radPerSecond: number) => void
  onClose: () => void
}) {
  const [season, setSeason] = useState(3)
  const [hour, setHour] = useState(16.5)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [labels, setLabels] = useState(true)
  const [orbit, setOrbit] = useState(true)
  const [small, setSmall] = useState(() => (typeof window !== 'undefined' ? window.innerHeight < 1000 : false))
  const st = useRef({ season, hour, speed, playing })
  st.current = { season, hour, speed, playing }
  useEffect(() => { onClock(season, hour, labels) }, [season, hour, labels])   // eslint-disable-line react-hooks/exhaustive-deps
  // the 360: the view circles the site while the year plays (drag to look around; it carries on after)
  useEffect(() => { onOrbit(orbit && playing ? 0.07 : 0) }, [orbit, playing])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onOrbit(0), [])   // eslint-disable-line react-hooks/exhaustive-deps
  // the clock: a day in ~40 s at 1x, then on to the next season at dawn
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      let h = st.current.hour + dt * 0.6 * st.current.speed
      if (h >= H1) { h = H0; setSeason((s) => (s + 1) % 4) }
      setHour(h)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const s = SEASONS[season]
  const w = weatherAt(season, hour)
  const night = nightOf(season, hour % 24)
  const acts = PROGRAMME[s.id]
  // the day's light, for the ribbon behind the hours
  const ribbon = useMemo(() => {
    const stops: string[] = []
    for (let h = H0; h <= H1; h += 0.5) {
      const n = nightOf(season, h % 24)
      const a = sunAt(season, h % 24).altitude
      const c = n > 0.85 ? '#1d2a4d' : n > 0.15 ? (a > -4 ? '#f0a47a' : '#5a5f96') : a < 15 ? '#f6dca0' : '#cfe6f7'
      stops.push(`${c} ${(((h - H0) / (H1 - H0)) * 100).toFixed(1)}%`)
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`
  }, [season])
  const pct = (h: number) => `${(((Math.min(H1, Math.max(H0, h < H0 ? h + 24 : h)) - H0) / (H1 - H0)) * 100).toFixed(2)}%`
  const sun = useMemo(() => {
    let rise: number | null = null, set: number | null = null
    for (let h = 0; h < 24; h += 0.05) {
      const a = sunAt(season, h).altitude, b = sunAt(season, h + 0.05).altitude
      if (a < 0 && b >= 0) rise = h
      if (a >= 0 && b < 0) set = h
    }
    return { rise, set }
  }, [season])
  // what's open on the ground floors now, and what changed from the office day
  const indoor = useMemo(() => {
    const list: { b: string; name: string; label: string; kind: keyof typeof KINDS; day: string }[] = []
    for (const fp of floors) for (const u of fp.units) {
      const p = unitProgram(u.name, fp.building, season, hour)
      if (!p?.open) continue
      const day = unitProgram(u.name, fp.building, season, 12)
      list.push({ b: fp.building, name: u.name.split(' · ')[1] ?? u.name, label: p.label, kind: p.kind, day: day?.label ?? '' })
    }
    const order = ['party', 'culture', 'craft', 'well', 'food', 'shop', 'home', 'work']
    return list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  }, [floors, season, Math.floor(hour * 2)])   // eslint-disable-line react-hooks/exhaustive-deps
  const switched = indoor.filter((x) => x.label !== x.day && x.kind !== 'work')
  const outdoor = acts.filter((a) => onAt(a, hour))
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHour(H0 + Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * (H1 - H0))
  }

  return (
    <div className="pointer-events-auto flex max-h-[min(30rem,46vh)] w-full flex-col overflow-hidden rounded-xl border-2 border-edge bg-raised shadow-[3px_3px_0_var(--color-edge)]">
      <div className="checker-band flex flex-wrap items-center justify-between gap-2 px-3.5 pb-2 pt-1" style={{ background: s.tint }}>
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#202020]">Seasons &amp; hours · Marievik through the year</h4>
        <span className="flex items-center gap-1.5">
          <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold">{s.icon} {s.label} · {fmtHour(hour)}</span>
          <span className="hidden rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[11px] sm:inline" title="Weather">{w.icon} {w.label}</span>
          <button type="button" onClick={() => setSmall(!small)} className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[11px] font-bold">{small ? 'more ▴' : 'less ▾'}</button>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full border-2 border-edge bg-surface text-[13px] leading-none">×</button>
        </span>
      </div>
      <div className="overflow-y-auto px-3.5 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPlaying(!playing)} aria-pressed={playing}
            className={`rounded-md border-2 border-edge px-3 py-1 font-mono text-[12px] font-bold shadow-[2px_2px_0_var(--color-edge)] ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
            {playing ? '❚❚ pause' : '▶ play the year'}
          </button>
          <span className="flex overflow-hidden rounded-md border-2 border-edge text-[11px] font-semibold">
            {SPEEDS.map((v) => (
              <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)} className={`px-1.5 py-0.5 ${speed === v ? 'bg-ink text-surface' : 'bg-surface'}`}>{v}×</button>
            ))}
          </span>
          <span className="flex gap-1">
            {SEASONS.map((x, i) => (
              <button key={x.id} type="button" aria-pressed={i === season} onClick={() => setSeason(i)}
                className={`rounded-md border-2 border-edge px-2 py-0.5 text-[11.5px] font-semibold ${i === season ? 'shadow-[2px_2px_0_var(--color-edge)]' : 'bg-surface'}`}
                style={i === season ? { background: x.tint } : undefined}>{x.icon} {x.label}</button>
            ))}
          </span>
          <span className="flex gap-1">
            {[['Morning', 8], ['Noon', 12.5], ['After work', 17.5], ['Evening', 20.5], ['Night', 23.5]].map(([l, h]) => (
              <button key={l as string} type="button" onClick={() => setHour(h as number)} className="rounded border-[1.5px] border-edge bg-surface px-1.5 font-mono text-[10.5px]">{l}</button>
            ))}
          </span>
          <button type="button" aria-pressed={orbit} onClick={() => setOrbit(!orbit)} title="Circle the view round the site while the year plays; drag to look around and it carries on after"
            className={`ml-auto rounded-md border-2 border-edge px-2 py-0.5 font-mono text-[11px] font-bold ${orbit ? 'bg-ink text-surface' : 'bg-surface'}`}>⟳ 360° {orbit ? 'on' : 'off'}</button>
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> labels</label>
        </div>

        {/* the day: light, the hours, the programme per place */}
        <div className="relative select-none" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setPlaying(false); scrub(e) }}
          onPointerMove={(e) => { if (e.buttons) scrub(e) }}>
          <div className="relative h-5 rounded border-2 border-edge" style={{ background: ribbon }}>
            {[6, 9, 12, 15, 18, 21, 24, 27].map((h) => (
              <span key={h} className="absolute top-0 h-full border-l border-[#20202033] pl-0.5 font-mono text-[9px] leading-4" style={{ left: pct(h), color: nightOf(season, h % 24) > 0.5 ? '#fff' : '#202020' }}>{fmtHour(h)}</span>
            ))}
            {sun.rise !== null && <span className="absolute -top-0.5 font-mono text-[9px]" style={{ left: pct(sun.rise) }} title="Sunrise">☀↑</span>}
            {sun.set !== null && <span className="absolute -top-0.5 font-mono text-[9px]" style={{ left: pct(sun.set) }} title="Sunset">☀↓</span>}
          </div>
          {!small && (
            <div className="mt-1 space-y-0.5">
              {ZONES.map((z) => (
                <div key={z.id} className="relative h-[18px]" title={z.note}>
                  <span className="absolute left-0 top-0 z-10 rounded-sm bg-raised/90 pr-1 font-mono text-[9.5px] font-semibold leading-[18px]">{z.name}</span>
                  {acts.filter((a) => a.zone === z.id).map((a) => (
                    <span key={a.name} className={`absolute top-0.5 h-[14px] overflow-hidden whitespace-nowrap rounded-sm border border-edge px-1 text-[9.5px] leading-[12px] ${onAt(a, hour) ? 'font-bold' : 'opacity-70'}`}
                      style={{ left: pct(a.from), width: `calc(${pct(Math.min(a.to, H1))} - ${pct(a.from)})`, background: KINDS[a.kind].colour, color: '#202020' }} title={`${a.name}, ${fmtHour(a.from)}–${fmtHour(a.to)}`}>
                      {a.name}
                    </span>
                  ))}
                </div>
              ))}
              <div className="relative h-[18px]" title="Ground floors: offices by day, the community's in the evening">
                <span className="absolute left-0 top-0 z-10 rounded-sm bg-raised/90 pr-1 font-mono text-[9.5px] font-semibold leading-[18px]">Ground floors</span>
                <span className="absolute top-0.5 h-[14px] rounded-sm border border-edge px-1 text-[9.5px] leading-[12px]" style={{ left: pct(7), width: `calc(${pct(17)} - ${pct(7)})`, background: KINDS.work.colour }}>offices, shops, cafés, lunch</span>
                <span className="absolute top-0.5 h-[14px] overflow-hidden whitespace-nowrap rounded-sm border border-edge px-1 text-[9.5px] leading-[12px]" style={{ left: pct(17), width: `calc(${pct(23)} - ${pct(17)})`, background: KINDS.craft.colour }}>yoga, pottery, quiz, bars, dinner</span>
                <span className="absolute top-0.5 h-[14px] overflow-hidden whitespace-nowrap rounded-sm border border-edge px-1 text-[9.5px] leading-[12px]" style={{ left: pct(23), width: `calc(${pct(26)} - ${pct(23)})`, background: KINDS.party.colour }}>late</span>
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute -bottom-0.5 top-0 w-0.5 bg-[#d8342b]" style={{ left: pct(hour) }} />
        </div>

        {!small && (
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-lg border-2 border-edge bg-surface px-2 py-1">
              <b className="block font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Outdoors now</b>
              {outdoor.length ? outdoor.map((a) => (
                <div key={a.name} className="flex items-baseline gap-1.5 text-[11.5px]"><i className="inline-block h-2.5 w-2.5 flex-none rounded-sm border border-edge" style={{ background: KINDS[a.kind].colour }} />
                  <span><b>{a.name}</b> <span className="text-muted">· {ZONES.find((z) => z.id === a.zone)?.name}, until {fmtHour(a.to)}</span></span></div>
              )) : <p className="text-[11.5px] text-muted">Quiet: nothing on outdoors at this hour.</p>}
              <p className="mt-1 font-mono text-[10px] text-muted">{w.icon} {w.label} · people out: {Math.round(streetLife(season, hour) * 100)} % of a summer afternoon · {night > 0.5 ? 'dark' : night > 0.1 ? 'twilight' : 'daylight'}</p>
            </div>
            <div className="rounded-lg border-2 border-edge bg-surface px-2 py-1 md:col-span-2">
              <b className="block font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Ground floors now · {indoor.length} spaces open{switched.length ? `, ${switched.length} used for something else than by day` : ''}</b>
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                {indoor.slice(0, 10).map((x) => (
                  <div key={x.b + x.name} className="flex items-baseline gap-1.5 truncate text-[11.5px]" title={x.day && x.day !== x.label ? `By day: ${x.day}` : ''}>
                    <i className="inline-block h-2.5 w-2.5 flex-none rounded-sm border border-edge" style={{ background: KINDS[x.kind].colour }} />
                    <span className="truncate"><b>{x.b}</b> {x.label}{x.day && x.day !== x.label ? <span className="text-muted"> · by day {x.day.toLowerCase()}</span> : null}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[9.5px]">
                {Object.entries(KINDS).map(([k, v]) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm border border-edge" style={{ background: v.colour }} />{v.label}</span>)}
              </div>
            </div>
          </div>
        )}
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted">
          A programme to argue with, not a forecast: the ground floors are the real tenants from the floor plans, what they host after hours and the outdoor events are suggestions. Sun from the date and hour; weather invented for each day.
        </p>
      </div>
    </div>
  )
}
