import { useEffect, useRef, useState } from 'react'
import { activeIn, type LifeItem, type UrbanLife } from '../urbanLife'
import { inkOn } from '../lifeIcons'
import { Icon, LIFE_YEARS, LIFE_YEAR_LIST, vars, type LifeFilter } from './LifePanel'

/** Urban scale, bottom of the screen: the decade 2024–2030 as a row of years to play through. Each year shows
 *  everything active then (squares: planted and staying, dashed circles: one year only) and names what starts
 *  that year; the map's flags and balloons follow the year picked here (filter.year, shared with LifePanel). */
export function LifeDecade({ life, filter, setFilter, onClose }: {
  life: UrbanLife; filter: LifeFilter; setFilter: (f: LifeFilter) => void; onClose: () => void
}) {
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

  const y = filter.year
  const cat = (c: string) => life.categories[c] ?? { label: c, colour: '#9a978e' }
  const play = () => {
    if (playing) { setPlaying(false); return }
    if (y >= LIFE_YEARS[1]) setFilter({ ...filter, year: LIFE_YEARS[0] })
    setPlaying(true)
  }
  const shown = (t: LifeItem) => (t.kind === 'permanent' ? filter.permanent : filter.temporary)

  return (
    <div className="pointer-events-auto w-full rounded-xl border-2 border-edge bg-raised shadow-[3px_3px_0_var(--color-edge)]">
      <div className="checker-band flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-1.5">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">Life on Marievik · the decade {LIFE_YEARS[0]}–{LIFE_YEARS[1]}</h4>
        <span className="flex items-center gap-1.5">
          <span className="rounded-[4px] border-2 border-edge bg-surface px-1.5 font-mono text-[12px] font-bold">{y}</span>
          <button type="button" onClick={() => { setPlaying(false); onClose() }} aria-label="Close the decade" title="Close"
            className="grid h-6 w-6 place-items-center rounded-full border-2 border-edge bg-surface text-[14px] font-bold leading-none text-ink shadow-[2px_2px_0_var(--color-edge)] hover:bg-coral">
            ×
          </button>
        </span>
      </div>
      <div className="flex items-stretch gap-2.5 px-3.5 py-2.5">
        <div className="flex shrink-0 flex-col justify-between gap-2">
          <button type="button" onClick={play} aria-pressed={playing} title={playing ? 'Pause' : 'Play the years'}
            className={`rounded-md border-2 border-edge px-2.5 py-1 font-mono text-[12px] font-bold shadow-[2px_2px_0_var(--color-edge)] ${playing ? 'bg-accent text-white' : 'bg-coral text-[#202020]'}`}>
            {playing ? '❚❚ pause' : '▶ play'}
          </button>
          <div className="space-y-1 text-[10.5px] text-ink-2">
            <span className="flex items-center gap-1.5"><i className="inline-block h-[7px] w-[7px] border border-[#202020] bg-[#9a978e]" />planted, stays</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-[7px] w-[7px] rounded-full border border-dashed border-[#202020] bg-[#9a978e]" />one year only</span>
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-1.5" role="radiogroup" aria-label="Year">
          {LIFE_YEAR_LIST.map((yr) => {
            const active = life.timeline.filter((t) => activeIn(t, yr))
            const starts = life.timeline.filter((t) => t.year === yr && shown(t))
            const on = yr === y
            return (
              <button key={yr} type="button" role="radio" aria-checked={on} onClick={() => { setPlaying(false); setFilter({ ...filter, year: yr }) }}
                title={`${yr}: ${active.filter((t) => t.kind === 'permanent').length} permanent, ${active.filter((t) => t.kind === 'temporary').length} temporary`}
                className={`life-col flex min-w-0 flex-col items-stretch rounded-md border-2 border-edge text-left ${on ? 'bg-coral shadow-[2px_2px_0_var(--color-edge)]' : 'bg-sunken hover:bg-surface'}`}>
                <span className={`flex items-baseline justify-between border-b-2 border-edge px-1.5 py-0.5 font-mono text-[12px] font-bold ${on ? 'text-[#202020]' : 'text-ink'}`}>
                  {yr}<span className="text-[9.5px] font-normal">{active.length} active</span>
                </span>
                <span className="flex min-h-[18px] flex-wrap content-start gap-[2px] px-1.5 pt-1">
                  {active.map((t) => (
                    <i key={t.id} className={`${t.kind === 'permanent' ? 'cell-p' : 'cell-t'} ${shown(t) ? '' : 'opacity-25'}`} style={vars(cat(t.category).colour)} />
                  ))}
                </span>
                <span className="flex min-w-0 flex-col gap-[3px] px-1.5 pb-1.5 pt-1">
                  {starts.slice(0, 4).map((t) => (
                    <span key={t.id} title={`${t.name} · ${t.kind === 'permanent' ? 'starts, stays' : 'this year only'}`}
                      className={`flex min-w-0 items-center gap-1 rounded-[3px] bg-surface py-px pl-px pr-1 text-[10.5px] leading-tight text-ink ${
                        t.kind === 'permanent' ? 'border-[1.5px] border-edge' : 'border-[1.5px] border-dashed border-edge'}`}>
                      <i className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[2px]" style={{ background: cat(t.category).colour, color: inkOn(cat(t.category).colour) }}>
                        <Icon k={t.category} size={8} stroke={2.6} />
                      </i>
                      <span className="truncate">{t.name}</span>
                    </span>
                  ))}
                  {starts.length > 4 && <span className="text-[10px] text-ink-2">+{starts.length - 4} more</span>}
                  {!starts.length && <span className="text-[10px] italic text-muted">nothing new</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
