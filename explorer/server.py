"""Marievik+ Explorer - local server.

    python -m explorer.server              ->  http://127.0.0.1:8020

Pages
  /             the Digital Lab landing page (web/landing.html)
  /explorer     the 3D explorer

Serves the 3D explorer (explorer/web/dist, built with `npm run build` in explorer/web) and the
API it calls. Like the Apartment Lab, the browser only draws and asks: every layout, quantity,
cost, carbon, daylight and comfort figure is computed here in Python, from one implementation.

API (all JSON)
  GET  /api/site                         site, buildings, facades, materials, roads, options
  POST /api/building/{id}                {settings}            -> 3D shell + KPIs for one scenario
  POST /api/floor/{id}/{index}           {settings}            -> walls, openings, rooms, units, floor KPIs
  POST /api/analysis/daylight            {building, floor, settings, context}  -> quick daylight factor
  POST /api/analysis/comfort             {building, floor, settings, context, unit?} -> quick comfort
  POST /api/analysis/full                {... , daylight: bool, energy: bool} -> job id (Ladybug Tools)
  GET  /api/jobs/{job}                   status / result of a Ladybug Tools run
  GET  /api/capabilities                 which simulation engines are installed
  GET  /api/methods                      CAVF KPI definitions, profiles, scenarios S0-S4, databases, constants
  POST /api/kpis/{id}                    {settings}            -> every CAVF KPI for one building scenario
  POST /api/figures/{id}                 {settings}            -> key figures and space distribution (Design panel)
  GET  /api/project/{pid}               project, its stakeholder profiles and timeline settings
  POST /api/timeline/{id}                {project, floor?}     -> 10 years: unchanged use + pathways of change
                                                                  (whole building, or one floor if floor is set)
  POST /api/floor/{id}/{index}/use/{use}                       -> that one floor at `use`, every other floor
                                                                  untouched (the 3D view for the floor timeline)
                                                                  ({status: computing, done, total} until ready)
  GET  /api/models                      Rhino .3dm files in explorer/models (loaded in the viewer)"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import climate, comfort, daylight, district, figures, kpis, layers, model as M, timeline
from .studio import capacity as studio_capacity, engine as studio, layouts as studio_layouts, money as studio_money, occupancy as studio_occupancy, tenancy as studio_tenancy

HERE = Path(__file__).resolve().parent
DIST = HERE / "web" / "dist"
MODELS = HERE / "models"
SIM_SCRIPT = HERE / "sim" / "full_sim.py"
LANDING = HERE.parent / "web" / "landing.html"           # the Digital Lab front door

app = FastAPI(title="Marievik+ Explorer", docs_url="/api/docs")
SITE: M.Site | None = None
JOBS: dict[str, dict] = {}
CAPS: dict = {"probed": False}


def site() -> M.Site:
    global SITE
    if SITE is None:
        SITE = M.Site()
    return SITE


class ScenarioBody(BaseModel):
    settings: dict | None = None


class AnalysisBody(BaseModel):
    building: str
    floor: int
    settings: dict | None = None
    context: dict | None = None          # {building id: settings} of the other buildings (their heights)
    unit: str | None = None
    daylight: bool = True
    energy: bool = True
    grid: float = 0.75


def _check(bid: str):
    if bid not in site().buildings:
        raise HTTPException(404, "unknown building %s" % bid)


# ---------------------------------------------------------------------------- model
@app.get("/api/site")
def api_site():
    return site().site_payload()


@app.get("/api/context")
def api_context():
    return site().context()


@app.get("/api/urban")
def api_urban():
    return {"buildings": site().urban_summary(), "radius_m": site().URBAN_RADIUS_M}


@app.post("/api/building/{bid}")
def api_building(bid: str, body: ScenarioBody):
    _check(bid)
    return site().building_payload(bid, body.settings)


@app.post("/api/floor/{bid}/{index}")
def api_floor(bid: str, index: int, body: ScenarioBody):
    _check(bid)
    sc = site().scenario(bid, body.settings)
    if not 0 <= index < len(sc["res"]["floors"]):
        raise HTTPException(404, "floor %d does not exist" % index)
    return site().floor_payload(bid, index, body.settings)


# ---------------------------------------------------------------------------- parametric view + suppliers
class ParametricBody(BaseModel):
    settings: dict | None = None
    floor: int = 1


@app.post("/api/parametric/{bid}")
def api_parametric(bid: str, body: ParametricBody):
    _check(bid)
    return site().parametric_payload(bid, body.settings, body.floor)


@app.post("/api/parametric/{bid}/cell")
def api_parametric_cell(bid: str, body: ScenarioBody):
    _check(bid)
    return site().parametric_cell(bid, body.settings)


@app.post("/api/supplier/{sid}/compare/{bid}")
def api_supplier_compare(sid: str, bid: str, body: ScenarioBody):
    _check(bid)
    if sid not in site().suppliers:
        raise HTTPException(404, "unknown supplier %s (no data/components/suppliers/%s.json)" % (sid, sid))
    return site().supplier_compare(sid, bid, body.settings)


# ---------------------------------------------------------------------------- CAVF KPIs per profile
@app.get("/api/methods")
def api_methods():
    return kpis.methods_payload()


@app.post("/api/kpis/{bid}")
def api_kpis(bid: str, body: ScenarioBody):
    _check(bid)
    return kpis.building_kpis(site(), bid, body.settings)


@app.post("/api/figures/{bid}")
def api_figures(bid: str, body: ScenarioBody):
    _check(bid)
    return figures.building_figures(site(), bid, body.settings)


# ---------------------------------------------------------------------------- projects and the 10-year timeline
PROJECTS = M.ROOT / "data" / "projects"
TIMELINES = timeline.Timelines(site)


def project_file(pid: str) -> dict | None:
    p = PROJECTS / f"{pid}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.parent == PROJECTS and p.is_file() else None


@app.get("/api/project/{pid}")
def api_project(pid: str):
    p = project_file(pid)
    if p is None:
        raise HTTPException(404, "no project file data/projects/%s.json: the generic profiles apply" % pid)
    return p


# ---------------------------------------------------------------- floor studio (B01 mock-up: explorer/studio)
STUDIO_BUILDINGS = {"B01"}   # the studio's geometry is B01's traced plan; other buildings need their own plans first


def _studio_check(bid: str, floor: int, layout: str | None = None):
    if bid not in STUDIO_BUILDINGS:
        raise HTTPException(404, f"no floor studio for {bid}: only {', '.join(sorted(STUDIO_BUILDINGS))} has drawn plans")
    if layout is not None and layout not in studio_layouts.LAYOUTS:
        raise HTTPException(400, f"unknown layout {layout}")
    if layout is not None and studio_layouts.LAYOUTS[layout].ground != (floor == 0):
        raise HTTPException(400, f"{layout} is a {'ground' if studio_layouts.LAYOUTS[layout].ground else 'upper'}-floor layout")


@app.get("/api/studio/layouts")
def api_studio_layouts():
    """The layouts a floor can take, today's layout per floor, B01's frame and fixed geometry, and which layout
    stands for each of the 10-year timeline's floor uses."""
    L = studio_layouts
    uses = timeline.SINGLE_FLOOR_USES + list(timeline.MIX_STATES)
    return {"layouts": {lid: {"name": x.name, "short": x.short, "use": x.use, "ground": x.ground} for lid, x in L.LAYOUTS.items()},
            "ground": L.GROUND_LAYOUTS, "typical": L.TYPICAL_LAYOUTS, "defaultFloor": L.DEFAULT_FLOOR_LAYOUT,
            "useToLayout": {"ground": {u: L.layout_for_use(u, True) for u in uses}, "typical": {u: L.layout_for_use(u, False) for u in uses}},
            "geometry": {"frame": L.FRAME, "plate": [L.W, L.H], "cell": L.CELL, "nx": L.NX, "ny": L.NY, "cores": L.CORES, "atrium": L.ATRIUM,
                         "lifts": L.LIFTS, "escapeLimit": L.ESCAPE_LIMIT, "wallH": L.WALL_H},
            "buildings": sorted(STUDIO_BUILDINGS)}


