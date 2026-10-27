import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Card } from './kit'
import { AMENITY_TYPES, activeIn, type LifeItem, type UrbanLife } from '../urbanLife'
import { inkOn, lifeIconSvg } from '../lifeIcons'

export interface LifeFilter { year: number; permanent: boolean; temporary: boolean; amenities: boolean }
export const LIFE_YEARS = [2024, 2030] as const
const YEARS = Array.from({ length: LIFE_YEARS[1] - LIFE_YEARS[0] + 1 }, (_, i) => LIFE_YEARS[0] + i)
const AMENITY_RADIUS = 600   // same radius as the pins on the map (App.tsx)

const vars = (c: string) => ({ '--c': c, '--on': inkOn(c) }) as CSSProperties
function Icon({ k, size = 12, stroke }: { k: string; size?: number; stroke?: number }) {
  return <span className="inline-grid place-items-center" dangerouslySetInnerHTML={{ __html: lifeIconSvg(k, size, stroke) }} />
}

/** Urban scale: AMF's events and activities on Marievik, played year by year, and the amenities around it.
 *  Three kinds of life, three objects (on the map and here): permanent → a planted flag, temporary → a balloon that
 *  is there for its one year, amenities → round tokens. */
export function LifePanel({ life, filter, setFilter }: { life: UrbanLife | null; filter: LifeFilter; setFilter: (f: LifeFilter) => void }) {
  const [playing, setPlaying] = useState(false)
  const latest = useRef(filter)
  latest.current = filter
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const f = latest.current
      if (f.year >= LIFE_YEARS[1]) { setPlaying(false); return }
      setFilter({ ...f, year: f.year + 1 })
    }, 1300)
    return () => window.clearInterval(id)
  }, [playing, setFilter])

  if (!life) return <Card title="Life on Marievik">Loading…</Card>
  const cat = (c: string) => life.categories[c] ?? { label: c, colour: '#9a978e' }
  const y = filter.year
  const perm = life.timeline.filter((t) => t.kind === 'permanent' && activeIn(t, y))
  const temp = life.timeline.filter((t) => t.kind === 'temporary' && activeIn(t, y))
  const near = life.amenities.filter((a) => Math.hypot(a.x, a.y) < AMENITY_RADIUS)
  const amenCount: Record<string, number> = {}
  for (const a of near) amenCount[a.type] = (amenCount[a.type] ?? 0) + 1
  const offMap = [...(filter.permanent ? perm : []), ...(filter.temporary ? temp : [])].filter((t) => t.x === null)
  const play = () => {
    if (playing) { setPlaying(false); return }
    if (y >= LIFE_YEARS[1]) setFilter({ ...filter, year: LIFE_YEARS[0] })
    setPlaying(true)
  }

  const tiles = [
    { key: 'permanent' as const, glyph: <i className="lg-flag" />, name: 'Permanent', sub: 'planted · stays', n: perm.length },
    { key: 'temporary' as const, glyph: <i className="lg-balloon" />, name: 'Temporary', sub: 'one year only', n: temp.length },
    { key: 'amenities' as const, glyph: <i className="lg-token" style={vars('#fd876e')}><Icon k="cafe" size={9} stroke={2.8} /></i>, name: 'Amenities', sub: 'around today', n: near.length },
  ]

  const row = (t: LifeItem) => {
    const c = cat(t.category)
    const isTemp = t.kind === 'temporary'
    return (
      <li key={t.id} title={t.note}
        className={`grid grid-cols-[1.35rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[12px] ${isTemp ? 'border-[1.5px] border-dashed border-edge bg-surface' : 'border-2 border-edge bg-surface shadow-[2px_2px_0_var(--color-edge)]'}`}>
        <i className={`grid h-[1.35rem] w-[1.35rem] place-items-center border-[1.5px] border-edge ${isTemp ? 'rounded-full' : 'rounded-[3px]'}`}
          style={{ background: c.colour, color: inkOn(c.colour) }}>
          <Icon k={t.category} size={12} />
        </i>
        <span className="min-w-0">
          <b className="block truncate font-semibold leading-tight">{t.name}</b>
          <span className="block truncate text-[10.5px] leading-tight text-muted">
            {c.label}{t.x === null ? ' · not on map' : t.place ? ` · ${t.place}` : ''}{t.confidence === 'approx' ? ' (approx.)' : ''}
          </span>
        </span>
        {!isTemp && t.year === y
          ? <span className="life-new">new</span>
          : <span className="font-mono text-[10.5px] text-ink-2">{isTemp ? `${t.year} only` : `since ${t.year}`}</span>}
      </li>
    )
  }

  return (
    <Card title="Life on Marievik" right={
      <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold text-ink shadow-[2px_2px_0_var(--color-edge)]">{y}</span>
    }>
      {/* the decade board: each year a little stack, squares for what's planted, dashed circles for what pops up */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">The decade, {LIFE_YEARS[0]}–{LIFE_YEARS[1]}</span>
        <button type="button" onClick={play} aria-pressed={playing} title={playing ? 'Pause' : 'Play the years'}
          className={`flex items-center gap-1 rounded-md border-2 border-edge px-1.5 py-px font-mono text-[10.5px] font-bold shadow-[2px_2px_0_var(--color-edge)] ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
          {playing ? '❚❚ pause' : '▶ play'}
        </button>
      </div>
      <div className="mb-3 grid grid-cols-7 gap-[3px]" role="radiogroup" aria-label="Year">
        {YEARS.map((yr) => {
          const p = life.timeline.filter((t) => t.kind === 'permanent' && activeIn(t, yr))
          const tt = life.timeline.filter((t) => t.kind === 'temporary' && activeIn(t, yr))
          const on = yr === y
          return (
            <button key={yr} type="button" role="radio" aria-checked={on} onClick={() => { setPlaying(false); setFilter({ ...filter, year: yr }) }}
              title={`${yr}: ${p.length} permanent, ${tt.length} temporary`}
              className={`life-col flex flex-col items-stretch rounded-[4px] border-2 border-edge ${on ? 'bg-coral shadow-[2px_2px_0_var(--color-edge)]' : 'bg-sunken hover:bg-surface'}`}>
              <span className="flex h-[58px] flex-wrap-reverse content-start justify-center gap-[1.5px] overflow-hidden p-[2px]">
                {p.map((t) => <i key={t.id} className={`cell-p ${filter.permanent ? '' : 'opacity-25'}`} style={vars(cat(t.category).colour)} />)}
                {tt.map((t) => <i key={t.id} className={`cell-t ${filter.temporary ? '' : 'opacity-25'}`} style={vars(cat(t.category).colour)} />)}
              </span>
              <span className={`border-t-2 border-edge py-px text-center font-mono text-[9.5px] font-bold ${on ? 'text-[#202020]' : 'text-ink-2'}`}>’{String(yr).slice(2)}</span>
            </button>
          )
        })}
      </div>

      {/* the three layers, each drawn as its own map object */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {tiles.map((t) => (
          <button key={t.key} type="button" aria-pressed={filter[t.key]} onClick={() => setFilter({ ...filter, [t.key]: !filter[t.key] })}
            className="life-tile flex flex-col items-center gap-0.5 rounded-md border-2 border-edge bg-surface px-1 pb-1 pt-1.5 text-center shadow-[2px_2px_0_var(--color-edge)]">
            <span className="flex h-[22px] items-end">{t.glyph}</span>
            <span className="life-tile-name text-[11.5px] font-bold leading-tight text-ink">{t.name}</span>
            <span className="text-[9.5px] leading-tight text-muted">{t.sub}</span>
            <span className="mt-0.5 rounded-[3px] bg-ink px-1.5 font-mono text-[10.5px] font-bold text-surface">{t.n}</span>
          </button>
        ))}
      </div>

      {filter.permanent && perm.length > 0 && (
        <>
          <h5 className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2"><i className="lg-flag scale-75" />Planted by {y}</h5>
          <ul className="mb-2.5 space-y-1">{perm.slice().sort((a, b) => b.year - a.year).map(row)}</ul>
        </>
      )}
      {filter.temporary && (
        <>
          <h5 className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2"><i className="lg-balloon scale-75" />Popping up in {y}</h5>
          {temp.length > 0
            ? <ul className="mb-2.5 space-y-1">{temp.map(row)}</ul>
            : <p className="mb-2.5 text-[11.5px] text-muted">No pop-ups on the timeline this year.</p>}
        </>
      )}
      {offMap.length > 0 && (
        <p className="mb-2 text-[11px] leading-snug text-muted">
          <b className="text-ink-2">Not on the map, location not published:</b> {offMap.map((t) => t.name).join(', ')}.
        </p>
      )}

      <div className="border-t border-line pt-2 text-[11px] text-ink-2">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">What kind of life</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {Object.entries(life.categories).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1 rounded-full border-[1.5px] border-edge bg-surface py-px pl-px pr-2">
              <i className="lg-token h-[15px] w-[15px]" style={vars(c.colour)}><Icon k={k} size={9} stroke={2.8} /></i>{c.label}
            </span>
          ))}
        </div>
        {filter.amenities && (
          <>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Amenity tokens within {AMENITY_RADIUS} m</div>
            <div className="mb-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
              {Object.entries(AMENITY_TYPES).filter(([k]) => amenCount[k]).sort((a, b) => (amenCount[b[0]] ?? 0) - (amenCount[a[0]] ?? 0)).map(([k, a]) => (
                <span key={k} className="flex min-w-0 items-center gap-1">
                  <i className="lg-token" style={vars(a.colour)}><Icon k={k} size={9} stroke={2.8} /></i>
                  <span className="truncate">{a.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted">{amenCount[k]}</span>
                </span>
              ))}
            </div>
          </>
        )}
        <p className="mt-1.5 leading-snug text-muted">
          Timeline: AMF's Marievik plan 2024–2030 (categories inferred). Places: AMF event pages, OpenStreetMap; amenities from OpenStreetMap (hover a token for its name).
        </p>
      </div>
    </Card>
  )
}
