"""Local server for the apartment model.

    python -m apartment.server            ->  http://127.0.0.1:8000

Binds to localhost only. The browser draws and handles interaction; every
number comes from Python, so there is exactly one implementation of the
costing and nothing to keep in sync.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import loader

from . import evaluate, geometry

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
DATA = HERE / "data"

app = FastAPI(title="Marievik+ Apartment Lab", docs_url="/api/docs")

# Wall types offered in the palette, drawn from the main component catalogue
# so cost and carbon come from one place.
WALL_TYPES = [
    "part.stud.gypsum.95",
    "part.demount.solid.100",
    "part.demount.glass.100",
    "part.movable.acoustic.wall",
    "part.curtain.acoustic",
    "part.cast.concrete.200",
]


class EvaluateRequest(BaseModel):
    plan: dict
    settings: dict = {}


def _json(payload) -> JSONResponse:
    return JSONResponse(content=payload)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/bootstrap")
def bootstrap():
    """Everything the browser needs once: catalogue, groups, demo plans."""
    demos = json.loads((DATA / "demo_plans.json").read_text(encoding="utf-8"))
    furniture = json.loads((DATA / "furniture.json").read_text(encoding="utf-8"))
    catalogue = loader.catalogue()
    groups = loader.user_groups()

    wall_types = []
    for cid in WALL_TYPES:
        component = catalogue.get(cid)
        if not component:
            continue
        cost = component["cost_sek"]
        wall_types.append({
            "id": cid,
            "name": component["name"],
            "short": component["name"].split(",")[0],
            "layer": component["layer"],
            "rw": component.get("performance", {}).get("Rw_dB", 0),
            "fire": component.get("performance", {}).get("fire_class", "none"),
            "reversibility": component["reversibility"],
            "recovery_rate": component["recovery_rate"],
            "service_life": component["service_life_years"],
            "cost_m2": cost["material"] + cost["labour_install"],
            "demount_m2": cost["labour_demount"],
            "carbon_m2": component["carbon_kgco2e"]["A1A3"],
            "notes": component.get("notes", ""),
        })

    return _json({
        "shell": demos["shell"],
        "configurations": demos["configurations"],
        "wall_types": wall_types,
        "furniture": furniture["items"],
        "user_groups": [
            {
                "id": g["id"],
                "label": g["label_en"],
                "turning_circle": g.get("clearances_mm", {}).get("turning_circle", 1200),
                "passage_width": g.get("clearances_mm", {}).get("passage_width_single", 900),
                "door_clear": g.get("clearances_mm", {}).get("door_clear_width", 800),
                "notes": g.get("notes", ""),
            }
            for g in groups.values()
            if g.get("clearances_mm", {}).get("turning_circle")
        ],
        "uses": [
            {"id": "student_housing", "label": "Student housing"},
            {"id": "elderly_care", "label": "Residential care"},
            {"id": "office_flexible", "label": "Flexible workplace"},
            {"id": "community_hybrid", "label": "Community hybrid"},
        ],
        "provenance": loader.provenance_report().caveat(),
    })


@app.post("/api/evaluate")
def api_evaluate(req: EvaluateRequest):
    """Analyse a plan and return every KPI. Called on each edit."""
    settings = req.settings or {}
    groups = loader.user_groups()
    group = groups.get(settings.get("user_group", "adult"), groups["adult"])
    clearances = group.get("clearances_mm", {})

    specs = {item["id"]: item for item in
             json.loads((DATA / "furniture.json").read_text(encoding="utf-8"))["items"]}

    # In assisted care use, staff working space around a bed stops being a
    # comfort preference and becomes an occupational-health requirement
    # (arbetsmiljölagen). Any bed inherits the care bed's clearances.
    if settings.get("user_group") == "care_resident_assisted":
        for key, spec in specs.items():
            if spec["category"] == "bedroom":
                specs[key] = {
                    **spec,
                    "clearance_side_mm": max(spec.get("clearance_side_mm", 0), 900),
                    "clearance_front_mm": max(spec.get("clearance_front_mm", 0), 1200),
                }

    geo = geometry.analyse(
        req.plan, specs,
        turning_circle_mm=clearances.get("turning_circle", 1200),
        passage_width_mm=clearances.get("passage_width_single", 900),
        door_clear_mm=clearances.get("door_clear_width", 800),
    )
    result = evaluate.evaluate(req.plan, geo, settings)

    money, carbon = result.money, result.carbon
    area = max(1.0, result.area_m2)

    return _json({
        "area_m2": round(result.area_m2, 1),
        "free_floor_m2": round(geo.free_floor_m2, 1),
        "furnished_m2": round(geo.furnished_m2, 1),
        "wall_length_m": round(geo.wall_length_m, 1),
        "years": result.years,

        "financial": {
            "capex": round(money.capex),
            "capex_m2": round(money.capex / area),
            "opex_annual": round(money.opex_annual),
            "opex_npv": round(money.opex_npv),
            "replacement_npv": round(money.replacement_npv),
            "residual_npv": round(money.residual_npv),
            "lcc": round(money.lcc),
            "lcc_m2": round(money.lcc / area),
        },
        "environmental": {
            "upfront": round(carbon.upfront),
            "a1a3": round(carbon.a1a3),
            "b4": round(carbon.b4),
            "c1c4": round(carbon.c1c4),
            "embodied": round(carbon.embodied),
            "operational": round(carbon.operational),
            "total": round(carbon.total),
            "total_m2": round(carbon.total / area, 1),
            "embodied_share": round(carbon.embodied / carbon.total, 3) if carbon.total else 0,
            "d_credit": round(carbon.d_credit),
        },
        "social": [
            {"name": m.name, "score": round(m.score), "band": m.band,
             "detail": m.detail, "hard_fail": m.hard_fail}
            for m in result.social
        ],
        "social_mean": round(result.social_mean),
        "rooms": result.rooms,
        "issues": result.issues,
        "blocked": geo.blocked_items,
        "turning": {
            "max_mm": round(geo.max_turn_mm),
            "required_mm": clearances.get("turning_circle", 1200),
            "coverage": round(geo.turn_coverage, 3),
        },
        "clearance_grid": _clearance_grid(geo),
    })


def _clearance_grid(geo: geometry.GeometryResult, step_mm: int = 200) -> dict:
    """Downsampled clearance map, so the plan can show where a circle fits.

    Sent coarse on purpose: the browser draws a wash, not a contour, and a
    full-resolution grid would be 50x the payload for no visible gain.
    """
    if geo.clearance_map is None or geo.raster is None:
        return {"step_mm": step_mm, "cols": 0, "rows": 0, "values": []}

    stride = max(1, step_mm // geometry.RES)
    sub = geo.clearance_map[::stride, ::stride]
    return {
        "step_mm": stride * geometry.RES,
        "cols": int(sub.shape[1]),
        "rows": int(sub.shape[0]),
        "values": [int(v) for v in sub.round().ravel().tolist()],
    }


@app.get("/api/clearance")
def api_clearance():
    return _json({"resolution_mm": geometry.RES})


app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


def main() -> None:
    import uvicorn

    print("\n  Marievik+ Apartment Lab")
    print("  http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