class StudioBody(BaseModel):
    layout: str | None = None
    params: dict[str, float] = {}


@app.post("/api/studio/{bid}/{floor}")
def api_studio_floor(bid: str, floor: int, body: StudioBody):
    """One floor in one layout: rooms, doors, partitions, furniture, walking grid, escape routes and every check,
    plus what moving the walls from the layout as drawn would cost."""
    lid = body.layout or studio_layouts.layout_for(floor)
    _studio_check(bid, floor, lid)
    m = studio.build(lid, body.params, floor)
    extra = {}
    if any(abs(m["p"][k] - v) > 1e-6 for k, v in m["L"].defaults.items()):
        ch = studio_money.change_cost(studio.build(lid, {}, floor), m)
        walls = ch["rows"][:4]
        base = studio.build(lid, {}, floor)["fig"]
        extra["edit"] = {"rows": walls, "sek": sum(r["sek"] for r in walls), "kg": sum(r["kg"] for r in walls),
                         "seatsDelta": m["fig"]["seatsAll"] - base["seatsAll"], "peopleDelta": m["fig"]["people"] - base["people"]}
    return studio.payload(m, extra)


class SeriesBody(BaseModel):
    layouts: list[str]
    years: list[int]
    params: dict[str, float] = {}
    overrides: list[dict | None] = []


