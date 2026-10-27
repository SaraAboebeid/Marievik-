import { Card, Slider } from './kit'
import { AMENITY_TYPES, activeIn, type UrbanLife } from '../urbanLife'

export interface LifeFilter { year: number; permanent: boolean; temporary: boolean; amenities: boolean }
export const LIFE_YEARS = [2024, 2030] as const

const chip = (on: boolean) =>
  `rounded-md border-2 border-edge px-2 py-0.5 text-[12px] font-semibold ${on ? 'bg-coral text-[#202020] shadow-[2px_2px_0_var(--color-edge)]' : 'bg-surface text-ink-2'}`

/** Urban scale: AMF's events and activities on Marievik, scrubbed year by year, and the amenities around it. */
export function LifePanel({ life, filter, setFilter }: { life: UrbanLife | null; filter: LifeFilter; setFilter: (f: LifeFilter) => void }) {
  if (!life) return <Card title="Life on Marievik">Loading…</Card>
  const now = life.timeline.filter((t) => activeIn(t, filter.year) && (t.kind === 'permanent' ? filter.permanent : filter.temporary))
  const onMap = now.filter((t) => t.x !== null)
  const offMap = now.filter((t) => t.x === null)
  const cat = (c: string) => life.categories[c] ?? { label: c, colour: '#9a978e' }
  return (
    <Card title="Life on Marievik" right={<span className="font-mono text-[12px] font-bold text-ink">{filter.year}</span>}>
      <Slider value={filter.year} min={LIFE_YEARS[0]} max={LIFE_YEARS[1]} step={1} onChange={(y) => setFilter({ ...filter, year: y })} />
      <div className="mb-2.5 flex justify-between font-mono text-[10px] text-muted"><span>{LIFE_YEARS[0]}</span><span>{LIFE_YEARS[1]}</span></div>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        <button type="button" className={chip(filter.permanent)} onClick={() => setFilter({ ...filter, permanent: !filter.permanent })}>Permanent</button>
        <button type="button" className={chip(filter.temporary)} onClick={() => setFilter({ ...filter, temporary: !filter.temporary })}>Temporary</button>
        <button type="button" className={chip(filter.amenities)} onClick={() => setFilter({ ...filter, amenities: !filter.amenities })}>Amenities today</button>
      </div>

      <ul className="space-y-1.5">
        {onMap.map((t) => (
          <li key={t.id} className="grid grid-cols-[0.8rem_minmax(0,1fr)_auto] items-start gap-2 text-[12px]" title={t.note}>
            <i className="mt-1 inline-block h-2.5 w-2.5 rounded-full border border-edge" style={{ background: cat(t.category).colour }} />
            <span className="min-w-0">
              <b className="font-semibold">{t.name}</b>
              <span className="block text-[11px] text-muted">{cat(t.category).label} · {t.place}{t.confidence === 'approx' ? ' (approximate)' : ''}</span>
            </span>
            <span className="font-mono text-[11px] text-ink-2">{t.kind === 'permanent' ? `from ${t.year}` : t.year}</span>
          </li>
        ))}
      </ul>
      {offMap.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          <b className="text-ink-2">Not on the map, location not published:</b> {offMap.map((t) => t.name).join(', ')}.
        </p>
      )}

      <div className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-2">
        <div className="mb-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
          {Object.entries(life.categories).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border border-edge" style={{ background: c.colour }} />{c.label}</span>
          ))}
        </div>
        <p className="text-muted">Solid sticker: permanent · dashed: temporary.</p>
        {filter.amenities && (
          <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
            {Object.entries(AMENITY_TYPES).map(([k, a]) => (
              <span key={k} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full border border-edge" style={{ background: a.colour }} />{a.label}</span>
            ))}
          </div>
        )}
        <p className="mt-1.5 leading-snug text-muted">
          Timeline: AMF's Marievik plan 2024–2030 (categories inferred). Places: AMF event pages, OpenStreetMap; amenities from OpenStreetMap (hover a dot for its name).
        </p>
      </div>
    </Card>
  )
}
