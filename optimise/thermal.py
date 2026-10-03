"""Engine-side driver for the EnergyPlus runs in thermal_sim.py.

Writes cases, runs them in the simulation venv, and caches every answer by
a hash of its inputs. Re-running the optimiser after changing a cost or a
weighting therefore costs nothing thermally; only a change of geometry,
glazing, use or orientation triggers a new simulation.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from . import programs, schemes

ROOT = Path(__file__).resolve().parents[1]
SIM_PYTHON = ROOT / ".venv-sim" / "Scripts" / "python.exe"
SIM_SCRIPT = Path(__file__).resolve().parent / "thermal_sim.py"
CACHE = ROOT / "runs" / "optimise" / "thermal_cache.json"
# Bump when thermal_sim.py changes in a way that alters results.
MODEL_VERSION = "1"

HABITABLE = {"bedroom", "care_room", "meeting", "focus", "open"}


def case_for(brief: programs.Brief, scheme: schemes.Scheme, azimuth: float) -> dict:
    shell = scheme.plan["shell"]
    window = schemes.WINDOWS[scheme.window]
    body = {
        "profile": brief.thermal_profile,
        "envelope": window["envelope"],
        "facade_azimuth_deg": azimuth,
        "shell": {k: shell[k] for k in ("width_mm", "depth_mm", "ceiling_mm", "external_wall_thickness_mm")},
        "windows": [{"x1": w["x1"], "x2": w["x2"], "sill_mm": w["sill_mm"], "head_mm": w["head_mm"]}
                    for w in shell["windows"]],
        "rooms": [{k: r[k] for k in ("id", "label", "x0", "y0", "x1", "y1", "people") if k in r}
                  | ({"space": r["space"]} if "space" in r else {})
                  for r in scheme.rooms],
        "version": MODEL_VERSION,
    }
    digest = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
    return {"id": digest, **body}


def _load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def run(cases: list[dict], log=print) -> dict[str, dict]:
    cache = _load_cache()
    todo = [c for c in cases if c["id"] not in cache]
    if todo:
        if not SIM_PYTHON.exists():
            raise RuntimeError(f"Simulation venv not found at {SIM_PYTHON}")
        log(f"  simulating {len(todo)} new case(s) in EnergyPlus ({len(cases) - len(todo)} cached)")
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "cases.json"
            dst = Path(tmp) / "results.json"
            src.write_text(json.dumps(todo), encoding="utf-8")
            # Console to a file, never a pipe: EnergyPlus children inherit it.
            log_path = Path(tmp) / "sim.log"
            with open(log_path, "w") as sim_log:
                proc = subprocess.run(
                    [str(SIM_PYTHON), str(SIM_SCRIPT), str(src), str(dst)],
                    stdout=sim_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                    timeout=600 + 60 * len(todo),
                )
            if proc.returncode != 0 or not dst.exists():
                tail = log_path.read_text(errors="replace")[-3000:]
                raise RuntimeError(f"thermal simulation failed:\n{tail}")
            for result in json.loads(dst.read_text(encoding="utf-8")):
                if not result.get("ok"):
                    log(f"  thermal case {result['id']} failed: {result.get('error', '')[:300]}")
                cache[result["id"]] = result
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache), encoding="utf-8")
    return {c["id"]: cache.get(c["id"]) for c in cases}


def summarise(sim: dict, rooms: list[dict]) -> tuple[float, dict]:
    """Area-weighted comfort over the rooms people actually use."""
    kinds = {r["id"]: r["kind"] for r in rooms}
    labels = {r["id"]: r.get("label", r["id"]) for r in rooms}
    used = [r for r in sim["rooms"] if kinds.get(r["id"].lower(), kinds.get(r["id"])) in HABITABLE]
    if not used:
        used = sim["rooms"]
    area = sum(r["area_m2"] for r in used) or 1.0
    comfort = sum(r["comfort_pct"] * r["area_m2"] for r in used) / area
    hot = sum(r["hot_pct"] * r["area_m2"] for r in used) / area
    cold = sum(r["cold_pct"] * r["area_m2"] for r in used) / area
    worst = max(used, key=lambda r: r["hours_over_26"])
    detail = {
        "comfort_pct": round(comfort, 1),
        "hot_pct": round(hot, 1),
        "cold_pct": round(cold, 1),
        "worst_room": labels.get(worst["id"].lower(), worst["label"]),
        "worst_hours_over_26": worst["hours_over_26"],
        "worst_max_c": worst["max_op_c"],
        "heating_kwh_m2": sim["heating_kwh_m2"],
        "cooling_kwh_m2": sim["cooling_kwh_m2"],
        "rooms": [
            {"label": labels.get(r["id"].lower(), r["label"]), "comfort_pct": r["comfort_pct"],
             "hours_over_26": r["hours_over_26"], "max_c": r["max_op_c"]}
            for r in sim["rooms"]
        ],
    }
    return round(comfort, 1), detail
