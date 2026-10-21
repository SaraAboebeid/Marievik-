import { useState } from 'react'
import type { FloorPayload, Level, SitePayload } from '../types'
import { COMMON_COLOR, UNIT_COLORS, rgb, unitColor } from '../viewer/colors'
import { SELECTION_COLOR } from '../viewer/Viewer'

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** What the colours and outlines in the 3D view mean, for the current level. */
export function MapLegend({ site, level, floor }: { site: SitePayload; level: Level; floor: FloorPayload | null }) {
  const [open, setOpen] = useState(true)
  const inFloor = (level.kind === 'floor' || level.kind === 'unit') && floor
  const mats = [...new Set(site.buildings.flatMap((b) => [b.facade?.material, b.facade?.base_material]).filter(Boolean) as string[])]
  // one entry per colour: the unit type it stands for (the same rule the viewer colours by)
  const typeOf = (name: string, kind: string) =>
    kind === 'common' ? 'Corridors, cores, shared' : Object.keys(UNIT_COLORS).find((k) => k !== 'other' && name.startsWith(k)) ?? 'Other'
  const unitTypes = inFloor
    ? [...new Map(floor.units.map((u) => [typeOf(u.name, u.kind), unitColor(u.name, u.kind)])).entries()]
    : []

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-raised/95 px-3 py-1.5 shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Hide legend' : 'Show legend'}
        className="flex flex-none items-center gap-1.5 text-left">
        <span className={`text-[10px] text-muted transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>▶</span>
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          {inFloor ? 'Unit types' : 'Facade colours'}
        </span>
      </button>
      {open && (
        <ul className="flex min-w-0 flex-nowrap items-center gap-x-2.5 overflow-x-auto text-[11.5px] text-ink-2">
          {inFloor ? (
            <>
              {unitTypes.map(([name, col]) => <Item key={name} swatch={col} label={name} />)}
              {!unitTypes.some(([n]) => n.startsWith('Corridors')) && <Item swatch={COMMON_COLOR} label="Corridors, cores, shared" />}
              <Sep />
              <Item swatch="#ffffff" label="Open unit (brighter)" />
            </>
          ) : (
            <>
              {mats.map((m) => <Item key={m} swatch={rgb(site.materials[m])} label={pretty(m)} />)}
              <Item swatch={rgb(site.materials.timber)} label="Added floors (timber)" />
              <Sep />
              <Item outline={SELECTION_COLOR} label="Selected" />
              <Item swatch="rgba(200,200,200,.35)" label="Faded: not selected" />
            </>
          )}
        </ul>
      )}
    </div>
  )
}

function Sep() {
  return <li className="h-3.5 w-px bg-line-strong" aria-hidden />
}

function Item({ swatch, outline, label }: { swatch?: string; outline?: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-3 w-4 flex-none rounded-[2px] border border-line"
        style={{ background: swatch ?? 'transparent', borderColor: outline, borderWidth: outline ? 2 : undefined }} />
      <span>{label}</span>
    </li>
  )
}