@app.post("/api/studio/{bid}/{floor}/series")
def api_studio_series(bid: str, floor: int, body: SeriesBody):
    """Year-by-year KPIs (running costs, replacements, works, carbon, people) for a sequence of layouts."""
    if len(body.layouts) != len(body.years):
        raise HTTPException(400, "one layout per year")
    for lid in set(body.layouts):
        _studio_check(bid, floor, lid)
    return {"years": studio_money.series(body.layouts, body.years, floor, body.params, body.overrides)}


@app.post("/api/studio/{bid}/{floor}/maximise")
def api_studio_maximise(bid: str, floor: int, body: StudioBody):
    """The wall positions that fit the most people in this layout while every standards and safety check passes."""
    lid = body.layout or studio_layouts.layout_for(floor)
    _studio_check(bid, floor, lid)
    start = studio.build(lid, body.params, floor)
    res = studio_capacity.maximise(lid, floor, body.params)
    m = res["model"]
    return {"layout": lid, "params": m["p"], "tried": res["tried"],
            "before": {"people": start["fig"]["people"], "seats": start["fig"]["seatsAll"], "allOk": start["fig"]["allOk"]},
            "after": {"people": m["fig"]["people"], "seats": m["fig"]["seatsAll"], "allOk": m["fig"]["allOk"],
                      "failed": [c["text"] for c in m["fig"]["checks"] if not c["ok"]]}}


@app.post("/api/studio/{bid}/{floor}/compare")
def api_studio_compare(bid: str, floor: int, body: StudioBody):
    """Every layout this floor can take, each with its walls placed for the most people: people, checks, and the
    cost of changing from today's layout."""
    lid = body.layout or studio_layouts.layout_for(floor)
    _studio_check(bid, floor, lid)
    return {"today": lid, "rows": studio_capacity.compare_layouts(floor, lid, body.params)}


class OccupancyBody(StudioBody):
    days: int = 20
    seed: int = 1
    attendance: float | None = None   # share of staff in at the peak; None = the use catalogue's
    demand: float = 1.0               # guest arrivals against the catalogue's profile


@app.post("/api/studio/{bid}/{floor}/occupancy")
def api_studio_occupancy(bid: str, floor: int, body: OccupancyBody):
    """Simulated working days on the floor: people hour by hour, desks, meeting and focus rooms, lunch, WC queues,
    walking. Uncalibrated until there is sensor data."""
    lid = body.layout or studio_layouts.layout_for(floor)
    _studio_check(bid, floor, lid)
    if not 1 <= body.days <= 120:
        raise HTTPException(400, "days must be 1-120")
    if body.attendance is not None and not 0 < body.attendance <= 1:
        raise HTTPException(400, "attendance is a share, 0-1")
    m = studio.build(lid, body.params, floor)
    return {"layout": lid, **studio_occupancy.simulate(m, body.days, body.seed, body.attendance, max(0.0, body.demand))}


class EvacuationBody(StudioBody):
    people: int | None = None   # None = the floor's planned people
    seed: int = 1


def _run_evacuation(job_id: str, case: dict):
    """JuPedSim in its own process, so a long run never holds up the server."""
    job = JOBS[job_id]
    folder = Path(tempfile.mkdtemp(prefix="mvx_evac_"))
    cf, rf = folder / "case.json", folder / "result.json"
    cf.write_text(json.dumps(case), encoding="utf-8")
    job.update(status="running", started=time.time())
    try:
        with open(folder / "log.txt", "w") as log:
            subprocess.run([sys.executable, "-m", "explorer.studio.evacuation", str(cf), str(rf)], cwd=str(M.ROOT),
                           stdout=log, stderr=subprocess.STDOUT, timeout=1800)
        if rf.is_file():
            job.update(status="complete", result=json.loads(rf.read_text(encoding="utf-8")))
        else:
            job.update(status="failed", error=(folder / "log.txt").read_text(errors="ignore")[-3000:])
    except Exception as e:
        job.update(status="failed", error=str(e))
    job["finished"] = time.time()


