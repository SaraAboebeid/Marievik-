import type { Bootstrap, OptionResult, ScenarioState, SweepFrame } from '../types'
import { MiniPlan } from './PlanCanvas'
import { CRIT_COLOR, CRIT_SHORT, fmtCrit } from './ParamPanel'

const KEYS = ['lcc', 'carbon', 'comfort', 'usability', 'functionality'] as const

const WORDS: Record<string, string> = {
  existing: 'existing glazing', upgraded: 'new glazing', lowered: 'new glazing, low sill',
  conventional: 'stud walls', demountable: 'demountable walls', demountable_glass: 'glazed walls',
  movable: 'movable walls', standard: 'new products', circular: 'second-hand', durable: 'premium',
  mixed: 'mixed products',
}

export function optionValue(o: OptionResult, k: (typeof KEYS)[number]) {
  return k === 'lcc' ? o.lcc_per_person : k === 'carbon' ? o.carbon_per_person : o[k]
}

/** The least-regret option of every use that has one, in brief order. */
export function bestPerUse(state: ScenarioState | null): { use: string; label: string; option: OptionResult }[] {
  const r = state?.result
  if (!r) return []
  return Object.entries(r.uses)
    .map(([use, u]) => ({ use, label: u.brief.label, option: u.options.find((o) => o.id === u.recommended) }))
    .filter((x): x is { use: string; label: string; option: OptionResult } => !!x.option)
}

export function frameFor(label: string, o: OptionResult, shellId: string, years: number): SweepFrame {
  return {
    value: label,
    plan: o.plan,
    settings: { use: o.use, user_group: o.user_group, occupants: o.occupants, years, shell_id: shellId },
    criteria: {
      lcc: o.lcc_per_person, carbon: o.carbon_per_person, comfort: o.comfort,
      usability: o.usability, functionality: o.functionality,
    },
    thermal: o.thermal ? { ...o.thermal, ok: true } : undefined,
  }
}

interface Props {
  boot: Bootstrap
  state: ScenarioState | null
  playing: boolean
  current: string | null
  onPlay: () => void
  onStop: () => void
  onShow: (use: string, option: OptionResult) => void
  onOpen: (option: OptionResult) => void
  onRefresh: () => void
}

export function ScenariosPanel({ boot, state, playing, current, onPlay, onStop, onShow, onOpen, onRefresh }: Props) {
  if (!state || state.status === 'running') {
    return (
      <div className="flex flex-col gap-2">
        <b className="text-[13px]">Working out the best layout for every use…</b>
        <p className="text-[12px] leading-snug text-muted">
          The engine is drawing walls and doors for student, senior, office and family use on this
          flat, furnishing each one, testing windows, walls and products, and simulating comfort in
          EnergyPlus. The first time takes a couple of minutes; after that it opens instantly.
          {state ? ` ${state.elapsed_s} s so far.` : ''}
        </p>
        <pre className="max-h-[160px] overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-[10.5px] leading-snug text-ink-2">
          {state?.log.join('\n') || 'starting…'}
        </pre>
      </div>
    )
  }
  if (state.status === 'failed') {
    return (
      <div className="flex flex-col gap-2">
        <b className="text-[13px] text-critical">Working out the scenarios failed.</b>
        <pre className="max-h-[200px] overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-[10.5px]">
          {state.log.join('\n')}
        </pre>
        <button type="button" onClick={onRefresh}
          className="rounded border border-line-strong bg-raised px-2 py-1 text-[12px] hover:border-accent">Try again</button>
      </div>
    )
  }

  const best = bestPerUse(state)
  const missing = Object.entries(state.result!.uses).filter(([, u]) => !u.options.length).map(([, u]) => u.brief.label)
  const bestCol = Object.fromEntries(KEYS.map((k) => {
    const vals = best.map((b) => optionValue(b.option, k))
    const better = k === 'lcc' || k === 'carbon' ? Math.min(...vals) : Math.max(...vals)
    return [k, better]
  }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={playing ? onStop : onPlay}
          className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
          {playing ? '■ Stop' : '▶ Play through all uses'}
        </button>
        <span className="text-[11.5px] text-muted">
          {playing ? 'The plan changes every few seconds.' : 'Click a use to show it on the plan.'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-raised">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-left font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted">
              <th className="px-2 py-1.5 font-normal">Use</th>
              <th className="px-1 py-1.5 text-right font-normal">ppl</th>
              {KEYS.map((k) => (
                <th key={k} className="px-1 py-1.5 text-right font-normal" style={{ color: CRIT_COLOR[k] }}>
                  {CRIT_SHORT[k].replace(' / person', '/p')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {best.map(({ use, label, option: o }) => (
              <tr key={use} onClick={() => onShow(use, o)}
                className={`cursor-pointer border-t border-line hover:bg-accent-soft ${current === use ? 'bg-accent-soft font-semibold' : ''}`}>
                <td className="px-2 py-1.5">{label}</td>
                <td className="px-1 text-right font-mono tabular-nums">{o.occupants}</td>
                {KEYS.map((k) => {
                  const v = optionValue(o, k)
                  return (
                    <td key={k} className={`px-1 text-right font-mono tabular-nums ${v === bestCol[k] ? 'text-good underline underline-offset-2' : ''}`}>
                      {fmtCrit(k, v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Each row is that use's least-regret layout of ten generated. Cost and carbon are per person
        over 50 years. Underlined: best across uses.
        {missing.length ? ` No workable layout for: ${missing.join(', ')} (too small for the brief).` : ''}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {best.map(({ use, label, option: o }) => (
          <div key={use}
            className={`flex flex-col gap-1.5 rounded-md border bg-raised p-2 ${current === use ? 'border-2 border-accent' : 'border-line'}`}>
            <button type="button" className="flex flex-col gap-1.5 text-left" onClick={() => onShow(use, o)}>
              <b className="text-[12.5px]">{label}</b>
              <MiniPlan plan={o.plan} boot={boot} />
              <span className="text-[11px] leading-snug">{o.description}</span>
              <span className="font-mono text-[10px] text-muted">
                {WORDS[o.window]} · {WORDS[o.partition]} · {WORDS[o.products]}
              </span>
            </button>
            <button type="button" onClick={() => onOpen(o)} className="text-left text-[11px] text-accent hover:underline">
              Open in editor →
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={onRefresh} className="self-start text-[11px] text-muted underline-offset-2 hover:underline">
        Recompute scenarios (after changing data)
      </button>
    </div>
  )
}
