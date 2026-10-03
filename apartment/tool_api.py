"""The parametric side of the Apartment Lab.

    POST /api/score      everything for one plan: the evaluator's KPIs plus the
                         optimiser's five criteria, window works costed
    POST /api/thermal    EnergyPlus comfort for the plan on the canvas (~10 s, cached)
    POST /api/sweep      play one parameter through its range: a frame per value,
                         each scored, plus the least-regret frame
    POST /api/optimise   start a full optimiser run on the current shell
    GET  /api/jobs/{id}  its progress and, when done, its ten options per use

The editor drives all of it; nothing here keeps state between calls except
the thermal cache and running jobs.
"""

from __future__ import annotations

import math
import threading
import time
import traceback
import uuid
from copy import deepcopy

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from engine import loader
from explore import search

from . import envelope, evaluate, geometry, shells

router = APIRouter()


# ---------------------------------------------------------------------------
# Scoring one plan
# ---------------------------------------------------------------------------


def _specs(user_group: str) -> dict:
    from .server import specs_for
    return specs_for(user_group)


def _brief(use: str):
    from optimise import programs
    return programs.BRIEFS.get(use) or programs.BRIEFS["student_housing"]


def with_works(plan: dict, shell_id: str | None) -> dict:
    """Cost the windows against the shell as built."""
    out = dict(plan)
    built = []
    if shell_id and shell_id in shells.all_shells():
        built = shells.shell(shell_id)["shell"]["windows"]
    others = [w for w in plan.get("works", []) if w.get("source") != "windows"]
    out["works"] = others + envelope.window_works(built, plan["shell"]["windows"])
    return out


def score(plan: dict, settings: dict) -> dict:
    """The evaluator's numbers and the optimiser's criteria for one plan."""
    from optimise import pipeline

    group_id = settings.get("user_group", "adult")
    groups = loader.user_groups()
    clear = groups.get(group_id, groups["adult"]).get("clearances_mm", {})
    brief = _brief(settings.get("use", "student_housing"))
    s = {"target_area_m2": brief.target_area_m2, "needs_beds": brief.needs_beds, **settings}
    if "hot_water_kwh_m2" not in s and "heating_kwh_m2" in s:
        s["heating_kwh_m2"] = float(s["heating_kwh_m2"]) + brief.hot_water_kwh_m2

    plan = with_works(plan, settings.get("shell_id"))
    specs = _specs(group_id)
    geo = geometry.analyse(plan, specs, clear.get("turning_circle", 1200),
                           clear.get("passage_width_single", 900), clear.get("door_clear_width", 800))
    result = evaluate.evaluate(plan, geo, s)
    social = {m.name: round(m.score, 1) for m in result.social}
    occupants = max(1, int(settings.get("occupants", 1)))
    usability = pipeline._usability(brief, social)
    func, func_detail = pipeline.functionality(brief, occupants, plan, geo, social)
    criteria = {
        "lcc": round(result.money.lcc / occupants),
        "carbon": round(result.carbon.total / occupants),
        "usability": usability,
        "functionality": func,
    }
    if settings.get("comfort") is not None:
        criteria["comfort"] = settings["comfort"]
    return {"plan": plan, "geo": geo, "result": result, "criteria": criteria,
            "functionality_detail": func_detail, "works": plan["works"]}


class ScoreRequest(BaseModel):
    plan: dict
    settings: dict = {}


@router.post("/api/score")
def api_score(req: ScoreRequest):
    from .server import evaluation_payload

    scored = score(req.plan, req.settings)
    payload = evaluation_payload(scored["result"], scored["geo"], req.settings)
    payload["criteria"] = scored["criteria"]
    payload["functionality_detail"] = scored["functionality_detail"]
    payload["works"] = scored["works"]
    return payload


# ---------------------------------------------------------------------------
# Thermal comfort for the plan on the canvas
# ---------------------------------------------------------------------------


def thermal_for(plans_settings: list[tuple[dict, dict]]) -> list[dict | None]:
    """Simulate several plans in one EnergyPlus batch."""
    from optimise import thermal, zones

    cases = []
    for plan, settings in plans_settings:
        brief = _brief(settings.get("use", "student_housing"))
        z = zones.from_plan(plan, _specs(settings.get("user_group", "adult")),
                            max(1, int(settings.get("occupants", 1))))
        azimuth = float(settings.get("azimuth", plan["shell"].get("facade_azimuth_deg", 180.0)))
        cases.append((thermal.case(plan, brief.thermal_profile, "existing", azimuth, z), z))
    results = thermal.run([c for c, _z in cases], log=lambda *_: None)
    out = []
    for c, z in cases:
        sim = results.get(c["id"])
        if not sim or not sim.get("ok"):
            out.append({"ok": False, "error": (sim or {}).get("error", "no result")[:500]})
            continue
        comfort, detail = thermal.summarise(sim, z)
        out.append({"ok": True, "comfort": comfort, **detail})
    return out


