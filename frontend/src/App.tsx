import { useCallback, useEffect, useRef, useState } from 'react'
import {
  arrange, findPlacement, fmt, getBootstrap, getScenarios, getStandards, refreshScenarios, scorePlan,
  simulateThermal,
} from './api'
import { PlanCanvas, comfortColor } from './components/PlanCanvas'
import { KpiPanel } from './components/KpiPanel'
import { StandardsPanel } from './components/StandardsPanel'
import { CRIT_COLOR, CRIT_SHORT, ParamPanel, fmtCrit } from './components/ParamPanel'
import { OptimisePanel } from './components/OptimisePanel'
import { ScenariosPanel, bestPerUse, frameFor } from './components/ScenariosPanel'
import type {
  Bootstrap, Criteria, EvalResult, Job, OptionResult, Plan, ScenarioState, Selection, Settings,
  StandardsSummary, SweepFrame, ThermalResult, Tool,
} from './types'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
type RightTab = 'scenarios' | 'results' | 'parameters' | 'optimise' | 'standards'

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [shellId, setShellId] = useState('')
  const [configId, setConfigId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [baseline, setBaseline] = useState<EvalResult | null>(null)
  const [thermal, setThermal] = useState<ThermalResult | null>(null)
  const [thermalStale, setThermalStale] = useState(true)
  const [thermalBusy, setThermalBusy] = useState(false)
  const [autoThermal, setAutoThermal] = useState(false)
  const [preview, setPreview] = useState<SweepFrame | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [std, setStd] = useState<StandardsSummary | null>(null)
  const [settings, setSettings] = useState<Settings>({
    use: 'student_housing', user_group: 'adult', occupants: 1, years: 50,
  })
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<Selection>(null)
  const [wallType, setWallType] = useState('part.demount.solid.100')
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('scenarios')
  const [scenarios, setScenarios] = useState<ScenarioState | null>(null)
  const [playing, setPlaying] = useState(false)
  const [scenarioNonce, setScenarioNonce] = useState(0)
  const [currentUse, setCurrentUse] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ plan: Plan; settings: Settings } | null>(null)
  const playTimer = useRef<number | null>(null)
  const autoplayed = useRef<Set<string>>(new Set())
  const scenariosRef = useRef<ScenarioState | null>(null)
  scenariosRef.current = scenarios
  const [status, setStatus] = useState('loading…')
  const [hint, setHint] = useState('')
  const [show, setShow] = useState({
    clearance: false, turning: false, rooms: true, grid: false, comfort: true,
  })

  const planRef = useRef<Plan | null>(null)
  const settingsRef = useRef(settings)
  const thermalRef = useRef<ThermalResult | null>(null)
  const busy = useRef(false)
  const queued = useRef(false)
  const thermalTimer = useRef<number | null>(null)
  const autoRef = useRef(autoThermal)
  planRef.current = plan
  settingsRef.current = settings
  thermalRef.current = thermal
  autoRef.current = autoThermal

  /* ---------------------------------------------------------- boot */

  useEffect(() => {
    getBootstrap().then((b) => {
      setBoot(b)
      loadShell(b, b.default_shell)
      setStatus('ready')
    }).catch((err) => setStatus(`cannot reach the engine — ${err.message}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getStandards(settings.user_group).then(setStd).catch(() => setStd(null))
  }, [settings.user_group])

  function loadShell(b: Bootstrap, id: string) {
    setShellId(id)
    const configs = b.shells[id].configurations
    const first = Object.keys(configs).find((k) => k !== 'as_drawn') ?? Object.keys(configs)[0]
    setConfigId(first)
    applyConfig(b, id, first)
    setThermal(null)
    setThermalStale(true)
    setBaseline(null)
  }

  function applyConfig(b: Bootstrap, sid: string, id: string) {
    const entry = b.shells[sid]
    const cfg = entry.configurations[id]
    const next: Plan = {
      shell: clone(entry.shell),
      walls: clone(cfg.walls),
      doors: clone(cfg.doors),
      furniture: clone(cfg.furniture),
    }
    const nextSettings: Settings = {
      use: cfg.use, user_group: cfg.user_group, occupants: cfg.occupants,
      years: settingsRef.current.years, shell_id: sid,
    }
    setPlan(next)
    setSettings(nextSettings)
    setSelected(null)
    setPreview(null)
    setHint(cfg.description)
    run(next, nextSettings)
    markThermalStale(next, nextSettings)
  }

  /* ------------------------------------------------------ evaluate */

  // Simulated heating and comfort feed the cost and carbon once known.
  const withThermal = (s: Settings): Settings => {
    const t = thermalRef.current
    return t?.ok ? { ...s, heating_kwh_m2: t.heating_kwh_m2, cooling_kwh_m2: t.cooling_kwh_m2, comfort: t.comfort } : s
  }

  const run = useCallback(async (p: Plan, s: Settings) => {
    if (busy.current) { queued.current = true; return }
    busy.current = true
    setStatus('computing…')
    const t0 = performance.now()
    try {
      const r = await scorePlan(p, withThermal(s))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runThermal(p = planRef.current, s = settingsRef.current) {
    if (!p) return
    setThermalBusy(true)
    setStatus('simulating comfort in EnergyPlus…')
    try {
      const t = await simulateThermal(p, s)
      setThermal(t)
      thermalRef.current = t
      setThermalStale(false)
      setStatus(t.ok ? `comfort simulated in ${t.seconds} s` : `simulation failed — ${t.error}`)
      run(p, s)
    } catch (err) {
      setStatus(`simulation error — ${(err as Error).message}`)
    } finally {
      setThermalBusy(false)
    }
  }

  function markThermalStale(p: Plan, s: Settings) {
    setThermalStale(true)
    if (thermalTimer.current) window.clearTimeout(thermalTimer.current)
    if (autoRef.current) thermalTimer.current = window.setTimeout(() => runThermal(p, s), 1200)
  }

  useEffect(() => {
    if (plan) { run(plan, settings); markThermalStale(plan, settings) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const onPlanChange = useCallback((draft: Plan, commit: boolean) => {
    if (draft) setPlan(draft)
    if (commit) {
      const p = draft ?? planRef.current!
      run(p, settingsRef.current)
      markThermalStale(p, settingsRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  function commit(draft: Plan, s: Settings = settings) {
    setPlan(draft)
    if (s !== settings) setSettings(s)
    else { run(draft, s); markThermalStale(draft, s) }
  }

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
    setSelected({ kind: 'furniture', id })
    setHint(`Placed ${spec.name} where it fits. Drag it if you want it somewhere particular.`)
    commit(draft)
  }

  async function autoArrange() {
    if (!plan) return
    setStatus('arranging furniture…')
    try {
      const r = await arrange(plan, settings, 1)
      if (r.variants[0]) commit({ ...clone(plan), furniture: r.variants[0].furniture })
    } catch (e) {
      setStatus(`engine error — ${(e as Error).message}`)
    }
  }

  const removeSelected = useCallback(() => {
    if (!plan || !selected) return
    const draft = clone(plan)
    if (selected.kind === 'furniture') {
      draft.furniture = draft.furniture.filter((f) => f.id !== selected.id)
    } else if (selected.kind === 'wall') {
      draft.walls = draft.walls.filter((w) => w.id !== selected.id)
      draft.doors = draft.doors.filter((d) => d.wall_id !== selected.id)
    } else if (selected.kind === 'door') {
      draft.doors = draft.doors.filter((d) => d.id !== selected.id)
    } else {
      draft.shell.windows.splice(selected.index, 1)
    }
    setSelected(null)
    commit(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, selected, settings])

  const rotateSelected = useCallback(() => {
    if (!plan || selected?.kind !== 'furniture') return
    const draft = clone(plan)
    const item = draft.furniture.find((f) => f.id === selected.id)!
    item.rot = ((item.rot || 0) + 90) % 360
    commit(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, selected, settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.matches('input,select,textarea')) return
      if (e.key === 'Escape') { setDrawStart(null); setSelected(null); stopPlay() }
      if (e.key === 'r' || e.key === 'R') rotateSelected()
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rotateSelected, removeSelected])

  function openOption(o: OptionResult) {
    if (!boot) return
    const p = clone(o.plan)
    const s: Settings = { ...settings, use: o.use, user_group: o.user_group, occupants: o.occupants, shell_id: shellId }
    stopPlay(false)
    setPreview(null)
    setSelected(null)
    setPlan(p)
    setSettings(s)
    if (o.thermal) {
      setThermal(null)
    }
    setHint(`Opened: ${o.description}. Everything is editable; the optimiser's numbers update as you go.`)
  }

  /* ------------------------------------------------------ scenarios */

  // Fetch (and if needed, start computing) every use's best layouts for this
  // flat as soon as it opens. Poll until ready, then play through them.
  useEffect(() => {
    if (!shellId) return
    let cancelled = false
    let timer: number | null = null
    setScenarios(null)
    const tick = async () => {
      try {
        const s = await getScenarios(shellId)
        if (cancelled) return
        setScenarios(s)
        if (s.status === 'running') timer = window.setTimeout(tick, 3000)
        else if (s.status === 'ready' && !autoplayed.current.has(shellId)) {
          autoplayed.current.add(shellId)
          startPlay(s)
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 5000)
      }
    }
    tick()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellId, scenarioNonce])

  function showUse(use: string, o: OptionResult, label?: string) {
    setCurrentUse(use)
    setPreview(frameFor(label ?? boot!.briefs.find((b) => b.id === use)?.label ?? use, o, shellId, settings.years))
  }

  function startPlay(state = scenariosRef.current) {
    const best = bestPerUse(state)
    if (!best.length) return
    if (playTimer.current) window.clearInterval(playTimer.current)
    let i = 0
    showUse(best[0].use, best[0].option, best[0].label)
    setPlaying(true)
    playTimer.current = window.setInterval(() => {
      i = (i + 1) % best.length
      showUse(best[i].use, best[i].option, best[i].label)
    }, 3200)
  }

  function stopPlay(backToPlan = true) {
    if (playTimer.current) window.clearInterval(playTimer.current)
    playTimer.current = null
    setPlaying(false)
    if (backToPlan) { setPreview(null); setCurrentUse(null) }
  }

  useEffect(() => () => { if (playTimer.current) window.clearInterval(playTimer.current) }, [])

  // Choosing a use loads that use's best layout, with a way back.
  function chooseUse(use: string) {
    stopPlay(false)
    const best = bestPerUse(scenariosRef.current).find((b) => b.use === use)
    if (best && plan) {
      setUndo({ plan: clone(plan), settings: { ...settings } })
      openOption(best.option)
      setCurrentUse(use)
      setHint(`Loaded the least-regret layout for ${best.label.toLowerCase()}: ${best.option.description}.`)
    } else {
      setPreview(null)
      setSettings({ ...settings, use })
    }
  }

  function doUndo() {
    if (!undo) return
    setPreview(null)
    setPlan(undo.plan)
    setSettings(undo.settings)
    setUndo(null)
    setHint('Back to your previous layout.')
  }

  /* ------------------------------------------------------- render */

  if (!boot || !plan) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <p className="font-mono text-xs">{status}</p>
      </div>
    )
  }

  const shellEntry = boot.shells[shellId]
  const group = boot.user_groups.find((g) => g.id === settings.user_group)
  const byCategory: Record<string, typeof boot.furniture> = {}
  boot.furniture.forEach((f) => { (byCategory[f.category] ??= []).push(f) })
  const shownPlan = preview?.plan ?? plan
  const crit: Criteria = preview?.criteria ?? {
    ...(result?.criteria ?? {}),
    ...(thermal?.ok ? { comfort: thermal.comfort } : {}),
  }
  const baseCrit = baseline?.criteria
  const selectedWall = selected?.kind === 'wall' ? selected.id : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ------------------------------------------------ header */}
      <header className="flex flex-none flex-wrap items-center gap-3.5 border-b-[3px] border-b-[#b9d35b] bg-accent-soft px-4 py-2">
        <h1 className="whitespace-nowrap text-[14px] font-semibold">
          Apartment Lab
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Marievik+</span>
        </h1>

        <Field label="Flat" id="h-shell">
          <select id="h-shell" value={shellId} onChange={(e) => loadShell(boot, e.target.value)} className={selCls}>
            {Object.entries(boot.shells).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
        </Field>

        <Field label="Start from" id="h-config">
          <select id="h-config" value={configId}
            onChange={(e) => { setConfigId(e.target.value); applyConfig(boot, shellId, e.target.value) }}
            className={selCls}>
            {Object.entries(shellEntry.configurations).map(([id, c]) => (
              <option key={id} value={id}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Use" id="h-use">
          <select id="h-use" value={settings.use}
            onChange={(e) => chooseUse(e.target.value)} className={selCls}>
            {boot.uses.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>

        <Field label="Designing for" id="h-group">
          <select id="h-group" value={settings.user_group}
            onChange={(e) => setSettings({ ...settings, user_group: e.target.value })} className={selCls}>
            {boot.user_groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>

        <Field label="People" id="h-occ">
          <input id="h-occ" type="number" min={1} max={8} value={settings.occupants}
            onChange={(e) => setSettings({ ...settings, occupants: +e.target.value })}
            className="w-14 rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]" />
        </Field>

        <span className={`ml-auto whitespace-nowrap font-mono text-[10.5px] ${
          status.includes('error') || status.includes('cannot') || status.includes('failed') ? 'text-critical'
            : status.includes('…') ? 'text-accent' : 'text-muted'}`}>
          {status}
        </span>
      </header>

      {/* ------------------------------------------------ body */}
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_380px]">
        {/* ---------------------------- left rail */}
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-surface p-3">
          <Group title="Tool">
            <div className="flex flex-wrap gap-1">
              {(['select', 'wall', 'door', 'window'] as Tool[]).map((t) => (
                <button key={t} type="button" onClick={() => { setTool(t); setDrawStart(null); setSelected(null) }}
                  className={btn(tool === t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Group>

          {selected && (
            <Group title="Selected">
              <Inspector boot={boot} plan={plan} selected={selected} wallType={wallType}
                onChange={commit} onRemove={removeSelected} onRotate={rotateSelected} />
            </Group>
          )}

          <Group title="Wall type for new walls">
            {boot.wall_types.map((w) => (
              <button key={w.id} type="button"
                title={`${w.name}\nReversibility ${w.reversibility} · recovery ${w.recovery_rate}\n${Math.round(w.cost_m2)} SEK/m² · ${Math.round(w.carbon_m2)} kgCO₂e/m²\n\n${w.notes}`}
                onClick={() => setWallType(w.id)}
                className={`${btn(wallType === w.id)} mb-0.5 flex w-full items-baseline justify-between gap-2 text-left`}>
                <span className="truncate">{w.short}</span>
                <em className="shrink-0 font-mono text-[10px] not-italic text-muted">Rw{w.rw}</em>
              </button>
            ))}
          </Group>

          <Group title="Furniture">
            <button type="button" className={`${btn(false)} mb-2 w-full text-left`} onClick={autoArrange}>
              Arrange furniture automatically
            </button>
            {Object.entries(byCategory).map(([cat, items]) => (
              <details key={cat} className="mb-1">
                <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                  {cat} · {items.length}
                </summary>
                {items.map((f) => (
                  <button key={f.id} type="button" onClick={() => addFurniture(f.id)}
                    title={`${f.name}\n${Math.round(f.cost_sek)} SEK · ${Math.round(f.carbon_kgco2e)} kgCO₂e\nNeeds ${f.clearance_front_mm} mm in front`}
                    className={`${btn(false)} my-0.5 flex w-full items-baseline justify-between gap-2 text-left`}>
                    <span className="truncate">{f.name.replace(/ \d+×\d+.*$/, '')}</span>
                    <em className="shrink-0 font-mono text-[10px] not-italic text-muted">{f.w}×{f.d}</em>
                  </button>
                ))}
              </details>
            ))}
          </Group>

          <Group title="Show">
            {([
              ['comfort', 'Thermal comfort per room'],
              ['turning', `Where ${group?.turning_circle ?? 1200} mm turning fits`],
              ['clearance', 'Clearance zones'],
              ['rooms', 'Room areas'],
              ['grid', '1 m grid'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                <input id={`show-${key}`} type="checkbox" checked={show[key]}
                  onChange={(e) => setShow({ ...show, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </Group>

          <Group title="Compare">
            <button type="button" className={`${btn(false)} mb-1 w-full text-left`}
              onClick={() => setBaseline(result ? { ...result, criteria: { ...crit } } : null)}>
              Set current as baseline
            </button>
            <button type="button" className={`${btn(false)} w-full text-left`} disabled={!baseline}
              onClick={() => setBaseline(null)}>
              Clear baseline
            </button>
          </Group>

          <Group title="Plan">
            <button type="button" className={`${btn(false)} mb-1 w-full text-left`}
              onClick={() => applyConfig(boot, shellId, configId)}>
              Reset to starting point
            </button>
            <button type="button" className={`${btn(false)} w-full text-left`}
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(plan, null, 2)).catch(() => {})}>
              Copy plan JSON
            </button>
          </Group>
        </aside>

        {/* ---------------------------- centre */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <CriteriaStrip boot={boot} crit={crit} base={baseCrit} thermal={thermal} stale={thermalStale}
            busy={thermalBusy} auto={autoThermal} preview={!!preview}
            onSimulate={() => runThermal()} onAuto={(v) => { setAutoThermal(v); if (v && thermalStale) runThermal() }} />
          <div className="flex-1 overflow-auto p-4">
            <PlanCanvas
              boot={boot} plan={shownPlan} result={preview ? null : result}
              thermal={preview?.thermal ?? (thermalStale ? null : thermal)}
              tool={tool} selected={preview ? null : selected}
              wallType={wallType} doorClear={group?.door_clear ?? 850}
              drawStart={drawStart} show={show} preview={!!preview}
              previewLabel={preview ? String(preview.value) : undefined}
              onSelect={setSelected} onChange={onPlanChange} onDrawStart={setDrawStart}
            />
          </div>
          <div className="min-h-[34px] flex-none border-t border-line bg-surface px-4 py-1.5 text-[12px] text-muted">
            {preview
              ? <span className="flex flex-wrap items-center gap-2">
                  <b className="text-ink-2">Showing: {String(preview.value)}{currentUse ? ' · least-regret layout' : ''}.</b>
                  {playing ? 'Playing through the uses.' : ''}
                  {currentUse && !playing && (
                    <button type="button" className="text-accent hover:underline" onClick={() => {
                      const b = bestPerUse(scenarios).find((x) => x.use === currentUse)
                      if (b) { setUndo({ plan: clone(plan), settings: { ...settings } }); openOption(b.option) }
                    }}>Open it in the editor</button>
                  )}
                  <button type="button" className="text-accent hover:underline" onClick={() => stopPlay()}>
                    {playing ? 'Stop' : 'Back to my plan'}
                  </button>
                </span>
              : tool === 'wall'
                ? drawStart ? 'Click the other end of the wall. Esc cancels.' : 'Click one end of the wall, then the other. Walls stay orthogonal.'
                : tool === 'door'
                  ? 'Click a wall to put a door there. Click a door to remove it.'
                  : tool === 'window'
                    ? 'Click on the facade to add a window. Select one to edit its size, sill and glazing.'
                    : undo
                      ? <span>{hint} <button type="button" className="ml-1 text-accent hover:underline" onClick={doUndo}>Undo</button></span>
                      : hint || 'Click to select, drag to move. Windows slide along the facade; drag their ends to resize. R rotates, Delete removes.'}
          </div>
        </section>

        {/* ---------------------------- right panel */}
        <div className="flex min-h-0 flex-col border-l border-line bg-surface">
          <div className="flex flex-none gap-1 border-b border-line px-3 py-2">
            {([
              ['scenarios', 'Scenarios'], ['results', 'Results'], ['parameters', 'Parameters'], ['optimise', 'Optimise'], ['standards', 'Standards'],
            ] as const).map(([t, l]) => (
              <button key={t} type="button" onClick={() => setRightTab(t)} className={btn(rightTab === t)}>{l}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {rightTab === 'scenarios' && (
              <ScenariosPanel boot={boot} state={scenarios} playing={playing} current={currentUse}
                onPlay={() => startPlay()} onStop={() => stopPlay()}
                onShow={(use, o) => { stopPlay(false); showUse(use, o) }}
                onOpen={(o) => { setUndo({ plan: clone(plan), settings: { ...settings } }); openOption(o) }}
                onRefresh={() => { setScenarios(null); autoplayed.current.delete(shellId); refreshScenarios(shellId).then(() => setScenarioNonce((n) => n + 1)).catch(() => {}) }} />
            )}
            {rightTab === 'results' && (result
              ? <>
                  {thermal?.ok && !thermalStale && <ThermalCard t={thermal} />}
                  {result.functionality_detail && <FunctionCard detail={result.functionality_detail} />}
                  <KpiPanel result={result} baseline={baseline} />
                </>
              : <p className="font-mono text-xs text-muted">{status}</p>)}
            {rightTab === 'parameters' && (
              <ParamPanel boot={boot} plan={plan} settings={{ ...settings, shell_id: shellId }}
                selectedWall={selectedWall}
                onApply={(p, s) => { setPreview(null); commit(p, { ...s, shell_id: shellId }) }}
                onPreview={setPreview} setStatus={setStatus} />
            )}
            {rightTab === 'optimise' && (
              <OptimisePanel boot={boot} shellId={shellId} onOpen={openOption} job={job} setJob={setJob} />
            )}
            {rightTab === 'standards' && (std
              ? <StandardsPanel std={std} />
              : <p className="font-mono text-xs text-muted">no standards for this group</p>)}
          </div>
        </div>
      </main>

      <footer className="flex-none border-t border-line bg-surface px-4 py-1.5 font-mono text-[10px] text-muted">
        {shellEntry.meta?.source ? `${shellEntry.label} · traced plan, verify on site · ` : ''}
        {boot.provenance} · costs, carbon and products are placeholders
      </footer>
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

function CriteriaStrip({
  crit, base, thermal, stale, busy, auto, preview, onSimulate, onAuto,
}: {
  boot: Bootstrap; crit: Criteria; base?: Criteria; thermal: ThermalResult | null; stale: boolean
  busy: boolean; auto: boolean; preview: boolean; onSimulate: () => void; onAuto: (v: boolean) => void
}) {
  const keys = ['lcc', 'carbon', 'comfort', 'usability', 'functionality'] as const
  return (
    <div className="flex flex-none flex-wrap items-stretch gap-2 border-b border-line bg-surface px-4 py-2">
      {keys.map((k) => {
        const v = crit[k]
        const b = base?.[k]
        const better = k === 'lcc' || k === 'carbon' ? -1 : 1
        const delta = v !== undefined && b !== undefined ? v - b : undefined
        const good = delta !== undefined && delta * better > 0
        const isComfort = k === 'comfort'
        return (
          <div key={k} className={`flex min-w-[112px] flex-1 flex-col rounded-md border bg-raised px-2.5 py-1.5 ${
            preview ? 'border-accent' : 'border-line'}`}>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.07em]" style={{ color: CRIT_COLOR[k] }}>
              {CRIT_SHORT[k]}
            </span>
            <span className="flex items-baseline gap-1.5">
              <b className="font-mono text-[16px] tabular-nums"
                style={isComfort && v !== undefined ? { color: comfortColor(v) } : undefined}>
                {fmtCrit(k, v)}
              </b>
              {delta !== undefined && Math.abs(delta) > 0.05 && (
                <span className={`font-mono text-[10.5px] ${good ? 'text-good' : 'text-critical'}`}>
                  {delta > 0 ? '+' : ''}{k === 'lcc' || k === 'carbon' ? fmt(delta) : delta.toFixed(0)}
                </span>
              )}
            </span>
            {isComfort && !preview && (
              <span className="flex items-center gap-1.5 text-[10.5px]">
                <button type="button" onClick={onSimulate} disabled={busy}
                  className="text-accent underline-offset-2 hover:underline disabled:opacity-50">
                  {busy ? 'simulating…' : thermal && !stale ? 're-run' : thermal ? 'out of date, re-run' : 'simulate'}
                </button>
                <label className="flex items-center gap-1 text-muted">
                  <input id="auto-thermal" type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
                  auto
                </label>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ThermalCard({ t }: { t: ThermalResult }) {
  return (
    <section className="mb-2 rounded-md border border-line bg-raised px-3 py-2.5">
      <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
        Thermal comfort · EN 16798-1 cat. II
      </h4>
      <div className="flex justify-between py-0.5 text-[12.5px]"><span>Comfortable hours</span>
        <b className="font-mono">{t.comfort_pct}%</b></div>
      <div className="flex justify-between py-0.5 text-[11.5px] text-muted"><span>Too warm · too cool</span>
        <span className="font-mono">{t.hot_pct}% · {t.cold_pct}%</span></div>
      <div className="flex justify-between py-0.5 text-[11.5px] text-muted"><span>Warmest room</span>
        <span className="font-mono">{t.worst_room}, {t.worst_hours_over_26} h &gt; 26 °C, peak {t.worst_max_c} °C</span></div>
      <div className="flex justify-between py-0.5 text-[11.5px] text-muted"><span>Space heating</span>
        <span className="font-mono">{t.heating_kwh_m2} kWh/m²·yr</span></div>
      {t.rooms?.map((r) => (
        <div key={r.space} className="flex justify-between border-t border-line py-0.5 text-[11.5px]">
          <span>{r.kind === 'wet' ? 'Bathroom' : r.label.replace('Habitable', 'Room')} · {r.area_m2} m²</span>
          <span className="font-mono" style={{ color: comfortColor(r.comfort_pct) }}>{r.comfort_pct}%</span>
        </div>
      ))}
    </section>
  )
}

function FunctionCard({ detail }: { detail: Record<string, number> }) {
  return (
    <section className="mb-2 rounded-md border border-line bg-raised px-3 py-2.5">
      <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">Functionality</h4>
      {Object.entries(detail).map(([k, v]) => (
        <div key={k} className="flex justify-between py-0.5 text-[12px]">
          <span>{k}</span><span className="font-mono">{v}</span>
        </div>
      ))}
    </section>
  )
}

function Inspector({
  boot, plan, selected, onChange, onRemove, onRotate,
}: {
  boot: Bootstrap; plan: Plan; selected: NonNullable<Selection>; wallType: string
  onChange: (p: Plan) => void; onRemove: () => void; onRotate: () => void
}) {
  const draft = () => clone(plan)
  const num = 'w-full rounded border border-line-strong bg-raised px-1.5 py-1 font-mono text-[12px]'
  const row = 'flex items-center justify-between gap-2 text-[12px]'
  if (selected.kind === 'window') {
    const w = plan.shell.windows[selected.index]
    if (!w) return null
    const set = (patch: Partial<typeof w>) => {
      const d = draft()
      Object.assign(d.shell.windows[selected.index], patch)
      onChange(d)
    }
    return (
      <div className="flex flex-col gap-1.5">
        <b className="text-[12.5px]">{w.door ? 'Balcony door' : 'Window'}</b>
        <label className={row} htmlFor="win-w">Width, mm
          <input id="win-w" type="number" step={50} value={w.x2 - w.x1} className={`${num} w-20`}
            onChange={(e) => { const c = (w.x1 + w.x2) / 2, h = +e.target.value / 2; set({ x1: Math.round(c - h), x2: Math.round(c + h) }) }} />
        </label>
        <label className={row} htmlFor="win-sill">Sill, mm
          <input id="win-sill" type="number" step={50} value={w.sill_mm} className={`${num} w-20`}
            onChange={(e) => set({ sill_mm: +e.target.value })} />
        </label>
        <label className={row} htmlFor="win-head">Head, mm
          <input id="win-head" type="number" step={50} value={w.head_mm} className={`${num} w-20`}
            onChange={(e) => set({ head_mm: +e.target.value })} />
        </label>
        <select id="win-glazing" value={w.glazing ?? 'existing'} className={num}
          onChange={(e) => set({ glazing: e.target.value as 'existing' | 'upgraded' })}>
          <option value="existing">Existing glazing</option>
          <option value="upgraded">New openable triple glazing</option>
        </select>
        <p className="text-[11px] leading-snug text-muted">
          New glazing and any glass beyond what was built are costed as facade works.
        </p>
        <button type="button" className={btn(false)} onClick={onRemove}>Remove window</button>
      </div>
    )
  }
  if (selected.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === selected.id)
    if (!w) return null
    return (
      <div className="flex flex-col gap-1.5">
        <b className="text-[12.5px]">Wall, {fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))} mm{w.fixed ? ' · fixed' : ''}</b>
        <select id="wall-type" value={w.component} className={num}
          onChange={(e) => { const d = draft(); d.walls.find((x) => x.id === w.id)!.component = e.target.value; onChange(d) }}>
          {boot.wall_types.map((t) => <option key={t.id} value={t.id}>{t.short}</option>)}
        </select>
        {w.fixed && <p className="text-[11px] text-muted">A wet-room wall: the optimiser keeps it. You can still move it here.</p>}
        <p className="text-[11px] text-muted">Drag to move. Play “Move selected wall” in Parameters to test positions.</p>
        <button type="button" className={btn(false)} onClick={onRemove}>Remove wall</button>
      </div>
    )
  }
  if (selected.kind === 'door') {
    const d0 = plan.doors.find((x) => x.id === selected.id)
    if (!d0) return null
    return (
      <div className="flex flex-col gap-1.5">
        <b className="text-[12.5px]">Door</b>
        <label className={row} htmlFor="door-clear">Clear width, mm
          <input id="door-clear" type="number" step={50} min={600} max={1400} value={d0.clear_mm} className={`${num} w-20`}
            onChange={(e) => { const d = draft(); d.doors.find((x) => x.id === d0.id)!.clear_mm = +e.target.value; onChange(d) }} />
        </label>
        <button type="button" className={btn(false)} onClick={onRemove}>Remove door</button>
      </div>
    )
  }
  const f = plan.furniture.find((x) => x.id === selected.id)
  if (!f) return null
  const spec = boot.furniture.find((x) => x.id === f.type)
  const products = boot.products.filter((p) => p.type === f.type)
  const chosen = products.find((p) => p.id === f.product)
  return (
    <div className="flex flex-col gap-1.5">
      <b className="text-[12.5px]">{spec?.name}{f.fixed ? ' · fitted' : ''}</b>
      <select id="furn-product" value={f.product ?? ''} className={num}
        onChange={(e) => { const d = draft(); const it = d.furniture.find((x) => x.id === f.id)!; it.product = e.target.value || undefined; onChange(d) }}>
        <option value="">Generic ({fmt(spec?.cost_sek ?? 0)} SEK)</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name.split(' — ')[1]} · {fmt(p.cost_sek)} SEK · {fmt(p.carbon_kgco2e)} kg</option>
        ))}
      </select>
      {chosen && (
        <p className="text-[11px] leading-snug text-muted">
          {chosen.service_life_years} yr life · {Math.round(chosen.recovery_rate * 100)}% recoverable · function {chosen.functionality}
          {chosen.functionality_note ? ` (${chosen.functionality_note})` : ''}
        </p>
      )}
      <div className="flex gap-1">
        <button type="button" className={btn(false)} onClick={onRotate}>Rotate</button>
        <button type="button" className={btn(false)} onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.07em] text-muted">{label}</label>
      {children}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-muted">{title}</h3>
      {children}
    </div>
  )
}

const selCls = 'rounded border border-line-strong bg-raised px-1.5 py-1 text-[12.5px]'

const btn = (active: boolean) =>
  `rounded border px-2 py-1 text-[12px] transition-colors disabled:opacity-45 ${
    active
      ? 'border-accent bg-accent text-white'
      : 'border-line-strong bg-raised text-ink-2 hover:border-accent hover:text-accent'
  }`
