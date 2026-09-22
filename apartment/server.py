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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import loader
from standards import rules

from . import evaluate, geometry


def specs_for(user_group: str) -> dict[str, dict]:
    """Furniture specs with clearances resolved by the standards engine.

    The flat numbers in furniture.json are a fallback. Where the standards
    layer has an activity mapping for an item, it wins — that is what makes
    a wardrobe need 750 mm for an ambulant adult and 1200 mm for a wheelchair
    user without anyone editing the furniture record.
    """
    raw = json.loads((DATA / "furniture.json").read_text(encoding="utf-8"))["items"]
    out: dict[str, dict] = {}
    for item in raw:
        spec = dict(item)
        derived = rules.item_clearances(item["id"], user_group)
        if "front" in derived and derived["front"].value_mm:
            spec["clearance_front_mm"] = derived["front"].value_mm
            spec["clearance_front_basis"] = derived["front"].basis
        if "side" in derived and derived["side"].value_mm:
            spec["clearance_side_mm"] = derived["side"].value_mm
            spec["clearance_side_basis"] = derived["side"].basis
        out[item["id"]] = spec
    return out

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


DIST = STATIC / "dist"


@app.get("/", response_class=HTMLResponse)
def index():
    """Serve the built Vite bundle, or say how to get one."""
    built = DIST / "index.html"
    if built.exists():
        return FileResponse(built)
    return HTMLResponse(
        "<pre style='font:14px ui-monospace;padding:40px;line-height:1.6'>"
        "No frontend build found.\n\n"
        "  cd frontend\n"
        "  npm install      (once)\n"
        "  npm run build    then reload this page\n\n"
        "Or, for development with hot reload, leave this server running and:\n\n"
        "  cd frontend\n"
        "  npm run dev      then open http://localhost:5173\n\n"
        "The API is up either way - see /api/docs.</pre>",
        status_code=503,
    )


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

    specs = specs_for(settings.get("user_group", "adult"))

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


class PlaceRequest(BaseModel):
    plan: dict
    type: str
    settings: dict = {}
    anchor: list[float] | None = None


@app.post("/api/place")
def api_place(req: PlaceRequest):
    """Where should a new item go? Answered by the engine, not the UI."""
    specs = specs_for(req.settings.get("user_group", "adult"))
    anchor = tuple(req.anchor) if req.anchor else None
    spot = geometry.find_placement(req.plan, specs, req.type, anchor)
    if spot is None:
        return _json({
            "ok": False,
            "reason": "Nothing fits. Every position that would hold this item and "
                      "its clearance is already taken by a wall, another item, or "
                      "the space another item needs to be usable.",
        })
    return _json({"ok": True, **spot})


@app.get("/api/standards/{user_group}")
def api_standards(user_group: str):
    """What the standards engine says about designing for this person."""
    return _json({**rules.summary(user_group), "coverage": rules.coverage()})


@app.get("/api/standards")
def api_standards_index():
    return _json({
        "user_groups": list(rules.envelopes().keys()),
        "space_types": [
            {"id": s["id"], "label": s["label"], "category": s["category"]}
            for s in rules.space_types().values()
        ],
        "coverage": rules.coverage(),
    })


@app.get("/api/clearance")
def api_clearance():
    return _json({"resolution_mm": geometry.RES})


if (STATIC / "dist" / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC / "dist" / "assets")), name="assets")
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


def main() -> None:
    import uvicorn

    built = (STATIC / "dist" / "index.html").exists()
    print("\n  Marievik+ Apartment Lab")
    print("  http://127.0.0.1:8000")
    if built:
        print("  serving the built frontend from apartment/static/dist")
    else:
        print("  NO BUILD FOUND — run `npm run build` in frontend/")
    print("\n  For frontend development, leave this running and start Vite:")
    print("      cd frontend && npm run dev     ->  http://localhost:5173")
    print("  Vite proxies /api here, so both halves hot-reload independently.\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
