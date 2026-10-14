import type { KpiResult, KpiStatus, Methods } from '../types'
import { Badge, Card } from './kit'

export const STATUS_TAG: Record<KpiStatus, { tone: 'good' | 'warn' | 'muted'; label: string; title: string }> = {
  computed: { tone: 'good', label: 'computed', title: 'Computed from this scenario by the engine' },
  partial: { tone: 'muted', label: 'partial', title: 'Computed, but part of the system boundary is not modelled yet' },
  placeholder: { tone: 'warn', label: 'placeholder value', title: 'Illustrative value from data/kpi/placeholders.json' },
}

interface Props {
  profile: string
  methods: Methods | null
  result: KpiResult | null
  building: string | null
  onExplain: (kpi: string) => void
}

/** The chosen profile's KPIs for the open building, each tagged with how it was obtained. */
export function ProfileKpis({ profile, methods, result, building, onExplain }: Props) {
  const p = methods?.profiles[profile]
  if (!methods || !p) return null
  const counts = { computed: 0, partial: 0, placeholder: 0 }
  if (result) p.kpis.forEach((k) => { const v = result.kpis[k]; if (v) counts[v.status]++ })
  return (
    <Card title={`${p.name} · KPIs`} right={<button onClick={() => onExplain('')} className="text-[11px] text-accent hover:underline">equations</button>}>
      {p.provisional && <p className="mb-1.5 text-[10.5px] leading-snug text-muted">Provisional KPI set for this profile, until it is defined.</p>}
      {!building ? (
        <>
          <p className="mb-1.5 text-[11.5px] leading-snug text-ink-2">Open a building to see these KPIs for its current scenario.</p>
          <ul className="flex flex-wrap gap-1">
            {p.kpis.map((k) => (
              <li key={k}>
                <button onClick={() => onExplain(k)} className="rounded border border-line bg-surface px-1.5 py-[1px] text-[11px] text-ink-2 hover:border-line-strong">
                  {methods.kpis[k]?.name ?? k}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : !result || result.building !== building ? (
        <p className="text-[12px] text-muted">Calculating…</p>
      ) : (
        <>
          <ul>
            {p.kpis.map((k) => {
              const v = result.kpis[k]
              const d = methods.kpis[k]
              if (!v || !d) return null
              const tag = STATUS_TAG[v.status]
              return (
                <li key={k} className="border-t border-line py-1 first:border-t-0">
                  <div className="flex items-baseline justify-between gap-2.5 text-[12.5px]">
                    <button onClick={() => onExplain(k)} className="min-w-0 truncate text-left hover:text-accent hover:underline" title="Show the equation">
                      {d.name}
                    </button>
                    <span className="whitespace-nowrap font-mono tabular-nums">{v.display}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[10.5px] text-muted" title={v.note}>{v.note}</span>
                    <span title={tag.title}><Badge tone={tag.tone}>{tag.label}</Badge></span>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 border-t border-line pt-1.5 text-[10.5px] leading-snug text-muted">
            {counts.computed} computed · {counts.partial} partial · {counts.placeholder} placeholder values. Click a KPI for its
            equation and data.
          </p>
        </>
      )}
    </Card>
  )
}
