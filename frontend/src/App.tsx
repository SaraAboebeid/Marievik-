import { useCallback, useEffect, useRef, useState } from 'react'
import { evaluatePlan, findPlacement, getBootstrap, getStandards } from './api'
import { PlanCanvas } from './components/PlanCanvas'
import { KpiPanel } from './components/KpiPanel'
import { StandardsPanel } from './components/StandardsPanel'
import type {
  Bootstrap, EvalResult, Plan, Selection, Settings, StandardsSummary, Tool,
} from './types'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [baseline, setBaseline] = useState<EvalResult | null>(null)
  const [std, setStd] = useState<StandardsSummary | null>(null)
  const [configId, setConfigId] = useState('')
  const [settings, setSettings] = useState<Settings>({
    use: 'student_housing', user_group: 'adult', occupants: 1, years: 50,
  })
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<Selection>(null)
  const [wallType, setWallType] = useState('part.demount.solid.100')
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [rightTab, setRightTab] = useState<'kpi' | 'standards'>('kpi')
  const [status, setStatus] = useState('loading…')
  const [hint, setHint] = useState('')
  const [show, setShow] = useState({
    clearance: false, turning: true, rooms: true, grid: false,
  })

  const planRef = useRef<Plan | null>(null)
  const settingsRef = useRef(settings)
  const busy = useRef(false)
  const queued = useRef(false)
  planRef.current = plan
  settingsRef.current = settings

  /* ---------------------------------------------------------- boot */

  useEffect(() => {
    getBootstrap().then((b) => {
      setBoot(b)
      const first = Object.keys(b.configurations)[0]
      setConfigId(first)
      applyConfig(b, first)
      setStatus('ready')
    }).catch((err) => setStatus(`cannot reach the engine — ${err.message}`))
  }, [])

  useEffect(() => {
    getStandards(settings.user_group).then(setStd).catch(() => setStd(null))
  }, [settings.user_group])

  function applyConfig(b: Bootstrap, id: string) {
    const cfg = b.configurations[id]
    const next: Plan = {
      shell: b.shell,
      walls: clone(cfg.walls),
      doors: clone(cfg.doors),
      furniture: clone(cfg.furniture),
    }
    const nextSettings: Settings = {
      use: cfg.use, user_group: cfg.user_group,
      occupants: cfg.occupants, years: settingsRef.current.years,
    }
    setPlan(next)
    setSettings(nextSettings)
    setSelected(null)
    setHint(cfg.description)
    run(next, nextSettings)
  }

  /* ------------------------------------------------------ evaluate */

  const run = useCallback(async (p: Plan, s: Settings) => {
    if (busy.current) { queued.current = true; return }
    busy.current = true
    setStatus('computing…')
    const t0 = performance.now()
    try {
      const r = await evaluatePlan(p, s)
      setResult(r)
      setStatus(`${Math.round(performance.now() - t0)} ms`)
    } catch (err) {
      setStatus(`engine error — ${(err as Error).message}`)
    } finally {
      busy.current = false
      if (queued.current) {
        queued.current = false
        run(planRef.current!, settingsRef.current)
      }
    }
  }, [])

  // Re-evaluate whenever settings change. Changing the user group changes
  // the requirements, not just the scoring, so this is not cosmetic.
  useEffect(() => {
    if (plan) run(plan, settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const onPlanChange = useCallback((draft: Plan, commit: boolean) => {
    if (draft) setPlan(draft)
    if (commit) run(draft ?? planRef.current!, settingsRef.current)
  }, [run])

  /* --------------------------------------------------- add / remove */

  async function addFurniture(typeId: string) {
    if (!plan || !boot) return
    const spec = boot.furniture.find((f) => f.id === typeId)!
    setStatus('finding a spot…')
    const spot = await findPlacement(plan, typeId, settings)
    if (!spot.ok) {
      setHint(`Cannot place ${spec.name}. ${spot.reason}`)
      setStatus('ready')
      return
    }
    const draft = clone(plan)
    const id = `f${Date.now().toString(36)}`
    draft.furniture.push({ id, type: typeId, x: spot.x!, y: spot.y!, rot: spot.rot! })
    setPlan(draft)
    setSelected({ kind: 'furniture', id })
    setHint(
      `Placed ${spec.name} where it fits — back to a wall, clear of everything else's ` +
      `approach space. Drag it if you want it somewhere particular.`,
    )
    run(draft, settings)
  }

  const removeSelected = useCallback(() => {
    if (!plan || !selected) return
    const draft = clone(plan)
    if (selected.kind === 'furniture') {
      draft.furniture = draft.furniture.filter((f) => f.id !== selected.id)
    } else if (selected.kind === 'wall') {
      draft.walls = draft.walls.filter((w) => w.id !== selected.id)
      draft.doors = draft.doors.filter((d) => d.wall_id !== selected.id)
    } else {
      draft.doors = draft.doors.filter((d) => d.id !== selected.id)
    }
    setPlan(draft)
    setSelected(null)
    run(draft, settings)
  }, [plan, selected, settings, run])

  const rotateSelected = useCallback(() => {
    if (!plan || selected?.kind !== 'furniture') return
    const draft = clone(plan)
    const item = draft.furniture.find((f) => f.id === selected.id)!
    item.rot = ((item.rot || 0) + 90) % 360
    setPlan(draft)
    run(draft, settings)
  }, [plan, selected, settings, run])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.matches('input,select,textarea')) return
      if (e.key === 'Escape') { setDrawStart(null); setSelected(null) }
      if (e.key === 'r' || e.key === 'R') rotateSelected()
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rotateSelected, removeSelected])

  /* ------------------------------------------------------- render */

  if (!boot || !plan) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <p className="font-mono text-xs">{status}</p>
      </div>
    )
  }

  const group = boot.user_groups.find((g) => g.id === settings.user_group)
  const byCategory: Record<string, typeof boot.furniture> = {}
  boot.furniture.forEach((f) => { (byCategory[f.category] ??= []).push(f) })

  const selLabel = selected
    ? selected.kind === 'furniture'
      ? boot.furniture.find((f) => f.id === plan.furniture.find((x) => x.id === selected.id)?.type)?.name
      : selected.kind === 'wall'
        ? boot.wall_types.find((t) => t.id === plan.walls.find((w) => w.id === selected.id)?.component)?.name
        : 'Door'
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ------------------------------------------------ header */}
      <header className="flex flex-none flex-wrap items-center gap-3.5 border-b border-line bg-surface px-4 py-2">
        <h1 className="whitespace-nowrap text-[14px] font-semibold">
          Apartment Lab
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            Marievik+
          </span>
        </h1>

        <Field label="Config">
          <select value={configId}
            onChange={(e) => { setConfigId(e.target.value); applyConfig(boot, e.target.value) }}
            className="rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]">
            {Object.entries(boot.configurations).map(([id, c]) => (
              <option key={id} value={id}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Use">
          <select value={settings.use}
            onChange={(e) => setSettings({ ...settings, use: e.target.value })}
            className="rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]">
            {boot.uses.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>

        <Field label="Designing for">
          <select value={settings.user_group}
            onChange={(e) => setSettings({ ...settings, user_group: e.target.value })}
            className="rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]">
            {boot.user_groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>

        <Field label="Occupants">
          <input type="number" min={1} max={6} value={settings.occupants}
            onChange={(e) => setSettings({ ...settings, occupants: +e.target.value })}
            className="w-14 rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]" />
        </Field>

        <Field label="Years">
          <input type="number" min={5} max={60} step={5} value={settings.years}
            onChange={(e) => setSettings({ ...settings, years: +e.target.value })}
            className="w-14 rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]" />
        </Field>

        <span className={`ml-auto whitespace-nowrap font-mono text-[10.5px] ${
          status.includes('error') || status.includes('cannot') ? 'text-critical'
            : status.includes('…') ? 'text-accent' : 'text-muted'}`}>
          {status}
        </span>
      </header>

      {/* ------------------------------------------------ body */}
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)_340px]">
        {/* ---------------------------- left rail */}
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-surface p-3">
          <Group title="Tool">
            <div className="flex flex-wrap gap-1">
              {(['select', 'wall', 'door'] as Tool[]).map((t) => (
                <button key={t} onClick={() => { setTool(t); setDrawStart(null); setSelected(null) }}
                  className={btn(tool === t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Group>

          <Group title="Wall type">
            {boot.wall_types.map((w) => (
              <button key={w.id} title={`${w.name}\nReversibility ${w.reversibility} · recovery ${w.recovery_rate}\n${Math.round(w.cost_m2)} SEK/m² · ${Math.round(w.carbon_m2)} kgCO₂e/m²\n\n${w.notes}`}
                onClick={() => {
                  setWallType(w.id)
                  if (selected?.kind === 'wall') {
                    const draft = clone(plan)
                    const wall = draft.walls.find((x) => x.id === selected.id)
                    if (wall) { wall.component = w.id; setPlan(draft); run(draft, settings) }
                  }
                }}
                className={`${btn(wallType === w.id)} mb-0.5 flex w-full items-baseline justify-between gap-2 text-left`}>
                <span className="truncate">{w.short}</span>
                <em className="shrink-0 font-mono text-[10px] not-italic text-muted">
                  Rw{w.rw}
                </em>
              </button>
            ))}
          </Group>

          <Group title="Add furniture">
            {Object.entries(byCategory).map(([cat, items]) => (
              <div key={cat} className="mb-2">
                <div className="mb-1 mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                  {cat}
                </div>
                {items.map((f) => (
                  <button key={f.id} onClick={() => addFurniture(f.id)}
                    title={`${f.name}\n${Math.round(f.cost_sek)} SEK · ${Math.round(f.carbon_kgco2e)} kgCO₂e\nNeeds ${f.clearance_front_mm} mm in front${f.clearance_side_mm ? `, ${f.clearance_side_mm} mm to one side` : ''}${f.notes ? `\n\n${f.notes}` : ''}`}
                    className={`${btn(false)} mb-0.5 flex w-full items-baseline justify-between gap-2 text-left`}>
                    <span className="truncate">{f.name.replace(/ \d+×\d+$/, '')}</span>
                    <em className="shrink-0 font-mono text-[10px] not-italic text-muted">
                      {f.w}×{f.d}
                    </em>
                  </button>
                ))}
              </div>
            ))}
          </Group>

          <Group title="Show">
            {([
              ['turning', `Where ${group?.turning_circle ?? 1200} mm turning fits`],
              ['clearance', 'Clearance zones'],
              ['rooms', 'Room areas'],
              ['grid', '1 m grid'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={show[key]}
                  onChange={(e) => setShow({ ...show, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </Group>

          <Group title="Compare">
            <button className={`${btn(false)} mb-1 w-full text-left`}
              onClick={() => setBaseline(result)}>
              Set current as baseline
            </button>
            <button className={`${btn(false)} w-full text-left`} disabled={!baseline}
              onClick={() => setBaseline(null)}>
              Clear baseline
            </button>
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              {baseline
                ? 'Every figure now shows its difference from the baseline.'
                : 'Set a baseline, then change the plan: every figure shows the difference.'}
            </p>
          </Group>

          <Group title="Plan">
            <button className={`${btn(false)} mb-1 w-full text-left`}
              onClick={() => applyConfig(boot, configId)}>
              Reset to configuration
            </button>
            <button className={`${btn(false)} w-full text-left`}
              onClick={() => navigator.clipboard.writeText(JSON.stringify(plan, null, 2))}>
              Copy plan JSON
            </button>
          </Group>
        </aside>

        {/* ---------------------------- centre */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex-1 overflow-auto p-4">
            <PlanCanvas
              boot={boot} plan={plan} result={result} tool={tool} selected={selected}
              wallType={wallType} doorClear={group?.door_clear ?? 850}
              drawStart={drawStart} show={show}
              onSelect={setSelected} onChange={onPlanChange} onDrawStart={setDrawStart}
            />
          </div>
          <div className="min-h-[34px] flex-none border-t border-line bg-surface px-4 py-1.5 text-[12px] text-muted">
            {selLabel && <b className="mr-2 font-medium text-ink-2">{selLabel} selected.</b>}
            {tool === 'wall'
              ? drawStart
                ? 'Click the other end of the wall. Esc cancels.'
                : 'Click one end of the wall, then the other. Walls stay orthogonal.'
              : tool === 'door'
                ? 'Click a wall to put a door there. Click a door to remove it.'
                : hint || 'Click to select, drag to move. R rotates, Delete removes, Esc deselects.'}
          </div>
        </section>

        {/* ---------------------------- right panel */}
        <div className="flex min-h-0 flex-col border-l border-line bg-surface">
          <div className="flex flex-none gap-1 border-b border-line px-3 py-2">
            {(['kpi', 'standards'] as const).map((t) => (
              <button key={t} onClick={() => setRightTab(t)} className={btn(rightTab === t)}>
                {t === 'kpi' ? 'Results' : 'Standards'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {rightTab === 'kpi'
              ? (result
                ? <KpiPanel result={result} baseline={baseline} />
                : <p className="font-mono text-xs text-muted">{status}</p>)
              : (std
                ? <StandardsPanel std={std} />
                : <p className="font-mono text-xs text-muted">no standards for this group</p>)}
          </div>
        </div>
      </main>

      <footer className="flex-none border-t border-line bg-surface px-4 py-1.5 font-mono text-[10px] text-muted">
        {boot.provenance} · all costs and carbon are placeholders for model development
      </footer>
    </div>
  )
}

/* ---------------------------------------------------------------- bits */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-[0.07em] text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
        {title}
      </h3>
      {children}
    </div>
  )
}

const btn = (active: boolean) =>
  `rounded border px-2 py-1 text-[12px] transition-colors disabled:opacity-45 ${
    active
      ? 'border-accent bg-accent text-white'
      : 'border-line-strong bg-raised text-ink-2 hover:border-accent hover:text-accent'
  }`
