import { fmt, fmt1, msek, pct, tco2, USE_LABEL } from '../api'
import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, FloorPayload, Level, SitePayload, UnitComfort,
} from '../types'
import type { Method, Overlay } from '../App'
import { Badge, Button, Card, Row, Toggle } from './kit'
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
  if (!b) return <Card title="Building"><p className="text-[12px] text-muted">Laying out…</p></Card>
  return (
    <>
      {level.kind === 'building' && <BuildingInfo b={b} />}
      {(level.kind === 'floor' || level.kind === 'unit') && p.floor && <FloorInfo {...p} b={b} />}
    </>
  )
}

function SiteInfo({ site, bdata, totals, onGo }: Props) {
  return (
    <>
      <Card title="Site · current scenario" right={<span className="font-mono text-[10px] text-muted">{totals.loaded}/{site.buildings.length}</span>}>
        <Row label="Gross floor area" value={`${fmt(totals.gfa_m2)} m²`} />
        <Row label="Added by extensions" value={`${fmt(totals.added_gfa_m2)} m²`} sub />
        <Row label="Units (apartments, offices, rooms…)" value={fmt(totals.units)} />
        <Row label="New fit-out cost" value={msek(totals.capex_sek)} strong />
        <Row label="Upfront carbon A1–A5" value={tco2(totals.upfront_kgco2e)} />
        <Row label="per m² GFA" value={`${fmt1(totals.gfa_m2 ? totals.upfront_kgco2e / totals.gfa_m2 : 0)} kg/m²`} sub />
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted">
          Existing shells are retained (no new carbon). Prices and carbon from the Marievik+ catalogue — mostly
          PLACEHOLDER until EPDs and tenders replace them.
        </p>
      </Card>
      <Card title="Buildings">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-left font-mono text-[9.5px] uppercase tracking-wide text-muted">
              <th className="pb-1 font-medium">Bldg</th><th className="pb-1 font-medium">Use</th>
              <th className="pb-1 pl-2 text-right font-medium">Fl.</th><th className="whitespace-nowrap pb-1 pl-3 text-right font-medium">GFA m²</th>
              <th className="whitespace-nowrap pb-1 pl-3 text-right font-medium">t CO₂e</th>
            </tr>
          </thead>
          <tbody>
            {site.buildings.map((sb) => {
              const b = bdata[sb.id]
              return (
                <tr key={sb.id} className="cursor-pointer border-t border-line hover:bg-sunken" onClick={() => onGo({ kind: 'building', building: sb.id })}>
                  <td className="py-1 pr-1"><span className="font-mono">{sb.id}</span> <span className="text-ink-2">{sb.name}</span></td>
                  <td className="py-1 text-ink-2">{b ? (USE_LABEL[b.settings.use] ?? b.settings.use).replace('Current use (site data)', sb.current_use) : '…'}</td>
                  <td className="py-1 pl-2 text-right font-mono">{b ? b.kpi.floors : sb.levels}{b?.kpi.added_floors ? <span className="text-warn">*</span> : ''}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right font-mono">{b ? fmt(b.kpi.gfa_m2) : '…'}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right font-mono">{b ? fmt(b.kpi.upfront_kgco2e / 1000) : '…'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </>
  )
}

function BuildingInfo({ b }: { b: BuildingPayload }) {
  const k = b.kpi
  return (
    <>
      <Card title={`Building · ${b.id}`}>
        <Row label="Gross floor area" value={`${fmt(k.gfa_m2)} m²`} />
        <Row label="Floors" value={`${k.existing_floors}${k.added_floors ? ` + ${k.added_floors} added` : ''}`} />
        <Row label="Height" value={`${fmt1(k.height_m)} m`} />
        <Row label="Units" value={fmt(k.units)} />
        {Object.entries(k.unit_types).sort((a, b) => b[1] - a[1]).map(([n, c]) => <Row key={n} label={n} value={c} sub />)}
        <Row label="Mean unit size" value={`${fmt1(k.unit_area_mean_m2)} m²`} />
        <Row label="Net to gross" value={pct(k.net_to_gross)} />
        <Row label="Window to floor ratio" value={pct(k.window_floor_ratio)} />
      </Card>
      <Card title="Cost & carbon">
        <Row label="New fit-out cost" value={msek(k.capex_sek)} strong />
        <Row label="per m² GFA" value={`${fmt(k.capex_sek_per_m2)} SEK`} sub />
        <Row label="Upfront carbon A1–A5" value={tco2(k.upfront_kgco2e)} />
        <Row label="per m² GFA" value={`${fmt1(k.upfront_kgco2e_per_m2)} kg CO₂e`} sub />
        {k.added_floors > 0 && (
          <>
            <Row label="of which added floors" value={msek(k.added_capex_sek)} sub />
            <Row label="" value={tco2(k.added_upfront_kgco2e)} sub />
          </>
        )}
        <Row label="End of life C1–C4" value={tco2(k.c1c4_kgco2e)} sub />
        <Row label="Module D (not netted)" value={tco2(k.d_credit_kgco2e)} sub />
        <Row label="Walls & slabs retained" value={pct(k.retained_share)} />
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge tone={k.placeholder_share > 0.5 ? 'warn' : 'good'}>{pct(k.placeholder_share)} placeholder data</Badge>
          {k.mock_priced_rows > 0 && <Badge tone="muted">{k.mock_priced_rows} mock-priced items</Badge>}
        </div>
      </Card>
      {k.blockers.length > 0 && (
        <Card title="Blockers">
          <ul className="space-y-1.5">
            {k.blockers.map((x, i) => (
              <li key={i} className="text-[11.5px] leading-snug">
                <Badge tone={x.severity === 'high' ? 'critical' : 'serious'}>{x.kind}</Badge> {x.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
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
          <div className="mb-1 text-[12.5px] font-medium">{unit.name}</div>
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
        <Card title={`Floor ${floor.index} · ${b.id}`}>
          <div className="mb-1 text-[12.5px] font-medium">{floor.use_label}{floor.added && <span className="ml-1"><Badge tone="warn">added floor</Badge></span>}</div>
          <Row label="Gross area" value={`${fmt(k.gfa_m2)} m²`} />
          <Row label="Units" value={fmt(k.units)} />
          {Object.entries(k.unit_types).map(([n, c]) => <Row key={n} label={n} value={c} sub />)}
          <Row label="Usable (in units)" value={`${fmt(k.usable_m2)} m² · ${pct(k.efficiency)}`} />
          <Row label="Units without windows" value={k.no_window_units} />
          <Row label="Units with glass < 10 % of floor" value={k.low_wfr_units} />
          <Row label="Fit-out cost" value={msek(k.capex_sek)} strong />
          <Row label="Upfront carbon" value={tco2(k.upfront_kgco2e)} />
          <p className="mt-1 text-[10.5px] text-muted">PageUp / PageDown: floor above / below. Click a unit to open it.</p>
        </Card>
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
            <p className="mt-1.5 text-[10.5px] leading-snug text-muted">
              Seconds. Daylight: split-flux daylight factor, CIE overcast sky, obstruction from every site building.
              Comfort: 5R1C hourly model, Stockholm TMYx, EN 16798-1 adaptive cat. II.
            </p>
          </>
        ) : (
          <>
            <Button primary onClick={p.onFull} disabled={p.busy || !fullOk}>Run EnergyPlus + Radiance</Button>
            <p className="mt-1.5 text-[10.5px] leading-snug text-muted">
              {fullOk
                ? `Honeybee model of the floor (every unit a zone, site context as shades). Found: ${engines.join(', ') || 'no engines — results will say what is missing'}. Minutes, not seconds.`
                : 'No Ladybug Tools environment found (.venv-sim). See explorer/README.md — the quick analysis still works.'}
            </p>
          </>
        )}
        {(dl || cf) && (
          <div className="mt-2 flex gap-1">
            <span className="mr-1 text-[11px] text-muted">Show:</span>
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
          {dl.note && <p className="mt-1 text-[10.5px] leading-snug text-muted">{dl.note}</p>}
        </Card>
      )}

      {(cf || p.unitComfort) && (
        <Card title={`Thermal comfort · ${cf?.method === 'ladybug_tools' ? 'EnergyPlus' : 'quick'}`}>
          {unit ? (
            (() => {
              const c = (cf?.method === 'ladybug_tools' ? cf.units[unit.id] : null) ?? p.unitComfort ?? cf?.units[unit.id]
              if (!c) return <p className="text-[12px] text-muted">Not a unit (corridor, core…).</p>
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
                      <div className="mb-1 text-[11px] text-ink-2">Hottest week (quick model)</div>
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
              <p className="mt-1 text-[10.5px] text-muted">Open a unit to see its hottest week.</p>
            </>
          ) : null}
          {cf?.note && <p className="mt-1 text-[10.5px] leading-snug text-muted">{cf.note}</p>}
        </Card>
      )}
    </>
  )
}
