import { useRef, useCallback } from 'react'
import type {
  Bootstrap, EvalResult, FurnitureSpec, Plan, Selection, ThermalResult, Tool, Wall,
} from '../types'

const SNAP = 50

const CAT_COLOR: Record<string, string> = {
  bedroom: 'var(--color-c1)',
  living: 'var(--color-c3)',
  kitchen: 'var(--color-c2)',
  sanitary: 'var(--color-c4)',
  storage: 'var(--color-c6)',
  work: 'var(--color-c5)',
  clearance: 'var(--color-muted)',
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export const comfortColor = (pct: number) =>
  pct >= 90 ? 'var(--color-good)' : pct >= 75 ? 'var(--color-warn)' : 'var(--color-critical)'

interface Props {
  boot: Bootstrap
  plan: Plan
  result: EvalResult | null
  thermal: ThermalResult | null
  tool: Tool
  selected: Selection
  wallType: string
  doorClear: number
  drawStart: { x: number; y: number } | null
  show: { clearance: boolean; turning: boolean; rooms: boolean; grid: boolean; comfort: boolean }
  preview: boolean
  previewLabel?: string
  onSelect: (s: Selection) => void
  onChange: (plan: Plan, commit: boolean) => void
  onDrawStart: (p: { x: number; y: number } | null) => void
}

export function PlanCanvas({
  boot, plan, result, thermal, tool, selected, wallType, doorClear, drawStart, show, preview, previewLabel,
  onSelect, onChange, onDrawStart,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const specs = useRef(new Map(boot.furniture.map((f) => [f.id, f])))

  const toMM = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }, [])

  const shell = plan.shell
  const { width_mm: W, depth_mm: D, external_wall_thickness_mm: ext } = shell
  const facadeY = shell.facade_y_mm ?? ext
  const outline: [number, number][] = shell.outline ?? [
    [ext, ext], [W - ext, ext], [W - ext, D - ext], [ext, D - ext],
  ]
  const outlinePath = 'M' + outline.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z'
  const blockedIds = new Set((result?.blocked ?? []).map((b) => b.id))
  const editable = !preview

  /* -------------------------------------------------- dragging */

  function startDrag(
    e: React.PointerEvent,
    apply: (dx: number, dy: number, draft: Plan) => void,
  ) {
    e.stopPropagation()
    if (tool !== 'select' || !editable) return
    const origin = toMM(e)
    const base = clone(plan)
    let moved = false

    const move = (ev: PointerEvent) => {
      const p = toMM(ev)
      const draft = clone(base)
      apply(p.x - origin.x, p.y - origin.y, draft)
      moved = true
      onChange(draft, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) onChange(null as unknown as Plan, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* -------------------------------------------------- canvas clicks */

  function onCanvasDown(e: React.PointerEvent) {
    if (!editable) return
    const p = toMM(e)
    if (tool === 'window') {
      // A new window on the facade, centred where you clicked.
      if (p.y > facadeY + 600) return
      const draft = clone(plan)
      const x = snap(p.x)
      draft.shell.windows.push({
        id: `win${Date.now().toString(36)}`, x1: x - 600, x2: x + 600,
        y1: facadeY / 2, y2: facadeY / 2, sill_mm: 800, head_mm: 2200, glazing: 'upgraded',
      })
      onSelect({ kind: 'window', index: draft.shell.windows.length - 1 })
      onChange(draft, true)
      return
    }
    if (tool !== 'wall') {
      onSelect(null)
      return
    }
    if (!drawStart) {
      onDrawStart({ x: snap(p.x), y: snap(p.y) })
      return
    }
    const end = { x: snap(p.x), y: snap(p.y) }
    if (Math.abs(end.x - drawStart.x) > Math.abs(end.y - drawStart.y)) end.y = drawStart.y
    else end.x = drawStart.x

    if (Math.hypot(end.x - drawStart.x, end.y - drawStart.y) >= 300) {
      const draft = clone(plan)
      draft.walls.push({
        id: `w${Date.now().toString(36)}`,
        x1: drawStart.x, y1: drawStart.y, x2: end.x, y2: end.y,
        thickness: 100, component: wallType,
      })
      onChange(draft, true)
    }
    onDrawStart(null)
  }

  function onWallDown(e: React.PointerEvent, wall: Wall) {
    e.stopPropagation()
    if (!editable) return
    if (tool === 'door') {
      const p = toMM(e)
      const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
      const t = Math.max(0.08, Math.min(0.92,
        ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / (len * len)))
      const draft = clone(plan)
      draft.doors.push({
        id: `d${Date.now().toString(36)}`, wall_id: wall.id, t,
        clear_mm: Math.max(850, doorClear),
      })
      onChange(draft, true)
      return
    }
    if (tool !== 'select') return
    onSelect({ kind: 'wall', id: wall.id })
    startDrag(e, (dx, dy, draft) => {
      const w = draft.walls.find((x) => x.id === wall.id)!
      w.x1 = snap(w.x1 + dx); w.x2 = snap(w.x2 + dx)
      w.y1 = snap(w.y1 + dy); w.y2 = snap(w.y2 + dy)
    })
  }

  function onWindowDown(e: React.PointerEvent, index: number, part: 'body' | 'a' | 'b') {
    e.stopPropagation()
    if (!editable) return
    if (tool === 'window' && part === 'body') {
      onSelect({ kind: 'window', index })
      return
    }
    onSelect({ kind: 'window', index })
    startDrag(e, (dx, _dy, draft) => {
      const w = draft.shell.windows[index]
      const o = plan.shell.windows[index]
      if (part === 'body') { w.x1 = snap(o.x1 + dx); w.x2 = snap(o.x2 + dx) }
      if (part === 'a') w.x1 = Math.min(snap(o.x1 + dx), o.x2 - 400)
      if (part === 'b') w.x2 = Math.max(snap(o.x2 + dx), o.x1 + 400)
    })
  }

  /* -------------------------------------------------- render */

  return (
    <svg
      ref={svgRef}
      viewBox={`-450 -650 ${W + 900} ${D + 1100}`}
      className={`mx-auto block h-auto w-full max-w-[920px] rounded-md border bg-raised ${
        preview ? 'border-accent' : 'border-line'}`}
      onPointerDown={onCanvasDown}
      onPointerMove={(e) => {
        if (tool === 'wall' && drawStart) {
          const p = toMM(e)
          const g = svgRef.current?.querySelector('#ghost') as SVGLineElement | null
          if (!g) return
          const end = { x: snap(p.x), y: snap(p.y) }
          if (Math.abs(end.x - drawStart.x) > Math.abs(end.y - drawStart.y)) end.y = drawStart.y
          else end.x = drawStart.x
          g.setAttribute('x2', String(end.x))
          g.setAttribute('y2', String(end.y))
        }
      }}
    >
      {/* envelope: thick outline, then the floor over its inner half */}
      <path d={outlinePath} fill="none" stroke="var(--color-ink-2)" strokeWidth={ext * 2}
        strokeLinejoin="miter" />
      <path d={outlinePath} fill="var(--color-raised)" />
      <text x={W / 2} y={-330} textAnchor="middle" fontSize={190} fontFamily="var(--font-mono)"
        fill="var(--color-muted)" letterSpacing={40}>
        FACADE{shell.facade_azimuth_deg !== undefined ? ` · faces ${compass(shell.facade_azimuth_deg)}` : ''}
      </text>

      {/* where the turning circle fits */}
      {show.turning && result?.clearance_grid && (
        <g opacity={0.55} pointerEvents="none">
          {result.clearance_grid.values.map((v, i) => {
            if (v < result.turning.required_mm) return null
            const g = result.clearance_grid
            const c = i % g.cols
            const r = Math.floor(i / g.cols)
            return (
              <rect key={i} x={c * g.step_mm} y={r * g.step_mm}
                width={g.step_mm} height={g.step_mm} fill="var(--color-accent-soft)" />
            )
          })}
        </g>
      )}

      {/* thermal comfort per room */}
      {show.comfort && thermal?.ok && thermal.rooms?.map((r) => (
        <g key={`th${r.space}`} pointerEvents="none">
          {r.zones.map((z, i) => (
            <rect key={i} x={z[0]} y={z[1]} width={z[2] - z[0]} height={z[3] - z[1]}
              fill={comfortColor(r.comfort_pct)} opacity={0.16} />
          ))}
        </g>
      ))}

      {show.grid && (
        <g stroke="var(--color-line)" strokeWidth={4} pointerEvents="none">
          {Array.from({ length: Math.floor(W / 1000) + 1 }, (_, i) => (
            <line key={`vx${i}`} x1={i * 1000} y1={0} x2={i * 1000} y2={D} />
          ))}
          {Array.from({ length: Math.floor(D / 1000) + 1 }, (_, i) => (
            <line key={`hz${i}`} x1={0} y1={i * 1000} x2={W} y2={i * 1000} />
          ))}
        </g>
      )}

      {/* windows: drag to slide, drag the ends to resize */}
      {shell.windows.map((w, i) => {
        const isSel = selected?.kind === 'window' && selected.index === i
        const colour = w.glazing === 'upgraded' ? 'var(--color-c3)' : 'var(--color-c1)'
        return (
          <g key={`win${i}`} className={editable ? 'cursor-ew-resize' : ''}>
            <rect x={w.x1} y={facadeY - ext - 20} width={w.x2 - w.x1} height={ext + 40}
              fill="var(--color-raised)" stroke={isSel ? 'var(--color-accent)' : 'none'} strokeWidth={50}
              onPointerDown={(e) => onWindowDown(e, i, 'body')}>
              <title>{`${w.door ? 'Balcony door' : 'Window'} ${w.x2 - w.x1} mm wide, sill ${w.sill_mm}, head ${w.head_mm}\n${w.glazing === 'upgraded' ? 'New triple glazing' : 'Existing glazing'}`}</title>
            </rect>
            <line x1={w.x1} y1={facadeY - ext / 2} x2={w.x2} y2={facadeY - ext / 2}
              stroke={colour} strokeWidth={w.door ? 60 : 36} pointerEvents="none" />
            {w.sill_mm <= 700 && !w.door && (
              <line x1={w.x1} y1={facadeY + 40} x2={w.x2} y2={facadeY + 40} stroke={colour}
                strokeWidth={20} strokeDasharray="90 60" pointerEvents="none" />
            )}
            {isSel && editable && (['a', 'b'] as const).map((part) => (
              <circle key={part} cx={part === 'a' ? w.x1 : w.x2} cy={facadeY - ext / 2} r={110}
                fill="var(--color-accent)" className="cursor-ew-resize"
                onPointerDown={(e) => onWindowDown(e, i, part)} />
            ))}
          </g>
        )
      })}

      {/* room labels */}
      {show.rooms && result?.rooms.map((r) => {
        const th = thermal?.ok ? thermal.rooms?.find((t) => {
          const z = t.zones[0]
          return z && r.centroid[0] >= z[0] - 400 && r.centroid[0] <= z[2] + 400 &&
            r.centroid[1] >= z[1] - 400 && r.centroid[1] <= z[3] + 400 && t.kind === r.kind
        }) : undefined
        return (
          <g key={`room${r.index}`} pointerEvents="none">
            <text x={r.centroid[0]} y={r.centroid[1]} textAnchor="middle"
              fontSize={200} fontFamily="var(--font-mono)" fill="var(--color-muted)">
              {r.area_m2.toFixed(1)} m²
            </text>
            <text x={r.centroid[0]} y={r.centroid[1] + 220} textAnchor="middle"
              fontSize={150} fontFamily="var(--font-mono)" fill="var(--color-muted)" opacity={0.8}>
              {r.kind}{r.daylight ? ' · daylit' : ''}{r.reachable ? '' : ' · ⚠'}
            </text>
            {show.comfort && th && (
              <text x={r.centroid[0]} y={r.centroid[1] + 420} textAnchor="middle"
                fontSize={150} fontFamily="var(--font-mono)" fill={comfortColor(th.comfort_pct)}>
                {th.comfort_pct.toFixed(0)}% comfort · {th.hours_over_26} h &gt;26°
              </text>
            )}
          </g>
        )
      })}

      {/* clearance zones */}
      {show.clearance && plan.furniture.map((f) => {
        const s = specs.current.get(f.type) as FurnitureSpec | undefined
        if (!s?.clearance_front_mm) return null
        return (
          <g key={`cz${f.id}`} pointerEvents="none"
            transform={`rotate(${f.rot || 0} ${f.x} ${f.y})`}>
            <rect x={f.x - s.w / 2} y={f.y + s.d / 2} width={s.w}
              height={s.clearance_front_mm} fill="var(--color-c5)" opacity={0.18} />
            {!!s.clearance_side_mm && (
              <>
                <rect x={f.x - s.w / 2 - s.clearance_side_mm} y={f.y - s.d / 2}
                  width={s.clearance_side_mm} height={s.d} fill="var(--color-c4)" opacity={0.13} />
                <rect x={f.x + s.w / 2} y={f.y - s.d / 2}
                  width={s.clearance_side_mm} height={s.d} fill="var(--color-c4)" opacity={0.13} />
              </>
            )}
          </g>
        )
      })}

      {/* walls */}
      {plan.walls.map((w) => {
        const type = boot.wall_types.find((t) => t.id === w.component)
        const isSel = selected?.kind === 'wall' && selected.id === w.id
        return (
          <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke={isSel ? 'var(--color-accent)' : 'var(--color-ink)'}
            strokeWidth={w.thickness ?? 100}
            strokeLinecap="square"
            strokeDasharray={type && type.reversibility >= 0.8 ? '220 60' : undefined}
            opacity={w.fixed ? 0.95 : 1}
            className={tool === 'door' ? 'cursor-copy' : 'cursor-pointer'}
            onPointerDown={(e) => onWallDown(e, w)}>
            <title>
              {(type ? `${type.name}\nRw ${type.rw} · reversibility ${type.reversibility}\n${Math.round(type.cost_m2)} SEK/m² · ${Math.round(type.carbon_m2)} kgCO₂e/m²` : w.component) +
                (w.fixed ? '\n\nFixed: the optimiser keeps this wall.' : '')}
            </title>
          </line>
        )
      })}

      {/* doors */}
      {plan.doors.map((d) => {
        const w = plan.walls.find((x) => x.id === d.wall_id)
        if (!w) return null
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
        const ux = (w.x2 - w.x1) / len
        const uy = (w.y2 - w.y1) / len
        const cx = w.x1 + ux * len * d.t
        const cy = w.y1 + uy * len * d.t
        const h = d.clear_mm / 2
        const isSel = selected?.kind === 'door' && selected.id === d.id
        return (
          <g key={d.id}>
            <line x1={cx - ux * h} y1={cy - uy * h} x2={cx + ux * h} y2={cy + uy * h}
              stroke={isSel ? 'var(--color-accent-soft)' : 'var(--color-raised)'}
              strokeWidth={(w.thickness ?? 100) + 14}
              strokeLinecap="butt" className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation()
                if (!editable) return
                if (tool === 'door') {
                  const draft = clone(plan)
                  draft.doors = draft.doors.filter((x) => x.id !== d.id)
                  onChange(draft, true)
                } else {
                  onSelect({ kind: 'door', id: d.id })
                  startDrag(e, (dx, dy, draft) => {
                    const dd = draft.doors.find((x) => x.id === d.id)!
                    dd.t = Math.max(0.05, Math.min(0.95, d.t + (dx * ux + dy * uy) / len))
                  })
                }
              }}>
              <title>{`Door, ${d.clear_mm} mm clear. Drag to slide along the wall.`}</title>
            </line>
            <path pointerEvents="none" fill="none" stroke="var(--color-line-strong)" strokeWidth={18}
              d={`M ${cx - ux * h} ${cy - uy * h} a ${d.clear_mm} ${d.clear_mm} 0 0 1 ${uy * d.clear_mm + ux * h} ${-ux * d.clear_mm + uy * h}`} />
          </g>
        )
      })}

      {/* furniture */}
      {plan.furniture.map((f) => {
        const s = specs.current.get(f.type) as FurnitureSpec | undefined
        if (!s) return null
        const isSel = selected?.kind === 'furniture' && selected.id === f.id
        const isBlocked = blockedIds.has(f.id)
        const product = f.product ? boot.products.find((p) => p.id === f.product) : undefined
        return (
          <g key={f.id} transform={`rotate(${f.rot || 0} ${f.x} ${f.y})`}
            className={editable ? 'cursor-grab active:cursor-grabbing' : ''}
            onPointerDown={(e) => {
              if (!editable) return
              onSelect({ kind: 'furniture', id: f.id })
              startDrag(e, (dx, dy, draft) => {
                const item = draft.furniture.find((x) => x.id === f.id)!
                item.x = snap(f.x + dx)
                item.y = snap(f.y + dy)
              })
            }}>
            <rect x={f.x - s.w / 2} y={f.y - s.d / 2} width={s.w} height={s.d} rx={30}
              fill={s.is_space_reservation ? 'none' : CAT_COLOR[s.category] ?? 'var(--color-muted)'}
              fillOpacity={s.is_space_reservation ? 0 : f.fixed ? 0.45 : 0.82}
              stroke={isSel ? 'var(--color-accent)' : isBlocked ? 'var(--color-critical)' : 'var(--color-raised)'}
              strokeWidth={isSel ? 75 : isBlocked ? 55 : 25}
              strokeDasharray={s.is_space_reservation ? '90 70' : undefined}>
              <title>
                {`${product?.name ?? s.name}\n${Math.round(product?.cost_sek ?? s.cost_sek)} SEK · ${Math.round(product?.carbon_kgco2e ?? s.carbon_kgco2e)} kgCO₂e` +
                  (f.fixed ? '\nFitted: the optimiser keeps it here.' : '') +
                  (isBlocked ? `\n\n⚠ ${result?.blocked.find((b) => b.id === f.id)?.detail ?? ''}` : '')}
              </title>
            </rect>
            <line x1={f.x - s.w / 2 + 60} y1={f.y + s.d / 2 - 40}
              x2={f.x + s.w / 2 - 60} y2={f.y + s.d / 2 - 40}
              stroke="var(--color-raised)" strokeWidth={35} opacity={0.75} pointerEvents="none" />
          </g>
        )
      })}

      {/* entry */}
      <circle cx={shell.entry.x} cy={shell.entry.y} r={110} fill="var(--color-good)" pointerEvents="none" />
      <text x={shell.entry.x} y={shell.entry.y + 300} textAnchor="middle" pointerEvents="none"
        fontSize={170} fontFamily="var(--font-mono)" fill="var(--color-good)">ENTRY</text>

      {drawStart && (
        <>
          <circle cx={drawStart.x} cy={drawStart.y} r={70} fill="var(--color-accent)" />
          <line id="ghost" x1={drawStart.x} y1={drawStart.y} x2={drawStart.x} y2={drawStart.y}
            stroke="var(--color-accent)" strokeWidth={100} opacity={0.5}
            strokeLinecap="square" pointerEvents="none" />
        </>
      )}

      {preview && (
        <text x={W / 2} y={D + 350} textAnchor="middle" fontSize={190} fontFamily="var(--font-mono)"
          fill="var(--color-accent)">{previewLabel ? previewLabel.toUpperCase() : 'PREVIEW'} · not applied yet</text>
      )}
    </svg>
  )
}

function compass(az: number) {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][
    Math.round(((az % 360) + 360) % 360 / 45) % 8]
}

