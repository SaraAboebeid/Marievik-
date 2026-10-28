import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, fmt1 } from './api'
import type { FullResult } from './api'
import type {
  BuildingPayload, Capabilities, ComfortResult, DaylightResult, Figures, FloorPayload, KpiResult, KpiValue, Level, Methods, Project, SavedScenario,
  Settings, SitePayload, TimelineResponse, Unit, UnitComfort, UrbanSummary,
} from './types'
import { TimelineDrawer } from './ui/TimelineDrawer'
import { HeadlineFigures, SpaceDistribution } from './ui/KeyFigures'
import { TopBar, buildingAddress, type Tab } from './ui/TopBar'
import { DistrictPanel, UrbanPanel } from './ui/ScalePanel'
import { PROFILE_LABEL, PROJECTS, readChoice, writeChoice } from './profile'
import { MethodsDrawer } from './ui/MethodsDrawer'
import { Viewer, type Pick, type StudioView, type ViewOptions } from './viewer/Viewer'
import { fromPayload, layoutFor, layoutForUse, setGeometry } from './studio/engine'
import type { CompareRow, Occupancy, Params, StudioMeta, StudioModel, Variants, YearKpi } from './studio/engine'
import { Crowd, type Scenario } from './studio/crowd'
import type { FloorTenancy } from './studio/tenancy'
import { FloorInfo, StudioChangePanel, StudioPanel, type CapacityState } from './ui/StudioPanel'
import { DayPanel, PeopleControls } from './ui/DayPanel'
import { GeneratePlans } from './ui/VariantsPanel'
import { PlanningTable } from './ui/PlanningTable'
import { LifePanel, type LifeFilter } from './ui/LifePanel'
import { LifeDecade } from './ui/LifeDecade'
import { KpiStrip, type KpiScale } from './ui/KpiStrip'
import { AMENITY_TYPES, activeIn, type UrbanLife } from './urbanLife'
import { lifeIconSvg } from './lifeIcons'
import { leaseAt, mockLeaseBook, rentedShare, stepTime } from './leases'
import { LeaseTimeline } from './ui/LeaseTimeline'
import { FlexDrawer } from './ui/FlexDrawer'
import { BuildingFlex } from './ui/BuildingFlex'
import { WalkPanel, WALK_COLOURS, WALK_MINUTES, bandOf, walkRadii, type WalkState } from './ui/WalkPanel'
import { EvacPanel } from './ui/EvacPanel'
import { DistrictModel, UrbanModel } from './ui/DistrictModel'
import { LAYER_LEGEND } from './ui/LayerBar'
import { LensPanel } from './ui/LensPanel'
import { LAYERS_AT, busyColour, evacDensity, evacFrames, riskColour } from './layers'
import type { CompareCardRow, DistrictMeta, DistrictResult, EvacResult, Layer, LayerData } from './layers'
import { BuildingOverview, FloorTenancyCard } from './ui/OverviewPanel'
import type { FloorRow } from './ui/OverviewPanel'
import { dayOfYear, sunPosition } from './viewer/sun'
import { COMFORT_BINS, DF_BINS, comfortColor } from './viewer/colors'
import { Card, Legend } from './ui/kit'
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
// Floor isn't a Scale of its own: it's Building scale with a floor (or unit) open — the tab just makes that visible.
const SCALE_TABS: [Scale | 'floor', string, string][] = [
  ['urban', 'Urban', 'Outdoor spaces and how the ground floors meet them'],
  ['district', 'District', 'Several buildings together — pick which ones'],
  ['building', 'Building', 'One building as a whole'],
  ['floor', 'Floor', 'One floor of a building: its plan, rooms and units'],
]

const STORE_KEY = 'marievik-explorer-saved'