@app.post("/api/studio/{bid}/{floor}/evacuation")
def api_studio_evacuation(bid: str, floor: int, body: EvacuationBody):
    """Start a JuPedSim evacuation of the floor as laid out; poll /api/jobs/{job} for the result."""
    lid = body.layout or studio_layouts.layout_for(floor)
    _studio_check(bid, floor, lid)
    try:
        import jupedsim  # noqa: F401
    except ImportError:
        raise HTTPException(409, "JuPedSim is not installed in the server's Python (pip install jupedsim)")
    if body.people is not None and not 1 <= body.people <= 2000:
        raise HTTPException(400, "people must be 1-2000")
    case = {"layout": lid, "params": body.params, "floor": floor, "people": body.people, "seed": body.seed}
    key = json.dumps(case, sort_keys=True)
    for j in JOBS.values():   # the same run asked for again: hand back the job already there
        if j.get("evacuation") == key and j["status"] in ("queued", "running", "complete"):
            return {"job": j["id"], "status": j["status"]}
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"id": job_id, "status": "queued", "evacuation": key, "building": bid, "floor": floor, "created": time.time()}
    threading.Thread(target=_run_evacuation, args=(job_id, case), daemon=True).start()
    return {"job": job_id, "status": "queued"}


# ---------------------------------------------------------------- the district over ten years (explorer/district.py)
class DistrictBody(BaseModel):
    cards: list[str] = []
    runs: int = 20
    seed: int = 1
    project: str = "marievik"


@app.get("/api/district/meta")
def api_district_meta():
    """The strategy cards and tenant types of the district model."""
    return district.meta()


def _district_check(body: DistrictBody, max_runs: int):
    unknown = set(body.cards) - set(district.market()["strategies"])
    if unknown:
        raise HTTPException(400, f"unknown strategy card(s): {', '.join(sorted(unknown))}")
    if not 1 <= body.runs <= max_runs:
        raise HTTPException(400, f"runs must be 1-{max_runs}")


@app.post("/api/district/run")
def api_district_run(body: DistrictBody):
    """Ten years of tenants choosing Marievik or elsewhere under the chosen strategy cards, against business as
    usual: vacancy, income, carbon and life per building, for the district and the wider area."""
    _district_check(body, 60)
    return {"strategy": district.simulate(site(), body.cards, body.runs, body.seed, body.project),
            "baseline": district.simulate(site(), [], body.runs, body.seed, body.project)}


@app.post("/api/district/compare")
def api_district_compare(body: DistrictBody):
    """Every strategy card alone, all of them, and none: 10-year value against carbon."""
    _district_check(body, 30)
    return district.compare(site(), body.runs, body.seed, body.project)


class LayersBody(BaseModel):
    studio: dict[str, str] = {}             # B01 floor -> floor-studio layout (as chosen in the explorer)
    params: dict[str, dict[str, float]] = {}


@app.post("/api/layers")
def api_layers(body: LayersBody):
    """Movement, fire escape and capacity for every building and floor (B01 from plans, others estimated)."""
    lay = {int(k): v for k, v in body.studio.items()}
    for f, lid in lay.items():
        _studio_check("B01", f, lid)
    return layers.site_layers(site(), lay, {int(k): v for k, v in body.params.items()})


class TenancyBody(BaseModel):
    project: str = "marievik"
    building: str
    floors: list[dict]   # [{floor, gfa}]


@app.post("/api/tenancy")
def api_tenancy(body: TenancyBody):
    """Who rents which suite on each floor (data/projects/<project>/leases.json), or example occupancy."""
    return {"floors": [studio_tenancy.floor_tenancy(body.project, body.building, int(f["floor"]), float(f.get("gfa", 0))) for f in body.floors]}


class TimelineBody(BaseModel):
    project: str = "marievik"
    floor: int | None = None          # one floor's own 10-year timeline, instead of the whole building


@app.post("/api/timeline/{bid}")
def api_timeline(bid: str, body: TimelineBody):
    _check(bid)
    p = project_file(body.project) or project_file("marievik")
    if body.floor is not None:
        n = len(site().scenario(bid, {})["res"]["floors"])
        if not 0 <= body.floor < n:
            raise HTTPException(404, "floor %d does not exist" % body.floor)
    return TIMELINES.get(bid, p, body.floor)


