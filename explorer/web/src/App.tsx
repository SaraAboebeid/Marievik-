import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, fmt1 } from './api'
import type { FullResult } from './api'
import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, FloorPayload, KpiResult, Level, Methods, SavedScenario,
  Settings, SitePayload, Unit, UnitComfort,
} from './types'
import { PROFILE_LABEL, PROJECTS, readChoice, writeChoice } from './profile'
import { ProfileKpis } from './ui/ProfileKpis'
import { MethodsDrawer } from './ui/MethodsDrawer'
import { Viewer, type Pick, type ViewOptions } from './viewer/Viewer'
import { dayOfYear, sunPosition } from './viewer/sun'
import { COMFORT_BINS, DF_BINS, comfortColor } from './viewer/colors'
import { Legend } from './ui/kit'
import { ScenarioPanel } from './ui/ScenarioPanel'
import { InfoPanel } from './ui/InfoPanel'
import { SunBar } from './ui/SunBar'
import { RhinoPanel, type RhinoLayer } from './ui/RhinoPanel'
import { CompareDrawer } from './ui/CompareDrawer'

export type Overlay = 'type' | 'daylight' | 'comfort'
export type Method = 'quick' | 'ladybug'

const STORE_KEY = 'marievik-explorer-saved'

export default function App() {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [site, setSite] = useState<SitePayload | null>(null)
  const [scen, setScen] = useState<Record<string, Settings>>({})
  const [bdata, setBdata] = useState<Record<string, BuildingPayload>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [level, setLevel] = useState<Level>({ kind: 'site' })
  const [floorData, setFloorData] = useState<FloorPayload | null>(null)
  const [dl, setDl] = useState<DaylightResult | null>(null)
  const [cf, setCf] = useState<ComfortResult | null>(null)
  const [unitComfort, setUnitComfort] = useState<UnitComfort | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('type')
  const [method, setMethod] = useState<Method>('quick')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [sun, setSun] = useState({ month: 6, day: 21, hour: 15 })
  // ?lite=1 starts without shadows and ambient occlusion (slow GPUs, remote desktops)
  const lite = new URLSearchParams(window.location.search).has('lite')
  const [view, setView] = useState<ViewOptions>({ sky: true, shadows: !lite, ao: !lite, explode: 0, labels: true })
  const [hover, setHover] = useState<{ p: Pick; x: number; y: number } | null>(null)
  const [saved, setSaved] = useState<SavedScenario[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') } catch { return [] }
  })
  const [showCompare, setShowCompare] = useState(false)
  const [rhinoLayers, setRhinoLayers] = useState<RhinoLayer[]>([])
  const [showGenerated, setShowGenerated] = useState(true)
  const [models, setModels] = useState<{ name: string; url: string; bytes: number }[]>([])
  const [choice, setChoice] = useState(readChoice)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [kpiResult, setKpiResult] = useState<KpiResult | null>(null)
  const [explain, setExplain] = useState<string | null>(null)   // Methods panel open (KPI id to show, or '')

  const buildingId = level.kind === 'site' ? null : level.building
  const settingsOf = useCallback((id: string) => scen[id] ?? site?.defaults, [scen, site])

  // ------------------------------------------------------------ profile KPIs and their methods
  useEffect(() => { writeChoice(choice.profile, choice.project) }, [choice])
  useEffect(() => { api.methods().then(setMethods).catch((e) => setError(String(e))) }, [])
  const bkey = buildingId ? bdata[buildingId]?.key : undefined
  useEffect(() => {
    if (!buildingId || !bkey) return
    let alive = true
    api.kpis(buildingId, settingsOf(buildingId) ?? {})
      .then((r) => { if (alive) setKpiResult(r) })
      .catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [buildingId, bkey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ viewer
  useEffect(() => {
    if (!host.current) return
    const v = new Viewer(host.current)
    viewer.current = v
    ;(window as unknown as { explorer: Viewer }).explorer = v
    return () => v.dispose()
  }, [])

  // ------------------------------------------------------------ site + every building's current scenario
  useEffect(() => {
    let alive = true
    api.site().then(async (s) => {
      if (!alive) return
      setSite(s)
      viewer.current?.setSite(s)
      const ids = s.buildings.map((b) => b.id)
      setLoading(Object.fromEntries(ids.map((i) => [i, true])))
      const queue = [...ids]
      const work = async () => {
        while (queue.length) {
          const id = queue.shift()!
          try {
            const p = await api.building(id, {})
            if (!alive) return
            setBdata((d) => ({ ...d, [id]: p }))
            viewer.current?.setBuilding(p)
          } catch (e) {
            setError(`${id}: ${(e as Error).message}`)
          } finally {
            setLoading((l) => ({ ...l, [id]: false }))
          }
        }
      }
      await Promise.all([work(), work(), work(), work()])
      viewer.current?.frameSite(true)
    }).catch((e) => setError(`Cannot reach the explorer server: ${(e as Error).message}`))
    api.capabilities().then(setCaps).catch(() => setCaps(null))
    api.models().then((m) => setModels(m.models)).catch(() => {})
    return () => { alive = false }
  }, [])

  // ------------------------------------------------------------ sun
  useEffect(() => {
    if (!site) return
    const p = sunPosition(site.location.lat, site.location.lon, site.location.tz, dayOfYear(sun.month, sun.day), sun.hour)
    viewer.current?.setSun(p.altitude, p.azimuth)
  }, [sun, site])

  useEffect(() => { viewer.current?.setOptions(view) }, [view])

  // ------------------------------------------------------------ scenario edits -> rebuild one building
  const timers = useRef<Record<string, number>>({})
  const updateScenario = useCallback((id: string, patch: Partial<Settings>) => {
    if (!site) return
    setScen((s) => {
      const next = { ...site.defaults, ...(s[id] ?? {}), ...patch }
      window.clearTimeout(timers.current[id])
      timers.current[id] = window.setTimeout(async () => {
        setLoading((l) => ({ ...l, [id]: true }))
        try {
          const p = await api.building(id, next)
          setBdata((d) => ({ ...d, [id]: p }))
          viewer.current?.setBuilding(p)
          setError(null)
        } catch (e) {
          setError((e as Error).message)
        } finally {
          setLoading((l) => ({ ...l, [id]: false }))
        }
      }, 250)
      return { ...s, [id]: next }
    })
    setDl(null); setCf(null); setUnitComfort(null); setOverlay('type')
  }, [site])

  // ------------------------------------------------------------ level changes
  const go = useCallback((l: Level) => {
    setLevel(l)
    setHover(null)
  }, [])

  const bKey = buildingId ? bdata[buildingId]?.key : undefined
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (level.kind === 'site' || level.kind === 'building') {
      v.setFocus(level)
      setFloorData(null)
      return
    }
    const b = bdata[level.building]
    if (!b) return
    const floor = Math.min(level.floor, b.floors.length - 1)
    if (floor !== level.floor) { setLevel({ kind: 'floor', building: level.building, floor }); return }
    if (floorData && floorData.building === level.building && floorData.index === floor && floorData.__key === b.key) {
      v.setFocus(level)
      return
    }
    setBusy('Laying out the floor…')
    api.floor(level.building, floor, settingsOf(level.building) ?? {}).then((fp) => {
      const tagged = Object.assign(fp, { __key: b.key })
      setFloorData(tagged)
      setDl(null); setCf(null); setUnitComfort(null); setOverlay('type')
      v.setFocus(level, false)
      v.setFloor(tagged)
    }).catch((e) => setError((e as Error).message)).finally(() => setBusy(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, bKey])

  // unit level: the unit's own comfort with its hottest week
  useEffect(() => {
    if (level.kind !== 'unit' || !floorData) { setUnitComfort(null); return }
    const u = floorData.units.find((x) => x.id === level.unit)
    if (!u || u.kind !== 'unit') { setUnitComfort(null); return }
    let alive = true
    api.comfort(level.building, level.floor, settingsOf(level.building) ?? {}, context(), level.unit)
      .then((r) => { if (alive) setUnitComfort(r.units[level.unit] ?? null) })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, floorData])

  // ------------------------------------------------------------ overlays
  useEffect(() => {
    const v = viewer.current
    if (!v || !floorData) return
    if (overlay === 'daylight' && dl) {
      const pts = Object.values(dl.units).flatMap((u) => u.points)
      v.showDaylight(pts, floorData.base + 0.85, 0.75)
      v.recolorUnits(() => null)
    } else {
      v.clearAnalysis()
      if (overlay === 'comfort' && cf) {
        v.recolorUnits((u: Unit) => (cf.units[u.id] ? comfortColor(cf.units[u.id].comfortable_pct) : null))
      } else v.recolorUnits(() => null)
    }
    if (level.kind === 'unit') v.setFocus(level, false)
  }, [overlay, dl, cf, floorData, level])

  // ------------------------------------------------------------ picking
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.onPick = (p) => {
      if (!p) return
      if (p.type === 'unit') return go({ kind: 'unit', building: p.building, floor: p.floor, unit: p.unit })
      if (level.kind === 'site' || p.building !== buildingId) return go({ kind: 'building', building: p.building })
      return go({ kind: 'floor', building: p.building, floor: p.floor })
    }
    v.onHover = (p, x, y) => setHover(p ? { p, x, y } : null)
  }, [level, buildingId, go])

  const up = useCallback(() => {
    if (level.kind === 'unit') go({ kind: 'floor', building: level.building, floor: level.floor })
    else if (level.kind === 'floor') go({ kind: 'building', building: level.building })
    else if (level.kind === 'building') go({ kind: 'site' })
  }, [level, go])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (explain !== null) return          // the Methods panel has the keyboard (Esc closes it)
      if (e.key === 'Escape' || e.key === 'Backspace') up()
      if (level.kind === 'floor' || level.kind === 'unit') {
        const b = bdata[level.building]
        if (e.key === 'PageUp' && b && level.floor < b.floors.length - 1) go({ kind: 'floor', building: level.building, floor: level.floor + 1 })
        if (e.key === 'PageDown' && level.floor > 0) go({ kind: 'floor', building: level.building, floor: level.floor - 1 })
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [up, level, bdata, go, explain])

  // ------------------------------------------------------------ analysis
  const context = useCallback(() => {
    const out: Record<string, Partial<Settings>> = {}
    for (const [id, s] of Object.entries(scen)) if (s.added_floors) out[id] = s
    return out
  }, [scen])

  const runQuick = async (what: 'daylight' | 'comfort') => {
    if (!floorData) return
    const b = floorData.building
    setBusy(what === 'daylight' ? 'Daylight factor (quick, CIE overcast sky)…' : 'Thermal comfort (quick 5R1C, 8760 h)…')
    try {
      if (what === 'daylight') {
        const r = await api.daylight(b, floorData.index, settingsOf(b) ?? {}, context())
        setDl(r); setOverlay('daylight')
      } else {
        const r = await api.comfort(b, floorData.index, settingsOf(b) ?? {}, context())
        setCf(r); setOverlay('comfort')
      }
      setError(null)
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const runFull = async () => {
    if (!floorData) return
    const b = floorData.building
    setBusy('Ladybug Tools: building the Honeybee model…')
    try {
      const { job } = await api.full(b, floorData.index, settingsOf(b) ?? {}, context())
      const t0 = Date.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        const j = await api.job(job)
        setBusy(`Ladybug Tools: ${j.status} (${Math.round((Date.now() - t0) / 1000)} s) — EnergyPlus + Radiance`)
        if (j.status === 'complete' && j.result) { applyFull(j.result, floorData); break }
        if (j.status === 'failed') throw new Error(j.error ?? 'simulation failed')
      }
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const applyFull = (r: FullResult, fp: FloorPayload) => {
    const msgs: string[] = []
    if (r.error) msgs.push(r.error)
    if (r.daylight?.ok && r.daylight.units) {
      const units = r.daylight.units
      const vals = Object.values(units).flatMap((u) => u.points.map((p) => p[2]))
      const n = Math.max(1, vals.length)
      setDl({
        building: fp.building, floor: fp.index, method: 'ladybug_tools', units,
        summary: {
          mean_df: vals.reduce((a, b) => a + b, 0) / n, area_300: vals.filter((v) => v >= 2.1).length / n,
          area_100: vals.filter((v) => v >= 0.7).length / n,
          units_pass: Object.values(units).filter((u) => u.pass_en17037).length, units: Object.keys(units).length, sensors: vals.length,
        },
        note: 'Radiance daylight factor (Honeybee, lbt-recipes daylight-factor).',
      })
      setOverlay('daylight')
    } else if (r.daylight) msgs.push(`Daylight: ${r.daylight.error}`)
    if (r.comfort?.ok && r.comfort.units) {
      const units = r.comfort.units
      const vals = Object.values(units)
      const area = vals.reduce((a, u) => a + u.area, 0) || 1
      const w = (k: keyof UnitComfort) => vals.reduce((a, u) => a + (u[k] as number) * u.area, 0) / area
      setCf({
        building: fp.building, floor: fp.index, method: 'ladybug_tools', units,
        summary: { comfortable_pct: w('comfortable_pct'), overheating_pct: w('overheating_pct'), too_cold_pct: w('too_cold_pct'),
          heating_kwh_m2: w('heating_kwh_m2'), cooling_kwh_m2: w('cooling_kwh_m2'), units: vals.length,
          max_op: Math.max(...vals.map((u) => u.max_op)) },
        note: 'EnergyPlus (Honeybee), EN 16798-1 adaptive cat. II, occupied hours.',
      })
      if (!(r.daylight?.ok)) setOverlay('comfort')
    } else if (r.comfort) msgs.push(`Comfort: ${r.comfort.error}`)
    setError(msgs.length ? msgs.join(' · ') : null)
  }

  // ------------------------------------------------------------ site totals and saved scenarios
  const totals = useMemo(() => {
    const bs = Object.values(bdata)
    return {
      gfa_m2: bs.reduce((a, b) => a + b.kpi.gfa_m2, 0),
      units: bs.reduce((a, b) => a + b.kpi.units, 0),
      capex_sek: bs.reduce((a, b) => a + b.kpi.capex_sek, 0),
      upfront_kgco2e: bs.reduce((a, b) => a + b.kpi.upfront_kgco2e, 0),
      added_gfa_m2: bs.reduce((a, b) => a + b.kpi.added_gfa_m2, 0),
      loaded: bs.length,
    }
  }, [bdata])

  const saveScenario = (name: string) => {
    if (!site) return
    const all: Record<string, Settings> = {}
    for (const b of site.buildings) all[b.id] = { ...site.defaults, ...(scen[b.id] ?? {}) }
    const s: SavedScenario = {
      id: Math.random().toString(36).slice(2, 9), name, created: new Date().toISOString(), scenarios: all,
      kpi: { gfa_m2: totals.gfa_m2, units: totals.units, capex_sek: totals.capex_sek, upfront_kgco2e: totals.upfront_kgco2e, added_gfa_m2: totals.added_gfa_m2 },
      analysis: floorData ? {
        building: floorData.building, floor: floorData.index, mean_df: dl?.summary.mean_df, area_300: dl?.summary.area_300,
        comfortable_pct: cf?.summary.comfortable_pct, overheating_pct: cf?.summary.overheating_pct,
      } : undefined,
    }
    const next = [...saved, s]
    setSaved(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* private window */ }
    setShowCompare(true)
  }
  const removeSaved = (id: string) => {
    const next = saved.filter((s) => s.id !== id)
    setSaved(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const restoreSaved = (s: SavedScenario) => {
    for (const [id, st] of Object.entries(s.scenarios)) {
      const cur = { ...site?.defaults, ...(scen[id] ?? {}) }
      if (JSON.stringify(cur) !== JSON.stringify(st)) updateScenario(id, st)
    }
  }

  // every building back to today's defaults, back to the site view, analyses and exploded view cleared
  const resetSite = () => {
    if (!site) return
    for (const id of site.buildings.map((x) => x.id)) updateScenario(id, { ...site.defaults })
    setView((v) => ({ ...v, explode: 0 }))
    setFloorData(null)
    go({ kind: 'site' })
  }

  // ------------------------------------------------------------ Rhino
  const loadRhino = async (src: string | ArrayBuffer, label: string) => {
    setBusy(`Loading ${label}…`)
    try {
      const layers = await viewer.current!.loadRhino(src)
      setRhinoLayers(layers)
      setError(null)
    } catch (e) { setError(`Rhino: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  // ------------------------------------------------------------ render
  const b = buildingId ? bdata[buildingId] : null
  const crumbs: { label: string; to: Level }[] = [{ label: 'Marievik', to: { kind: 'site' } }]
  if (level.kind !== 'site') crumbs.push({ label: `${level.building} ${b?.name ?? ''}`, to: { kind: 'building', building: level.building } })
  if (level.kind === 'floor' || level.kind === 'unit') crumbs.push({ label: `Floor ${level.floor}${b?.floors[level.floor]?.added ? ' (added)' : ''}`, to: { kind: 'floor', building: level.building, floor: level.floor } })
  if (level.kind === 'unit') crumbs.push({ label: floorData?.units.find((u) => u.id === level.unit)?.name ?? level.unit, to: level })

  const hoverText = (() => {
    if (!hover?.p) return null
    if (hover.p.type === 'unit') {
      const u = floorData?.units.find((x) => x.id === (hover.p as { unit: string }).unit)
      if (!u) return null
      const d = dl?.units[u.id]
      const c = cf?.units[u.id]
      return `${u.name} · ${fmt1(u.area)} m²${u.orientation ? ' · ' + u.orientation : ''}${d ? ` · DF ${fmt1(d.mean)} %` : ''}${c ? ` · ${fmt(c.comfortable_pct)} % comfortable` : ''}`
    }
    const bb = bdata[hover.p.building]
    const f = bb?.floors[hover.p.floor]
    return bb ? `${bb.id} ${bb.name} · floor ${hover.p.floor}${f ? ` · ${f.use_label}${f.added ? ' (added)' : ''}` : ''}` : hover.p.building
  })()

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />

      {/* top: title + breadcrumb */}
      <header className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-raised/95 px-3 py-1.5 shadow-sm">
          <a href="/" className="text-[12px] text-muted hover:text-ink" title="Back to the Digital Lab home page">←</a>
          <span className="text-[13px] font-semibold tracking-tight">Marievik+ Explorer</span>
          <span className="text-line-strong">|</span>
          <nav className="flex items-center gap-1 text-[12.5px]" aria-label="Level">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted">›</span>}
                <button className={`rounded px-1 ${i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-accent hover:underline'}`}
                  onClick={() => go(c.to)}>{c.label}</button>
              </span>
            ))}
          </nav>
          {level.kind !== 'site' && (
            <button onClick={up} className="ml-1 rounded border border-line px-1.5 text-[11px] text-muted hover:text-ink" title="Up one level (Esc)">↑ up</button>
          )}
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className="flex items-center gap-1.5 rounded-md border border-line bg-raised/95 px-2.5 py-1 text-[12px] shadow-sm"
            title={PROJECTS[choice.project].placeholder ? 'Placeholder project: shows the Marievik model until its own is added' : undefined}>
            <span className="h-2 w-2 rounded-full bg-c2" aria-hidden />
            {PROJECTS[choice.project].name}, {PROJECTS[choice.project].city}
            {PROJECTS[choice.project].placeholder && <span className="rounded bg-warn-bg px-1 font-mono text-[9.5px] text-warn">placeholder</span>}
          </span>
          <select value={choice.profile ?? ''} onChange={(e) => setChoice((c) => ({ ...c, profile: e.target.value || null }))}
            aria-label="Profile"
            className="rounded-md border border-line bg-raised/95 px-2 py-1 text-[12px] shadow-sm outline-none focus:border-accent">
            <option value="">No profile</option>
            {Object.entries(PROFILE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={() => setExplain('')}
            className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-medium text-white shadow-sm hover:brightness-110">
            Methods & data
          </button>
          {(busy || Object.values(loading).some(Boolean)) && (
            <span className="rounded-md border border-line bg-raised/95 px-2.5 py-1 font-mono text-[11px] text-ink-2 shadow-sm">
              {busy ?? `Laying out ${Object.values(loading).filter(Boolean).length} building(s)…`}
            </span>
          )}
          <button onClick={() => setShowCompare((s) => !s)}
            className="rounded-md border border-line bg-raised/95 px-2.5 py-1 text-[12px] shadow-sm hover:border-line-strong">
            Scenarios ({saved.length})
          </button>
        </div>
      </header>

      {error && (
        <div className="absolute left-1/2 top-14 z-20 max-w-xl -translate-x-1/2 rounded-md border border-critical bg-critical-bg px-3 py-2 text-[12px] text-critical shadow">
          <button className="float-right ml-3 font-mono" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          {error}
        </div>
      )}

      {/* left: scenario controls + Rhino */}
      <aside className="panel-scroll absolute left-3 top-14 z-10 w-[19rem]">
        {site && (
          <ScenarioPanel
            site={site} level={level} building={b} settings={buildingId ? settingsOf(buildingId) ?? site.defaults : null}
            loading={buildingId ? !!loading[buildingId] : false}
            onChange={(patch) => buildingId && updateScenario(buildingId, patch)}
            onGo={go} view={view} setView={setView}
            onSave={saveScenario}
            onResetBuilding={() => buildingId && updateScenario(buildingId, { ...site.defaults })}
            onResetSite={resetSite}
          />
        )}
        <RhinoPanel models={models} layers={rhinoLayers}
          onLoad={loadRhino}
          onLayers={(vis) => {
            setRhinoLayers((ls) => ls.map((l) => ({ ...l, visible: vis.has(l.name) })))
            viewer.current?.applyRhinoLayers(vis)
          }}
          showGenerated={showGenerated}
          setShowGenerated={(v) => { setShowGenerated(v); viewer.current?.setBuildingsVisible(v) }} />
      </aside>

      {/* right: KPIs and analysis for the current level */}
      <aside className="panel-scroll absolute right-3 top-14 z-10 w-[22rem]">
        {site && choice.profile && (
          <ProfileKpis profile={choice.profile} methods={methods} result={kpiResult} building={buildingId}
            onExplain={(k) => setExplain(k)} />
        )}
        {site && (
          <InfoPanel
            site={site} level={level} bdata={bdata} totals={totals} floor={floorData}
            dl={dl} cf={cf} unitComfort={unitComfort} overlay={overlay} setOverlay={setOverlay}
            method={method} setMethod={setMethod} caps={caps} busy={!!busy}
            onQuick={runQuick} onFull={runFull} onGo={go}
          />
        )}
      </aside>

      {/* legends */}
      <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
        {overlay === 'daylight' && dl && <Legend title={`Daylight factor % — ${dl.method === 'quick' ? 'quick estimate' : 'Radiance'}`} bins={DF_BINS} />}
        {overlay === 'comfort' && cf && <Legend title="Occupied hours in category II comfort" bins={COMFORT_BINS} />}
      </div>

      <SunBar sun={sun} setSun={setSun} view={view} setView={setView} level={level} />

      {showCompare && (
        <CompareDrawer saved={saved} current={totals} onClose={() => setShowCompare(false)}
          onRemove={removeSaved} onRestore={restoreSaved} onSave={saveScenario} />
      )}

      {explain !== null && methods && (
        <MethodsDrawer methods={methods} profile={choice.profile} focus={explain}
          result={kpiResult && kpiResult.building === buildingId ? kpiResult : null} onClose={() => setExplain(null)} />
      )}

      {hover && hoverText && (
        <div className="pointer-events-none fixed z-30 rounded border border-line bg-raised px-2 py-1 text-[11.5px] shadow"
          style={{ left: hover.x + 14, top: hover.y + 12 }}>
          {hoverText}
        </div>
      )}
    </div>
  )
}

declare module './types' {
  interface FloorPayload { __key?: string }
}