export default function App() {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const explodedKeyRef = useRef<string | null>(null)   // "<building>:<settings key>" currently showing exploded real plans
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
  const [view, setView] = useState<ViewOptions>({ sky: true, shadows: !lite, ao: !lite, explode: 0, labels: true, context: true, toon: true, bloom: !lite, dof: !lite, skyStyle: true, waterMotion: !lite })
  const [hover, setHover] = useState<{ p: Pick; x: number; y: number } | null>(null)
  const [saved, setSaved] = useState<SavedScenario[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') } catch { return [] }
  })
  const [showCompare, setShowCompare] = useState(false)
  // custom building-picker dropdown (not a native <select>, so it can be styled like the rest of the bar)
  const [bPickerOpen, setBPickerOpen] = useState(false)
  const bPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!bPickerOpen) return
    const onDoc = (e: MouseEvent) => { if (bPickerRef.current && !bPickerRef.current.contains(e.target as Node)) setBPickerOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBPickerOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [bPickerOpen])
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

  // ------------------------------------------------------------ studio floors: furnished layouts, people, tenancy and ten years
  // laid out and checked on the server (explorer/studio); B01 only until other buildings have drawn plans. Mock-up data.
  const [studioMeta, setStudioMeta] = useState<StudioMeta | null>(null)
  useEffect(() => {
    api.studioMeta().then((m) => { setGeometry(m.geometry); setStudioMeta(m) }).catch(() => {
      setStudioMeta(null)
      // the page is newer than the server behind it: say so rather than quietly showing the old floors
      setError('The explorer server is running older code than this page, so the floor studio, layers and district model are missing. Restart it (python -m explorer.server) and reload.')
    })
  }, [])
  const studioRef = useRef(false)
  const [studioView, setStudioView] = useState<StudioView>('furniture')
  const [studioLayout, setStudioLayout] = useState<Record<number, string>>({})
  const [studioParams, setStudioParams] = useState<Record<number, Params>>({})
  const [scenario, setScenario] = useState<Scenario>('day')
  const [studioHeat, setStudioHeat] = useState(true)
  const [crowdNote, setCrowdNote] = useState('')
  const [capacity, setCapacity] = useState<CapacityState>({ busy: null, result: null, rows: null })
  const [tlHidden, setTlHidden] = useState(false)   // the bottom timeline on a studio floor, closed with its ✕
  const studioFloor = studioMeta && buildingId && studioMeta.buildings.includes(buildingId) && (level.kind === 'floor' || level.kind === 'unit') ? level.floor : null
  studioRef.current = studioFloor !== null
  // The 10-year timeline plays one segment on the furnished floor: segment 1 keeps today's layout while its
  // running costs, replacements and people move on; segment 2 follows the chosen pathway, so a change of use
  // swaps in the furnished layout that stands for it.
  const [tlSeg, setTlSeg] = useState<1 | 2>(2)
  const tlReady = tl && tl.status === 'ready' && tl.building === buildingId && tl.floor === studioFloor ? tl : null
  const floorLayout = studioFloor === null || !studioMeta ? null : studioLayout[studioFloor] ?? layoutFor(studioMeta, studioFloor)
  const mapUse = (use: string) => (studioMeta ? layoutForUse(studioMeta, use, studioFloor === 0) : null)
  const layoutName = (id: string) => studioMeta?.layouts[id]?.name.toLowerCase() ?? (id.startsWith('gen-') ? `generated plan ${id.slice(4)}` : id)
  const tlPathSeg = tlReady ? tlReady.segments.find((s) => s.id === tlPath) ?? tlReady.segments.find((s) => s.segment === 2) ?? tlReady.segments[0] : null
  const tlBase = tlReady?.segments.find((s) => s.id === 'unchanged')
  const baseUse = tlReady && tlBase ? tlReady.states[tlBase.years[0].state]?.groups.floor?.use : undefined
  const s2Uses = tlReady && tlPathSeg ? tlPathSeg.years.map((r) => tlReady.states[r.state]?.groups.floor) : []
  const s2Layouts = floorLayout ? s2Uses.map((g) => (!g || g.use === baseUse ? floorLayout : mapUse(g.use) ?? floorLayout)) : []
  const s2Key = s2Layouts.join('|')
  // years whose use has no furnished layout (school, housing, hotel): that use's running costs and the
  // timeline's own people and works figures; works the furnished layouts cannot show come from the timeline too
  const s2Over = tlPathSeg ? tlPathSeg.years.map((r, i) => {
    const g = s2Uses[i]
    const unfurnished = !!g && g.use !== baseUse && !mapUse(g.use)
    const ev = tlPathSeg.events.find((e) => e.year === r.year)
    const works = ev && !(i > 0 && s2Layouts[i] !== s2Layouts[i - 1]) ? { sek: ev.capex_sek, kg: ev.co2_kg, months: ev.months } : undefined
    return unfurnished || works ? { opexUse: unfurnished ? g.use : undefined, people: unfurnished ? g.persons : undefined, works } : null
  }) : []
  const s2OverKey = JSON.stringify(s2Over)
  const yiNow = tlReady ? Math.max(0, tlReady.years.indexOf(tlYear)) : 0
  const tlLayout = tlSeg === 2 && s2Layouts[yiNow] && s2Layouts[yiNow] !== floorLayout ? s2Layouts[yiNow] : null
  const gNow = s2Uses[yiNow]
  const sLayout = tlLayout ?? floorLayout
  const sParamsKey = JSON.stringify((tlLayout || studioFloor === null ? undefined : studioParams[studioFloor]) ?? {})
  const studioLayouts = studioMeta ? (studioFloor === 0 ? studioMeta.ground : studioMeta.typical) : []
  const tlNote = !tlReady || !floorLayout ? null
    : tlSeg === 1 ? `Segment 1 on the model, ${tlYear}: ${layoutName(floorLayout)} all ten years. Only running costs, replacements and people change.`
    : gNow && gNow.use !== baseUse
      ? mapUse(gNow.use)
        ? `Segment 2 on the model, ${tlYear}: ${gNow.label}, shown as ${layoutName(s2Layouts[yiNow])}.`
        : `Segment 2 on the model, ${tlYear}: ${gNow.label}. No furnished layout for this use yet, so today's layout is shown.`
      : `Segment 2 on the model, ${tlYear}: still ${layoutName(floorLayout)}.`

  // the floor itself, laid out and checked on the server (slider drags are debounced)
  const [studioModel, setStudioModel] = useState<StudioModel | null>(null)
  const [studioLoading, setStudioLoading] = useState(false)
  useEffect(() => {
    if (studioFloor === null || !sLayout || !buildingId) { setStudioModel(null); return }
    let alive = true
    setStudioLoading(true)
    const t = window.setTimeout(() => {
      api.studioFloor(buildingId, studioFloor, sLayout, JSON.parse(sParamsKey))
        .then((p) => { if (alive) setStudioModel(fromPayload(p)) })
        .catch((e) => { if (alive) setError(`Floor studio: ${(e as Error).message}`) })
        .finally(() => { if (alive) setStudioLoading(false) })
    }, 120)
    return () => { alive = false; window.clearTimeout(t) }
  }, [buildingId, studioFloor, sLayout, sParamsKey])
  useEffect(() => { setCapacity({ busy: null, result: null, rows: null }) }, [studioFloor])

  // simulated working days on the floor as laid out (explorer/studio/occupancy.py)
  const [occ, setOcc] = useState<Occupancy | null>(null)
  const [occBusy, setOccBusy] = useState(false)
  const [occHour, setOccHour] = useState(10)
  const [attendance, setAttendance] = useState<number | null>(null)
  const [demand, setDemand] = useState(1)
  useEffect(() => {
    if (studioFloor === null || !sLayout || !buildingId) { setOcc(null); return }
    let alive = true
    setOccBusy(true)
    const t = window.setTimeout(() => {
      api.studioOccupancy(buildingId, studioFloor, sLayout, JSON.parse(sParamsKey), { attendance, demand })
        .then((o) => { if (alive) setOcc(o) })
        .catch((e) => { if (alive) setError(`Occupancy: ${(e as Error).message}`) })
        .finally(() => { if (alive) setOccBusy(false) })
    }, 300)
    return () => { alive = false; window.clearTimeout(t) }
  }, [buildingId, studioFloor, sLayout, sParamsKey, attendance, demand])
  const occNow = occ && occ.layout === sLayout ? occ : null
  const roomUseKey = occNow ? JSON.stringify(Object.fromEntries(Object.entries(occNow.roomUse).map(([k, v]) => [k, v[Math.max(0, occNow.hours.indexOf(occHour))]]))) : ''

  // evacuation of the floor as laid out (JuPedSim, explorer/studio/evacuation.py): a background job, played back
  const [evac, setEvac] = useState<EvacResult | null>(null)
  const [evacBusy, setEvacBusy] = useState(false)
  const [evacErr, setEvacErr] = useState<string | null>(null)
  const [evacT, setEvacT] = useState(0)
  const [evacPlaying, setEvacPlaying] = useState(false)
  const [evacDense, setEvacDense] = useState(true)
  const evacKey = studioFloor !== null && sLayout ? `${studioFloor}|${sLayout}|${sParamsKey}` : ''
  const evacNow = evac && evacKey === `${evac.floor}|${evac.layout}|${sParamsKey}` ? evac : null
  const evacFramesRef = useRef<{ key: string; frames: Float32Array[] } | null>(null)
  const runEvac = () => {
    if (!buildingId || studioFloor === null || !sLayout) return
    setEvacBusy(true); setEvacErr(null); setEvacPlaying(false)
    api.studioEvacuation(buildingId, studioFloor, sLayout, JSON.parse(sParamsKey))
      .then(async ({ job }) => {
        for (let i = 0; i < 400; i++) {
          const j = await api.evacJob(job)
          if (j.status === 'complete' && j.result) { setEvac(j.result); setEvacT(0); setEvacPlaying(true); return }
          if (j.status === 'failed') throw new Error(j.error?.split('\n').filter(Boolean).slice(-1)[0] ?? 'evacuation failed')
          await new Promise((r) => setTimeout(r, 1500))
        }
        throw new Error('the evacuation took too long')
      })
      .catch((e) => setEvacErr((e as Error).message))
      .finally(() => setEvacBusy(false))
  }
  useEffect(() => { setEvacPlaying(false) }, [evacKey])
  // play: four times real time
  useEffect(() => {
    if (!evacPlaying || !evacNow) return
    const end = evacNow.frames.n * evacNow.frames.dt
    let last = performance.now(), raf = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000 * 4
      last = now
      setEvacT((t) => { const n = t + dt; if (n >= end) { setEvacPlaying(false); return end } return n })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [evacPlaying, evacNow])

  // ------------------------------------------------------------ layers: movement, fire escape, capacity (and vacancy from the district model)
  const [layer, setLayerState] = useState<Layer>('none')
  const [layerData, setLayerData] = useState<LayerData | null>(null)
  const setLayer = (l: Layer) => {
    setLayerState(l)
    if (studioRef.current) setStudioView(l === 'movement' ? 'move' : l === 'fire' ? 'fire' : l === 'capacity' ? 'capacity' : 'furniture')
  }
  const b01Layouts = studioMeta ? Object.fromEntries(Array.from({ length: 7 }, (_, f) => [f, studioLayout[f] ?? layoutFor(studioMeta, f)])) : null
  const layersKey = b01Layouts && (layer === 'movement' || layer === 'fire' || layer === 'capacity' || layer === 'vacancy' || layer === 'tenancy') ? JSON.stringify([b01Layouts, studioParams]) : ''
  useEffect(() => {
    if (!layersKey) return
    const [lay, par] = JSON.parse(layersKey) as [Record<number, string>, Record<number, Params>]
    let alive = true
    api.layers(lay, par).then((d) => { if (alive) setLayerData(d) }).catch((e) => { if (alive) setError(`Layers: ${(e as Error).message}`) })
    return () => { alive = false }
  }, [layersKey])

  // ------------------------------------------------------------ the district over ten years (explorer/district.py)
  const [districtMeta, setDistrictMeta] = useState<DistrictMeta | null>(null)
  const [districtCards, setDistrictCards] = useState<Set<string>>(new Set(['activate_ground', 'flexible_fitout']))
  const [districtRes, setDistrictRes] = useState<{ strategy: DistrictResult; baseline: DistrictResult } | null>(null)
  const [districtBusy, setDistrictBusy] = useState(false)
  const [distYear, setDistYear] = useState(2035)
  const [cardRows, setCardRows] = useState<CompareCardRow[] | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  useEffect(() => {
    if (districtMeta || (scale !== 'district' && scale !== 'urban')) return
    api.districtMeta().then((m) => { setDistrictMeta(m); setDistYear(m.start_year + m.years - 1) }).catch(() => {})
  }, [scale, districtMeta])
  const runDistrict = (cards = districtCards) => {
    setDistrictBusy(true)
    api.districtRun([...cards], 20)
      .then((r) => { setDistrictRes(r); setLayerState((l) => (l === 'none' ? 'vacancy' : l)) })
      .catch((e) => setError(`District model: ${(e as Error).message}`))
      .finally(() => setDistrictBusy(false))
  }
  const runCardCompare = () => {
    setCardBusy(true)
    api.districtCompare(10).then((r) => setCardRows(r.rows)).catch((e) => setError(`District comparison: ${(e as Error).message}`)).finally(() => setCardBusy(false))
  }
  const pickCardRow = (id: string) => {
    const all = districtMeta?.strategies.map((s) => s.id) ?? []
    const cards = new Set(id === 'none' ? [] : id === 'all' ? all : [id])
    setDistrictCards(cards)
    runDistrict(cards)
  }

  // both segments' KPIs, year by year, from the furnished layouts
  const [tlKpis, setTlKpis] = useState<{ s1: YearKpi[]; s2: YearKpi[] } | null>(null)
  const kpiKey = tlReady && floorLayout && studioFloor !== null && buildingId
    ? JSON.stringify([buildingId, studioFloor, tlReady.years, floorLayout, studioParams[studioFloor] ?? {}, s2Key, s2OverKey]) : ''
  useEffect(() => {
    if (!kpiKey) { setTlKpis(null); return }
    const [bid, fl, years, today, p, s2k, over] = JSON.parse(kpiKey) as [string, number, number[], string, Params, string, string]
    let alive = true
    Promise.all([api.studioSeries(bid, fl, years.map(() => today), years, p, []), api.studioSeries(bid, fl, s2k.split('|'), years, p, JSON.parse(over))])
      .then(([a, b]) => { if (alive) setTlKpis({ s1: a.years, s2: b.years }) })
      .catch((e) => { if (alive) setError(`Timeline KPIs: ${(e as Error).message}`) })
    return () => { alive = false }
  }, [kpiKey])

  // the capacity search: this layout's walls for the most people, or every layout compared
  const runMaximise = () => {
    if (!buildingId || studioFloor === null || !floorLayout) return
    const fl = studioFloor
    setCapacity((c) => ({ ...c, busy: 'maximise' }))
    api.studioMaximise(buildingId, fl, floorLayout, studioParams[fl] ?? {})
      .then((r) => { setStudioParams((s) => ({ ...s, [fl]: r.params })); setCapacity((c) => ({ ...c, busy: null, result: { before: r.before, after: r.after } })) })
      .catch((e) => { setError(`Capacity search: ${(e as Error).message}`); setCapacity((c) => ({ ...c, busy: null })) })
  }
  const runCompare = () => {
    if (!buildingId || studioFloor === null || !floorLayout) return
    setCapacity((c) => ({ ...c, busy: 'compare' }))
    api.studioCompare(buildingId, studioFloor, floorLayout, studioParams[studioFloor] ?? {})
      .then((r) => setCapacity((c) => ({ ...c, busy: null, rows: r.rows })))
      .catch((e) => { setError(`Layout comparison: ${(e as Error).message}`); setCapacity((c) => ({ ...c, busy: null })) })
  }
  // plans generated within the floor's envelope, scored on the server (explorer/studio/generator.py), kept per floor
  const [variants, setVariants] = useState<Record<number, Variants>>({})
  const [variantsBusy, setVariantsBusy] = useState(false)
  const [variantsErr, setVariantsErr] = useState<string | null>(null)
  const runVariants = (n: number) => {
    if (!buildingId || studioFloor === null) return
    const fl = studioFloor
    setVariantsBusy(true); setVariantsErr(null)
    api.studioVariants(buildingId, fl, n)
      .then((v) => setVariants((s) => ({ ...s, [fl]: v })))
      .catch((e) => setVariantsErr((e as Error).message))
      .finally(() => setVariantsBusy(false))
  }
  // put a layout (drawn or generated) on this floor, walls as drawn
  const openLayout = (id: string) => {
    if (studioFloor === null) return
    const fl = studioFloor
    setStudioLayout((s) => ({ ...s, [fl]: id }))
    setStudioParams((s) => ({ ...s, [fl]: {} }))
    setCapacity((c) => ({ ...c, result: null }))
  }
  const pickRow = (r: CompareRow) => {
    if (studioFloor === null) return
    setStudioLayout((s) => ({ ...s, [studioFloor]: r.layout }))
    setStudioParams((s) => ({ ...s, [studioFloor]: r.params }))
  }

  // who rents what, per building (data/projects/<project>/leases.json, or example occupancy)
  const [tenancy, setTenancy] = useState<Record<string, FloorTenancy[]>>({})
  const tenancyFor = buildingId && bdata[buildingId] && !tenancy[buildingId] ? buildingId : null
  useEffect(() => {
    if (!tenancyFor) return
    const bp = bdata[tenancyFor]
    api.tenancy(choice.project, tenancyFor, bp.floors.map((f) => ({ floor: f.index, gfa: ringsArea(f.rings) })))
      .then((r) => setTenancy((t) => ({ ...t, [tenancyFor]: r.floors })))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenancyFor, choice.project])
  const floorTenancy = studioFloor !== null && buildingId ? tenancy[buildingId]?.[studioFloor] ?? null : null

  // on a studio floor the 10-year timeline sits open in the bottom bar; elsewhere it opens from Building setup
  const tlAuto = studioFloor !== null && !tlHidden
  const tlOpen = showTimeline || tlAuto

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
  // also loaded whenever a building or floor is open, for the 10-year planning table in the left panel
  const tlWanted = tlOpen || (!!buildingId && level.kind !== 'site')
  useEffect(() => {
    if (!tlWanted || !buildingId) return
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
  }, [tlWanted, buildingId, choice.project, timelineFloor])

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

  // the side panels start under the top bar, which wraps to two rows on narrow screens and grows with the KPI strip
  const topBarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = topBarRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      document.documentElement.style.setProperty('--panel-top', `${Math.round(r.bottom + 12)}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the KPI strip: which scale it speaks for, and the district/urban totals (explorer/scale_kpis.py)
  const kpiScale: KpiScale = level.kind === 'floor' || level.kind === 'unit' ? 'floor' : scale
  const [scaleKpis, setScaleKpis] = useState<{ scale: string; key: string; kpis: Record<string, KpiValue> } | null>(null)
  const scenKey = JSON.stringify(scen)
  useEffect(() => {
    if (kpiScale !== 'district' && kpiScale !== 'urban') return
    let alive = true
    api.kpisScale(kpiScale, choice.project, scen)
      .then((r) => { if (alive) setScaleKpis({ scale: kpiScale, key: scenKey, kpis: r.kpis }) })
      .catch((e) => { if (alive) setError(`KPIs: ${String(e)}`) })
    return () => { alive = false }
  }, [kpiScale, choice.project, scenKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const stripValues = kpiScale === 'district' || kpiScale === 'urban'
    ? (scaleKpis?.scale === kpiScale ? scaleKpis.kpis : null)
    : (kpiResult && kpiResult.building === buildingId ? kpiResult.kpis : null)
  const stripWaiting = stripValues ? null
    : (kpiScale === 'building' && !buildingId) ? 'pick a building'
    : 'calculating…'

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
    if (!tlOpen || !buildingId || !site || !tl || tl.status !== 'ready' || tl.building !== buildingId) return
    // segment 1 plays the building as it is; segment 2 the chosen pathway
    const seg = (tlSeg === 1 ? tl.segments.find((s) => s.id === 'unchanged') : tl.segments.find((s) => s.id === tlPath)) ?? tl.segments[0]
    const row = seg.years.find((r) => r.year === tlYear) ?? seg.years[0]
    if (tl.floor !== undefined) {
      if (!(level.kind === 'floor' && level.floor === tl.floor)) return   // navigated away mid-fetch
      if (studioRef.current) return   // B01's furnished floor follows the timeline year itself (tlLayout)
      const use = tl.states[row.state].groups.floor.use
      floorOverrideActive.current = true
      api.floorUse(buildingId, tl.floor, use).then((fp) => {
        const tagged = Object.assign(fp, { __key: `tl:${buildingId}:${tl.floor}:${use}` })
        setFloorData(tagged)
        if (!(studioRef.current && buildingId === 'B01')) viewer.current?.setFloor(tagged)
      }).catch((e) => setError((e as Error).message))
      return
    }
    const want = tl.states[row.state].settings
    const cur = settingsOf(buildingId)
    if (cur?.ground_use !== want.ground_use || cur?.use !== want.use) updateScenario(buildingId, want)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlOpen, buildingId, tl, tlPath, tlYear, level, tlSeg])

  // Leaving floor-timeline mode (closed, or switched to the whole-building timeline): put the floor back
  // to its plain, Settings-driven view, so nothing is left showing a year's one-off override.
  const tlFloorReady = tl?.status === 'ready' ? tl.floor : undefined
  useEffect(() => {
    if (!floorOverrideActive.current || (tlOpen && tlFloorReady !== undefined)) return
    floorOverrideActive.current = false
    if (!buildingId || level.kind !== 'floor') return
    const b = bdata[buildingId]
    api.floor(buildingId, level.floor, settingsOf(buildingId) ?? {}).then((fp) => {
      setFloorData(Object.assign(fp, { __key: b?.key }))
      if (!(studioRef.current && buildingId === 'B01')) viewer.current?.setFloor(fp)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }).catch(() => {})
  }, [tlOpen, tlFloorReady])

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
      // the floor studio draws B01's floor itself; the explorer's own floor waits until it is switched off
      if (!(studioRef.current && level.building === 'B01')) v.setFloor(tagged)
    }).catch((e) => setError((e as Error).message)).finally(() => setBusy(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, bKey])

  // ------------------------------------------------------------ floor studio in 3D: the floor, then the people walking on it
  const studioShown = useRef<number | null>(null)
  const b01Floor = studioFloor !== null ? bdata.B01?.floors[studioFloor] : undefined
  const studioBase = b01Floor ? b01Floor.z + b01Floor.slab_t : null
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (studioModel && studioBase !== null && studioModel.floor === studioFloor) {   // never draw a floor that is still loading
      if (level.kind === 'floor' || level.kind === 'unit') v.setFocus(level, false)   // show the floors below this one
      v.setStudio(studioModel, studioBase, studioView, studioShown.current !== studioFloor, floorTenancy?.suites ?? [],
        studioView === 'use' && roomUseKey ? JSON.parse(roomUseKey) : null)
      studioShown.current = studioFloor
      return
    }
    if (studioShown.current === null) return
    studioShown.current = null
    // studio switched off: put the explorer's own floor back
    if ((level.kind === 'floor' || level.kind === 'unit') && floorData && floorData.building === level.building && floorData.index === level.floor) v.setFloor(floorData)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioModel, studioView, studioBase, studioView === 'use' ? roomUseKey : ''])
  useEffect(() => {
    const v = viewer.current
    if (!v || !studioModel || studioView !== 'move') return
    const crowd = new Crowd(studioModel, scenario)
    setCrowdNote(`${crowd.agents.length} people shown${crowd.step > 1 ? ` (one in ${crowd.step})` : ''}`)
    if (!studioHeat) v.setStudioHeat(null)
    let raf = 0, last = performance.now(), frame = 0
    const loop = (t: number) => {
      crowd.tick(Math.min(0.1, (t - last) / 1000))
      last = t
      v.setStudioAgents(crowd.agents)
      if (studioHeat && frame++ % 15 === 0) v.setStudioHeat(crowd.heat)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [studioModel, studioView, scenario, studioHeat])

  // the evacuation on the plan: people at time t (out = hidden), and how crowded it got
  useEffect(() => {
    const v = viewer.current
    if (!v || !studioModel || studioView !== 'fire' || !evacNow) return
    const key = `${evacNow.floor}|${evacNow.layout}|${evacNow.total}|${evacNow.frames.n}`
    if (evacFramesRef.current?.key !== key) evacFramesRef.current = { key, frames: evacFrames(evacNow) }
    const frames = evacFramesRef.current.frames
    const f = Math.min(frames.length - 1, Math.floor(evacT / evacNow.frames.dt))
    const fr = frames[f], first = frames[0]
    const walkers = Array.from({ length: evacNow.frames.agents }, (_, i) => {
      const x = fr[2 * i], y = fr[2 * i + 1]
      const gone = !isFinite(x)
      return { x: gone ? first[2 * i] : x, y: gone ? first[2 * i + 1] : y, gone,
        moving: !gone && Math.hypot(x - first[2 * i], y - first[2 * i + 1]) > 0.3 }
    })
    v.setStudioAgents(walkers)
  }, [studioModel, studioView, evacNow, evacT])
  useEffect(() => {
    const v = viewer.current
    if (!v || !studioModel) return
    v.setStudioDensity(studioView === 'fire' && evacNow && evacDense ? evacDensity(evacNow) : null, evacNow?.heat.nx ?? 0, evacNow?.heat.ny ?? 0, evacNow?.heat.cell ?? 1)
  }, [studioModel, studioView, evacNow, evacDense])

  // layers on the buildings: each floor tinted by its figure, a label over the roof, flows to the station
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    const onFloor = studioFloor !== null || level.kind === 'floor' || level.kind === 'unit'
    if (layer === 'none' || layer === 'tenancy' || layer === 'amenities' || onFloor) { v.setLayerTint(null); v.setFlows(null); return }
    if (layer === 'vacancy') {
      v.setFlows(null)
      if (districtRes) {
        const yi = Math.max(0, districtRes.strategy.years.indexOf(distYear))
        v.setLayerTint(Object.fromEntries(districtRes.strategy.buildings.map((bd) => {
          const vac = bd.vacancy[yi], n = bdata[bd.id]?.floors.length ?? 8
          return [bd.id, { floors: Array(n).fill(riskColour(vac / 0.15)), label: `${bd.id} ${Math.round(vac * 100)} %` }]
        })))
        return
      }
      // no district run yet: today's real/placeholder vacancy (explorer/layers.py), not a simulated future year
      if (!layerData) { v.setLayerTint(null); return }
      v.setLayerTint(Object.fromEntries(layerData.buildings.map((bd) => {
        const n = bdata[bd.id]?.floors.length ?? 8
        return [bd.id, { floors: Array(n).fill(riskColour(bd.vacancyToday / 0.15)), label: `${bd.id} ${Math.round(bd.vacancyToday * 100)} % today` }]
      })))
      return
    }
    if (!layerData) return
    const tints: Record<string, { floors: (string | null)[]; label?: string }> = {}
    const maxPeak = Math.max(1, ...layerData.buildings.flatMap((bd) => bd.floors.map((f) => f.peak)))
    for (const bd of layerData.buildings) {
      if (layer === 'capacity') {
        const planned = bd.floors.reduce((a, f) => a + f.planned, 0), legal = bd.floors.reduce((a, f) => a + f.legalMax, 0)
        const fails = bd.floors.filter((f) => f.checksOk === false).length
        tints[bd.id] = {
          floors: bd.floors.map((f) => (f.checksOk === false ? '#d8342b' : f.source === 'estimate' ? '#b9b6ac' : riskColour(f.planned / Math.max(1, f.legalMax)))),
          label: bd.id === 'B01' || bd.id === buildingId ? `${bd.id} ${planned} / ${legal} people${fails ? ` · ${fails} floor${fails > 1 ? 's' : ''} fail a check` : ''}` : undefined,
        }
      } else if (layer === 'fire') {
        const plan = bd.floors.filter((f) => f.escape_m !== null)
        const worst = plan.length ? plan.reduce((a, f) => ((f.escape_m ?? 0) > (a.escape_m ?? 0) ? f : a)) : null
        tints[bd.id] = {
          floors: bd.floors.map((f) => (f.escape_m === null ? '#9a978e' : riskColour(f.escape_m / f.escapeLimit))),
          label: worst ? `${bd.id} longest escape ${worst.escape_m?.toFixed(1)} m (floor ${worst.floor}) · out in ~${Math.ceil((worst.evac_s ?? 0) / 60)} min` : undefined,
        }
      } else {
        tints[bd.id] = { floors: bd.floors.map((f) => busyColour(f.peak / maxPeak)), label: bd.id === 'B01' || bd.id === buildingId ? `${bd.id} ${bd.peak} at the peak` : undefined }
      }
    }
    v.setLayerTint(tints)
    if (layer === 'movement') {
      const trips = layerData.buildings.reduce((a, bd) => a + bd.stationTrips, 0)
      v.setFlows(layerData.buildings.map((bd) => ({ from: bd.c, to: layerData.station.xy, trips: bd.stationTrips })),
        { at: layerData.station.xy, text: `Liljeholmen station · ${trips.toLocaleString('sv-SE')} trips a day` })
    } else v.setFlows(null)
  }, [layer, layerData, districtRes, distYear, bdata, studioFloor, level.kind, buildingId])

  // rented / vacant: a dusk tour around the buildings, example spaces lit when rented, dark when vacant
  // (District: the whole site; Building: the one building in focus), played quarter by quarter over ten years
  // from the lease book (leases.ts: mock leases until real lease data is added).
  const tourFocus = scale === 'building' && level.kind === 'building' ? buildingId ?? null : null
  const tourOn = layer === 'tenancy' && scale !== 'urban' && studioFloor === null && level.kind !== 'floor' && level.kind !== 'unit'
  // flexibility (Building scale): one B01 floor through a year, Smartax walls against fixed gypsum walls (ui/FlexDrawer.tsx);
  // the quarters start from segment 2 of the 10-year plan when it has been generated for B01
  const flexOn = layer === 'flexibility' && scale === 'building' && studioFloor === null && level.kind !== 'floor' && level.kind !== 'unit' && !!studioMeta
  const [flexFloor, setFlexFloor] = useState(2)
  const [flexFloorOpen, setFlexFloorOpen] = useState(false)   // a floor picked from the whole-building view
  // the whole-building view lives in the 3D model: side panels step aside while it's on, and come back after
  const flexBuildingView = flexOn && buildingId === 'B01' && !flexFloorOpen
  const flexPanels = useRef<{ left: boolean; right: boolean } | null>(null)
  useEffect(() => {
    if (flexBuildingView) { flexPanels.current = panels; setPanels({ left: false, right: false }) }
    else if (flexPanels.current) { setPanels(flexPanels.current); flexPanels.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flexBuildingView])
  const flexPrefill = useMemo(() => {
    const def = ['open', 'cellular', 'cowork', 'teams'].filter((l) => studioMeta?.typical.includes(l))
    while (def.length < 4) def.push(def[def.length - 1] ?? 'open')
    const t = tl && tl.status === 'ready' && tl.building === 'B01' ? tl : null
    const seg = t ? t.segments.find((s) => s.id === tlPath && s.segment === 2) ?? t.segments.find((s) => s.segment === 2) : null
    if (t && seg && studioMeta) {
      const seq: string[] = []
      for (const y of seg.years) {
        const st = t.states[y.state]
        const g = st?.groups.floor ?? st?.groups.upper
        const l = g ? studioMeta.useToLayout.typical[g.use] : null
        if (l && seq[seq.length - 1] !== l) seq.push(l)
      }
      if (seq.length >= 2) {
        const plan = seq.slice(0, 4)
        while (plan.length < 4) plan.push(plan[plan.length - 1])
        return { plan, note: `Prefilled from segment 2 of the 10-year plan (${seg.label}): its uses in order, one per quarter. Change any quarter.` }
      }
    }
    return { plan: def, note: "A starting sequence: pick each quarter's use. Generate B01's 10-year plan to prefill it from segment 2 instead." }
  }, [studioMeta, tl, tlPath])
  const tourIds = Object.keys(bdata).sort()
  const leaseBook = useMemo(() => mockLeaseBook(tourIds), [tourIds.join(',')])
  const [leaseStep, setLeaseStep] = useState(0)
  const [leasePlaying, setLeasePlaying] = useState(false)
  const tourKey = tourOn ? JSON.stringify([tourFocus, tourIds]) : ''
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (!tourKey) { v.setTenancyTour(null); setLeasePlaying(false); return }
    const lettable: Record<string, { id: string; share: number }[]> = {}
    for (const sp of leaseBook.spaces) (lettable[sp.building] ??= []).push({ id: sp.id, share: sp.share })
    v.setTenancyTour({ lettable, focus: tourFocus })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourKey])
  useEffect(() => {
    const v = viewer.current
    if (!v || !tourKey) return
    const t = stepTime(leaseStep)
    const rented = Object.fromEntries(leaseBook.spaces.map((sp) => [sp.id, !!leaseAt(leaseBook, sp.id, t)]))
    const share = rentedShare(leaseBook, t)
    v.setTenancyOccupancy(rented, Object.fromEntries(tourIds.map((id) => [id, `${id} · ${Math.round((share[id] ?? 0) * 100)} % rented`])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourKey, leaseStep, leaseBook])
  // a lens the new scale doesn't offer (layers.ts LAYERS_AT) goes back to None - at urban scale, to Amenities
  useEffect(() => { if (!LAYERS_AT[scale].includes(layer)) setLayerState(scale === 'urban' ? 'amenities' : 'none') }, [layer, scale])
  useEffect(() => () => viewer.current?.setTenancyTour(null), [])

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

  // Urban scale: AMF's events and activities timeline and today's amenities, pinned on the site (explorer/urban_life.py)
  const [life, setLife] = useState<UrbanLife | null>(null)
  const [decadeClosed, setDecadeClosed] = useState(false)   // the bottom decade window, closed with its ×
  const [lifeFilter, setLifeFilter] = useState<LifeFilter>({ year: new Date().getFullYear(), permanent: true, temporary: true, amenities: true })
  // Urban scale: life on site (the Life panel, the decade along the bottom, flags, balloons and amenity tokens)
  // is the Amenities lens; None leaves the map clean. The panel's own tiles still pick which kinds show.
  const lifeOn = scale === 'urban' && layer === 'amenities'
  useEffect(() => {
    if (scale !== 'urban' || life) return
    let alive = true
    api.urbanLife(choice.project).then((r) => { if (alive) setLife(r) }).catch((e) => { if (alive) setError(`Life on site: ${(e as Error).message}`) })
    return () => { alive = false }
  }, [scale, life, choice.project])
  // walking-distance rings around the site (Urban scale): 5 and 10 minutes at a chosen pace, clickable
  const [walk, setWalk] = useState<WalkState>({ on: true, pace: 'normal', selected: null })
  const siteC = useMemo<[number, number]>(() => {
    const pts = site?.buildings.flatMap((b) => b.footprint) ?? []
    if (!pts.length) return [0, 0]
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }, [site])
  const walkOn = lifeOn && walk.on && !!site   // only with the Amenities lens, like the rest of life on site
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.onWalkRing = (i) => setWalk((w) => ({ ...w, on: true, selected: w.selected === i ? null : i }))
    if (!walkOn) { v.setWalkRings(null); return }
    const radii = walkRadii(walk.pace)
    const counts = radii.map((_, i) => (life?.amenities ?? []).filter((a) => bandOf(Math.hypot(a.x - siteC[0], a.y - siteC[1]), radii) === i).length)
    v.setWalkRings({ center: siteC, selected: walk.selected,
      rings: radii.map((r, i) => ({ r, colour: WALK_COLOURS[i], label: `${WALK_MINUTES[i]} min · ${Math.round(r)} m · ${counts[i]} places` })) })
  }, [walkOn, walk, siteC, life])
  useEffect(() => () => viewer.current?.setWalkRings(null), [])

  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (!lifeOn || !life) { v.setLifePins(null); return }
    const f = lifeFilter
    const events = life.timeline
      .filter((t) => t.x !== null && t.y !== null && activeIn(t, f.year) && (t.kind === 'permanent' ? f.permanent : f.temporary))
      .map((t) => {
        const c = life.categories[t.category]
        return { x: t.x!, y: t.y!, label: t.name, colour: c?.colour ?? '#9a978e', kind: t.kind, id: t.id, icon: lifeIconSvg(t.category, 13),
          badge: t.kind === 'temporary' ? `${t.year} only` : t.year === f.year ? 'new' : undefined,
          title: `${t.name} · ${c?.label ?? t.category} · ${t.kind === 'permanent' ? `from ${t.year}` : t.year}\n${t.place}${t.note ? `\n${t.note}` : ''}` }
      })
    // with the rings on, every amenity out to the outer ring shows, and those outside the chosen ring fade
    const radii = walkRadii(walk.pace)
    const dOf = (a: { x: number; y: number }) => Math.hypot(a.x - siteC[0], a.y - siteC[1])
    const amen = !f.amenities ? [] : life.amenities.filter((a) => (walkOn ? dOf(a) <= radii[radii.length - 1] : Math.hypot(a.x, a.y) < 600)).map((a) => ({
      dim: walkOn && walk.selected !== null && bandOf(dOf(a), radii) !== walk.selected,
      x: a.x, y: a.y, label: a.name, colour: AMENITY_TYPES[a.type]?.colour ?? '#9a978e', kind: 'amenity' as const,
      id: `a:${a.type}:${a.name}:${a.x}:${a.y}`, icon: lifeIconSvg(a.type, 11, 2.6),
      title: `${a.name} · ${AMENITY_TYPES[a.type]?.label ?? a.type}${a.addr ? ` · ${a.addr}` : ''}`,
    }))
    v.setLifePins([...amen, ...events])
  }, [scale, life, lifeFilter, layer, walkOn, walk, siteC]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // the 10-year timeline in the bottom bar; the side panels stop above it
  const bottomBar = tlOpen && !!buildingId
  const lifeBar = lifeOn && !!life && !decadeClosed   // the decade of life on site, along the bottom at urban scale
  const closeTl = () => { if (showTimeline) toggleTimeline(); else setTlHidden(true) }
  // the bottom drawer, both segments side by side: on a studio floor it is the auto-opened bar, elsewhere a toggle
  const openTimeline = () => { if (studioFloor !== null) setTlHidden(false); else if (!showTimeline) toggleTimeline() }
  // a row of the 10-year planning table: open the full timeline on that pathway
  const openPathway = (id: string, segment: 1 | 2) => {
    setTlPath(id)
    setTlSeg(segment)
    openTimeline()
  }
  const tlButton = (
    <button type="button" onClick={() => (tlOpen ? closeTl() : openTimeline())} aria-pressed={tlOpen}
      className={`mb-2.5 w-full rounded-md border-2 border-edge px-3 py-1.5 text-[13px] font-semibold shadow-[3px_3px_0_var(--color-edge)] ${tlOpen ? 'bg-surface' : 'bg-coral text-[#202020]'}`}>
      {tlOpen ? 'Hide the 10-year plan' : 'Generate 10-year plan'}
    </button>
  )
  const floorOpen = !!(studioModel && studioMeta && studioFloor !== null && sLayout)
  // a single building, no floor open: only None/Vacancy make sense there (Movement/Fire/Capacity move to the
  // floor's own views once you open one); Urban/District keep the full site-wide set. Defaults to None -
  // picking a building never auto-switches the lens, only an explicit click on Vacancy does.
  // a building is open but not in the floor studio - the whole building, or (for a building with no studio,
  // e.g. B08) one of its floors too: the 10-year timeline and plan-generator shortcut apply to both.
  const showBuildingActions = !floorOpen && level.kind !== 'site' && !!buildingId
  // explode, every floor's real plan at once, not just the massing box - fetched once per building+settings
  // and kept until something actually changes (switching building, editing settings, turning explode off).
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    // with a floor open (studio or not) that floor is drawn on its own; the rest of the stack shows its plans
    const want = buildingId && view.explode > 0 && b ? `${buildingId}:${b.key}` : null
    if (explodedKeyRef.current === want) return
    const prevBid = explodedKeyRef.current?.split(':')[0]
    if (prevBid && prevBid !== buildingId) v.setExplodedPlans(prevBid, null)
    if (!want) {
      if (buildingId) v.setExplodedPlans(buildingId, null)
      explodedKeyRef.current = null
      return
    }
    let alive = true
    Promise.all(b!.floors.map((f) => api.floor(buildingId!, f.index, settingsOf(buildingId!) ?? {})))
      .then((floors) => { if (alive) { v.setExplodedPlans(buildingId!, floors); explodedKeyRef.current = want } })
      .catch((e) => { if (alive) setError(`Exploded plans: ${(e as Error).message}`) })
    return () => { alive = false }
  }, [view.explode, buildingId, b?.key])
  // building overview: each floor's use and area, and how much of it is rented (B01 from the floor studio)
  const overviewRows: FloorRow[] | null = b ? b.floors.map((f) => {
    const area = ringsArea(f.rings)
    const fLayout = studioMeta?.buildings.includes(b.id) ? studioLayout[f.index] ?? layoutFor(studioMeta, f.index) : undefined
    const studioUse = fLayout?.startsWith('gen-') ? 'office' : fLayout ? studioMeta?.layouts[fLayout]?.use : undefined   // generated plans are offices
    const ten = tenancy[b.id]?.[f.index]
    return ten ? { n: f.index, label: f.index === 0 ? 'GF' : `F${f.index}`, use: studioUse ? USE_FAMILY[studioUse] ?? f.use_label : f.use_label, area, ten } : null
  }).filter((r): r is FloorRow => r !== null) : null
  const crumbs:{ label: string; to: Level }[] = [{ label: 'Marievik', to: { kind: 'site' } }]
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
  const panelTop = 'top-[var(--panel-top,12rem)]'   // under the top bar and its KPI strip, however tall they wrap
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

      {/* under the bar: where you are, and the tools — a second full-width bar (like the header above it),
          pill chips inside it in the same ink-outline / hard-shadow / coral-for-active sticker style. */}
      <div ref={topBarRef} className="absolute inset-x-0 top-[64px] z-10 flex flex-wrap items-center justify-between gap-3 border-b-2 border-edge bg-surface px-4 py-2 shadow-[0_3px_0_var(--color-edge)]">
        <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1 rounded-md border-2 border-edge bg-surface p-1 text-[12.5px] shadow-[3px_3px_0_var(--color-edge)]" aria-label="Scale">
          {SCALE_TABS.map(([id, label, hint]) => {
            const onFloor = scale === 'building' && (level.kind === 'floor' || level.kind === 'unit')
            const active = id === 'floor' ? onFloor : id === 'building' ? scale === 'building' && !onFloor : scale === id
            const pick = () => {
              if (id !== 'floor') {
                setScale(id)
                if (id === 'building' && onFloor) go({ kind: 'building', building: level.building })
                return
              }
              if (onFloor) return
              setScale('building')
              go({ kind: 'floor', building: buildingId ?? 'B01', floor: 1 })   // B01 has the drawn plans
            }
            return (
            <button key={id} onClick={pick} title={hint} aria-pressed={active}
              className={`rounded-md px-3.5 py-1 font-semibold transition-[transform,box-shadow,background-color] motion-reduce:transition-none ${
                active
                  ? 'bg-coral text-[#202020] shadow-[2px_2px_0_var(--color-edge)] -translate-y-px'
                  : 'text-ink-2 hover:bg-sunken hover:text-ink'
              }`}>
              {label}
            </button>
            )
          })}
        </nav>
        {scale === 'building' && site && (
          <div ref={bPickerRef} className="relative">
            <button type="button" onClick={() => setBPickerOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={bPickerOpen}
              title="Pick a building by address — or click one directly in the model"
              className="flex w-96 items-center gap-1.5 rounded-md border-2 border-edge bg-surface px-3 py-1.5 text-[12.5px] font-medium shadow-[3px_3px_0_var(--color-edge)]">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-ink-2" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M5.5 2.5h6l3 3v12h-9z" strokeLinejoin="round" /><path d="M11.5 2.5v3h3" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-left">
                {buildingId ? `${buildingId} · ${buildingAddress(site.buildings.find((bd) => bd.id === buildingId)!)}` : 'Pick a building…'}
              </span>
              <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 shrink-0 text-ink-2 transition-transform ${bPickerOpen ? 'rotate-180' : ''}`} aria-hidden>
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {bPickerOpen && (
              <ul role="listbox" aria-label="Pick a building"
                className="absolute left-0 top-full z-20 mt-1.5 max-h-[70vh] w-96 overflow-y-auto rounded-md border-2 border-edge bg-surface shadow-[3px_3px_0_var(--color-edge)]">
                <li>
                  <button type="button" role="option" aria-selected={!buildingId} onClick={() => { go({ kind: 'site' }); setBPickerOpen(false) }}
                    className={`block w-full truncate px-3 py-1.5 text-left text-[12.5px] ${!buildingId ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-sunken'}`}>
                    Pick a building…
                  </button>
                </li>
                {site.buildings.map((bd) => (
                  <li key={bd.id}>
                    <button type="button" role="option" aria-selected={buildingId === bd.id} title={`${bd.id} · ${buildingAddress(bd)}`}
                      onClick={() => { go({ kind: 'building', building: bd.id }); setBPickerOpen(false) }}
                      className={`block w-full truncate border-t-2 border-edge px-3 py-1.5 text-left text-[12.5px] ${buildingId === bd.id ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-sunken'}`}>
                      {bd.id} · {buildingAddress(bd)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(level.kind === 'floor' || level.kind === 'unit') && (
        <nav className="flex flex-wrap items-center gap-1.5 rounded-md border-2 border-edge bg-surface px-3 py-1.5 text-[12.5px] shadow-[3px_3px_0_var(--color-edge)]" aria-label="Level">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-ink-2" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path d="M4 17V8.5L10 4l6 4.5V17z" strokeLinejoin="round" /><path d="M8 17v-5h4v5" strokeLinejoin="round" />
          </svg>
          {/* the site and building are already shown by the Scale tabs and the building picker - only floor/unit add anything here */}
          {crumbs.slice(2).map((c, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted">›</span>}
              <button className={`rounded px-1 ${i === arr.length - 1 ? 'font-medium text-ink' : 'text-ink-2 underline-offset-2 hover:text-ink hover:underline'}`}
                onClick={() => go(c.to)}>{c.label}</button>
            </span>
          ))}
        </nav>
        )}
        {level.kind !== 'site' && (
          <button onClick={up} title="Up one level (Esc)" aria-label="Up one level"
            className="group inline-flex items-center gap-1.5 rounded-md border-2 border-edge bg-surface py-1.5 pl-2.5 pr-1.5 text-[12px] font-semibold text-ink shadow-[3px_3px_0_var(--color-edge)] transition-[transform,box-shadow,background-color] hover:bg-coral hover:text-[#202020] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:transition-none">
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M6 10V2.5M2.5 6 6 2.5 9.5 6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
            Up
            <kbd className="rounded border border-line bg-sunken px-1 font-mono text-[9.5px] font-normal text-muted group-hover:border-[#202020]/30 group-hover:bg-transparent group-hover:text-[#202020]/70">Esc</kbd>
          </button>
        )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {project.placeholder && <span className="rounded bg-warn-bg px-1.5 font-mono text-[10.5px] text-warn">placeholder model</span>}
          {working && (
            <span className="rounded-md border-2 border-edge bg-surface px-3 py-1.5 font-mono text-[11.5px] text-ink-2 shadow-[3px_3px_0_var(--color-edge)]">{working}</span>
          )}
          <LensPanel floorOpen={floorOpen} scale={scale} layer={layer} setLayer={setLayer}
            view={studioView} setView={setStudioView}
            scenario={scenario} setScenario={setScenario} heat={studioHeat} setHeat={setStudioHeat} crowdNote={crowdNote}
            explode={view.explode} setExplode={(v) => setView({ ...view, explode: v })} />
        </div>
        <KpiStrip scale={kpiScale} profile={projectProfile} pinned={choice.kpis}
          cavfKpis={!projectProfile && cavfProfile ? methods?.profiles[cavfProfile]?.kpis ?? null : null}
          methods={methods} values={stripValues} valuesFrom={stripValues ? (kpiScale === 'floor' ? 'building' : 'here') : null}
          waiting={stripWaiting} onExplain={(k) => setExplain(k)} />
      </div>

      {error && (
        <div className="absolute left-1/2 top-32 z-30 max-w-xl -translate-x-1/2 rounded-md border border-critical bg-critical-bg px-3 py-2 text-[12.5px] text-critical shadow">
          <button className="float-right ml-3 font-mono" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          {error}
        </div>
      )}

      {/* left: a floor open — that floor's own status, the 10-year timeline and the plan generator. A whole
          building, no floor open — the (building-wide) 10-year timeline and a way into the plan generator.
          The lens picker lives in the top bar now (every scale); the building's figures are on the right. */}
      {(floorOpen || (showBuildingActions && !!studioMeta?.buildings.includes(buildingId!))) && (panels.left ? (
        <aside className={`panel-scroll ${bottomBar || lifeBar || tourOn ? 'panel-short' : ''} absolute left-3 ${panelTop} z-10 w-[19rem]`}>
          <div className="mb-1 flex justify-end">
            <button onClick={() => togglePanel('left')} title="Close panel" aria-label="Close panel"
              className="grid h-6 w-6 place-items-center rounded-full border border-line bg-raised/95 text-[14px] leading-none text-ink-2 shadow-sm hover:text-ink">×</button>
          </div>
          {floorOpen ? (() => {
            const floorLabel = studioFloor === 0 ? 'Ground floor' : `Floor ${studioFloor}`
            return (
              <>
                <FloorInfo model={studioModel!} floorLabel={floorLabel} />
                <GeneratePlans data={variants[studioFloor!] ?? null} busy={variantsBusy} error={variantsErr} onGenerate={runVariants}
                  current={floorLayout ?? sLayout!} ground={studioFloor === 0} onOpen={openLayout} />
              </>
            )
          })() : (
            <>
              {studioMeta?.buildings.includes(buildingId!) && (
                <Card title="Generate floor plans">
                  <p className="mb-2 text-[12px] leading-snug text-ink-2">
                    Random plans inside a floor's fixed envelope, checked and simulated, compared on a trade-off curve. Generated per floor - open one to try it.
                  </p>
                  <button type="button" onClick={() => go({ kind: 'floor', building: buildingId!, floor: 1 })}
                    className="w-full rounded-md border-2 border-edge bg-coral px-3 py-1.5 text-[13px] font-semibold text-[#202020] shadow-[3px_3px_0_var(--color-edge)]">
                    Open a floor to generate plans
                  </button>
                </Card>
              )}
            </>
          )}
        </aside>
      ) : (
        <button onClick={() => togglePanel('left')} title={floorOpen ? 'Show this floor' : 'Show the 10-year timeline'} aria-label={floorOpen ? 'Show this floor' : 'Show the 10-year timeline'}
          className={`absolute left-3 ${panelTop} z-10 grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised/95 text-[13px] text-ink-2 shadow-sm hover:border-line-strong hover:text-ink`}>
          ▸
        </button>
      ))}

      {/* right: a whole building, no floor open — its key figures, overview and space distribution. A floor
          open — what you change (layout/walls/people, building settings) above what comes out of it (results).
          Nothing to set up on the whole site. */}
      {panels.right ? (
        <aside className={`panel-scroll ${bottomBar || lifeBar || tourOn ? 'panel-short' : ''} absolute right-3 ${panelTop} z-10 w-[22rem]`}>
          <div className="mb-1 flex justify-end">
            <button onClick={() => togglePanel('right')} title="Close panel" aria-label="Close panel"
              className="grid h-6 w-6 place-items-center rounded-full border border-line bg-raised/95 text-[14px] leading-none text-ink-2 shadow-sm hover:text-ink">×</button>
          </div>
          {buildingId && level.kind !== 'site' && tlButton}
          {buildingId && level.kind !== 'site' && (
            <PlanningTable tl={tl}
              title={`${level.kind === 'building' ? buildingId : studioFloor === 0 ? 'Ground floor' : `Floor ${level.floor}`} · 10-year planning`}
              onOpen={openPathway} />
          )}
          {floorOpen && (
            <>
            <StudioChangePanel model={studioModel!} meta={studioMeta!} floorLabel={studioFloor === 0 ? 'Ground floor' : `Floor ${studioFloor}`}
              layout={floorLayout ?? sLayout!} layouts={studioLayouts} setLayout={openLayout}
              setParam={(key, v) => setStudioParams((s) => ({ ...s, [studioFloor!]: { ...(s[studioFloor!] ?? {}), [key]: +v.toFixed(2) } }))}
              onReset={() => { setStudioParams((s) => ({ ...s, [studioFloor!]: {} })); setCapacity((c) => ({ ...c, result: null })) }}
              capacity={capacity} onMaximise={runMaximise} onCompare={runCompare} onPickRow={pickRow}
              people={<PeopleControls occ={occNow} attendance={attendance} setAttendance={setAttendance} demand={demand} setDemand={setDemand} />} />
            {site && (
            <ScenarioPanel
              site={site} level={level} building={b} settings={buildingId ? settingsOf(buildingId) ?? site.defaults : null}
              loading={buildingId ? !!loading[buildingId] : false} status={sc} saved={saved}
              onChange={(patch) => buildingId && updateScenario(buildingId, patch)}
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
            </>
          )}
          {site && scale === 'district' && (
            <DistrictPanel site={site} hidden={districtHidden}
              onToggle={(id) => setDistrictHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })}
              onAll={() => setDistrictHidden(new Set())}
              onNone={() => setDistrictHidden(new Set(site.buildings.map((bd) => bd.id)))} />
          )}
          {site && scale === 'district' && studioFloor === null && (
            <DistrictModel meta={districtMeta} res={districtRes} busy={districtBusy} cards={districtCards}
              toggle={(id) => setDistrictCards((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n })}
              onRun={() => runDistrict()} year={distYear} setYear={(y) => { setDistYear(y); if (layer === 'none') setLayerState('vacancy') }}
              compare={cardRows} compareBusy={cardBusy} onCompare={runCardCompare} onPickCompare={pickCardRow} />
          )}
          {lifeOn && <LifePanel life={life} filter={lifeFilter} setFilter={setLifeFilter} />}
          {lifeOn && life && <WalkPanel amenities={life.amenities} center={siteC} walk={walk} setWalk={setWalk} />}
          {scale === 'urban' && <UrbanModel res={districtRes} year={distYear} />}
          {scale === 'urban' && <UrbanPanel urban={urban} loading={!urban} />}
          {floorOpen ? (
            <StudioPanel model={studioModel!} setView={setStudioView}
              floorLabel={studioFloor === 0 ? 'Ground floor' : `Floor ${studioFloor}`}
              loading={studioLoading}
              day={<DayPanel occ={occNow} busy={occBusy} hour={occHour} setHour={(h) => { setOccHour(h); setStudioView('use') }}
                showUse={studioView === 'use'} onShowUse={() => setStudioView(studioView === 'use' ? 'furniture' : 'use')} />}
              tenancy={floorTenancy ? <FloorTenancyCard ten={floorTenancy} floorLabel={studioFloor === 0 ? 'Ground floor' : `Floor ${studioFloor}`} /> : null}
              evac={<EvacPanel res={evacNow} busy={evacBusy} error={evacErr} onRun={runEvac}
                playing={evacPlaying} onPlay={() => { if (!evacPlaying && evacNow && evacT >= evacNow.frames.n * evacNow.frames.dt - 0.01) setEvacT(0); setEvacPlaying(!evacPlaying) }}
                t={evacT} setT={(t) => { setEvacPlaying(false); setEvacT(t) }} density={evacDense} setDensity={setEvacDense} />} />
          ) : level.kind === 'building' && buildingId ? (() => {
            const figData = figures && figures.building === buildingId ? figures : null
            const figLoading = !!loading[buildingId] || figures?.key !== bdata[buildingId]?.key
            return (
              <>
                <HeadlineFigures data={figData} loading={figLoading} />
                {overviewRows && (
                  <BuildingOverview name={buildingId} floors={overviewRows}
                    onFloor={(n) => go({ kind: 'floor', building: buildingId, floor: n })} />
                )}
                <SpaceDistribution data={figData} />
              </>
            )
          })() : site && (
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
        {layer !== 'none' && layer !== 'tenancy' && layer !== 'amenities' && layer !== 'flexibility' && studioFloor === null && level.kind !== 'floor' && level.kind !== 'unit' && (
          <Legend title={LAYER_LEGEND[layer].title} bins={LAYER_LEGEND[layer].bins} />
        )}
      </div>

      {/* bottom: map legend + sun/view controls, both foldable */}
      <div className={`pointer-events-none absolute bottom-3 z-10 flex items-end gap-2 ${
        tourOn || lifeBar || flexOn ? 'inset-x-3' : 'left-1/2 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2'}`}>
        {flexOn ? (
          flexFloorOpen || buildingId !== 'B01' ? (
            <div className="flex w-full flex-col gap-1.5">
              {buildingId !== 'B01' && (
                <div className="pointer-events-auto flex items-center gap-2 self-start rounded-lg border-2 border-edge bg-surface px-3 py-1.5 text-[12px] shadow-[2px_2px_0_var(--color-edge)]">
                  {buildingId ? `${buildingId} has no drawn floor plans yet: flexibility is shown for B01.` : 'Pick a building for the whole-building view: B01 has drawn floor plans.'}
                  <button type="button" onClick={() => go({ kind: 'building', building: 'B01' })} className="rounded-md border-2 border-edge bg-coral px-2 py-px font-bold">Open B01</button>
                </div>
              )}
              {flexFloorOpen && buildingId === 'B01' && (
                <button type="button" onClick={() => setFlexFloorOpen(false)} className="pointer-events-auto self-start rounded-md border-2 border-edge bg-surface px-2.5 py-1 font-mono text-[11.5px] font-bold shadow-[2px_2px_0_var(--color-edge)] hover:bg-coral">
                  ← the whole building
                </button>
              )}
              {buildingId === 'B01' && (
                <FlexDrawer meta={studioMeta!} project={choice.project} floor={flexFloor} setFloor={setFlexFloor} prefill={flexPrefill.plan} prefillNote={flexPrefill.note}
                  onClose={() => setLayerState('none')} />
              )}
            </div>
          ) : (
            <BuildingFlex meta={studioMeta!} onOpenFloor={(f) => { setFlexFloor(Math.max(1, f)); setFlexFloorOpen(true) }} onClose={() => setLayerState('none')}
              onFrame={(f) => {
                const v = viewer.current
                if (!v) return
                v.onFlexFloor = (fl) => { setFlexFloor(Math.max(1, fl)); setFlexFloorOpen(true) }
                v.setFlexFrame(f)
              }} />
          )
        ) : lifeBar ? (
          <LifeDecade life={life!} filter={lifeFilter} setFilter={setLifeFilter} onClose={() => setDecadeClosed(true)} />
        ) : tourOn ? (
          <LeaseTimeline book={leaseBook} buildings={tourIds} focus={tourFocus} step={leaseStep} setStep={setLeaseStep}
            playing={leasePlaying} setPlaying={setLeasePlaying} />
        ) : bottomBar ? (
          <TimelineDrawer tl={tl && (tl.status !== 'ready' || tl.building === buildingId) ? tl : null} profile={projectProfile}
            year={tlYear} setYear={setTlYear} pathway={tlPath} setPathway={setTlPath} onClose={closeTl}
            segment={tlSeg} setSegment={setTlSeg} kpis={studioFloor !== null ? tlKpis : null} note={studioFloor !== null ? tlNote : null} />
        ) : (
          <>
            {site && <div className="pointer-events-auto min-w-0"><MapLegend site={site} level={level} floor={floorData} /></div>}
            {lifeOn && life && decadeClosed && (
              <button type="button" onClick={() => setDecadeClosed(false)} title="Open the decade of life on Marievik, 2024–2030"
                className="pointer-events-auto rounded-lg border-2 border-edge bg-coral px-3 py-1.5 font-mono text-[11.5px] font-bold text-[#202020] shadow-[2px_2px_0_var(--color-edge)]">
                ▶ The decade
              </button>
            )}
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

const USE_FAMILY: Record<string, string> = { office: 'Office', cowork: 'Coworking', ground: 'Reception & building services', cafe: 'Café', restaurant: 'Restaurant' }

/** Plan area of a floor outline: the outer ring less any holes (shoelace). */
function ringsArea(rings: [number, number][][]) {
  const one = (r: [number, number][]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
  return rings.length ? Math.max(0, one(rings[0]) - rings.slice(1).reduce((a, h) => a + one(h), 0)) : 0
}

declare module './types' {
  interface FloorPayload { __key?: string }
}