@app.post("/api/floor/{bid}/{index}/use/{use}")
def api_floor_use(bid: str, index: int, use: str):
    """One floor at a given use, every other floor left exactly as it is today — the 3D view behind
    the single-floor 10-year timeline, since the ordinary ?settings-based /api/floor/{bid}/{index}
    always moves every 'upper' floor together."""
    _check(bid)
    if use not in M.USES:
        raise HTTPException(404, "unknown use %s" % use)
    sc = site().scenario(bid, {})
    if not 0 <= index < len(sc["res"]["floors"]):
        raise HTTPException(404, "floor %d does not exist" % index)
    return site().floor_payload_override(bid, index, use)


# ---------------------------------------------------------------------------- quick analysis
@app.post("/api/analysis/daylight")
def api_daylight(body: AnalysisBody):
    _check(body.building)
    return daylight.floor_daylight(site(), body.building, body.floor, body.settings, body.context, body.grid)


@app.post("/api/analysis/comfort")
def api_comfort(body: AnalysisBody):
    _check(body.building)
    return comfort.floor_comfort(site(), body.building, body.floor, body.settings, body.context,
                                 [body.unit] if body.unit else None)


# ---------------------------------------------------------------------------- Ladybug Tools
def sim_python() -> Path | None:
    env = os.environ.get("MVX_SIM_PYTHON")
    root = M.ROOT / ".venv-sim"
    for p in ([Path(env)] if env else []) + [root / "Scripts" / "python.exe", root / "bin" / "python"]:
        if p.is_file():
            return p
    return None


def probe() -> dict:
    py = sim_python()
    out = {"probed": True, "sim_python": str(py) if py else None, "honeybee": False,
           "energyplus": None, "radiance": None, "quick": True}
    if py:
        code = ("import json\nfrom honeybee_energy.config import folders as e\n"
                "try:\n from honeybee_radiance.config import folders as r; rp=r.radiance_path\nexcept Exception: rp=None\n"
                "try:\n import lbt_recipes; rec=True\nexcept Exception: rec=False\n"
                "print(json.dumps({'energyplus': e.energyplus_path, 'radiance': rp, 'recipes': rec}))")
        try:
            r = subprocess.run([str(py), "-c", code], capture_output=True, text=True, timeout=60)
            d = json.loads(r.stdout.strip().splitlines()[-1])
            out.update(honeybee=True, **d)
        except Exception as e:  # report, never fail the server
            out["error"] = str(e)
    return out


@app.get("/api/capabilities")
def api_capabilities():
    if not CAPS.get("probed"):
        CAPS.update(probe())
    return CAPS


def full_case(body: AnalysisBody) -> dict:
    S = site()
    sc = S.scenario(body.building, body.settings)
    F = sc["res"]["floors"][body.floor]
    base = F.z + F.slab_t
    units = sc["units"][body.floor]
    unit_of = {wid: u["id"] for u in units for wid in u["windows"]}
    wall_of = {w["id"]: w for w in F.walls}
    windows = []
    for o in F.openings:
        if o["kind"] != "window" or o["id"] not in unit_of:
            continue
        w = wall_of[o["wall"]]
        t = F.thick(w)
        (ux, uy), _ = M.L._unit(w["a"], w["b"])
        nx, ny = uy, -ux
        a = [w["a"][0] + ux * o["s0"] + nx * t / 2, w["a"][1] + uy * o["s0"] + ny * t / 2]
        b = [w["a"][0] + ux * o["s1"] + nx * t / 2, w["a"][1] + uy * o["s1"] + ny * t / 2]
        windows.append({"unit": unit_of[o["id"]], "a": a, "b": b, "n": [nx, ny],
                        "z0": base + o["z0"], "z1": base + o["z1"]})
    ctx = []
    for p in S.context_prisms(dict(body.context or {}, **{body.building: body.settings or {}})):
        if p["id"] == body.building:
            ctx.append({"rings": p["rings"], "z0": 0.0, "height": max(0.1, F.z)})
            if F.z + F.height < sc["res"]["height"] - 0.1:
                ctx.append({"rings": p["rings"], "z0": F.z + F.height, "height": sc["res"]["height"]})
        else:
            ctx.append({"rings": p["rings"], "z0": 0.0, "height": p["height"]})
    added = body.floor >= sc["levels"]
    prof = comfort.PROFILES[comfort.PROFILE_FOR.get(F.use, "office")]
    return {"id": "%s_F%02d_%s" % (body.building, body.floor, sc["key"].split(":")[1]),
            "z": base, "height": F.wall_h, "top": body.floor == len(sc["res"]["floors"]) - 1,
            "units": [{"id": u["id"], "name": u["name"], "kind": u["kind"], "poly": u["poly"], "holes": u.get("holes")}
                      for u in units],
            "windows": windows, "exterior_rings": M._rings(F.footprint), "context": ctx,
            "profile": comfort.PROFILE_FOR.get(F.use, "office"), "m2_per_person": prof["m2_per_person"],
            "envelope": "added" if added else ("upgraded" if sc["settings"]["windows"] != "existing" else "existing"),
            "openable": added or sc["settings"]["windows"] != "existing",
            "epw": str(climate.EPW_DEFAULT), "grid": body.grid,
            "run_daylight": body.daylight, "run_energy": body.energy}


