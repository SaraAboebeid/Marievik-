import { useEffect, useState, type ReactNode } from 'react'
import { api, fmt, fmt1, SYSTEM_COLOR, SYSTEM_LABEL } from '../api'
import type { BuildingPayload, Settings, Supplier, SupplierCompare, SupplierSystemResult } from '../types'
import { Badge, Button, Toggle } from './kit'

interface Props {
  suppliers: Supplier[]
  building: BuildingPayload | null
  settings: Settings | null
  onApply: (system: string) => void
  onClose: () => void
}

/** Supplier product cards: the range, its data, and how it does in the open building against the generic systems. */
export function SupplierDrawer({ suppliers, building, settings, onApply, onClose }: Props) {
  const [sid, setSid] = useState(suppliers[0]?.id ?? '')
  const sup = suppliers.find((s) => s.id === sid) ?? suppliers[0]
  const [cmp, setCmp] = useState<SupplierCompare | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const bid = building?.id
  const skey = JSON.stringify({ ...settings, partition_system: undefined })
  useEffect(() => {
    if (!sup || !bid || !settings) { setCmp(null); return }
    let alive = true
    setBusy(true); setErr(null)
    api.supplierCompare(sup.id, bid, settings)
      .then((r) => { if (alive) setCmp(r) })
      .catch((e) => { if (alive) setErr((e as Error).message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [sup?.id, bid, skey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sup) {
    return (
      <Shell onClose={onClose} title="Suppliers">
        <p className="text-[13px] text-ink-2">No supplier data on this computer. Supplier files go in
          <code className="mx-1 font-mono text-[12px]">data/components/suppliers/</code>(see the README there).</p>
      </Shell>
    )
  }
  const using = settings?.partition_system === sup.system
  const verified = sup.products.filter((p) => !p.estimate).length

  return (
    <Shell onClose={onClose} title="Suppliers" tabs={suppliers.length > 1 ? (
      suppliers.map((s) => <Toggle key={s.id} on={s.id === sup.id} onChange={() => setSid(s.id)} label={s.title} />)
    ) : null}>
      {/* the product */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[44rem]">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-[18px] font-semibold tracking-tight">{sup.title}</h3>
            <span className="text-[13px] text-ink-2">{sup.supplier}</span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sup.product}</p>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink">
            {sup.strengths.map((s) => <li key={s} className="flex gap-1.5"><span className="text-good">+</span>{s}</li>)}
          </ul>
        </div>
        <div className="flex flex-col items-end gap-1 text-[11.5px] text-ink-2">
          <span>Data received {sup.received}</span>
          <div className="flex gap-1">
            <Badge tone={verified === sup.products.length ? 'good' : 'warn'}>{verified} of {sup.products.length} builds supplier-stated</Badge>
            {sup.confidential && <Badge tone="muted">prices confidential</Badge>}
          </div>
        </div>
      </div>

      {/* the range */}
      <h4 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">The range, per m² of wall</h4>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left font-mono text-[10.5px] uppercase tracking-wide text-ink-2">
              <th className="py-1 pr-3 font-medium">Build</th>
              <th className="py-1 pr-3 text-right font-medium">R'w dB</th>
              <th className="py-1 pr-3 font-medium">Fire</th>
              <th className="py-1 pr-3 text-right font-medium">mm</th>
              <th className="py-1 pr-3 text-right font-medium">SEK</th>
              <th className="py-1 pr-3 text-right font-medium">kg CO₂e A1–A5</th>
              <th className="py-1 pr-3 text-right font-medium">C1–C4</th>
              <th className="py-1 pr-3 text-right font-medium">Reusable</th>
              <th className="py-1 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {sup.products.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="py-1.5 pr-3">
                  <div className="leading-snug">{p.name.split(',')[0]}</div>
                  <div className="text-[11px] leading-snug text-muted">{p.name.split(',').slice(1).join(',').trim()}</div>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{p.Rw_dB}</td>
                <td className="py-1.5 pr-3 font-mono">{p.fire_class}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{p.thickness_mm}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt(p.capex_sek_m2)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt1(p.upfront_kgco2e_m2)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmt1(p.c1c4_kgco2e_m2)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums" title={`fixing: ${p.fixing}, reversibility ${p.reversibility}`}>{fmt(p.recovery_rate * 100)} %</td>
                <td className="py-1.5" title={`${p.cost_provenance}\n${p.carbon_provenance}`}>
                  <Badge tone={p.estimate ? 'warn' : 'good'}>{p.estimate ? 'our estimate' : 'supplier + EPD'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* in the open building */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">
          {building ? `In ${building.id} ${building.name.split(' - ')[0]}, same uses, three ways to build the walls` : 'In a building'}
        </h4>
        {building && (using
          ? <span className="flex items-center gap-2"><Badge tone="good">{building.id} uses {sup.title}</Badge>
              <Button onClick={() => onApply('conventional')}>Switch {building.id} back to conventional</Button></span>
          : <Button primary onClick={() => onApply(sup.system)}>Use {sup.title} in {building.id}</Button>)}
      </div>
      {!building && <p className="mb-4 text-[13px] text-ink-2">Open a building to see how {sup.title} compares there: the layout picks the
        cheapest build that meets each wall's sound and fire requirement.</p>}
      {building && busy && !cmp && <p className="mb-4 font-mono text-[12px] text-ink-2">Laying out {building.id} three ways…</p>}
      {err && <p className="mb-4 text-[12.5px] text-critical">{err}</p>}
      {building && cmp && <CompareTable cmp={cmp} system={sup.system} title={sup.title} />}

      {/* what is still open */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">Open questions to {sup.supplier.split(' ')[0]}</h4>
          <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-snug text-ink">
            {sup.open_questions.map((q) => <li key={q}>{q}</li>)}
          </ol>
        </div>
        <div>
          <h4 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">Sources</h4>
          <dl className="space-y-1 text-[12px] leading-snug">
            {Object.entries(sup.sources).map(([k, v]) => (
              <div key={k}><dt className="inline font-medium text-ink-2">{k.replace('_', ' ')}: </dt><dd className="inline text-ink">{v}</dd></div>
            ))}
          </dl>
        </div>
      </div>
    </Shell>
  )
}

function CompareTable({ cmp, system, title }: { cmp: SupplierCompare; system: string; title: string }) {
  const cols = cmp.systems
  const best = (get: (r: SupplierSystemResult) => number) => Math.min(...cols.map(get))
  const cell = (r: SupplierSystemResult, get: (r: SupplierSystemResult) => number, show: string) => (
    <span className={get(r) === best(get) ? 'font-semibold text-good' : ''}>{show}</span>
  )
  const rows: { label: string; sub?: string; get: (r: SupplierSystemResult) => ReactNode }[] = [
    { label: 'New walls', get: (r) => `${fmt(r.wall_area_m2)} m²` },
    { label: 'Wall cost', get: (r) => cell(r, (x) => x.walls_capex_sek, `${fmt1(r.walls_capex_sek / 1e6)} MSEK`) },
    { label: 'Wall carbon A1–A5', get: (r) => cell(r, (x) => x.walls_upfront_kgco2e, `${fmt(r.walls_upfront_kgco2e / 1000)} t`) },
    {
      label: 'Meets sound & fire', sub: 'indicative, per use',
      get: (r) => (r.sound_below_m2 === 0 && r.fire_below_m2 === 0
        ? <Badge tone="good">all walls</Badge>
        : <Badge tone="warn">{fmt(Math.max(r.sound_below_m2, r.fire_below_m2))} m² short</Badge>),
    },
    {
      label: 'Builds used', get: (r) => (
        <div className="space-y-0.5 text-left text-[11.5px] leading-snug">
          {r.builds.map((b) => <div key={b.type}><span className="text-ink-2">{fmt(b.area_m2)} m²</span> {b.name.split('(')[0].trim()}</div>)}
        </div>),
    },
    { label: 'Next change of use: strip-out', sub: 'demount labour', get: (r) => cell(r, (x) => x.strip_cost_sek, `${fmt1(r.strip_cost_sek / 1e6)} MSEK`) },
    { label: 'Recovered for reuse', get: (r) => `${fmt(r.recovered_m2)} m² · ${fmt(r.wall_area_m2 ? (r.recovered_m2 / r.wall_area_m2) * 100 : 0)} %` },
    { label: 'Waste carbon C1–C4', get: (r) => cell(r, (x) => x.strip_kgco2e, `${fmt1(r.strip_kgco2e / 1000)} t`) },
    { label: 'Data behind it', get: (r) => <Badge tone={r.placeholder_share > 0.5 ? 'warn' : 'good'}>{fmt(r.placeholder_share * 100)} % placeholder</Badge> },
  ]
  const tall = cols.find((r) => r.system === system)?.too_tall ?? []
  return (
    <div className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              <th className="py-1.5 pr-3" />
              {cols.map((r) => (
                <th key={r.system} className="py-1.5 pr-3 text-right font-semibold">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: SYSTEM_COLOR[r.system] }} />
                  {r.system === system ? title : SYSTEM_LABEL[r.system] ?? r.system}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 text-ink-2">{row.label}{row.sub && <div className="text-[11px] text-muted">{row.sub}</div>}</td>
                {cols.map((r) => <td key={r.system} className={`py-1.5 pr-3 text-right font-mono tabular-nums ${r.system === system ? 'bg-sunken/60' : ''}`}>{row.get(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-2">
        Bold green: best of the three. Walls only: the new partition, corridor, support and unit walls, not the retained facade and core.
        Strip-out uses each product's demount labour and recovery rate; what is not recovered carries its C1–C4.
        {tall.length > 0 && ` Walls on ${tall.flatMap((t) => t.floors).map((f) => `F${String(f).padStart(2, '0')}`).join(', ')} are taller than the ${tall[0].max_height_m} m studs.`}
      </p>
    </div>
  )
}

function Shell({ title, tabs, onClose, children }: { title: string; tabs?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-ink/25 p-4 pt-14" onClick={onClose}>
      <div className="flex max-h-full w-[min(68rem,100%)] flex-col rounded-lg border border-line bg-raised shadow-xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h3 className="mr-2 text-[14px] font-semibold">{title}</h3>
          {tabs}
          <button onClick={onClose} className="ml-auto font-mono text-[16px] text-muted hover:text-ink" aria-label="Close">×</button>
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  )
}