@router.post("/api/thermal")
def api_thermal(req: ScoreRequest):
    t0 = time.time()
    res = thermal_for([(req.plan, req.settings)])[0]
    res["seconds"] = round(time.time() - t0, 1)
    return res


# ---------------------------------------------------------------------------
# Sweeps: one parameter through its range
# ---------------------------------------------------------------------------

PARAMETERS = {
    "sill": {"label": "Window sill height", "unit": "mm", "values": [300, 450, 600, 750, 900, 1050]},
    "window_width": {"label": "Window width", "unit": "%", "values": [60, 80, 100, 120, 140, 160]},
    "glazing": {"label": "Glazing", "unit": "", "values": ["existing", "upgraded"]},
    "partition": {"label": "Wall system", "unit": "", "values": list(search.SPEC_VARIANTS)},
    "products": {"label": "Product strategy", "unit": "", "values": ["standard", "circular", "durable", "mixed"]},
    "occupants": {"label": "People", "unit": "", "values": [1, 2, 3, 4]},
    "wall_offset": {"label": "Move selected wall", "unit": "mm", "values": [-1200, -800, -400, 0, 400, 800, 1200]},
    "rearrange": {"label": "Furniture arrangement", "unit": "variant", "values": [0, 1, 2, 3, 4, 5]},
    "azimuth": {"label": "Facade orientation", "unit": "°", "values": [0, 45, 90, 135, 180, 225, 270, 315]},
}


def _facade_span(plan: dict) -> tuple[float, float]:
    from shapely.geometry import LineString

    shell = plan["shell"]
    interior = geometry.interior_polygon(shell)
    fy = shell.get("facade_y_mm", shell.get("external_wall_thickness_mm", 250))
    span = interior.intersection(LineString([(-1e5, fy + 20), (1e5, fy + 20)]))
    return span.bounds[0], span.bounds[2]


def apply_parameter(plan: dict, settings: dict, param: str, value, wall_id: str | None = None):
    """A copy of plan and settings with one parameter set; None if it cannot apply."""
    p, s = deepcopy(plan), dict(settings)
    windows = [w for w in p["shell"]["windows"] if not w.get("door")]
    if param == "sill":
        for w in windows:
            w["sill_mm"] = int(value)
            w["head_mm"] = max(w["head_mm"], int(value) + 400)
    elif param == "window_width":
        left, right = _facade_span(p)
        built = {w.get("id"): w for w in shells.shell(settings["shell_id"])["shell"]["windows"]} \
            if settings.get("shell_id") in shells.all_shells() else {}
        for w in windows:
            b = built.get(w.get("id"), w)
            cx, half = (b["x1"] + b["x2"]) / 2, (b["x2"] - b["x1"]) / 2 * float(value) / 100
            w["x1"], w["x2"] = round(max(left + 100, cx - half)), round(min(right - 100, cx + half))
    elif param == "glazing":
        for w in p["shell"]["windows"]:
            w["glazing"] = value
    elif param == "partition":
        p = search.apply_spec(p, value)
        for wall in p["walls"]:
            if wall.get("fixed"):
                wall["component"] = next(w["component"] for w in plan["walls"] if w["id"] == wall["id"])
    elif param == "products":
        from optimise.pipeline import apply_products
        p = apply_products(p, value)
    elif param == "occupants":
        s["occupants"] = int(value)
    elif param == "azimuth":
        s["azimuth"] = float(value)
    elif param == "wall_offset":
        wall = next((w for w in p["walls"] if w["id"] == wall_id), None)
        if wall is None or wall.get("fixed"):
            return None
        horizontal = abs(wall["y2"] - wall["y1"]) < abs(wall["x2"] - wall["x1"])
        d = int(value)
        moved = {"x1": wall["x1"], "y1": wall["y1"], "x2": wall["x2"], "y2": wall["y2"]}
        if horizontal:
            moved["y1"] += d; moved["y2"] += d
        else:
            moved["x1"] += d; moved["x2"] += d
        # Walls that met the moved wall's old line follow it, so rooms stay closed.
        for other in p["walls"]:
            if other is wall or other.get("fixed"):
                continue
            for end in ("1", "2"):
                ox, oy = other["x" + end], other["y" + end]
                if horizontal and abs(oy - wall["y1"]) < 60 and min(wall["x1"], wall["x2"]) - 60 <= ox <= max(wall["x1"], wall["x2"]) + 60:
                    other["y" + end] = oy + d
                if not horizontal and abs(ox - wall["x1"]) < 60 and min(wall["y1"], wall["y2"]) - 60 <= oy <= max(wall["y1"], wall["y2"]) + 60:
                    other["x" + end] = ox + d
        wall.update(moved)
        interior = geometry.interior_polygon(p["shell"]).buffer(60)
        from shapely.geometry import LineString
        if not interior.contains(LineString([(wall["x1"], wall["y1"]), (wall["x2"], wall["y2"])])):
            return None
    elif param == "rearrange":
        from . import anneal
        variants = anneal.arrange(p, _specs(s.get("user_group", "adult")), variants=1,
                                  iterations=3000, seed=int(value) * 7 + 1)
        if variants:
            p = variants[0]["plan"]
    else:
        raise HTTPException(400, f"unknown parameter {param}")
    return p, s


