import type { CSSProperties } from 'react'
import { Card } from './kit'
import { AMENITY_TYPES, type Amenity } from '../urbanLife'
import { inkOn, lifeIconSvg } from '../lifeIcons'

// Urban scale: what's within a short walk of Marievik. Rings at 5 and 10 minutes' walk from the site centre,
// as the crow flies (no street network yet), at a chosen walking pace; click a ring (or its row) for the list.

export const PACES: { id: string; label: string; mpm: number; note: string }[] = [
  { id: 'slow', label: 'Slow', mpm: 60, note: 'children, older people, with a pram' },
  { id: 'normal', label: 'Normal', mpm: 80, note: 'about 4.8 km/h' },
  { id: 'brisk', label: 'Brisk', mpm: 100, note: 'about 6 km/h' },
]
export const WALK_MINUTES = [5, 10]
export const WALK_COLOURS = ['#fd876e', '#0528ca']

export interface WalkState { on: boolean; pace: string; selected: number | null }
export const walkRadii = (pace: string) => WALK_MINUTES.map((m) => m * (PACES.find((p) => p.id === pace)?.mpm ?? 80))
export const bandOf = (d: number, radii: number[]) => radii.findIndex((r) => d <= r)

const vars = (c: string) => ({ '--c': c, '--on': inkOn(c) }) as CSSProperties
const Icon = ({ k }: { k: string }) => <span className="inline-grid place-items-center" dangerouslySetInnerHTML={{ __html: lifeIconSvg(k, 9, 2.8) }} />

export function WalkPanel({ amenities, center, walk, setWalk }: {
  amenities: Amenity[]; center: [number, number]; walk: WalkState; setWalk: (w: WalkState) => void
}) {
  const radii = walkRadii(walk.pace)
  const withD = amenities.map((a) => ({ a, d: Math.hypot(a.x - center[0], a.y - center[1]) }))
  const bands = radii.map((_, i) => withD.filter((x) => bandOf(x.d, radii) === i).sort((p, q) => p.d - q.d))
  const pace = PACES.find((p) => p.id === walk.pace) ?? PACES[1]
  const pick = (i: number) => setWalk({ ...walk, on: true, selected: walk.selected === i ? null : i })

  return (
    <Card title="Within a short walk" right={
      <button type="button" aria-pressed={walk.on} onClick={() => setWalk({ ...walk, on: !walk.on, selected: null })}
        className={`rounded-md border-2 border-edge px-2 py-px font-mono text-[10.5px] font-bold shadow-[2px_2px_0_var(--color-edge)] ${walk.on ? 'bg-accent text-white' : 'bg-surface text-[#202020]'}`}>
        {walk.on ? 'rings on' : 'show rings'}
      </button>
    }>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Pace</span>
        {PACES.map((p) => (
          <button key={p.id} type="button" title={p.note} aria-pressed={walk.pace === p.id} onClick={() => setWalk({ ...walk, on: true, pace: p.id })}
            className={`rounded-md border-2 border-edge px-1.5 py-px text-[11px] font-semibold ${walk.pace === p.id ? 'bg-coral text-[#202020] shadow-[2px_2px_0_var(--color-edge)]' : 'bg-surface'}`}>
            {p.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-muted">{pace.mpm} m/min</span>
      </div>

      <div className="space-y-1.5">
        {radii.map((r, i) => {
          const list = bands[i]
          const open = walk.selected === i
          const byType = Object.entries(list.reduce<Record<string, typeof list>>((acc, x) => { (acc[x.a.type] ??= []).push(x); return acc }, {}))
            .sort((p, q) => q[1].length - p[1].length)
          return (
            <div key={i} className={`overflow-hidden rounded-md border-2 border-edge ${open ? 'shadow-[3px_3px_0_var(--color-edge)]' : ''}`}>
              <button type="button" onClick={() => pick(i)} aria-expanded={open}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left" style={{ background: open ? WALK_COLOURS[i] : 'var(--color-surface)', color: open ? inkOn(WALK_COLOURS[i]) : undefined }}>
                <i className="inline-block h-3.5 w-3.5 flex-none rounded-full border-2 border-edge" style={{ background: WALK_COLOURS[i] }} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[12.5px] leading-tight">{i ? `${WALK_MINUTES[i - 1]}–${WALK_MINUTES[i]}` : `0–${WALK_MINUTES[i]}`} min walk</b>
                  <span className="block font-mono text-[10px] opacity-80">{i ? `${Math.round(radii[i - 1])}–` : 'up to '}{Math.round(r)} m</span>
                </span>
                <span className="rounded-[3px] bg-ink px-1.5 font-mono text-[11px] font-bold text-surface">{list.length}</span>
                <span className="font-mono text-[11px]">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="max-h-[22rem] overflow-y-auto border-t-2 border-edge bg-raised px-2 py-1.5">
                  {byType.length === 0 && <p className="text-[11.5px] text-muted">Nothing mapped in this ring.</p>}
                  {byType.map(([type, xs]) => {
                    const t = AMENITY_TYPES[type] ?? { label: type, colour: '#9a978e' }
                    return (
                      <div key={type} className="mb-1.5">
                        <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-bold">
                          <i className="lg-token" style={vars(t.colour)}><Icon k={type} /></i>{t.label}
                          <span className="font-mono text-[10px] font-normal text-muted">{xs.length}</span>
                        </div>
                        <ul className="ml-[22px] space-y-px">
                          {xs.map(({ a, d }) => (
                            <li key={`${a.name}${a.x}${a.y}`} className="flex items-baseline gap-2 text-[11.5px]" title={a.addr}>
                              <span className="min-w-0 flex-1 truncate">{a.name}</span>
                              <span className="font-mono text-[10px] text-muted">{Math.round(d)} m · {Math.max(1, Math.round(d / pace.mpm))} min</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-muted">
        Straight-line distance from the middle of the site, so real walks are a little longer. Amenities from OpenStreetMap (fetched 2026-10-27); gyms and saunas inside buildings aren't mapped. Click a ring on the map or a row here.
      </p>
    </Card>
  )
}