/** A small read-only plan for option cards. */
export function MiniPlan({ plan, boot }: { plan: Plan; boot: Bootstrap }) {
  const s = plan.shell
  const ext = s.external_wall_thickness_mm
  const outline: [number, number][] = s.outline ?? [
    [ext, ext], [s.width_mm - ext, ext], [s.width_mm - ext, s.depth_mm - ext], [ext, s.depth_mm - ext],
  ]
  const d = 'M' + outline.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z'
  const fy = s.facade_y_mm ?? ext
  return (
    <svg viewBox={`-300 -300 ${s.width_mm + 600} ${s.depth_mm + 600}`} className="block h-auto w-full">
      <path d={d} fill="none" stroke="var(--color-ink-2)" strokeWidth={ext * 2} />
      <path d={d} fill="var(--color-raised)" />
      {s.windows.map((w, i) => (
        <line key={i} x1={w.x1} y1={fy - ext / 2} x2={w.x2} y2={fy - ext / 2}
          stroke={w.glazing === 'upgraded' ? 'var(--color-c3)' : 'var(--color-c1)'} strokeWidth={ext + 40} />
      ))}
      {plan.furniture.map((f) => {
        const sp = boot.furniture.find((x) => x.id === f.type)
        if (!sp || sp.is_space_reservation) return null
        return (
          <rect key={f.id} x={f.x - sp.w / 2} y={f.y - sp.d / 2} width={sp.w} height={sp.d}
            transform={`rotate(${f.rot || 0} ${f.x} ${f.y})`}
            fill={CAT_COLOR[sp.category] ?? 'var(--color-muted)'} fillOpacity={0.7} />
        )
      })}
      {plan.walls.map((w) => {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
        const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
        const cuts = plan.doors.filter((x) => x.wall_id === w.id)
          .map((x) => [x.t * len - x.clear_mm / 2, x.t * len + x.clear_mm / 2]).sort((a, b) => a[0] - b[0])
        const segs: [number, number][] = []
        let a = 0
        for (const [c0, c1] of cuts) { if (c0 > a) segs.push([a, c0]); a = c1 }
        if (a < len) segs.push([a, len])
        return segs.map(([s0, s1], i) => (
          <line key={`${w.id}${i}`} x1={w.x1 + ux * s0} y1={w.y1 + uy * s0} x2={w.x1 + ux * s1} y2={w.y1 + uy * s1}
            stroke="var(--color-ink)" strokeWidth={w.thickness ?? 100} />
        ))
      })}
    </svg>
  )
}