def least_regret(frames: list[dict]) -> int | None:
    """Index of the frame with the smallest worst-case regret across stakeholder views."""
    from optimise.pipeline import CRITERIA
    from optimise.selection import STAKEHOLDERS

    ok = [i for i, f in enumerate(frames) if f.get("criteria")]
    if not ok:
        return None
    keys = [k for k in CRITERIA if all(k in frames[i]["criteria"] for i in ok)]
    norm = {i: {} for i in ok}
    for k in keys:
        vals = [frames[i]["criteria"][k] for i in ok]
        lo, hi = min(vals), max(vals)
        for i in ok:
            v = frames[i]["criteria"][k]
            n = 0.5 if hi == lo else (v - lo) / (hi - lo)
            norm[i][k] = n if CRITERIA[k]["sense"] > 0 else 1 - n
    worst = {}
    for i in ok:
        regrets = []
        for meta in STAKEHOLDERS.values():
            w = {k: meta["w"][k] for k in keys}
            total = sum(w.values()) or 1
            util = {j: sum(w[k] * norm[j][k] for k in keys) / total for j in ok}
            regrets.append(max(util.values()) - util[i])
        worst[i] = max(regrets)
    return min(ok, key=lambda i: worst[i])


class SweepRequest(BaseModel):
    plan: dict
    settings: dict = {}
    parameter: str
    values: list | None = None
    wall_id: str | None = None
    thermal: bool = False


@router.post("/api/sweep")
def api_sweep(req: SweepRequest):
    meta = PARAMETERS.get(req.parameter)
    if not meta:
        raise HTTPException(400, f"unknown parameter {req.parameter}")
    values = req.values or meta["values"]
    frames = []
    for v in values:
        applied = apply_parameter(req.plan, req.settings, req.parameter, v, req.wall_id)
        if applied is None:
            frames.append({"value": v, "skipped": "does not fit in the plan"})
            continue
        p, s = applied
        frames.append({"value": v, "plan": p, "settings": s})

    use_thermal = req.thermal or req.parameter == "azimuth"
    sims = thermal_for([(f["plan"], f["settings"]) for f in frames if "plan" in f]) if use_thermal else []
    sim_iter = iter(sims)
    for f in frames:
        if "plan" not in f:
            continue
        s = dict(f["settings"])
        sim = next(sim_iter) if use_thermal else None
        if sim and sim.get("ok"):
            s["heating_kwh_m2"] = sim["heating_kwh_m2"]
            s["cooling_kwh_m2"] = sim["cooling_kwh_m2"]
            s["comfort"] = sim["comfort"]
        scored = score(f["plan"], s)
        f["plan"] = scored["plan"]
        f["criteria"] = scored["criteria"]
        r = scored["result"]
        f["kpis"] = {"capex": round(r.money.capex), "lcc": round(r.money.lcc),
                     "carbon_upfront": round(r.carbon.upfront), "carbon_total": round(r.carbon.total),
                     "issues": sum(1 for i in r.issues if i["severity"] != "minor")}
        if sim:
            f["thermal"] = sim
    best = least_regret(frames)
    return {"parameter": req.parameter, "meta": meta, "frames": frames, "least_regret": best,
            "thermal": use_thermal}


@router.get("/api/parameters")
def api_parameters():
    return PARAMETERS


# ---------------------------------------------------------------------------
# Scenarios: the best layouts for every use, computed without being asked
# ---------------------------------------------------------------------------
#
# Opening a flat should show what it could be, not wait for a button. The
# first time a flat is opened, a quick optimiser run for every use starts in
# the background; its result is saved, so every later start is instant.
# Delete the file, or POST .../refresh, to recompute after changing data.

