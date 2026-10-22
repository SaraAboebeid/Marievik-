"""What a change of fit-out costs, and running costs year by year — from data/studio/costs.json (placeholders)."""
from __future__ import annotations

import json
from pathlib import Path

from .engine import build, length, subtract

COSTS_FILE = Path(__file__).resolve().parents[2] / "data" / "studio" / "costs.json"
_costs: dict | None = None


def costs() -> dict:
    global _costs
    if _costs is None:
        _costs = json.loads(COSTS_FILE.read_text(encoding="utf-8"))
    return _costs


def _replacements(use: str) -> list[dict]:
    r = costs()["replacements"]
    return r["office"] if use in ("office", "cowork") else r["ground"] if use == "ground" else r["food"]


def change_cost(base: dict, tgt: dict) -> dict:
    """Cost and carbon of going from one floor fit-out to another: partitions (re-used where possible), doors,
    furniture (moved where the same kind is kept), finishes and services."""
    C = costs()
    P = C["partitions"]
    wall_h = P["wall_height_m"]
    add_solid = add_glass = removed = 0.0
    for k in set(base["walls"]) | set(tgt["walls"]):
        B, T = base["walls"].get(k), tgt["walls"].get(k)
        ball, tall = (B["all"] if B else []), (T["all"] if T else [])
        add_solid += length(subtract(T["solid"] if T else [], ball))
        add_glass += length(subtract(T["glass"] if T else [], ball))
        removed += length(subtract(ball, tall))
    reused = min(removed * P["reuse_share"], add_solid + add_glass)
    new_solid = max(0.0, add_solid - reused)
    new_glass = max(0.0, add_glass - max(0.0, reused - add_solid))
    rows = [
        {"what": f"New partitions ({round(new_solid + new_glass)} m)", "sek": (new_solid * P["new_solid"]["sek_m2"] + new_glass * P["new_glass"]["sek_m2"]) * wall_h,
         "kg": (new_solid * P["new_solid"]["kgco2e_m2"] + new_glass * P["new_glass"]["kgco2e_m2"]) * wall_h},
        {"what": f"Re-used partitions ({round(reused)} m)", "sek": reused * P["reinstall"]["sek_m2"] * wall_h, "kg": reused * P["reinstall"]["kgco2e_m2"] * wall_h},
        {"what": f"Partitions taken down ({round(removed)} m)", "sek": removed * P["take_down"]["sek_m2"] * wall_h, "kg": removed * P["take_down"]["kgco2e_m2"] * wall_h},
    ]
    new_doors = sum(1 for d in tgt["doors"] if not any(b["o"] == d["o"] and abs(b["c"] - d["c"]) < 0.1 and abs(b["pos"] - d["pos"]) < 0.6 for b in base["doors"]))
    rows.append({"what": f"Doors ({new_doors} new)", "sek": new_doors * C["door"]["sek"], "kg": new_doors * C["door"]["kgco2e"]})

    def count(m):
        c: dict[str, int] = {}
        for it in m["items"]:
            c[it["k"]] = c.get(it["k"], 0) + 1
        return c
    cb, ct, F = count(base), count(tgt), C["furniture"]
    f_new = f_new_kg = 0.0
    f_moved = 0
    for k, n in ct.items():
        keep = min(cb.get(k, 0), n)
        f_new += (n - keep) * F[k][0]
        f_new_kg += (n - keep) * F[k][1]
        f_moved += keep
    rows.append({"what": "New furniture and fittings", "sek": f_new, "kg": f_new_kg})
    rows.append({"what": f"Re-used furniture ({f_moved} items moved)", "sek": f_moved * C["moving_an_item"]["sek"], "kg": f_moved * C["moving_an_item"]["kgco2e"]})
    family = base["L"].use != tgt["L"].use
    fin_area = tgt["fig"]["gfa"] * 0.9 if family else min(tgt["fig"]["gfa"], (new_solid + new_glass + reused) * 3.5)
    rows.append({"what": "Floor, ceiling and wall finishes", "sek": fin_area * C["finishes_per_m2"]["sek"], "kg": fin_area * C["finishes_per_m2"]["kgco2e"]})
    S = C["services_per_m2"]
    sv = S[tgt["L"].use] if family else S["same_use"]
    rows.append({"what": S["what"] if family else S["same_use"]["what"], "sek": sv["sek"] * tgt["fig"]["gfa"], "kg": sv["kgco2e"] * tgt["fig"]["gfa"]})
    months = max(1, round((new_solid + new_glass + reused + removed) / 140 + ((4 if tgt["L"].use == "restaurant" else 2) if family else 0.5)))
    return {"rows": rows, "sek": sum(r["sek"] for r in rows), "kg": sum(r["kg"] for r in rows), "months": months}


def series(layouts: list[str], years: list[int], floor: int, params: dict | None = None, overrides: list[dict | None] | None = None) -> list[dict]:
    """Year-by-year KPIs for a floor that holds layouts[i] in years[i]: running costs every year, replacements as
    they fall due, and the works whenever the layout changes. The first layout uses `params` (moved walls).
    overrides[i] stands in for a year whose use has no furnished layout: {opexUse, people, works: {sek, kg, months}}."""
    C = costs()
    E, OPEX = C["energy"], C["opex_per_m2_year"]
    overrides = overrides or []
    models: dict[str, dict] = {}

    def model(lid):
        if lid not in models:
            models[lid] = build(lid, params if lid == layouts[0] else {}, floor)
        return models[lid]
    out, cum_cost, cum_kg, refitted = [], 0.0, 0.0, False
    for i, year in enumerate(years):
        m = model(layouts[i])
        ov = overrides[i] if i < len(overrides) else None
        prev = model(layouts[i - 1]) if i > 0 and layouts[i - 1] != layouts[i] else None
        change = change_cost(prev, m) if prev else None
        if change is None and ov and ov.get("works"):   # a change the furnished layouts cannot show: the timeline's own figures
            w = ov["works"]
            change = {"rows": [], "sek": w["sek"], "kg": w["kg"], "months": w["months"]}
        if change:
            refitted = True
        share = max(0.0, 1 - change["months"] / 12) if change else 1.0   # no running costs while the works are on
        rates = OPEX.get((ov or {}).get("opexUse") or "", OPEX[m["L"].use])
        gfa = m["fig"]["gfa"]
        running = (rates["kwh"] * gfa * E["sek_per_kwh"] + rates["maint"] * gfa + rates["clean"] * gfa) * share
        repl = repl_kg = 0.0
        if not (ov or {}).get("opexUse"):
            chairs = sum(1 for it in m["items"] if it["k"] == "chair")
            for e in _replacements(m["L"].use):
                if e["year"] == year and not (refitted and e["fitout"]):
                    q = gfa if e["per"] == "m2" else chairs
                    repl += e["sek"] * q
                    repl_kg += e["kgco2e"] * q
        works = change["sek"] if change else 0.0
        cost = running + repl + works
        kg = rates["kwh"] * gfa * E["kgco2e_per_kwh"] * share + repl_kg + (change["kg"] if change else 0.0)
        cum_cost += cost
        cum_kg += kg
        out.append({"year": year, "layout": layouts[i], "use": m["L"].use, "running": running, "repl": repl, "works": works, "cost": cost, "kg": kg,
                    "cumCost": cum_cost, "cumKg": cum_kg, "people": (ov or {}).get("people") or m["fig"]["people"], "seats": m["fig"]["seatsAll"],
                    "change": ({"sek": change["sek"], "kg": change["kg"], "months": change["months"]} if change else None)})
    return out
