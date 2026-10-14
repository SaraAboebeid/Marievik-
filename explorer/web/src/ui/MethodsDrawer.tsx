import { useEffect, useRef, useState } from 'react'
import { fmt, fmt1 } from '../api'
import type { KpiResult, Methods } from '../types'
import { Badge, Toggle } from './kit'
import { STATUS_TAG } from './ProfileKpis'

type Tab = 'equations' | 'scenarios' | 'data'

interface Props {
  methods: Methods
  profile: string | null
  focus: string                 // KPI id to scroll to, or ''
  result: KpiResult | null      // values for the open building, if any
  onClose: () => void
}

/** Equations, definitions, scenarios and the databases every figure comes from. */
export function MethodsDrawer({ methods, profile, focus, result, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('equations')
  const [onlyProfile, setOnlyProfile] = useState(!!profile && !focus)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    if (!focus) return
    setTab('equations')
    requestAnimationFrame(() => box.current?.querySelector(`[data-kpi="${focus}"]`)?.scrollIntoView({ block: 'start' }))
  }, [focus])

  const prof = profile ? methods.profiles[profile] : null
  const ids = Object.keys(methods.kpis).filter((k) => !onlyProfile || !prof || prof.kpis.includes(k))
  const groups = [...new Set(ids.map((k) => methods.kpis[k].group))]

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-ink/25 p-4 pt-14" onClick={onClose}>
      <div className="flex max-h-full w-[min(64rem,100%)] flex-col rounded-lg border border-line bg-raised shadow-xl" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Methods and data">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h3 className="mr-2 text-[14px] font-semibold">Methods & data</h3>
          {(['equations', 'scenarios', 'data'] as Tab[]).map((t) => (
            <Toggle key={t} on={tab === t} onChange={() => setTab(t)}
              label={{ equations: 'KPI equations', scenarios: 'Scenarios S0–S4', data: 'Databases & numbers' }[t]} />
          ))}
          <button onClick={onClose} className="ml-auto font-mono text-[16px] text-muted hover:text-ink" aria-label="Close">×</button>
        </div>

        <div ref={box} className="overflow-y-auto px-4 py-3">
          {tab === 'equations' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                {prof && <Toggle on={onlyProfile} onChange={setOnlyProfile} label={`Only ${prof.name}`} />}
                <span className="text-muted">{methods.scenarios.symbols}</span>
              </div>
              {groups.map((g) => (
                <section key={g} className="mb-4">
                  <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-muted">{g}</h4>
                  <div className="grid gap-2 md:grid-cols-2">
                    {ids.filter((k) => methods.kpis[k].group === g).map((k) => {
                      const d = methods.kpis[k]
                      const v = result?.kpis[k]
                      return (
                        <article key={k} data-kpi={k}
                          className={`scroll-mt-2 rounded-md border bg-surface p-3 ${k === focus ? 'border-accent ring-2 ring-accent-soft' : 'border-line'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <h5 className="text-[13.5px] font-semibold">{d.name}</h5>
                            <span className="whitespace-nowrap font-mono text-[10px] text-muted">{d.scale}</span>
                          </div>
                          {d.formula
                            ? <pre className="my-1.5 whitespace-pre-wrap rounded bg-sunken px-2 py-1.5 font-mono text-[11.5px] leading-snug text-ink">{d.formula}</pre>
                            : <p className="my-1.5 rounded bg-warn-bg px-2 py-1.5 text-[11.5px] text-warn">Equation not defined yet.</p>}
                          <dl className="space-y-1 text-[11.5px] leading-snug">
                            {d.meaning && <Def k="Meaning / unit" v={d.meaning} />}
                            {d.definitions && <Def k="Definitions" v={d.definitions} />}
                            {d.status && <Def k="Method status" v={d.status} />}
                            {d.notes && <Def k="Notes" v={d.notes} />}
                            <Def k="In this explorer" v={d.explorer} />
                            <Def k="Source" v={d.source} />
                          </dl>
                          {v && (
                            <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-[12px]">
                              <span className="text-ink-2">{result?.building}: <span className="font-mono">{v.display}</span></span>
                              <Badge tone={STATUS_TAG[v.status].tone}>{STATUS_TAG[v.status].label}</Badge>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </>
          )}

          {tab === 'scenarios' && <Scenarios s={methods.scenarios} />}
          {tab === 'data' && <Data d={methods.data} />}
        </div>
      </div>
    </div>
  )
}

function Def({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-ink-2">{v}</dd>
    </div>
  )
}

const th = 'py-1 pr-3 text-left font-mono text-[9.5px] font-medium uppercase tracking-wide text-muted'
const td = 'py-1 pr-3 align-top'

function Scenarios({ s }: { s: Methods['scenarios'] }) {
  return (
    <div className="space-y-4 text-[12px]">
      <table className="w-full">
        <thead><tr><th className={th}>Scenario</th><th className={th}>Meaning</th><th className={th}>Property-value driver</th></tr></thead>
        <tbody>
          {s.scenarios.map((x) => (
            <tr key={x.id} className="border-t border-line">
              <td className={`${td} whitespace-nowrap font-medium`}>{x.id} — {x.name}</td><td className={td}>{x.meaning}</td>
              <td className={`${td} text-ink-2`}>{x.driver}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc space-y-1 pl-5 text-ink-2">{s.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      <div>
        <h4 className="mb-1 font-semibold">Worked example</h4>
        <p className="mb-1.5 text-muted">{s.example.note}</p>
        <table className="w-full">
          <thead><tr><th className={th}>Scenario</th>{s.example.columns.map((c) => <th key={c} className={`${th} text-right`}>{c}</th>)}</tr></thead>
          <tbody>
            {s.example.rows.map((r) => (
              <tr key={String(r[0])} className="border-t border-line">
                {r.map((c, i) => <td key={i} className={`${td} ${i ? 'text-right font-mono' : ''}`}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-2">{s.example.worked.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
    </div>
  )
}

function Data({ d }: { d: Methods['data'] }) {
  const sp = d.study_period
  const ph = Object.entries(d.placeholders).filter(([k, v]) => !k.startsWith('_') && k !== 'file' && typeof v === 'object') as
    [string, { value: number | string; unit: string; basis: string }][]
  return (
    <div className="space-y-5 text-[12px]">
      <section>
        <h4 className="mb-1 font-semibold">Study period and discounting <span className="font-mono text-[10.5px] font-normal text-muted">{sp.file}</span></h4>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-2">
          <span>Start year <b className="font-mono">{sp.start_year}</b></span>
          <span>Length <b className="font-mono">{sp.length_years} years</b></span>
          <span>Real discount rate <b className="font-mono">{fmt1(sp.discount_rate_real * 100)} %</b></span>
          <span>Carbon discounted <b className="font-mono">{sp.carbon_discounting ? 'yes' : 'no'}</b></span>
        </div>
        <p className="mt-1 text-[11px] text-muted">{sp.carbon_discounting_note}</p>
      </section>

      <section>
        <h4 className="mb-1 font-semibold">Placeholder assumptions <span className="font-mono text-[10.5px] font-normal text-muted">{String(d.placeholders.file)}</span></h4>
        <p className="mb-1.5 text-[11px] text-muted">Every KPI tagged “placeholder value” is built from these. Edit the file to change them; the tag stays until the KPI's method is implemented.</p>
        <table className="w-full">
          <thead><tr><th className={th}>Input</th><th className={`${th} text-right`}>Value</th><th className={th}>Unit</th><th className={th}>Basis</th></tr></thead>
          <tbody>
            {ph.map(([k, v]) => (
              <tr key={k} className="border-t border-line">
                <td className={`${td} font-mono text-[11px]`}>{k}</td>
                <td className={`${td} text-right font-mono`}>{typeof v.value === 'number' ? (Math.abs(v.value) >= 100 ? fmt(v.value) : v.value) : v.value}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{v.unit}</td>
                <td className={`${td} text-ink-2`}>{v.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="mb-1 font-semibold">Component catalogue <span className="font-mono text-[10.5px] font-normal text-muted">{d.catalogue.file} · v{d.catalogue.meta.version} · {d.catalogue.meta.updated}</span></h4>
        <p className="mb-1.5 text-[11px] text-muted">Cost in {d.catalogue.meta.currency} and carbon in {d.catalogue.meta.carbon_unit}. Transformation cost and upfront GWP are priced from this table.</p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Component</th><th className={th}>Layer</th><th className={th}>Unit</th>
                <th className={`${th} text-right`}>Material</th><th className={`${th} text-right`}>Install</th>
                <th className={`${th} text-right`}>A1–A3</th><th className={`${th} text-right`}>A4</th><th className={`${th} text-right`}>A5</th>
                <th className={`${th} text-right`}>C1–C4</th><th className={`${th} text-right`}>D</th>
                <th className={`${th} text-right`}>Life y</th><th className={`${th} text-right`}>Recovery</th><th className={th}>Data</th>
              </tr>
            </thead>
            <tbody>
              {d.catalogue.components.map((c) => {
                const ph2 = c.cost_sek.provenance === 'PLACEHOLDER' || c.carbon_kgco2e.provenance === 'PLACEHOLDER'
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className={td}><div>{c.name}</div><div className="font-mono text-[10px] text-muted">{c.id}</div></td>
                    <td className={`${td} text-ink-2`}>{c.layer}</td><td className={`${td} text-ink-2`}>{c.unit}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(c.cost_sek.material)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(c.cost_sek.labour_install)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt1(c.carbon_kgco2e.A1A3)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt1(c.carbon_kgco2e.A4)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt1(c.carbon_kgco2e.A5)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt1(c.carbon_kgco2e.C1C4)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt1(c.carbon_kgco2e.D)}</td>
                    <td className={`${td} text-right font-mono`}>{c.service_life_years}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(c.recovery_rate * 100)} %</td>
                    <td className={td}>{ph2 ? <Badge tone="warn">placeholder</Badge> : <Badge tone="good">sourced</Badge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
