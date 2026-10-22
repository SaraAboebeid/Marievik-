import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, fmt1 } from './api'
import type { FullResult } from './api'
import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, Figures, FloorPayload, KpiResult, Level, Methods, Project, SavedScenario,
  Settings, SitePayload, TimelineResponse, Unit, UnitComfort, UrbanSummary,
} from './types'
import { TimelineDrawer } from './ui/TimelineDrawer'
import { KeyFigures } from './ui/KeyFigures'
import { TopBar, buildingAddress, type Tab } from './ui/TopBar'
import { DistrictPanel, UrbanPanel } from './ui/ScalePanel'
import { PROFILE_LABEL, PROJECTS, readChoice, writeChoice } from './profile'
import { MethodsDrawer } from './ui/MethodsDrawer'
import { Viewer, type Pick, type ViewOptions } from './viewer/Viewer'
import { dayOfYear, sunPosition } from './viewer/sun'
import { COMFORT_BINS, DF_BINS, comfortColor } from './viewer/colors'
import { Legend } from './ui/kit'
import { ScenarioPanel } from './ui/ScenarioPanel'
import { InfoPanel, USE_DOT, useOf } from './ui/InfoPanel'
import { SunBar } from './ui/SunBar'
import { CompareDrawer } from './ui/CompareDrawer'
import { MapLegend } from './ui/MapLegend'
import { ParametricDrawer } from './ui/ParametricDrawer'
import { SupplierDrawer } from './ui/SupplierDrawer'

export type Overlay = 'type' | 'daylight' | 'comfort'
export type Method = 'quick' | 'ladybug'
export type Scale = 'urban' | 'district' | 'building'
const SCALE_TABS: [Scale, string, string][] = [
  ['urban', 'Urban', 'Outdoor spaces and how the ground floors meet them'],
  ['district', 'District', 'Several buildings together — pick which ones'],
  ['building', 'Building', 'One building, one floor, one unit'],
]

const STORE_KEY = 'marievik-explorer-saved'

