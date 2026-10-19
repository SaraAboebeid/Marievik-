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
  GET  /api/models                       Rhino .3dm files in explorer/models (loaded in the viewer)"""
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

from . import climate, comfort, daylight, kpis, model as M

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
