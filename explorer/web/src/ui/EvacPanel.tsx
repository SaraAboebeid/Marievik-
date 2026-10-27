import { Badge, Section, Slider, Stat, StatGrid } from './kit'
import type { EvacResult } from '../layers'

const mmss = (s: number | null) => (s === null ? '–' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

/** Fire escape: a JuPedSim evacuation of the floor as laid out, played back on the plan. */
export function EvacPanel({ res, busy, error, onRun, playing, onPlay, t, setT, density, setDensity }: {
  res: EvacResult | null; busy: boolean; error: string | null; onRun: () => void
  playing: boolean; onPlay: () => void; t: number; setT: (t: number) => void; density: boolean; setDensity: (v: boolean) => void
}) {
  const end = res ? res.frames.n * res.frames.dt : 0
  return (
    <Section id="studio-evac" title="Evacuation (JuPedSim)" right={<Badge tone="warn">{busy ? 'simulating…' : 'mock-up plan'}</Badge>}>
      <p className="mb-2 text-[12px] leading-snug text-ink-2">
        Everyone planned for this floor starts in a seat, waits for the alarm (30–90 s), then walks to the nearest exit door, around walls and
        furniture, queueing at the doors. Pedestrian dynamics by JuPedSim; a hand calculation is given beside it.
      </p>
      <button type="button" onClick={onRun} disabled={busy}
        className="mb-2 w-full rounded-md border-2 border-edge bg-coral px-2 py-1 text-[12.5px] font-semibold text-[#202020] disabled:opacity-50">
        {busy ? 'Evacuating the floor… (a minute for a big crowd)' : res ? 'Run again with this layout' : 'Evacuate this floor'}
      </button>
      {error && <p className="mb-2 text-[12px] text-serious">{error}</p>}
      {res && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <button type="button" onClick={onPlay} className="rounded-md border-2 border-edge bg-surface px-2 py-0.5 text-[12px] font-semibold">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <div className="flex-1"><Slider value={Math.min(t, end)} min={0} max={end} step={0.5} onChange={setT} /></div>
            <span className="w-11 text-right font-mono text-[12px]">{mmss(t)}</span>
          </div>
          {t < 30 && (
            <p className="mb-2 flex items-center justify-between gap-2 rounded-md border-2 border-line bg-sunken px-2 py-1 text-[11.5px] text-ink-2">
              <span>Still waiting for the alarm — nobody moves before 0:30.</span>
              <button type="button" onClick={() => setT(30)} className="shrink-0 rounded border-2 border-edge bg-surface px-1.5 py-0.5 font-semibold">Skip to 0:30 →</button>
            </p>
          )}
          <button type="button" onClick={() => setDensity(!density)} aria-pressed={density}
            className={`mb-2.5 rounded-md border-2 border-edge px-2 py-0.5 text-[12px] font-semibold ${density ? 'bg-coral text-[#202020]' : 'bg-surface'}`}>Crowding on the floor</button>
          <StatGrid>
            <Stat label="everyone out (simulated)" value={mmss(res.total)} sub={`9 in 10 by ${mmss(res.p90)}`} />
            <Stat label="hand calculation" value={mmss(res.hand)} sub="slowest start + longest walk + door queue" />
            <Stat label="people" value={res.people} sub={res.stuck ? `${res.stuck} did not get out` : 'all reached an exit'} />
            <Stat label="densest crowd" value={res.heat.max.toLocaleString('sv-SE')} unit="per m²" sub={res.heat.max > 4 ? 'over 4: crush risk' : 'under 4 per m²'} />
          </StatGrid>
          <ul className="mt-2.5 space-y-1.5">
            <li className="flex items-start gap-2 text-[12.5px]">
              <Badge tone={res.stuck === 0 ? 'good' : 'serious'}>{res.stuck === 0 ? 'OK' : 'Check'}</Badge>
              <span>{res.stuck === 0 ? 'Everyone reached an exit' : `${res.stuck} people could not reach an exit`}</span>
            </li>
            <li className="flex items-start gap-2 text-[12.5px]">
              <Badge tone={res.heat.max <= 4 ? 'good' : 'serious'}>{res.heat.max <= 4 ? 'OK' : 'Check'}</Badge>
              <span>Crowding at the doors: at most {res.heat.max.toLocaleString('sv-SE')} people per m²</span>
            </li>
          </ul>
          <table className="mt-2.5 w-full text-[11.5px]">
            <thead><tr className="text-left font-mono text-[10px] uppercase text-muted"><th className="pb-1">Exit</th><th className="pb-1 text-right">People</th><th className="pb-1 text-right">Last out</th><th className="pb-1 text-right">Flow /m/s</th></tr></thead>
            <tbody>
              {res.exits.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-0.5">{e.id} <span className="text-muted">{e.w} m</span></td><td className="text-right tabular-nums">{e.people}</td>
                  <td className="text-right tabular-nums">{mmss(e.last)}</td><td className="text-right tabular-nums">{e.flow ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-muted">{res.note} {res.engine}; computed in {res.seconds} s.</p>
        </>
      )}
    </Section>
  )
}
