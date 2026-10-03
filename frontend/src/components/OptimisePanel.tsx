import { useEffect, useRef, useState } from 'react'
import { getJob, startOptimise } from '../api'
import type { Bootstrap, Job, OptionResult } from '../types'
import { MiniPlan } from './PlanCanvas'
import { CRIT_COLOR, CRIT_SHORT, fmtCrit } from './ParamPanel'

interface Props {
  boot: Bootstrap
  shellId: string
  onOpen: (option: OptionResult) => void
  /** Kept by the parent so a finished run survives switching tabs. */
  job: Job | null
  setJob: (j: Job | null) => void
}

const WORDS: Record<string, string> = {
  existing: 'existing glazing', upgraded: 'new glazing', lowered: 'new glazing, low sill',
  conventional: 'stud walls', demountable: 'demountable walls', demountable_glass: 'glazed walls',
  movable: 'movable walls', standard: 'new products', circular: 'second-hand', durable: 'premium',
  mixed: 'mixed products',
}

export function OptimisePanel({ boot, shellId, onOpen, job, setJob }: Props) {
  const [uses, setUses] = useState<string[]>(boot.briefs.map((b) => b.id))
  const [quick, setQuick] = useState(true)
  const [tab, setTab] = useState<string | null>(null)
  const [error, setError] = useState('')
  const poll = useRef<number | null>(null)

  useEffect(() => () => { if (poll.current) window.clearInterval(poll.current) }, [])

  async function start() {
    setError('')
    try {
      const { job: id } = await startOptimise(shellId, uses, quick)
      let log: string[] = []
      setJob({ id, status: 'running', log, log_length: 0, elapsed_s: 0 })
      poll.current = window.setInterval(async () => {
        try {
          const j = await getJob(id, log.length)
          log = [...log, ...j.log]
          setJob({ ...j, log })
          if (j.status !== 'running') {
            window.clearInterval(poll.current!)
            poll.current = null
            if (j.result) setTab(Object.keys(j.result.uses)[0] ?? null)
          }
        } catch (e) {
          setError((e as Error).message)
        }
      }, 1500)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const running = job?.status === 'running'
  const result = job?.result
  const shown = tab && result?.uses[tab]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-snug text-muted">
        Generates walls, doors and furniture for each use on this flat, tests every window, wall and
        product choice, simulates comfort in EnergyPlus and keeps ten options per use. The
        recommended one has the least regret across five stakeholder views. Open any option to keep
        editing it.
      </p>
      <fieldset className="rounded-md border border-line bg-raised px-3 py-2" disabled={running}>
        <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Uses</legend>
        {boot.briefs.map((b) => (
          <label key={b.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px]">
            <input id={`use-${b.id}`} type="checkbox" checked={uses.includes(b.id)}
              onChange={(e) => setUses(e.target.checked ? [...uses, b.id] : uses.filter((u) => u !== b.id))} />
            {b.label}
            <span className="ml-auto font-mono text-[10.5px] text-muted">
              {b.densities.map((d) => d.occupants).join('/')} ppl
            </span>
          </label>
        ))}
        <label className="mt-1.5 flex cursor-pointer items-center gap-2 border-t border-line pt-1.5 text-[12px] text-ink-2">
          <input id="opt-quick" type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />
          Quick search (about 1–3 min). Off: the full search, about 5–10 min.
        </label>
      </fieldset>
      <button type="button" disabled={running || !uses.length} onClick={start}
        className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-45">
        {running ? `Optimising… ${job?.elapsed_s ?? 0} s` : 'Run optimiser on this flat'}
      </button>
      {error && <p className="text-[12px] text-critical">{error}</p>}

      {job && (
        <pre className="max-h-[140px] overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-[10.5px] leading-snug text-ink-2">
          {job.log.filter((l) => !l.includes('furnished')).slice(-14).join('\n') || 'starting…'}
          {job.status === 'failed' && '\n\nThe run failed. The log above says where.'}
        </pre>
      )}

      {result && (
        <>
          <div className="flex flex-wrap gap-1">
            {Object.entries(result.uses).map(([u, v]) => (
              <button key={u} type="button" onClick={() => setTab(u)}
                className={`rounded border px-2 py-1 text-[12px] ${tab === u
                  ? 'border-accent bg-accent text-white' : 'border-line-strong bg-raised text-ink-2 hover:border-accent'}`}>
                {v.brief.label} <span className="font-mono text-[10px] opacity-75">{v.options.length}</span>
              </button>
            ))}
          </div>
          {job?.report && (
            <p className="text-[11px] text-muted">Full report saved to <span className="font-mono">{job.report}</span></p>
          )}
          {shown && !shown.options.length && (
            <p className="text-[12px] text-muted">No layout for this use fits the flat with every room reachable and the furniture usable.</p>
          )}
          {shown && result.adaptability?.by_start_use[tab!] && (
            <p className="rounded-md bg-accent-soft px-2.5 py-1.5 text-[11.5px] leading-snug">
              <b>If the use may change later:</b>{' '}
              {result.adaptability.candidates[tab!]?.[result.adaptability.by_start_use[tab!].robust]?.description}
              {' with '}
              {WORDS[result.adaptability.candidates[tab!]?.[result.adaptability.by_start_use[tab!].robust]?.partition ?? '']}
              {' '}is the start you would regret least.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {shown && shown.options.map((o, i) => {
              const rec = o.id === shown.recommended
              return (
                <button key={o.id} type="button" onClick={() => onOpen(o)}
                  className={`flex flex-col gap-1.5 rounded-md border bg-raised p-2 text-left hover:border-accent ${
                    rec ? 'border-2 border-accent' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-1">
                    <b className="text-[12.5px]">Option {i + 1}</b>
                    {rec && <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[9.5px] text-accent">least regret</span>}
                  </div>
                  <MiniPlan plan={o.plan} boot={boot} />
                  <span className="text-[11px] leading-snug">{o.description}</span>
                  <span className="font-mono text-[10px] text-muted">
                    {WORDS[o.window]} · {WORDS[o.partition]} · {WORDS[o.products]}
                  </span>
                  <div className="grid grid-cols-5 gap-1">
                    {(['lcc', 'carbon', 'comfort', 'usability', 'functionality'] as const).map((k) => (
                      <div key={k} className="flex flex-col">
                        <span className="font-mono text-[8.5px] uppercase text-muted" style={{ color: CRIT_COLOR[k] }}>
                          {CRIT_SHORT[k].split(' ')[0]}
                        </span>
                        <span className="font-mono text-[10.5px] tabular-nums">
                          {fmtCrit(k, k === 'lcc' ? o.lcc_per_person : k === 'carbon' ? o.carbon_per_person : o[k])}
                        </span>
                      </div>
                    ))}
                  </div>
                  <span className="text-[10.5px] text-accent">Open in editor →</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
