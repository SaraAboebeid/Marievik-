"""Engine-side driver for the EnergyPlus runs in thermal_sim.py.

Writes cases, runs them in the simulation venv, and caches every answer by
a hash of its inputs. Re-running the optimiser after changing a cost or a
weighting therefore costs nothing thermally; only a change of geometry,
glazing, use or orientation triggers a new simulation.

Zones come from the plan itself (optimise/zones.py), so the same code
serves the generator's layouts and whatever is drawn in the editor.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from . import programs, schemes, zones

ROOT = Path(__file__).resolve().parents[1]
SIM_PYTHON = ROOT / ".venv-sim" / "Scripts" / "python.exe"
SIM_SCRIPT = Path(__file__).resolve().parent / "thermal_sim.py"
CACHE = ROOT / "runs" / "optimise" / "thermal_cache.json"
# Bump when thermal_sim.py or zoning changes in a way that alters results.
MODEL_VERSION = "2"

HABITABLE = {"habitable", "bedroom", "care_room", "meeting", "focus", "open"}
PROFILE_FOR_USE = {b.id: b.thermal_profile for b in programs.BRIEFS.values()}


def case(plan: dict, profile: str, glazing: str, azimuth: float, zone_list: list[dict]) -> dict:
    """A simulation case for any plan."""
    shell = plan["shell"]
    body = {
        "profile": profile,
        "envelope": glazing,
        "facade_azimuth_deg": azimuth,
        "shell": {k: shell[k] for k in ("width_mm", "depth_mm", "ceiling_mm", "external_wall_thickness_mm",
                                        "facade_y_mm") if k in shell},
        "windows": [{"x1": w["x1"], "x2": w["x2"], "sill_mm": w["sill_mm"], "head_mm": w["head_mm"],
                     "glazing": w.get("glazing", glazing)} for w in shell["windows"]],
        "rooms": [{k: z[k] for k in ("id", "space", "label", "x0", "y0", "x1", "y1", "people")}
                  for z in zone_list],
        "version": MODEL_VERSION,
    }
    # Traced shells carry their own climate and their own existing glazing.
    if shell.get("climate_epw"):
        body["epw"] = shell["climate_epw"]
    if shell.get("existing_glazing"):
        body["existing_glazing"] = shell["existing_glazing"]
    digest = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
    return {"id": digest, **body}


def case_for(brief: programs.Brief, scheme: schemes.Scheme, azimuth: float) -> tuple[dict, list[dict]]:
    from apartment.server import specs_for

    specs = specs_for(scheme.density.user_group)
    zone_list = zones.from_plan(scheme.plan, specs, scheme.density.occupants)
    glazing = schemes.WINDOWS[scheme.window]["envelope"]
    return case(scheme.plan, brief.thermal_profile, glazing, azimuth, zone_list), zone_list


def _load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def run(cases: list[dict], log=print) -> dict[str, dict]:
    cache = _load_cache()
    todo = list({c["id"]: c for c in cases if c["id"] not in cache}.values())
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
        # Re-read before writing: the editor and the optimiser share this file.
        merged = _load_cache()
        merged.update(cache)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(merged), encoding="utf-8")
        cache = merged
    return {c["id"]: cache.get(c["id"]) for c in cases}


def summarise(sim: dict, zone_list: list[dict]) -> tuple[float, dict]:
    """Area-weighted comfort over the rooms people actually use, and per room."""
    by_id = {z["id"]: z for z in zone_list}
    rooms: dict[str, dict] = {}
    for r in sim["rooms"]:
        z = by_id.get(r["id"]) or by_id.get(r["id"].lower())
        if not z:
            continue
        agg = rooms.setdefault(z["space"], {"label": z["label"], "kind": z["kind"], "area": 0.0,
                                            "comfort": 0.0, "hot": 0.0, "cold": 0.0,
                                            "hours_over_26": 0, "max_c": -99.0, "zones": []})
        a = r["area_m2"]
        agg["area"] += a
        agg["comfort"] += r["comfort_pct"] * a
        agg["hot"] += r["hot_pct"] * a
        agg["cold"] += r["cold_pct"] * a
        agg["hours_over_26"] = max(agg["hours_over_26"], r["hours_over_26"])
        agg["max_c"] = max(agg["max_c"], r["max_op_c"])
        agg["zones"].append([z["x0"], z["y0"], z["x1"], z["y1"]])
    per_room = []
    for space, agg in rooms.items():
        area = agg["area"] or 1.0
        per_room.append({"space": space, "label": agg["label"], "kind": agg["kind"],
                         "area_m2": round(agg["area"], 1),
                         "comfort_pct": round(agg["comfort"] / area, 1),
                         "hot_pct": round(agg["hot"] / area, 1), "cold_pct": round(agg["cold"] / area, 1),
                         "hours_over_26": agg["hours_over_26"], "max_c": agg["max_c"], "zones": agg["zones"]})
    used = [r for r in per_room if r["kind"] in HABITABLE] or per_room
    area = sum(r["area_m2"] for r in used) or 1.0
    comfort = sum(r["comfort_pct"] * r["area_m2"] for r in used) / area
    worst = max(used, key=lambda r: r["hours_over_26"]) if used else {"label": "-", "hours_over_26": 0, "max_c": 0}
    detail = {
        "comfort_pct": round(comfort, 1),
        "hot_pct": round(sum(r["hot_pct"] * r["area_m2"] for r in used) / area, 1),
        "cold_pct": round(sum(r["cold_pct"] * r["area_m2"] for r in used) / area, 1),
        "worst_room": worst["label"],
        "worst_hours_over_26": worst["hours_over_26"],
        "worst_max_c": worst["max_c"],
        "heating_kwh_m2": sim["heating_kwh_m2"],
        "cooling_kwh_m2": sim["cooling_kwh_m2"],
        "rooms": per_room,
    }
    return round(comfort, 1), detail
