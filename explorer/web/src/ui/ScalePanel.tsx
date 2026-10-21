import { fmt } from '../api'
import type { SitePayload, UrbanSummary } from '../types'
import { Card, Row, Toggle } from './kit'

/** District scale: which of the site's buildings count toward the totals and stay lit in the 3D view. */
export function DistrictPanel({ site, hidden, onToggle, onAll, onNone }: {
  site: SitePayload; hidden: Set<string>; onToggle: (id: string) => void; onAll: () => void; onNone: () => void
}) {
  const shown = site.buildings.length - hidden.size
  return (
    <Card title="District scale · buildings in view"
      right={<span className="font-mono text-[11px] text-ink-2">{shown}/{site.buildings.length}</span>}>
      <p className="mb-2 text-[12px] leading-snug text-ink-2">
        Looking at several buildings together. Totals on this panel, and which buildings stay lit in the model, follow this selection.
      </p>
      <div className="mb-2 flex gap-1.5">
        <button onClick={onAll} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">All</button>
        <button onClick={onNone} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">None</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {site.buildings.map((b) => (
          <Toggle key={b.id} on={!hidden.has(b.id)} onChange={() => onToggle(b.id)} label={b.id} />
        ))}
      </div>
    </Card>
  )
}

/** Urban scale: each building's ground-floor use and the public green/plaza area nearby — the site's outdoor link. */
export function UrbanPanel({ urban, loading }: { urban: UrbanSummary | null; loading: boolean }) {
  return (
    <Card title="Urban scale · ground floors & open space">
      <p className="mb-2 text-[12px] leading-snug text-ink-2">
        What meets the street, and the public green and plaza area within {urban ? fmt(urban.radius_m) : '…'} m of each building.
      </p>
      {loading && !urban ? (
        <p className="text-[12.5px] text-ink-2">Reading the urban context…</p>
      ) : (
        <div>
          {urban?.buildings.map((b) => (
            <Row key={b.id} label={`${b.id} · ${b.ground_use_label}`}
              value={`${fmt(b.green_m2)} m² green · ${fmt(b.plaza_m2)} m² plaza`} />
          ))}
        </div>
      )}
    </Card>
  )
}