export default function App() {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [site, setSite] = useState<SitePayload | null>(null)
  const [scen, setScen] = useState<Record<string, Settings>>({})
  const [bdata, setBdata] = useState<Record<string, BuildingPayload>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  // ?building=B01 opens that building straight away (a shareable link)
  const [level, setLevel] = useState<Level>(() => {
    const id = new URLSearchParams(window.location.search).get('building')
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? { kind: 'building', building: id } : { kind: 'site' }
  })
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
  const [view, setView] = useState<ViewOptions>({ sky: true, shadows: !lite, ao: !lite, explode: 0, labels: true, context: true })
  const [hover, setHover] = useState<{ p: Pick; x: number; y: number } | null>(null)
  const [saved, setSaved] = useState<SavedScenario[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') } catch { return [] }
  })
  const [showCompare, setShowCompare] = useState(false)
  const [showParametric, setShowParametric] = useState(() => new URLSearchParams(window.location.search).get('view') === 'parametric')
  const [showSuppliers, setShowSuppliers] = useState(false)
  const [choice, setChoice] = useState(readChoice)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [kpiResult, setKpiResult] = useState<KpiResult | null>(null)
  const [explain, setExplain] = useState<string | null>(null)   // Methods panel open (KPI id to show, or '')
  // the saved scenario on screen: its name and its settings when saved or loaded (cleared once anything changes)
  const [shownScenario, setShownScenario] = useState<{ name: string; settings: string } | null>(null)
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>(() => {
    try { return { left: true, right: true, ...JSON.parse(localStorage.getItem('mvx-panels') ?? '{}') } } catch { return { left: true, right: true } }
  })
  const togglePanel = (side: 'left' | 'right') => setPanels((p) => {
    const next = { ...p, [side]: !p[side] }
    try { localStorage.setItem('mvx-panels', JSON.stringify(next)) } catch { /* private window */ }
    return next
  })
  // the timeline takes the whole width: the side panels close while it is open and come back as they were
  const panelsBefore = useRef(panels)
  const toggleTimeline = () => setShowTimeline((s) => {
    const open = !s
    return open ? (panelsBefore.current = panels, setPanels({ left: false, right: false })) : setPanels(panelsBefore.current), open
  })

  const [tab, setTab] = useState<Tab>('explore')
  const [scale, setScale] = useState<Scale>('building')
  const [districtHidden, setDistrictHidden] = useState<Set<string>>(new Set())
  const [urban, setUrban] = useState<UrbanSummary | null>(null)
  const [figures, setFigures] = useState<Figures | null>(null)
  const [projectData, setProjectData] = useState<Project | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)
  const [tl, setTl] = useState<TimelineResponse | null>(null)
  const [tlYear, setTlYear] = useState(0)
  const [tlPath, setTlPath] = useState('least_change')

  const buildingId = level.kind === 'site' ? null : level.building
  const settingsOf = useCallback((id: string) => scen[id] ?? site?.defaults, [scen, site])

  // ------------------------------------------------------------ the project's own profiles (data/projects), else the generic ones
  useEffect(() => {
    let alive = true
    api.project(choice.project).then((p) => { if (alive) setProjectData(p) }).catch(() => { if (alive) setProjectData(null) })
    return () => { alive = false }
  }, [choice.project])
  const projectProfile = projectData?.profiles.find((p) => p.id === choice.profile) ?? null
  // the CAVF KPI set behind the chosen profile: a project profile names the generic profile it reads like
  const cavfProfile = projectProfile?.cavf_profile ?? (choice.profile && PROFILE_LABEL[choice.profile] ? choice.profile : null)
  const profileOptions: [string, string][] = projectData
    ? projectData.profiles.map((p) => [p.id, p.title_en])
    : Object.entries(PROFILE_LABEL)

  // The floor the timeline should focus on: whichever one is open, so switching the button to "on" while
  // looking at a floor gives that floor's own 10-year timeline, not the whole building's.
  const timelineFloor = level.kind === 'floor' ? level.floor : undefined

  // ------------------------------------------------------------ 10-year timeline: computed once per building
  // (or once per building+floor), polled until ready
  useEffect(() => {
    if (!showTimeline || !buildingId) return
    let alive = true
    let t = 0
    let misses = 0
    setTl(null)
    // A failed request (server mid-restart, a dropped connection) must not freeze the progress bar: back off
    // and keep retrying rather than give up after one error, same as a normal transient network hiccup.
    const poll = () => api.timeline(buildingId, choice.project, timelineFloor).then((r) => {
      if (!alive) return
      misses = 0
      setTl(r)
      if (r.status === 'ready') setTlYear((y) => (r.years.includes(y) ? y : r.years[0]))
      else if (r.status === 'computing') t = window.setTimeout(poll, 2000)
    }).catch((e) => {
      if (!alive) return
      misses += 1
      if (misses >= 3) setError(`10-year timeline: ${String(e)} (still retrying)`)
      t = window.setTimeout(poll, Math.min(2000 * 2 ** misses, 20000))
    })
    poll()
    return () => { alive = false; window.clearTimeout(t) }
  }, [showTimeline, buildingId, choice.project, timelineFloor])

  // ------------------------------------------------------------ key figures of the open building's scenario (Design panel)
  const figKey = buildingId ? bdata[buildingId]?.key : undefined
  useEffect(() => {
    if (!buildingId || !figKey) return
    let alive = true
    api.figures(buildingId, settingsOf(buildingId) ?? {})
      .then((r) => { if (alive) setFigures(r) })
      .catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [buildingId, figKey, tab]) // eslint-disable-line react-hooks/exhaustive-deps

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
      api.context().then((c) => { if (alive && c && c.roads) viewer.current?.setContext(c) }).catch(() => {})
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

  // the timeline drives the 3D model: the chosen pathway's state in the chosen year.
  // Whole-building mode changes the usual ground/upper Settings (as before). Floor mode must NOT go
  // through Settings — "upper floors use" there always moves every upper floor together — so it calls
  // the one-floor override endpoint directly and pushes the result straight into the viewer.
  const floorOverrideActive = useRef(false)
  useEffect(() => {
    if (!showTimeline || !buildingId || !site || !tl || tl.status !== 'ready' || tl.building !== buildingId) return
    const seg = tl.segments.find((s) => s.id === tlPath) ?? tl.segments[0]
    const row = seg.years.find((r) => r.year === tlYear) ?? seg.years[0]
    if (tl.floor !== undefined) {
      if (!(level.kind === 'floor' && level.floor === tl.floor)) return   // navigated away mid-fetch
      const use = tl.states[row.state].groups.floor.use
      floorOverrideActive.current = true
      api.floorUse(buildingId, tl.floor, use).then((fp) => {
        const tagged = Object.assign(fp, { __key: `tl:${buildingId}:${tl.floor}:${use}` })
        setFloorData(tagged)
        viewer.current?.setFloor(tagged)
      }).catch((e) => setError((e as Error).message))
      return
    }
    const want = tl.states[row.state].settings
    const cur = settingsOf(buildingId)
    if (cur?.ground_use !== want.ground_use || cur?.use !== want.use) updateScenario(buildingId, want)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTimeline, buildingId, tl, tlPath, tlYear, level])

  // Leaving floor-timeline mode (closed, or switched to the whole-building timeline): put the floor back
  // to its plain, Settings-driven view, so nothing is left showing a year's one-off override.
  const tlFloorReady = tl?.status === 'ready' ? tl.floor : undefined
  useEffect(() => {
    if (!floorOverrideActive.current || (showTimeline && tlFloorReady !== undefined)) return
    floorOverrideActive.current = false
    if (!buildingId || level.kind !== 'floor') return
    const b = bdata[buildingId]
    api.floor(buildingId, level.floor, settingsOf(buildingId) ?? {}).then((fp) => {
      setFloorData(Object.assign(fp, { __key: b?.key }))
      viewer.current?.setFloor(fp)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }).catch(() => {})
  }, [showTimeline, tlFloorReady])

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

  // ------------------------------------------------------------ scale: urban / district / building
  // Urban and District both look at the whole site at once; only Building drills into one building/floor/unit.
  useEffect(() => {
    if (scale !== 'building' && level.kind !== 'site') go({ kind: 'site' })
  }, [scale, level.kind, go])

  // District dims every building not in the current selection; Urban dims every building, to recede the massing
  // behind the outdoor spaces and ground floors it is about.
  useEffect(() => {
    const v = viewer.current
    if (!v || !site) return
    if (scale === 'urban') v.setDimmed(site.buildings.map((bd) => bd.id))
    else if (scale === 'district') v.setDimmed(site.buildings.filter((bd) => districtHidden.has(bd.id)).map((bd) => bd.id))
    else v.setDimmed(null)
  }, [scale, districtHidden, site])

  // Urban scale is about the outdoor spaces, so its context (streets, paths, greens, plazas…) is always shown.
  useEffect(() => {
    if (scale === 'urban') setView((v) => (v.context ? v : { ...v, context: true }))
  }, [scale])

  // Each building's ground-floor use plus nearby public green/plaza area (explorer/model.py Site.urban_summary) —
  // static per site, so fetched once on first use of Urban scale.
  useEffect(() => {
    if (scale !== 'urban' || urban) return
    let alive = true
    api.urban().then((r) => { if (alive) setUrban(r) }).catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [scale, urban])

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
      // Urban/District are whole-site views; picking a building there means "look at this one" — switch to Building scale.
      if (scale !== 'building') setScale('building')
      if (p.type === 'unit') return go({ kind: 'unit', building: p.building, floor: p.floor, unit: p.unit })
      if (level.kind === 'site' || p.building !== buildingId) return go({ kind: 'building', building: p.building })
      return go({ kind: 'floor', building: p.building, floor: p.floor })
    }
    v.onHover = (p, x, y) => setHover(p ? { p, x, y } : null)
  }, [level, buildingId, go, scale])

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
    const bs = Object.values(bdata).filter((bd) => scale !== 'district' || !districtHidden.has(bd.id))
    return {
      gfa_m2: bs.reduce((a, b) => a + b.kpi.gfa_m2, 0),
      units: bs.reduce((a, b) => a + b.kpi.units, 0),
      capex_sek: bs.reduce((a, b) => a + b.kpi.capex_sek, 0),
      upfront_kgco2e: bs.reduce((a, b) => a + b.kpi.upfront_kgco2e, 0),
      added_gfa_m2: bs.reduce((a, b) => a + b.kpi.added_gfa_m2, 0),
      loaded: bs.length,
    }
  }, [bdata, scale, districtHidden])

  const allSettings = useCallback(() => {
    const all: Record<string, Settings> = {}
    if (site) for (const b of site.buildings) all[b.id] = { ...site.defaults, ...(scen[b.id] ?? {}) }
    return all
  }, [site, scen])
  const scenarioStatus = useMemo(() => {
    const all = allSettings()
    const today = JSON.stringify(site?.defaults ?? {})
    const changed = Object.keys(all).filter((id) => JSON.stringify(all[id]) !== today)
    const name = shownScenario && shownScenario.settings === JSON.stringify(all) ? shownScenario.name : null
    return { changed, name, savedCount: saved.length }
  }, [allSettings, site, shownScenario, saved.length])

  const saveScenario = (name: string) => {
    if (!site) return
    const all = allSettings()
    setShownScenario({ name, settings: JSON.stringify(all) })
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
    setShownScenario({ name: s.name, settings: JSON.stringify(s.scenarios) })
    for (const [id, st] of Object.entries(s.scenarios)) {
      const cur = { ...site?.defaults, ...(scen[id] ?? {}) }
      if (JSON.stringify(cur) !== JSON.stringify(st)) updateScenario(id, st)
    }
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

  // hovering a building other than the open one: a card with its figures, instead of the one-line label
  const hoverB = hover?.p && hover.p.type !== 'unit' && (level.kind === 'site' || hover.p.building !== buildingId)
    ? bdata[hover.p.building] ?? null : null
  const hoverSB = hoverB ? site?.buildings.find((s) => s.id === hoverB.id) : undefined

  const project = PROJECTS[choice.project]
  const working = busy ?? (Object.values(loading).some(Boolean) ? `Laying out ${Object.values(loading).filter(Boolean).length} building(s)…` : null)
  const sc = scenarioStatus
  const scenarioLabel = sc.name ? sc.name : sc.changed.length ? `${sc.changed.length} building${sc.changed.length > 1 ? 's' : ''} changed · not saved` : 'Today’s site'
  const panelTop = 'top-[8rem]'
  // hover label: above and right of the pointer, flipped to the left near the right edge so it never runs off screen
  const hoverLeft = hover ? (hover.x > window.innerWidth - 360 ? hover.x - 16 : hover.x + 16) : 0
  const hoverFlip = hover ? hover.x > window.innerWidth - 360 : false

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />

      <TopBar tab={tab}
        setTab={(t) => { setTab(t); if (t === 'compare') setShowCompare(true) }}
        location={`${project.name}, ${project.city}`}
        profile={{ value: choice.profile ?? '', options: profileOptions, onChange: (v) => setChoice((c) => ({ ...c, profile: v || null })) }}
        tools={[
          { label: 'Parametric model', title: 'Plans, bill of quantities and every use × wall system for one building',
            open: showParametric, onClick: () => setShowParametric((s) => !s) },
          ...(site && site.suppliers.length > 0 ? [{ label: 'Suppliers',
            title: 'Supplier products and how they do in the open building', open: showSuppliers, onClick: () => setShowSuppliers((s) => !s) }] : []),
          { label: 'Methods & data', open: explain !== null, onClick: () => setExplain((e) => (e === null ? '' : null)) },
        ]} />

      {/* under the bar: where you are, and the tools */}
      <div className="pointer-events-none absolute left-3 right-3 top-[78px] z-10 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-1 text-[12.5px] shadow-sm" aria-label="Scale">
          {SCALE_TABS.map(([id, label, hint]) => (
            <button key={id} onClick={() => setScale(id)} title={hint} aria-pressed={scale === id}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${scale === id ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </nav>
        {scale === 'building' && site && (
          <select value={buildingId ?? ''}
            onChange={(e) => go(e.target.value ? { kind: 'building', building: e.target.value } : { kind: 'site' })}
            aria-label="Pick a building" title="Pick a building by address — or click one directly in the model"
            className="rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 text-[12.5px] shadow-sm">
            <option value="">Pick a building…</option>
            {site.buildings.map((bd) => <option key={bd.id} value={bd.id}>{bd.id} · {buildingAddress(bd)}</option>)}
          </select>
        )}
        {level.kind !== 'site' && (
        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 text-[12.5px] shadow-sm" aria-label="Level">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted">›</span>}
              <button className={`rounded px-1 ${i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-ink-2 underline-offset-2 hover:text-ink hover:underline'}`}
                onClick={() => go(c.to)}>{c.label}</button>
            </span>
          ))}
          <button onClick={up} className="ml-1 rounded border border-line px-1.5 text-[11.5px] text-ink-2 hover:text-ink" title="Up one level (Esc)">↑ up</button>
          <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />
          <span className={`text-[12px] ${sc.changed.length && !sc.name ? 'text-warn' : 'text-ink-2'}`}>{scenarioLabel}</span>
          {project.placeholder && <span className="ml-1 rounded bg-warn-bg px-1.5 font-mono text-[10.5px] text-warn">placeholder model</span>}
        </nav>
        )}
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          {working && (
            <span className="rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2 shadow-sm">{working}</span>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute left-1/2 top-32 z-30 max-w-xl -translate-x-1/2 rounded-md border border-critical bg-critical-bg px-3 py-2 text-[12.5px] text-critical shadow">
          <button className="float-right ml-3 font-mono" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          {error}
        </div>
      )}

      {/* left: building setup and scenarios (nothing to set up on the whole site) */}
      {level.kind !== 'site' && (panels.left ? (
        <aside className={`panel-scroll absolute left-3 ${panelTop} z-10 w-[19rem]`}>
          <div className="mb-1 flex justify-end">
            <button onClick={() => togglePanel('left')} title="Close panel" aria-label="Close panel"
              className="grid h-6 w-6 place-items-center rounded-full border border-line bg-raised/95 text-[14px] leading-none text-ink-2 shadow-sm hover:text-ink">×</button>
          </div>
          {site && (
            <ScenarioPanel
              site={site} level={level} building={b} settings={buildingId ? settingsOf(buildingId) ?? site.defaults : null}
              loading={buildingId ? !!loading[buildingId] : false} status={sc} saved={saved}
              onChange={(patch) => buildingId && updateScenario(buildingId, patch)}
              onGo={go} view={view} setView={setView}
              onSave={saveScenario} onRestore={restoreSaved} onCompare={() => setShowCompare(true)} onSuppliers={() => setShowSuppliers(true)}
              onResetBuilding={() => buildingId && updateScenario(buildingId, { ...site.defaults })}
              timeline={{
                label: timelineFloor !== undefined ? '10-year timeline · this floor' : '10-year timeline',
                title: timelineFloor !== undefined
                  ? 'Ten years for this floor: its own use unchanged against pathways of change, played on the model'
                  : 'Ten years: the building unchanged against pathways of change, played on the model',
                onOpen: toggleTimeline,
              }}
            />
          )}
        </aside>
      ) : (
        <button onClick={() => togglePanel('left')} title="Show building setup" aria-label="Show building setup"
          className={`absolute left-3 ${panelTop} z-10 grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised/95 text-[13px] text-ink-2 shadow-sm hover:border-line-strong hover:text-ink`}>
          ▸
        </button>
      ))}

      {/* right: the building's key figures, or the site / floor / unit figures and analysis */}
      {panels.right ? (
        <aside className={`panel-scroll absolute right-3 ${panelTop} z-10 w-[22rem]`}>
          <div className="mb-1 flex justify-end">
            <button onClick={() => togglePanel('right')} title="Close panel" aria-label="Close panel"
              className="grid h-6 w-6 place-items-center rounded-full border border-line bg-raised/95 text-[14px] leading-none text-ink-2 shadow-sm hover:text-ink">×</button>
          </div>
          {site && scale === 'district' && (
            <DistrictPanel site={site} hidden={districtHidden}
              onToggle={(id) => setDistrictHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })}
              onAll={() => setDistrictHidden(new Set())}
              onNone={() => setDistrictHidden(new Set(site.buildings.map((bd) => bd.id)))} />
          )}
          {scale === 'urban' && <UrbanPanel urban={urban} loading={!urban} />}
          {level.kind === 'building' && buildingId ? (
            <KeyFigures data={figures && figures.building === buildingId ? figures : null} loading={!!loading[buildingId] || figures?.key !== bdata[buildingId]?.key} />
          ) : site && (
            <InfoPanel
              site={site} level={level} bdata={bdata} totals={totals} floor={floorData}
              dl={dl} cf={cf} unitComfort={unitComfort} overlay={overlay} setOverlay={setOverlay}
              method={method} setMethod={setMethod} caps={caps} busy={!!busy}
              onQuick={runQuick} onFull={runFull} onGo={go}
            />
          )}
        </aside>
      ) : (
        <button onClick={() => togglePanel('right')} title="Show figures" aria-label="Show figures"
          className={`absolute right-3 ${panelTop} z-10 grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised/95 text-[13px] text-ink-2 shadow-sm hover:border-line-strong hover:text-ink`}>
          ◂
        </button>
      )}

      {/* analysis legends */}
      <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
        {overlay === 'daylight' && dl && <Legend title={`Daylight factor % — ${dl.method === 'quick' ? 'quick estimate' : 'Radiance'}`} bins={DF_BINS} />}
        {overlay === 'comfort' && cf && <Legend title="Occupied hours in category II comfort" bins={COMFORT_BINS} />}
      </div>

      {/* bottom: map legend + sun/view controls, both foldable */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-end gap-2">
        {showTimeline && buildingId ? (
          <TimelineDrawer tl={tl && (tl.status !== 'ready' || tl.building === buildingId) ? tl : null} profile={projectProfile}
            year={tlYear} setYear={setTlYear} pathway={tlPath} setPathway={setTlPath} onClose={toggleTimeline} />
        ) : (
          <>
            {site && <div className="pointer-events-auto min-w-0"><MapLegend site={site} level={level} floor={floorData} /></div>}
            <div className="pointer-events-auto"><SunBar sun={sun} setSun={setSun} view={view} setView={setView} level={level} /></div>
          </>
        )}
      </div>

      {showCompare && (
        <CompareDrawer saved={saved} current={totals} onClose={() => { setShowCompare(false); if (tab === 'compare') setTab('design') }}
          onRemove={removeSaved} onRestore={restoreSaved} onSave={saveScenario} />
      )}

      {showParametric && site && (
        <ParametricDrawer site={site} start={buildingId} settingsOf={settingsOf}
          onApply={(id, patch) => { updateScenario(id, patch); if (buildingId !== id) go({ kind: 'building', building: id }) }}
          onClose={() => setShowParametric(false)} />
      )}

      {showSuppliers && site && (
        <SupplierDrawer suppliers={site.suppliers} building={b} settings={buildingId ? settingsOf(buildingId) ?? null : null}
          onApply={(system) => buildingId && updateScenario(buildingId, { partition_system: system })}
          onClose={() => setShowSuppliers(false)} />
      )}

      {explain !== null && methods && (
        <MethodsDrawer methods={methods} profile={cavfProfile} focus={explain}
          result={kpiResult && kpiResult.building === buildingId ? kpiResult : null} onClose={() => setExplain(null)} />
      )}

      {hover && hoverB ? (
        <div className="pointer-events-none fixed z-30 w-[16rem] rounded-lg border border-line bg-raised px-3 py-2.5 text-[12.5px] shadow-lg"
          style={{ left: hoverLeft, top: hover.y - 12, transform: hoverFlip ? 'translate(-100%, -100%)' : 'translateY(-100%)' }}>
          <div className="flex items-baseline gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: USE_DOT[hoverSB?.current_use ?? ''] ?? '#cfcdc4' }} />
            <span><span className="font-semibold">{hoverB.id}</span> {hoverSB ? buildingAddress(hoverSB) : hoverB.name}</span>
          </div>
          <div className="pl-4 text-[11.5px] text-ink-2">{useOf(hoverB, hoverSB)}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-2">
            <div><div className="font-mono text-[10px] uppercase tracking-wide text-ink-2">Floors</div>
              <div className="tabular-nums">{hoverB.kpi.floors}{hoverB.kpi.added_floors ? <span className="text-warn">+</span> : ''}</div></div>
            <div><div className="font-mono text-[10px] uppercase tracking-wide text-ink-2">GFA m²</div>
              <div className="tabular-nums">{fmt(hoverB.kpi.gfa_m2)}</div></div>
            <div><div className="font-mono text-[10px] uppercase tracking-wide text-ink-2">t CO₂e</div>
              <div className="tabular-nums">{fmt(hoverB.kpi.upfront_kgco2e / 1000)}</div></div>
          </div>
          <div className="mt-2 text-[11px] text-muted">Click to open</div>
        </div>
      ) : hover && hoverText && (
        <div className="pointer-events-none fixed z-30 max-w-[340px] rounded-md bg-ink px-2.5 py-1.5 text-[12.5px] leading-snug text-bg shadow-lg"
          style={{ left: hoverLeft, top: hover.y - 44, transform: hoverFlip ? 'translateX(-100%)' : undefined }}>
          {hoverText}
        </div>
      )}
    </div>
  )
}

declare module './types' {
  interface FloorPayload { __key?: string }
}
