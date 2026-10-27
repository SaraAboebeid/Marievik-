import { useState } from 'react'
import { fmt, fmt1, msek, pct, tco2, USE_LABEL } from '../api'
import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, FloorPayload, Level, SiteBuilding, SitePayload, UnitComfort,
} from '../types'
import type { Method, Overlay } from '../App'
import { Badge, Button, Card, Row, Section, Stat, StatGrid, Toggle } from './kit'
import { DfHistogram, HotWeekChart } from './charts'

interface Props {
  site: SitePayload
  level: Level
  bdata: Record<string, BuildingPayload>
  totals: { gfa_m2: number; units: number; capex_sek: number; upfront_kgco2e: number; added_gfa_m2: number; loaded: number }
  floor: FloorPayload | null
  dl: DaylightResult | null
  cf: ComfortResult | null
  unitComfort: UnitComfort | null
  overlay: Overlay
  setOverlay: (o: Overlay) => void
  method: Method
  setMethod: (m: Method) => void
  caps: Capabilities | null
  busy: boolean
  onQuick: (w: 'daylight' | 'comfort') => void
  onFull: () => void
  onGo: (l: Level) => void
}

export function InfoPanel(p: Props) {
  const { level } = p
  if (level.kind === 'site') return <SiteInfo {...p} />
  const b = p.bdata[level.building]
  if (!b) return <Card title="Building"><p className="text-[12.5px] text-ink-2">Laying out…</p></Card>
  return (
    <>
      {level.kind === 'building' && <BuildingInfo key={b.id} b={b} site={p.site} bdata={p.bdata} onGo={p.onGo} />}
      {(level.kind === 'floor' || level.kind === 'unit') && p.floor && <FloorInfo {...p} b={b} />}
    </>
  )
}

const nf1 = (v: number) => fmt1(v)
export const useOf = (b: BuildingPayload, sb: SiteBuilding | undefined) => {
  const lab = (u: string) => (u === 'site' ? (sb?.current_use ?? 'current use') : (USE_LABEL[u] ?? u))
  const g = b.settings.ground_use, u = b.settings.use
  return g === u || g === 'same' ? lab(u) : `${lab(g)} ground floor, ${lab(u)} above`
}

/** Today's use of each building, as a colour (the same greens and pinks as the timeline and the donuts). */
export const USE_DOT: Record<string, string> = { office: '#b9d27a', residential: '#c46ba4', retail: '#c97855', hotel: '#dfa00c', school: '#8a72d8' }

function SiteInfo({ site, totals }: Props) {
  const done = totals.loaded === site.buildings.length
  return (
    <>
      <Card title="Site · current scenario" right={!done && <span className="font-mono text-[12px] text-ink-2">{totals.loaded}/{site.buildings.length} laid out</span>}>
        <StatGrid>
          <Stat label="Gross floor area" value={fmt(totals.gfa_m2)} unit="m²"
            sub={totals.added_gfa_m2 ? `${fmt(totals.added_gfa_m2)} m² added on top` : 'no floors added'} />
          <Stat label="Units" value={fmt(totals.units)} sub="apartments, offices, rooms…" />
          <Stat label="New fit-out cost" value={nf1(totals.capex_sek / 1e6)} unit="MSEK" />
          <Stat label="Upfront carbon A1–A5" value={fmt(totals.upfront_kgco2e / 1000)} unit="t CO₂e"
            sub={`${fmt1(totals.gfa_m2 ? totals.upfront_kgco2e / totals.gfa_m2 : 0)} kg/m²`} />
        </StatGrid>
        <p className="mt-2.5 text-[12.5px] leading-snug text-ink-2">
          Existing shells are retained (no new carbon). Prices and carbon come from the Marievik+ catalogue, mostly
          placeholder values until EPDs and tenders replace them.
        </p>
      </Card>
    </>
  )
}

