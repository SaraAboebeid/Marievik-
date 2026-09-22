import { useRef, useCallback } from 'react'
import type {
  Bootstrap, EvalResult, FurnitureSpec, Plan, Selection, Tool, Wall,
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

interface Props {
  boot: Bootstrap
  plan: Plan
  result: EvalResult | null
  tool: Tool
  selected: Selection
  wallType: string
  doorClear: number
  drawStart: { x: number; y: number } | null
  show: { clearance: boolean; turning: boolean; rooms: boolean; grid: boolean }
  onSelect: (s: Selection) => void
  onChange: (plan: Plan, commit: boolean) => void
  onDrawStart: (p: { x: number; y: number } | null) => void
}

export function PlanCanvas({
  boot, plan, result, tool, selected, wallType, doorClear, drawStart, show,
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

  const { width_mm: W, depth_mm: D, external_wall_thickness_mm: ext } = plan.shell
  const blockedIds = new Set((result?.blocked ?? []).map((b) => b.id))

  /* -------------------------------------------------- dragging */

  function startDrag(
    e: React.PointerEvent,
    apply: (dx: number, dy: number, draft: Plan) => void,
  ) {
    e.stopPropagation()
    if (tool !== 'select') return
    const origin = toMM(e)
    const base = JSON.parse(JSON.stringify(plan)) as Plan
    let moved = false

    const move = (ev: PointerEvent) => {
      const p = toMM(ev)
      const draft = JSON.parse(JSON.stringify(base)) as Plan
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
    if (tool !== 'wall') {
      onSelect(null)
      return
    }
    const p = toMM(e)
    if (!drawStart) {
      onDrawStart({ x: snap(p.x), y: snap(p.y) })
      return
    }
    const end = { x: snap(p.x), y: snap(p.y) }
    // Orthogonal only — the dominant axis wins.
    if (Math.abs(end.x - drawStart.x) > Math.abs(end.y - drawStart.y)) end.y = drawStart.y
    else end.x = drawStart.x

    if (Math.hypot(end.x - drawStart.x, end.y - drawStart.y) >= 300) {
      const draft = JSON.parse(JSON.stringify(plan)) as Plan
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
    if (tool === 'door') {
      const p = toMM(e)
      const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
      const t = Math.max(0.08, Math.min(0.92,
        ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / (len * len)))
      const draft = JSON.parse(JSON.stringify(plan)) as Plan
      draft.doors.push({
        id: `d${Date.now().toString(36)}`, wall_id: wall.id, t,
        // Meet the tested user group's door standard, never below 850.
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

  /* -------------------------------------------------- render */

  return (
    <svg
      ref={svgRef}
      viewBox={`-140 -140 ${W + 280} ${D + 280}`}
      className="mx-auto block h-auto w-full max-w-[900px] rounded-md border border-line bg-raised"
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
      {/* where the turning circle fits */}
      {show.turning && result?.clearance_grid && (
        <g opacity={0.55}>
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

      {show.grid && (
        <g stroke="var(--color-line)" strokeWidth={4}>
          {Array.from({ length: Math.floor(W / 1000) + 1 }, (_, i) => (
            <line key={`vx${i}`} x1={i * 1000} y1={0} x2={i * 1000} y2={D} />
          ))}
          {Array.from({ length: Math.floor(D / 1000) + 1 }, (_, i) => (
            <line key={`hz${i}`} x1={0} y1={i * 1000} x2={W} y2={i * 1000} />
          ))}
        </g>
      )}

      {/* envelope */}
      <rect x={ext / 2} y={ext / 2} width={W - ext} height={D - ext}
        fill="none" stroke="var(--color-ink-2)" strokeWidth={ext} />

      {/* windows */}
      {plan.shell.windows.map((w, i) => (
        <g key={`win${i}`}>
          <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke="var(--color-c1)" strokeWidth={ext + 20} strokeLinecap="butt" />
          <line x1={w.x1} y1={w.y1 + 12} x2={w.x2} y2={w.y2 + 12}
            stroke="var(--color-raised)" strokeWidth={34} />
        </g>
      ))}

      {/* room labels */}
      {show.rooms && result?.rooms.map((r) => (
        <g key={`room${r.index}`} pointerEvents="none">
          <text x={r.centroid[0]} y={r.centroid[1]} textAnchor="middle"
            fontSize={200} fontFamily="var(--font-mono)" fill="var(--color-muted)">
            {r.area_m2.toFixed(1)} m²
          </text>
          <text x={r.centroid[0]} y={r.centroid[1] + 220} textAnchor="middle"
            fontSize={150} fontFamily="var(--font-mono)" fill="var(--color-muted)" opacity={0.7}>
            {r.kind}{r.daylight ? ' · daylit' : ''}{r.reachable ? '' : ' · ⚠'}
          </text>
        </g>
      ))}

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
            opacity={type && type.reversibility >= 0.8 ? 0.55 : 1}
            className={tool === 'door' ? 'cursor-copy' : 'cursor-pointer'}
            onPointerDown={(e) => onWallDown(e, w)}>
            <title>
              {type ? `${type.name}\nRw ${type.rw} · reversibility ${type.reversibility}\n${Math.round(type.cost_m2)} SEK/m² · ${Math.round(type.carbon_m2)} kgCO₂e/m²` : w.component}
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
        return (
          <g key={d.id}>
            <line x1={cx - ux * h} y1={cy - uy * h} x2={cx + ux * h} y2={cy + uy * h}
              stroke="var(--color-raised)" strokeWidth={(w.thickness ?? 100) + 14}
              strokeLinecap="butt" className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation()
                if (tool === 'door') {
                  const draft = JSON.parse(JSON.stringify(plan)) as Plan
                  draft.doors = draft.doors.filter((x) => x.id !== d.id)
                  onChange(draft, true)
                } else onSelect({ kind: 'door', id: d.id })
              }}>
              <title>{`Door, ${d.clear_mm} mm clear`}</title>
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
        return (
          <g key={f.id} transform={`rotate(${f.rot || 0} ${f.x} ${f.y})`}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              onSelect({ kind: 'furniture', id: f.id })
              startDrag(e, (dx, dy, draft) => {
                const item = draft.furniture.find((x) => x.id === f.id)!
                item.x = snap(f.x + dx)
                item.y = snap(f.y + dy)
              })
            }}>
            <rect x={f.x - s.w / 2} y={f.y - s.d / 2} width={s.w} height={s.d} rx={30}
              fill={s.is_space_reservation ? 'none' : CAT_COLOR[s.category] ?? 'var(--color-muted)'}
              fillOpacity={s.is_space_reservation ? 0 : 0.82}
              stroke={isSel ? 'var(--color-accent)' : isBlocked ? 'var(--color-critical)' : 'var(--color-raised)'}
              strokeWidth={isSel ? 75 : isBlocked ? 55 : 25}
              strokeDasharray={s.is_space_reservation ? '90 70' : undefined}>
              <title>
                {`${s.name}\n${Math.round(s.cost_sek)} SEK · ${Math.round(s.carbon_kgco2e)} kgCO₂e` +
                  (isBlocked ? `\n\n⚠ ${result?.blocked.find((b) => b.id === f.id)?.detail ?? ''}` : '')}
              </title>
            </rect>
            {/* front-face tick, so rotation reads at a glance */}
            <line x1={f.x - s.w / 2 + 60} y1={f.y + s.d / 2 - 40}
              x2={f.x + s.w / 2 - 60} y2={f.y + s.d / 2 - 40}
              stroke="var(--color-raised)" strokeWidth={35} opacity={0.75} pointerEvents="none" />
          </g>
        )
      })}

      {/* entry */}
      <circle cx={plan.shell.entry.x} cy={plan.shell.entry.y} r={110} fill="var(--color-good)" />
      <text x={plan.shell.entry.x} y={plan.shell.entry.y - 190} textAnchor="middle"
        fontSize={170} fontFamily="var(--font-mono)" fill="var(--color-good)">ENTRY</text>

      {/* wall being drawn */}
      {drawStart && (
        <>
          <circle cx={drawStart.x} cy={drawStart.y} r={70} fill="var(--color-accent)" />
          <line id="ghost" x1={drawStart.x} y1={drawStart.y} x2={drawStart.x} y2={drawStart.y}
            stroke="var(--color-accent)" strokeWidth={100} opacity={0.5}
            strokeLinecap="square" pointerEvents="none" />
        </>
      )}
    </svg>
  )
}
