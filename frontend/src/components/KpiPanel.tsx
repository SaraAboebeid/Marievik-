import { fmt, fmt1, kg, sek } from '../api'
import type { EvalResult } from '../types'

const BAND_BG: Record<string, string> = {
  good: 'bg-good',
  acceptable: 'bg-warn',
  poor: 'bg-serious',
  failing: 'bg-critical',
}

const TAG: Record<string, string> = {
  blocker: 'bg-critical-bg text-critical',
  major: 'bg-serious-bg text-serious',
  minor: 'bg-warn-bg text-warn',
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2 rounded-md border border-line bg-raised px-3 py-2.5">
      <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
        {title}
      </h4>
      {children}
    </section>
  )
}

function Row({
  label, value, delta, variant = 'normal',
}: {
  label: string
  value: string
  delta?: number
  variant?: 'normal' | 'sub' | 'big'
}) {
  const size =
    variant === 'big' ? 'text-[13.5px] font-semibold border-t border-line mt-1.5 pt-1.5'
      : variant === 'sub' ? 'text-[11.5px] text-muted'
        : 'text-[12.5px]'
  return (
    <div className={`flex justify-between gap-2.5 py-[2.5px] ${size}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap font-mono tabular-nums">
        {value}
        {delta !== undefined && delta !== 0 && (
          <span className={`ml-1.5 font-mono text-[10.5px] ${delta > 0 ? 'text-critical' : 'text-good'}`}>
            {delta > 0 ? '+' : ''}{fmt(delta)}
          </span>
        )}
      </span>
    </div>
  )
}

interface Props {
  result: EvalResult
  baseline: EvalResult | null
}

export function KpiPanel({ result, baseline }: Props) {
  const f = result.financial
  const e = result.environmental
  const bf = baseline?.financial
  const be = baseline?.environmental
  const d = (now: number, before?: number) => (before === undefined ? undefined : now - before)

  return (
    <>
      <Card title="Financial">
        <Row label="Capex" value={`${sek(f.capex)} SEK`} delta={d(f.capex, bf?.capex)} />
        <Row label="per m²" value={`${fmt(f.capex_m2)} SEK`} variant="sub" />
        <Row label="Opex, year 1" value={`${sek(f.opex_annual)} SEK/yr`}
          delta={d(f.opex_annual, bf?.opex_annual)} />
        <Row label="Opex, NPV" value={`${sek(f.opex_npv)} SEK`} variant="sub" />
        <Row label="Replacements, NPV" value={`${sek(f.replacement_npv)} SEK`} variant="sub" />
        <Row label="Residual value" value={`−${sek(f.residual_npv)} SEK`} variant="sub" />
        <Row label={`LCC over ${result.years} yr`} value={`${sek(f.lcc)} SEK`}
          delta={d(f.lcc, bf?.lcc)} variant="big" />
        <Row label="per m²" value={`${fmt(f.lcc_m2)} SEK/m²`} variant="sub" />
      </Card>

      <Card title="Environmental">
        <Row label="Upfront A1–A5" value={kg(e.upfront)} delta={d(e.upfront, be?.upfront)} />
        <Row label="Replacement B4" value={kg(e.b4)} variant="sub" />
        <Row label="End of life C1–C4" value={kg(e.c1c4)} variant="sub" />
        <Row label="Embodied total" value={kg(e.embodied)} delta={d(e.embodied, be?.embodied)} />
        <Row label="Operational B6" value={kg(e.operational)} variant="sub" />
        <Row label={`LCA over ${result.years} yr`} value={kg(e.total)}
          delta={d(e.total, be?.total)} variant="big" />
        <Row label="per m²" value={`${fmt1(e.total_m2)} kg/m²`} variant="sub" />
        <Row label="Embodied share" value={`${Math.round(e.embodied_share * 100)}%`} variant="sub" />
        <Row label="Module D (not netted)" value={kg(e.d_credit)} variant="sub" />
      </Card>

      <Card title="Social">
        {result.social.map((m) => {
          const b = baseline?.social.find((x) => x.name === m.name)
          const delta = b ? m.score - b.score : undefined
          return (
            <div key={m.name} className="border-t border-line py-1.5 first:border-t-0">
              <div className="flex justify-between gap-2 text-[12.5px]">
                <b className="font-medium">{m.name}</b>
                <span className="font-mono tabular-nums">
                  {m.score}
                  {delta !== undefined && delta !== 0 && (
                    <span className={`ml-1.5 text-[10.5px] ${delta < 0 ? 'text-critical' : 'text-good'}`}>
                      {delta > 0 ? '+' : ''}{delta}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-sm bg-sunken">
                <div className={`h-full rounded-sm ${BAND_BG[m.band]}`} style={{ width: `${m.score}%` }} />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{m.detail}</p>
            </div>
          )
        })}
        <Row label="Mean" value={`${result.social_mean} / 100`}
          delta={baseline ? result.social_mean - baseline.social_mean : undefined} variant="big" />
      </Card>

      <Card title="Issues">
        {result.issues.length === 0 ? (
          <p className="text-[12px] italic text-muted">
            Nothing blocking. Every item has its clearance and every room is reachable.
          </p>
        ) : (
          result.issues.map((i, idx) => (
            <div key={idx} className="flex gap-2 border-t border-line py-1.5 text-[12px] first:border-t-0">
              <span className={`mt-0.5 h-fit shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${TAG[i.severity]}`}>
                {i.severity}
              </span>
              <div>
                <b className="block font-medium">{i.title}</b>
                <p className="mt-0.5 leading-snug text-muted">{i.detail}</p>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card title="Rooms">
        {result.rooms.map((r) => (
          <Row key={r.index}
            label={`${r.kind === 'wet' ? 'Wet room' : `Room ${r.index}`}${r.daylight ? '' : ' · no window'}`}
            value={`${fmt1(r.area_m2)} m² · turn ${fmt(r.turn_mm)}`} />
        ))}
        <Row label="Turning circle needed" value={`${fmt(result.turning.required_mm)} mm`} variant="sub" />
        <Row label="Largest available" value={`${fmt(result.turning.max_mm)} mm`} variant="sub" />
        <Row label="Floor area" value={`${fmt1(result.area_m2)} m²`} variant="sub" />
        <Row label="Free floor" value={`${fmt1(result.free_floor_m2)} m²`} variant="sub" />
      </Card>
    </>
  )
}