/** The open building: what it is, its headline figures, and a side-by-side with any other building. */
function BuildingInfo({ b, site, bdata, onGo }: { b: BuildingPayload; site: SitePayload; bdata: Record<string, BuildingPayload>; onGo: (l: Level) => void }) {
  const k = b.kpi
  const sb = site.buildings.find((x) => x.id === b.id)
  const [other, setOther] = useState('')
  const o = other ? bdata[other] : null
  const osb = o ? site.buildings.find((x) => x.id === o.id) : undefined
  const rows: [string, (x: BuildingPayload, s?: SiteBuilding) => string][] = [
    ['Use', (x, s) => useOf(x, s)],
    ['Floors', (x) => `${x.kpi.floors}`],
    ['Gross floor area', (x) => `${fmt(x.kpi.gfa_m2)} m²`],
    ['Units', (x) => fmt(x.kpi.units)],
    ['New fit-out cost', (x) => msek(x.kpi.capex_sek)],
    ['Upfront carbon', (x) => tco2(x.kpi.upfront_kgco2e)],
    ['Carbon per m²', (x) => `${fmt1(x.kpi.upfront_kgco2e_per_m2)} kg`],
    ['Walls & slabs retained', (x) => pct(x.kpi.retained_share)],
  ]
  return (
    <>
      <Card title={`Selected building · ${b.id}`}>
        <h3 className="text-[16px] font-semibold leading-snug">{b.name}</h3>
        <p className="mb-2.5 text-[12.5px] text-ink-2">{useOf(b, sb)}</p>
        <StatGrid>
          <Stat label="Floors" value={k.floors} sub={k.added_floors ? `${k.existing_floors} existing + ${k.added_floors} added` : `${fmt1(k.height_m)} m high`} />
          <Stat label="Gross floor area" value={fmt(k.gfa_m2)} unit="m²" sub={`${fmt(k.units)} units`} />
          <Stat label="New fit-out cost" value={nf1(k.capex_sek / 1e6)} unit="MSEK" sub={`${fmt(k.capex_sek_per_m2)} SEK/m²`} />
          <Stat label="Upfront carbon" value={fmt(k.upfront_kgco2e / 1000)} unit="t CO₂e" sub={`${fmt1(k.upfront_kgco2e_per_m2)} kg/m²`} />
        </StatGrid>
        <div className="mt-3 border-t border-line pt-2.5">
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className="whitespace-nowrap">Compare with</span>
            <select value={other} onChange={(e) => setOther(e.target.value)}
              className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-[12.5px] text-ink outline-none focus:border-ink-2">
              <option value="">choose a building…</option>
              {site.buildings.filter((x) => x.id !== b.id).map((x) => (
                <option key={x.id} value={x.id} disabled={!bdata[x.id]}>{x.id} {x.name.split(' - ')[0]}</option>
              ))}
            </select>
          </label>
          {o && (
            <table className="mt-2 w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase tracking-wide text-ink-2">
                  <th className="pb-1 font-medium" /><th className="pb-1 pl-2 text-right font-medium">{b.id}</th>
                  <th className="pb-1 pl-2 text-right font-medium">
                    <button className="uppercase underline-offset-2 hover:underline" onClick={() => onGo({ kind: 'building', building: o.id })} title="Open this building">{o.id}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get]) => (
                  <tr key={label} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink-2">{label}</td>
                    <td className="py-1 pl-2 text-right font-mono">{get(b, sb)}</td>
                    <td className="py-1 pl-2 text-right font-mono">{get(o, osb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {k.blockers.length > 0 && (
        <Card title={`Blockers (${k.blockers.length})`}>
          <ul className="space-y-2">
            {k.blockers.map((x, i) => (
              <li key={i} className="text-[12.5px] leading-snug">
                <Badge tone={x.severity === 'high' ? 'critical' : 'serious'}>{x.kind}</Badge> {x.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Section id="b-layout" title="Layout details" defaultOpen={false}>
        <Row label="Height" value={`${fmt1(k.height_m)} m`} />
        <Row label="Units" value={fmt(k.units)} />
        {Object.entries(k.unit_types).sort((a, b) => b[1] - a[1]).map(([n, c]) => <Row key={n} label={n} value={c} sub />)}
        <Row label="Mean unit size" value={`${fmt1(k.unit_area_mean_m2)} m²`} />
        <Row label="Net to gross" value={pct(k.net_to_gross)} />
        <Row label="Window to floor ratio" value={pct(k.window_floor_ratio)} />
      </Section>
      <Section id="b-cost" title="Cost & carbon details" defaultOpen={false}>
        <Row label="New fit-out cost" value={msek(k.capex_sek)} />
        <Row label="per m² GFA" value={`${fmt(k.capex_sek_per_m2)} SEK`} sub />
        <Row label="Upfront carbon A1–A5" value={tco2(k.upfront_kgco2e)} />
        <Row label="per m² GFA" value={`${fmt1(k.upfront_kgco2e_per_m2)} kg CO₂e`} sub />
        {k.added_floors > 0 && (
          <>
            <Row label="Added floors: cost" value={msek(k.added_capex_sek)} sub />
            <Row label="Added floors: carbon" value={tco2(k.added_upfront_kgco2e)} sub />
          </>
        )}
        <Row label="End of life C1–C4" value={tco2(k.c1c4_kgco2e)} />
        <Row label="Module D (reported, not netted)" value={tco2(k.d_credit_kgco2e)} />
        <Row label="Walls & slabs retained" value={pct(k.retained_share)} />
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={k.placeholder_share > 0.5 ? 'warn' : 'good'}>{pct(k.placeholder_share)} placeholder data</Badge>
          {k.mock_priced_rows > 0 && <Badge tone="muted">{k.mock_priced_rows} mock-priced items</Badge>}
        </div>
      </Section>
      <WallsSection k={k} />
    </>
  )
}

/** New walls against the indicative sound (R'w) and fire requirements of their use. */
function WallsSection({ k }: { k: BuildingPayload['kpi'] }) {
  const w = k.walls
  if (!w) return null
  const ok = w.sound_below_m2 === 0 && w.fire_below_m2 === 0
  return (
    <Section id="b-walls" title="Walls vs requirements" defaultOpen={false}>
      <Row label="New walls checked" value={`${fmt(w.checked_m2)} m²`} />
      {w.unknown_m2 > 0 && <Row label="No performance data" value={`${fmt(w.unknown_m2)} m²`} sub />}
      <Row label="Below sound requirement" value={`${fmt(w.sound_below_m2)} m²`} />
      <Row label="Below fire requirement" value={`${fmt(w.fire_below_m2)} m²`} />
      {w.shortfalls.map((s) => (
        <Row key={`${s.use}${s.category}${s.type}`} sub label={`${USE_LABEL[s.use] ?? s.use}, ${s.category}`}
          value={`${fmt(s.area_m2)} m² · ${s.has} < ${s.required}`} />
      ))}
      {w.too_tall.map((t) => (
        <Row key={t.type} sub label={`${t.type} max ${fmt1(t.max_height_m)} m`}
          value={`${fmt1(t.wall_h)} m on ${t.floors.map((f) => `F${String(f).padStart(2, '0')}`).join(', ')}`} />
      ))}
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone={ok ? 'good' : 'warn'}>{ok ? 'all new walls meet their use' : 'requirements not met'}</Badge>
        <Badge tone="muted">indicative: SS 25267/25268 class C, Br1</Badge>
      </div>
    </Section>
  )
}

function FloorInfo(p: Props & { b: BuildingPayload }) {
  const { floor, dl, cf, level, b } = p
  if (!floor) return null
  const unit = level.kind === 'unit' ? floor.units.find((u) => u.id === level.unit) : null
  const k = floor.kpi
  const fullOk = !!(p.caps?.sim_python && p.caps.honeybee)
  const engines = p.caps ? [p.caps.energyplus ? 'EnergyPlus' : null, p.caps.radiance ? 'Radiance' : null].filter(Boolean) : []
  return (
    <>
      {unit ? (
        <Card title={`Unit · ${unit.id}`}>
          <div className="mb-1.5 text-[14px] font-semibold">{unit.name}</div>
          <Row label="Area" value={`${fmt1(unit.area)} m²`} />
          <Row label="Orientation" value={unit.orientation ?? '—'} />
          <Row label="Windows" value={`${unit.windows.length} · ${fmt1(unit.glazing_m2)} m² glass`} />
          <Row label="Window to floor ratio" value={
            <span>{pct(unit.wfr)} {unit.kind === 'unit' && (unit.wfr >= 0.1 ? <Badge tone="good">≥ 10 %</Badge> : <Badge tone="critical">&lt; 10 %</Badge>)}</span>} />
          <Row label="Facade length" value={`${fmt1(unit.facade_m)} m`} />
          <Row label="Rooms" value={unit.rooms.length} />
          {floor.rooms.filter((r) => unit.rooms.includes(r.id)).map((r) => <Row key={r.id} label={r.name} value={`${fmt1(r.area)} m²`} sub />)}
        </Card>
      ) : (
        <>
          <Card title={`Floor ${floor.index} · ${b.id}`}>
            <h3 className="mb-2.5 text-[15px] font-semibold leading-snug">
              {floor.use_label}{floor.added && <span className="ml-1.5 align-middle"><Badge tone="warn">added floor</Badge></span>}
            </h3>
            <StatGrid>
              <Stat label="Gross area" value={fmt(k.gfa_m2)} unit="m²" sub={`${pct(k.efficiency)} usable`} />
              <Stat label="Units" value={fmt(k.units)} />
              <Stat label="Fit-out cost" value={fmt1(k.capex_sek / 1e6)} unit="MSEK" />
              <Stat label="Upfront carbon" value={fmt(k.upfront_kgco2e / 1000)} unit="t CO₂e" />
            </StatGrid>
            <p className="mt-2 text-[11.5px] text-ink-2">PageUp / PageDown: floor above / below. Click a unit to open it.</p>
          </Card>
          <Section id="f-details" title="Floor details" defaultOpen={false}>
            {Object.entries(k.unit_types).map(([n, c]) => <Row key={n} label={n} value={c} sub />)}
            <Row label="Usable (in units)" value={`${fmt(k.usable_m2)} m² · ${pct(k.efficiency)}`} />
            <Row label="Units without windows" value={k.no_window_units} />
            <Row label="Units with glass < 10 % of floor" value={k.low_wfr_units} />
          </Section>
        </>
      )}

      <Card title="Analysis · this floor" right={
        <div className="flex gap-1">
          <Toggle on={p.method === 'quick'} onChange={() => p.setMethod('quick')} label="Quick" />
          <Toggle on={p.method === 'ladybug'} onChange={() => p.setMethod('ladybug')} label="Ladybug Tools" />
        </div>}>
        {p.method === 'quick' ? (
          <>
            <div className="flex gap-1.5">
              <Button primary onClick={() => p.onQuick('daylight')} disabled={p.busy}>Daylight</Button>
              <Button primary onClick={() => p.onQuick('comfort')} disabled={p.busy}>Thermal comfort</Button>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
              Seconds. Daylight: split-flux daylight factor, CIE overcast sky, obstruction from every site building.
              Comfort: 5R1C hourly model, Stockholm TMYx, EN 16798-1 adaptive cat. II.
            </p>
          </>
        ) : (
          <>
            <Button primary onClick={p.onFull} disabled={p.busy || !fullOk}>Run EnergyPlus + Radiance</Button>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
              {fullOk
                ? `Honeybee model of the floor (every unit a zone, site context as shades). Found: ${engines.join(', ') || 'no engines — results will say what is missing'}. Minutes, not seconds.`
                : 'No Ladybug Tools environment found (.venv-sim). See explorer/README.md — the quick analysis still works.'}
            </p>
          </>
        )}
        {(dl || cf) && (
          <div className="mt-2 flex gap-1">
            <span className="mr-1 text-[12px] text-ink-2">Show:</span>
            <Toggle on={p.overlay === 'type'} onChange={() => p.setOverlay('type')} label="Unit types" />
            {dl && <Toggle on={p.overlay === 'daylight'} onChange={() => p.setOverlay('daylight')} label="Daylight" />}
            {cf && <Toggle on={p.overlay === 'comfort'} onChange={() => p.setOverlay('comfort')} label="Comfort" />}
          </div>
        )}
      </Card>

      {dl && (
        <Card title={`Daylight factor · ${dl.method === 'quick' ? 'quick' : 'Radiance'}`}>
          {unit && dl.units[unit.id] ? (
            <>
              <Row label="Mean DF" value={`${fmt1(dl.units[unit.id].mean)} %`} strong />
              <Row label="Area ≥ 2.1 % (300 lx)" value={pct(dl.units[unit.id].area_300)} />
              <Row label="Area ≥ 0.7 % (100 lx)" value={pct(dl.units[unit.id].area_100)} />
              <Row label="EN 17037 minimum (Stockholm)" value={dl.units[unit.id].pass_en17037 ? <Badge tone="good">meets</Badge> : <Badge tone="critical">does not meet</Badge>} />
              {dl.units[unit.id].obstruction_deg !== undefined && <Row label="Obstruction angle" value={`${fmt(dl.units[unit.id].obstruction_deg)}°`} sub />}
              <div className="mt-2"><DfHistogram values={dl.units[unit.id].points.map((x) => x[2])} /></div>
            </>
          ) : (
            <>
              <Row label="Mean DF, floor" value={`${fmt1(dl.summary.mean_df)} %`} strong />
              <Row label="Area ≥ 2.1 % (300 lx)" value={pct(dl.summary.area_300)} />
              <Row label="Area ≥ 0.7 % (100 lx)" value={pct(dl.summary.area_100)} />
              <Row label="Units meeting EN 17037 minimum" value={`${dl.summary.units_pass} / ${dl.summary.units}`} />
              <div className="mt-2"><DfHistogram values={Object.values(dl.units).flatMap((u) => u.points.map((x) => x[2]))} /></div>
            </>
          )}
          {dl.note && <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{dl.note}</p>}
        </Card>
      )}

      {(cf || p.unitComfort) && (
        <Card title={`Thermal comfort · ${cf?.method === 'ladybug_tools' ? 'EnergyPlus' : 'quick'}`}>
          {unit ? (
            (() => {
              const c = (cf?.method === 'ladybug_tools' ? cf.units[unit.id] : null) ?? p.unitComfort ?? cf?.units[unit.id]
              if (!c) return <p className="text-[12.5px] text-ink-2">Not a unit (corridor, core…).</p>
              return (
                <>
                  <Row label="Comfortable (cat. II)" value={`${fmt1(c.comfortable_pct)} %`} strong />
                  <Row label="Too warm" value={`${fmt1(c.overheating_pct)} %`} />
                  <Row label="Too cold" value={`${fmt1(c.too_cold_pct)} %`} />
                  <Row label="Occupied hours > 26 / 27 °C" value={`${fmt(c.hours_above_26)} / ${fmt(c.hours_above_27)} h`} />
                  <Row label="Max operative" value={`${fmt1(c.max_op)} °C`} />
                  <Row label="Space heating" value={`${fmt1(c.heating_kwh_m2)} kWh/m²·yr`} />
                  {c.cooling_kwh_m2 > 0 && <Row label="Cooling" value={`${fmt1(c.cooling_kwh_m2)} kWh/m²·yr`} />}
                  {p.unitComfort?.hot_week && (
                    <div className="mt-2">
                      <div className="mb-1 text-[12px] text-ink-2">Hottest week (quick model)</div>
                      <HotWeekChart data={p.unitComfort.hot_week} />
                    </div>
                  )}
                </>
              )
            })()
          ) : cf ? (
            <>
              <Row label="Comfortable, area-weighted" value={`${fmt1(cf.summary.comfortable_pct)} %`} strong />
              <Row label="Too warm" value={`${fmt1(cf.summary.overheating_pct)} %`} />
              <Row label="Too cold" value={`${fmt1(cf.summary.too_cold_pct)} %`} />
              <Row label="Hottest unit, max operative" value={`${fmt1(cf.summary.max_op)} °C`} />
              <Row label="Space heating" value={`${fmt1(cf.summary.heating_kwh_m2)} kWh/m²·yr`} />
              {!!cf.summary.cooling_kwh_m2 && <Row label="Cooling" value={`${fmt1(cf.summary.cooling_kwh_m2)} kWh/m²·yr`} />}
              {cf.envelope && <Row label="Envelope" value={cf.envelope} sub />}
              <p className="mt-1 text-[11.5px] text-ink-2">Open a unit to see its hottest week.</p>
            </>
          ) : null}
          {cf?.note && <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{cf.note}</p>}
        </Card>
      )}
    </>
  )
}