def _run_job(job_id: str, case: dict):
    job = JOBS[job_id]
    py = sim_python()
    folder = Path(tempfile.mkdtemp(prefix="mvx_job_"))
    cf, rf = folder / "case.json", folder / "result.json"
    cf.write_text(json.dumps(case), encoding="utf-8")
    job.update(status="running", started=time.time())
    try:
        with open(folder / "log.txt", "w") as log:
            subprocess.run([str(py), str(SIM_SCRIPT), str(cf), str(rf)], cwd=str(M.ROOT), stdout=log,
                           stderr=subprocess.STDOUT, timeout=1800)
        result = json.loads(rf.read_text(encoding="utf-8")) if rf.is_file() else None
        if result is None:
            job.update(status="failed", error=(folder / "log.txt").read_text(errors="ignore")[-3000:])
        else:
            job.update(status="complete", result=result)
    except Exception as e:
        job.update(status="failed", error=str(e))
    job["finished"] = time.time()


@app.post("/api/analysis/full")
def api_full(body: AnalysisBody):
    _check(body.building)
    if not sim_python():
        raise HTTPException(409, "No Ladybug Tools environment (.venv-sim) found - quick analysis only. "
                                 "See explorer/README.md to set it up.")
    case = full_case(body)
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"id": job_id, "status": "queued", "building": body.building, "floor": body.floor,
                    "settings": body.settings, "created": time.time()}
    threading.Thread(target=_run_job, args=(job_id, case), daemon=True).start()
    return {"job": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "unknown job")
    return JOBS[job_id]


# ---------------------------------------------------------------------------- Rhino models + web app
@app.get("/api/models")
def api_models():
    MODELS.mkdir(exist_ok=True)
    return {"models": [{"name": p.name, "url": "/models/" + p.name, "bytes": p.stat().st_size}
                       for p in sorted(MODELS.glob("*.3dm"))]}


@app.get("/models/{name}")
def model_file(name: str):
    p = (MODELS / name).resolve()
    if p.parent != MODELS.resolve() or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="application/octet-stream")


for _sub in ("assets", "rhino3dm"):               # the built app and the rhino3dm WebAssembly runtime
    if (DIST / _sub).is_dir():
        app.mount("/" + _sub, StaticFiles(directory=DIST / _sub), name=_sub)


@app.get("/", response_class=HTMLResponse)
def landing():
    return LANDING.read_text(encoding="utf-8")


@app.get("/explorer", response_class=HTMLResponse)
def index():
    f = DIST / "index.html"
    if f.is_file():
        return f.read_text(encoding="utf-8")
    return ("<h3>Marievik+ Explorer</h3><p>The web app is not built yet. Run <code>npm install</code> and "
            "<code>npm run build</code> in <code>explorer/web</code>, or <code>npm run dev</code> there for "
            "development (http://localhost:5174).</p>")


@app.on_event("startup")
def _warm():
    def work():
        CAPS.update(probe())
        S = site()
        for bid in S.buildings:              # every building's current-use scenario, ready before it is asked for
            try:
                S.scenario(bid, {})
            except Exception as e:           # a footprint the engine cannot lay out must not stop the rest
                print("warm-up %s failed: %s" % (bid, e), file=sys.stderr)
        for p in sorted(PROJECTS.glob("*.json")):   # pilot buildings' timelines, ready before they are asked for
            proj = json.loads(p.read_text(encoding="utf-8"))
            for bid in proj.get("pilot_buildings", []):
                if bid in S.buildings:
                    TIMELINES.get(bid, proj)
    threading.Thread(target=work, daemon=True).start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8020)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    import uvicorn
    print("Marievik+ Digital Lab  ->  http://%s:%d   (explorer: /explorer)" % (a.host, a.port))
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
