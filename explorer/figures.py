"""explorer.figures - the key figures of one building scenario, for the Design panel.

Gross and usable area, estimated occupancy, cost and carbon, space distribution of the ground floor
and a typical floor, and two flexibility figures. Each figure carries a status, like the CAVF KPIs:
computed (from this layout), partial (part of the method is a working value) or placeholder
(data/kpi/placeholders.json until a method exists).
"""
from __future__ import annotations

import json

from shapely.geometry import Polygon
from shapely.ops import unary_union

from engine import loader
from . import model as M, timeline as T

DAYLIGHT_DEPTH_M = 6.0      # same working value as the B01 pilot (data/pilots/marievik/b01.json)

# room name -> category, first keyword that matches wins
CATEGORIES = [
    ("Core / services", ("core", "plant", "wc", "bin store", "facilities", "it /", "security", "first aid",
                         "loading", "support", "bathroom", "storage")),
    ("Lobby / reception", ("lobby", "reception", "visitor")),
    ("Café / retail", ("café", "cafe", "retail", "shop", "restaurant")),
    ("Meeting rooms", ("meeting",)),
    ("Workstations", ("open-plan", "open office", "workstation", "office", "admin", "cell")),
    ("Pantry / kitchen", ("pantry", "kitchen")),
    ("Homes", ("apartment", "bedroom", "living")),
    ("Hotel rooms", ("hotel", "guest")),
    ("Classrooms", ("classroom", "school")),
    ("Atrium", ("atrium",)),
    ("Circulation", ("corridor", "circulation")),
]


def category(name: str) -> str:
    n = name.lower()
    for cat, keys in CATEGORIES:
        if any(k in n for k in keys):
            return cat
    return "Other"


def distribution(F) -> list[dict]:
    areas: dict[str, float] = {}
    for r in F.rooms:
        if r["name"] == "Atrium (void)":
            continue
        c = category(r["name"])
        areas[c] = areas.get(c, 0.0) + r["area"]
    total = sum(areas.values()) or 1.0
    return [{"category": c, "m2": round(a), "share": round(a / total, 3)}
            for c, a in sorted(areas.items(), key=lambda kv: -kv[1])]


def building_figures(site: M.Site, bid: str, settings: dict | None) -> dict:
    sc = site.scenario(bid, settings)
    floors, k = sc["res"]["floors"], sc["kpi"]
    usable = daylit = 0.0
    for F in floors:
        # a room keeps only its outline, so an open room around a core still covers it: take cores and atria out
        out_of_use = unary_union([Polygon(r["poly"]) for r in F.rooms if r["name"].startswith(("Core", "Atrium"))])
        area = unary_union([Polygon(r["poly"]) for r in F.rooms if not r["name"].startswith(("Core", "Atrium"))]).difference(out_of_use)
        usable += area.area
        daylit += area.difference(F.footprint.buffer(-DAYLIGHT_DEPTH_M)).area
    persons = sum(T.persons_of(F.use, F.footprint.area)[0] for F in floors if F.use in T.CATALOGUE_USE)
    ph = json.loads((loader.DATA / "kpi" / "placeholders.json").read_text(encoding="utf-8"))
    gfa = k["gfa_m2"]
    return {
        "building": bid, "key": sc["key"],
        "figures": {
            "gfa_m2": {"value": gfa, "label": "Gross area (GFA)", "unit": "m²", "status": "computed"},
            "usable_m2": {"value": round(usable), "label": f"Usable area ({round(100 * usable / gfa) if gfa else 0} %)", "unit": "m²",
                          "status": "computed", "note": "Room area without cores and atrium voids."},
            "occupancy": {"value": round(persons), "label": "Estimated occupancy", "unit": "people", "status": "partial",
                          "note": "Gross area / the use catalogue's m² per person (office 15, school 16, housing 45)."},
            "capex_sek": {"value": k["capex_sek"], "label": "Transformation cost", "unit": "SEK", "status": "partial",
                          "note": "Fit-out at catalogue prices (CAPEX: materials + labour). Many prices are placeholders."},
            "upfront_kgco2e": {"value": k["upfront_kgco2e"], "label": "Upfront embodied carbon", "unit": "kg CO₂e", "status": "partial",
                               "note": "A1–A5 of new elements; the retained shell carries none."},
            "utilization": {"value": ph["utilization"]["value"], "label": "Space utilization", "unit": "share", "status": "placeholder",
                            "note": ph["utilization"]["basis"]},
            "adaptability": {"value": ph["adaptability_grade"]["value"], "label": "Adaptability score", "unit": "grade",
                             "status": "placeholder", "note": ph["adaptability_grade"]["basis"]},
            "daylight_access": {"value": round(daylit / usable, 3) if usable else 0, "label": "Daylight access", "unit": "share",
                                "status": "partial",
                                "note": f"Share of usable area within {DAYLIGHT_DEPTH_M:.0f} m of the facade (a working value, "
                                        "not a daylight simulation; run Analyse → Daylight for that)."},
        },
        "distribution": {
            "ground": {"label": "Ground floor", "use": floors[0].use, "rows": distribution(floors[0])},
            "typical": {"label": "Typical floor", "use": floors[1].use if len(floors) > 1 else floors[0].use,
                        "rows": distribution(floors[1] if len(floors) > 1 else floors[0])},
        },
    }
