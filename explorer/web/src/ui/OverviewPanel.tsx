import { Badge, Card } from './kit'
import { VACANT_COLOR } from '../studio/tenancy'
import type { FloorTenancy } from '../studio/tenancy'

const n0 = (v: number) => Math.round(v).toLocaleString('sv-SE')
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0)

/** Colour of a use in the bar charts, by what kind of use it is. */
function useColor(label: string) {
  const l = label.toLowerCase()
  if (/cowork/.test(l)) return '#4aa3b5'
  if (/caf|restaurant|food/.test(l)) return '#fd876e'
  if (/reception|entrance|ground|lobby|services/.test(l)) return '#f5d66b'
  if (/resid|housing|apartment/.test(l)) return '#f4a7dd'
  if (/school|class/.test(l)) return '#03b05f'
  if (/hotel/.test(l)) return '#c9a0f0'
  if (/retail|shop/.test(l)) return '#e2b07a'
  return '#0528ca'
}

export interface FloorRow { n: number; label: string; use: string; area: number; ten: FloorTenancy }

/** Building level: what the building is used for, and how much of it is rented. */
export function BuildingOverview({ name, floors, onFloor }: { name: string; floors: FloorRow[]; onFloor: (n: number) => void }) {
  const byUse = new Map<string, number>()
  for (const f of floors) byUse.set(f.use, (byUse.get(f.use) ?? 0) + f.area)
  const uses = [...byUse.entries()].sort((a, b) => b[1] - a[1])
  const maxUse = Math.max(1, ...uses.map((u) => u[1]))
  const rented = floors.reduce((a, f) => a + f.ten.rented, 0), vacant = floors.reduce((a, f) => a + f.ten.vacant, 0)
  const leasable = rented + vacant
  return (
    <Card title={`${name} · overview`} right={<Badge tone="warn">tenancy: example data</Badge>}>
      <div className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-2">Floor area by use</div>
      <div className="mb-3 space-y-1.5">
        {uses.map(([u, a]) => (
          <div key={u}>
            <div className="flex justify-between text-[12px]"><span className="truncate pr-2">{u}</span><span className="tabular-nums text-ink-2">{n0(a)} m²</span></div>
            <div className="h-3 rounded-sm border border-edge bg-sunken"><div className="h-full rounded-sm" style={{ width: `${(100 * a) / maxUse}%`, background: useColor(u) }} /></div>
          </div>
        ))}
      </div>

      <div className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-2">Rented and vacant</div>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[17px] font-extrabold tabular-nums">{pct(rented, leasable)} %</div><div className="text-[11px] text-ink-2">let</div></div>
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[15px] font-bold tabular-nums">{n0(rented)}</div><div className="text-[11px] text-ink-2">m² rented</div></div>
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[15px] font-bold tabular-nums">{n0(vacant)}</div><div className="text-[11px] text-ink-2">m² vacant</div></div>
      </div>
      <div className="space-y-1">
        {floors.slice().reverse().map((f) => {
          const tot = Math.max(1, f.ten.rented + f.ten.vacant + f.ten.shared)
          return (
            <button key={f.n} type="button" onClick={() => onFloor(f.n)} title={`Open ${f.label}`}
              className="grid w-full grid-cols-[3.2rem_minmax(0,1fr)_2.6rem] items-center gap-2 rounded px-1 py-0.5 text-left text-[11.5px] hover:bg-sunken">
              <span className="font-semibold">{f.label}</span>
              <span className="flex h-3.5 overflow-hidden rounded-sm border border-edge">
                <span style={{ width: `${(100 * f.ten.rented) / tot}%`, background: '#4aa3b5' }} />
                <span style={{ width: `${(100 * f.ten.vacant) / tot}%`, background: `repeating-linear-gradient(-45deg, ${VACANT_COLOR} 0 3px, #c9c6bd 3px 6px)` }} />
                <span style={{ width: `${(100 * f.ten.shared) / tot}%`, background: '#e6e1cf' }} />
              </span>
              <span className="text-right tabular-nums text-ink-2">{pct(f.ten.rented, f.ten.rented + f.ten.vacant)} %</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-ink-2">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: '#4aa3b5' }} />rented</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: VACANT_COLOR }} />vacant</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: '#e6e1cf' }} />shared / owner</span>
        <span>Click a floor to open it.</span>
      </div>
    </Card>
  )
}

/** Floor level: who rents which part of this floor, and what is vacant. */
export function FloorTenancyCard({ ten, floorLabel }: { ten: FloorTenancy; floorLabel: string }) {
  return (
    <Card title={`${floorLabel} · rented and vacant`} right={<Badge tone="warn">example data</Badge>}>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[17px] font-extrabold tabular-nums">{pct(ten.rented, ten.leasable)} %</div><div className="text-[11px] text-ink-2">let</div></div>
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[15px] font-bold tabular-nums">{n0(ten.rented)}</div><div className="text-[11px] text-ink-2">m² rented</div></div>
        <div className="rounded-md border-2 border-line bg-sunken px-2 py-1.5"><div className="text-[15px] font-bold tabular-nums">{n0(ten.vacant)}</div><div className="text-[11px] text-ink-2">m² vacant</div></div>
      </div>
      <ul className="space-y-1.5">
        {ten.suites.map((s) => (
          <li key={s.id} className="grid grid-cols-[0.9rem_minmax(0,1fr)_auto] items-start gap-2 text-[12px]">
            <i className="mt-0.5 inline-block h-3 w-3.5 rounded-sm border border-edge"
              style={{ background: s.tenant || s.shared ? s.colour : `repeating-linear-gradient(-45deg, ${VACANT_COLOR} 0 3px, #c9c6bd 3px 6px)` }} />
            <span className="min-w-0">
              <b className="font-semibold">{s.shared ? s.label : s.tenant ?? 'Vacant'}</b>
              <span className="block text-[11px] text-muted">
                {s.shared ? 'not let' : s.tenant ? `${s.label} · ${s.sector} · lease to ${s.leaseEnd} · ${n0(s.rent ?? 0)} SEK/m²/yr` : `${s.label} · available to let`}
              </span>
            </span>
            <span className="tabular-nums text-ink-2">{n0(s.area)} m²</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">Tenants are fictional until AMF's rent roll replaces them. Choose “Rented / vacant” in the floor panel to see them on the plan.</p>
    </Card>
  )
}