SCENARIO_VERSION = "1"
SCENARIOS: dict[str, dict] = {}
_scenario_lock = threading.Lock()


def _scenario_file(shell_id: str):
    from optimise.run import ROOT
    return ROOT / "runs" / "optimise" / f"scenarios_{shell_id}.json"


def _scenario_worker(shell_id: str) -> None:
    import json as _json

    from optimise import programs, run

    state = SCENARIOS[shell_id]

    def log(*parts):
        line = " ".join(str(p) for p in parts).strip()
        if line and "furnished" not in line:
            state["log"].append(line)

    try:
        with _scenario_lock:  # one EnergyPlus batch at a time
            uses = list(programs.BRIEFS)
            results = run.optimise(uses, shell_id=shell_id, quick=True, log=log)
        results["scenario_version"] = SCENARIO_VERSION
        path = _scenario_file(shell_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_json.dumps(results, default=str), encoding="utf-8")
        state.update(status="ready", result=results)
    except Exception as exc:
        state.update(status="failed")
        state["log"].append(f"failed: {exc}")
        state["log"].append(traceback.format_exc()[-1500:])


def ensure_scenarios(shell_id: str, refresh: bool = False) -> dict:
    import json as _json

    state = SCENARIOS.get(shell_id)
    if state and not refresh and state["status"] in ("running", "ready"):
        return state
    path = _scenario_file(shell_id)
    if not refresh and path.exists():
        try:
            saved = _json.loads(path.read_text(encoding="utf-8"))
            if saved.get("scenario_version") == SCENARIO_VERSION:
                SCENARIOS[shell_id] = {"status": "ready", "result": saved, "log": [], "started": time.time()}
                return SCENARIOS[shell_id]
        except ValueError:
            pass
    SCENARIOS[shell_id] = {"status": "running", "result": None, "log": [], "started": time.time()}
    threading.Thread(target=_scenario_worker, args=(shell_id,), daemon=True).start()
    return SCENARIOS[shell_id]


@router.get("/api/scenarios/{shell_id}")
def api_scenarios(shell_id: str):
    if shell_id not in shells.all_shells():
        raise HTTPException(404, f"unknown shell {shell_id}")
    state = ensure_scenarios(shell_id)
    out = {"status": state["status"], "log": state["log"][-8:],
           "elapsed_s": round(time.time() - state["started"])}
    if state["status"] == "ready":
        out["result"] = state["result"]
    return out


@router.post("/api/scenarios/{shell_id}/refresh")
def api_scenarios_refresh(shell_id: str):
    if shell_id not in shells.all_shells():
        raise HTTPException(404, f"unknown shell {shell_id}")
    ensure_scenarios(shell_id, refresh=True)
    return {"status": "running"}


# ---------------------------------------------------------------------------
# Optimiser jobs
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}


class OptimiseRequest(BaseModel):
    shell_id: str
    uses: list[str]
    quick: bool = True
    azimuth: float | None = None


def _job(job_id: str, req: OptimiseRequest) -> None:
    from optimise import run

    job = JOBS[job_id]

    def log(*parts):
        line = " ".join(str(p) for p in parts).strip()
        if line:
            job["log"].append(line)

    try:
        results = run.optimise(req.uses, shell_id=req.shell_id, quick=req.quick, azimuth=req.azimuth, log=log)
        out_dir = run.save(results)
        job["result"] = results
        job["report"] = str(out_dir / "report.html")
        job["status"] = "done"
    except Exception as exc:  # report it in the UI rather than losing it
        job["status"] = "failed"
        job["log"].append(f"failed: {exc}")
        job["log"].append(traceback.format_exc()[-1500:])


@router.post("/api/optimise")
def api_optimise(req: OptimiseRequest):
    if req.shell_id not in shells.all_shells():
        raise HTTPException(400, f"unknown shell {req.shell_id}")
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"id": job_id, "status": "running", "log": [], "started": time.time(),
                    "request": req.model_dump()}
    threading.Thread(target=_job, args=(job_id, req), daemon=True).start()
    return {"job": job_id}


@router.get("/api/jobs/{job_id}")
def api_job(job_id: str, since: int = 0):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    out = {"id": job_id, "status": job["status"], "log": job["log"][since:], "log_length": len(job["log"]),
           "elapsed_s": round(time.time() - job["started"])}
    if job["status"] == "done":
        out["result"] = job["result"]
        out["report"] = job.get("report")
    return out
