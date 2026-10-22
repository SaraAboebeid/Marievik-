import { Badge, Card, Section, Slider } from './kit'
import type { Band, CompareCardRow, DistrictMeta, DistrictResult } from '../layers'

// B-U-S cards: Built, Use, System
const CARD_COLOUR: Record<string, string> = { B: '#fd876e', U: '#03b05f', S: '#f4a7dd' }
const CARD_NAME: Record<string, string> = { B: 'Built', U: 'Use', S: 'System' }
const nf = (v: number, d = 0) => v.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d })
const pc = (v: number) => `${nf(v * 100, 1)} %`
const signed = (v: number, d = 0) => `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}`

/** One figure over ten years: the strategy (line and 10-90 % band) against business as usual (dashed). */
function Chart({ title, unit, s, b, years, year, fmt = (v: number) => nf(v) }: {
  title: string; unit: string; s: Band; b: Band; years: number[]; year: number; fmt?: (v: number) => string
}) {
  const W = 300, H = 92, pl = 34, pb = 14, n = years.length
  const all = [...s.p10, ...s.p90, ...b.mean]
  let lo = Math.min(...all), hi = Math.max(...all)
  if (hi - lo < 1e-9) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.08
  lo -= pad; hi += pad
  const x = (i: number) => pl + (i / (n - 1)) * (W - pl - 6)
  const y = (v: number) => H - pb - ((v - lo) / (hi - lo)) * (H - pb - 6)
  const line = (a: number[]) => a.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const yi = years.indexOf(year)
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="font-semibold">{title}</span>
        <span className="text-muted">{yi >= 0 ? `${year}: ${fmt(s.mean[yi])} ${unit}` : unit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        <polygon points={[...s.p90.map((v, i) => `${x(i)},${y(v)}`), ...s.p10.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(' ')} fill="var(--color-c1)" opacity={0.18} />
        <polyline points={line(b.mean)} fill="none" stroke="var(--color-muted)" strokeWidth={1.3} strokeDasharray="4 3" />
        <polyline points={line(s.mean)} fill="none" stroke="var(--color-c1)" strokeWidth={2} />
        {yi >= 0 && <line x1={x(yi)} x2={x(yi)} y1={4} y2={H - pb} stroke="var(--color-ink)" strokeWidth={1} />}
        <text x={2} y={y(hi - pad) + 3} fontSize={8} fill="var(--color-muted)">{fmt(hi - pad)}</text>
        <text x={2} y={y(lo + pad)} fontSize={8} fill="var(--color-muted)">{fmt(lo + pad)}</text>
        {years.map((yy, i) => (i % 3 === 0 || i === n - 1 ? <text key={yy} x={x(i)} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--color-muted)">{String(yy).slice(2)}</text> : null))}
      </svg>
    </div>
  )
}

/** Value against carbon for each card alone: the profit / carbon trade-off at a glance. */
function TradeOff({ rows, onPick }: { rows: CompareCardRow[]; onPick: (id: string) => void }) {
  const W = 300, H = 170, p = 30
  const xs = rows.map((r) => r.carbon_t), ys = rows.map((r) => r.value_msek)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const x = (v: number) => p + ((v - x0) / Math.max(1, x1 - x0)) * (W - p - 12)
  const y = (v: number) => H - p + 8 - ((v - y0) / Math.max(1, y1 - y0)) * (H - p - 12)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ten-year value against carbon for each strategy card">
      <text x={W - 4} y={H - 4} textAnchor="end" fontSize={8} fill="var(--color-muted)">more carbon (t CO₂e, 10 years) →</text>
      <text x={4} y={10} fontSize={8} fill="var(--color-muted)">↑ more value (MSEK, discounted)</text>
      {rows.map((r) => (
        <g key={r.id} className="cursor-pointer" onClick={() => onPick(r.id)}>
          <circle cx={x(r.carbon_t)} cy={y(r.value_msek)} r={5} fill={r.card ? CARD_COLOUR[r.card] : r.id === 'all' ? 'var(--color-ink)' : '#ffffff'} stroke="var(--color-ink)" strokeWidth={1.2} />
          <text x={x(r.carbon_t) + 7} y={y(r.value_msek) + 3} fontSize={8} fill="var(--color-ink)">{r.label}</text>
        </g>
      ))}
    </svg>
  )
}

/** District scale: ten years of tenants choosing Marievik or elsewhere, under AMF's strategy cards. */
export function DistrictModel({ meta, res, busy, cards, toggle, onRun, year, setYear, compare, compareBusy, onCompare, onPickCompare }: {
  meta: DistrictMeta | null; res: { strategy: DistrictResult; baseline: DistrictResult } | null; busy: boolean
  cards: Set<string>; toggle: (id: string) => void; onRun: () => void; year: number; setYear: (y: number) => void
  compare: CompareCardRow[] | null; compareBusy: boolean; onCompare: () => void; onPickCompare: (id: string) => void
}) {
  if (!meta) return null
  const s = res?.strategy, b = res?.baseline
  const yi = s ? Math.max(0, s.years.indexOf(year)) : 0
  const sameCards = !!s && s.cards.length === cards.size && s.cards.every((c) => cards.has(c))
  return (
    <>
      <Card title="Ten years in the district" right={<Badge tone="warn">example market data</Badge>}>
        <p className="mb-2 text-[12px] leading-snug text-ink-2">
          Tenants look for space each quarter and take a unit in Marievik if it beats an average place elsewhere: near the station, life on the
          ground floors, green and water, quality, flexibility, rent. Pick AMF's moves, then play ten years against business as usual.
        </p>
        <div className="mb-2 grid grid-cols-1 gap-1">
          {meta.strategies.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={cards.has(c.id)} title={c.text}
              className={`flex items-start gap-2 rounded-md border-2 px-2 py-1 text-left text-[12px] ${cards.has(c.id) ? 'border-edge bg-sunken font-semibold' : 'border-line bg-surface text-ink-2'}`}>
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border border-edge font-mono text-[9.5px] font-bold text-[#202020]"
                style={{ background: CARD_COLOUR[c.card] }} title={CARD_NAME[c.card]}>{c.card}</span>
              <span>{c.label}{cards.has(c.id) && <span className="block text-[10.5px] font-normal text-muted">{c.text}</span>}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onRun} disabled={busy}
          className="w-full rounded-md border-2 border-edge bg-coral px-2 py-1 text-[12.5px] font-semibold text-[#202020] disabled:opacity-50">
          {busy ? 'Playing ten years…' : sameCards ? 'Play again' : 'Play ten years'}
        </button>
        {s && b && (
          <div className="mt-2.5">
            <div className="grid grid-cols-2 gap-1.5 text-[12px]">
              {[
                ['10-year value', `${nf(s.totals.value_msek)} MSEK`, signed(s.totals.value_msek - b.totals.value_msek), s.totals.value_msek >= b.totals.value_msek],
                ['Carbon, 10 years', `${nf(s.totals.carbon_t)} t`, signed(s.totals.carbon_t - b.totals.carbon_t), s.totals.carbon_t <= b.totals.carbon_t],
                ['Vacancy, year 10', pc(s.totals.vacancy_end), `${signed((s.totals.vacancy_end - b.totals.vacancy_end) * 100, 1)} pts`, s.totals.vacancy_end <= b.totals.vacancy_end],
                ['Evening life, year 10', `${nf(s.totals.evening_end)} people`, signed(s.totals.evening_end - b.totals.evening_end), s.totals.evening_end >= b.totals.evening_end],
              ].map(([label, v, d, good]) => (
                <div key={label as string} className="rounded-md border-2 border-line bg-surface px-2 py-1">
                  <div className="font-mono text-[9.5px] uppercase text-muted">{label}</div>
                  <div className="font-semibold tabular-nums">{v}</div>
                  <div className={`text-[10.5px] tabular-nums ${good ? 'text-good' : 'text-serious'}`}>{d} vs business as usual</div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-snug text-muted">Value: net income less capex, discounted at 5 %. Carbon: operational energy plus fit-outs, conversions and works.</p>
          </div>
        )}
      </Card>

      {s && b && (
        <Section id="district-years" title="Year by year">
          <label className="mb-2 block text-[12px] text-ink-2">
            <span className="mb-0.5 flex justify-between"><span>Year shown on the model (vacancy)</span><span className="font-mono text-ink">{year}</span></span>
            <Slider value={year} min={s.years[0]} max={s.years[s.years.length - 1]} step={1} onChange={setYear} />
          </label>
          <Chart title="Vacancy" unit="%" s={s.district.vacancy} b={b.district.vacancy} years={s.years} year={year} fmt={(v) => nf(v * 100, 1)} />
          <Chart title="Net operating income" unit="MSEK" s={s.district.noi_msek} b={b.district.noi_msek} years={s.years} year={year} />
          <Chart title="Works (capex)" unit="MSEK" s={s.district.capex_msek} b={b.district.capex_msek} years={s.years} year={year} />
          <Chart title="Carbon, operational" unit="t" s={s.district.co2_op_t} b={b.district.co2_op_t} years={s.years} year={year} />
          <Chart title="Carbon, embodied in works" unit="t" s={s.district.co2_emb_t} b={b.district.co2_emb_t} years={s.years} year={year} />
          <Chart title="People in the district (peak day)" unit="" s={s.district.people} b={b.district.people} years={s.years} year={year} />
          <p className="text-[10.5px] text-muted">Line: with the cards, band 10–90 % of {s.runs} runs. Dashed: business as usual.</p>
        </Section>
      )}

      {s && b && (
        <Section id="district-buildings" title={`Buildings in ${year}`}>
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-left font-mono text-[10px] uppercase text-muted"><th className="pb-1">Building</th><th className="pb-1 text-right">Vacancy</th><th className="pb-1 text-right">vs BAU</th><th className="pb-1 text-right">NOI MSEK</th></tr></thead>
            <tbody>
              {s.buildings.map((bd, i) => {
                const d = bd.vacancy[yi] - b.buildings[i].vacancy[yi]
                return (
                  <tr key={bd.id} className="border-t border-line" title={`${bd.name}\nAttractiveness to a corporate office: ${signed(bd.attract[yi], 2)} against an average location\nTransit ${bd.transit}, water ${bd.water}`}>
                    <td className="py-0.5">{bd.id} <span className="text-muted">{bd.kind}</span></td>
                    <td className="text-right tabular-nums">{pc(bd.vacancy[yi])}</td>
                    <td className={`text-right tabular-nums ${d < -0.005 ? 'text-good' : d > 0.005 ? 'text-serious' : 'text-muted'}`}>{signed(d * 100, 1)}</td>
                    <td className="text-right tabular-nums">{nf(bd.noi_msek[yi], 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}

      {s && (
        <Section id="district-demand" title="Who came, who went elsewhere" defaultOpen={false}>
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-left font-mono text-[10px] uppercase text-muted"><th className="pb-1">Tenant type</th><th className="pb-1 text-right">Moved in</th><th className="pb-1 text-right">Went elsewhere</th></tr></thead>
            <tbody>
              {Object.entries(s.demand).map(([id, d]) => (
                <tr key={id} className="border-t border-line"><td className="py-0.5">{d.label}</td><td className="text-right tabular-nums">{nf(d.won, 1)}</td><td className="text-right tabular-nums text-muted">{nf(d.lost, 1)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] text-muted">Over ten years, mean of runs. Demand that went elsewhere is what a change of use could win.</p>
        </Section>
      )}

      <Section id="district-tradeoff" title="Profit against carbon, card by card" defaultOpen={false}>
        <p className="mb-2 text-[12px] leading-snug text-ink-2">Each card played alone, all together and none. Up and left is better: more value, less carbon. Click one to play it.</p>
        <button type="button" onClick={onCompare} disabled={compareBusy}
          className="mb-2 rounded-md border-2 border-edge bg-surface px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50">
          {compareBusy ? 'Playing every card…' : compare ? 'Compare again' : 'Compare every card'}
        </button>
        {compare && <TradeOff rows={compare} onPick={onPickCompare} />}
      </Section>
      {s && <p className="mt-1 px-1 text-[10.5px] leading-snug text-muted">{s.note}</p>}
    </>
  )
}

/** Urban scale: what Marievik adds to Liljeholmen in the 10-year model. */
export function UrbanModel({ res, year }: { res: { strategy: DistrictResult; baseline: DistrictResult } | null; year: number }) {
  if (!res) return (
    <Card title="Marievik in Liljeholmen">
      <p className="text-[12px] text-ink-2">Play ten years at district scale to see trips to the station, evening life on the street and how much of the market Marievik wins.</p>
    </Card>
  )
  const s = res.strategy, b = res.baseline, yi = Math.max(0, s.years.indexOf(year))
  return (
    <Card title={`Marievik in Liljeholmen, ${year}`} right={<Badge tone="warn">example data</Badge>}>
      <div className="grid grid-cols-2 gap-1.5 text-[12px]">
        {[
          ['Trips a day to the station', nf(s.urban.station_trips_per_day[yi]), signed(s.urban.station_trips_per_day[yi] - b.urban.station_trips_per_day[yi])],
          ['People out in the evening', nf(s.urban.street_evening_people[yi]), signed(s.urban.street_evening_people[yi] - b.urban.street_evening_people[yi])],
          ['Tenants won of all who looked', pc(s.urban.capture_share), `${signed((s.urban.capture_share - b.urban.capture_share) * 100, 1)} pts`],
          ['Carbon per person and year', `${nf(s.totals.kg_per_person_year, 0)} kg`, signed(s.totals.kg_per_person_year - b.totals.kg_per_person_year)],
        ].map(([label, v, d]) => (
          <div key={label} className="rounded-md border-2 border-line bg-surface px-2 py-1">
            <div className="font-mono text-[9.5px] uppercase text-muted">{label}</div>
            <div className="font-semibold tabular-nums">{v}</div>
            <div className="text-[10.5px] tabular-nums text-muted">{d} vs business as usual</div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted">{s.urban.note}</p>
    </Card>
  )
}
