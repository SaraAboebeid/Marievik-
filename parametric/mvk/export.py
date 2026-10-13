"""
mvk.export - write Grasshopper results in the format the Marievik+ dashboard reads.

Output: <Marievik+>/runs/grasshopper/<building_id>.json  (schema "mvk.scenarios/1")

  building     id, name, footprint (plan coords), floors, floor heights, mode
  current      the configuration set in Grasshopper when exported (use, ground use, partition system)
  scenarios    one per (use x partition system): KPIs, cost/carbon by category and layer,
               bill of quantities keyed by Marievik+ catalogue ids (re-priced by the dashboard engine),
               unpriced interventions, room schedule
  geometry     per use: ground floor and a typical floor as 2D plan data
               (walls with state, openings, rooms), rotated so the long axis is horizontal

The bill is the contract with Marievik+: engine/grasshopper.py prices it again with
engine.evaluate.evaluate_bill, so the dashboard and Grasshopper use one method and one catalogue.
"""
import json
import math
import os
from datetime import datetime

try:
    from . import layout as L
    from . import pricing
except ImportError:
    import layout as L
    import pricing

SCHEMA = "mvk.scenarios/1"
SYSTEMS = ["conventional", "demountable"]


def _xf(footprint):
    ux, uy = L._main_axis(footprint)
    ang = -math.atan2(uy, ux)
    ca, sa = math.cos(ang), math.sin(ang)
    pts = [(x * ca - y * sa, x * sa + y * ca) for x, y in footprint.exterior.coords]
    mx, my = min(p[0] for p in pts), min(p[1] for p in pts)

    def f(p):
        x, y = p[0] * ca - p[1] * sa - mx, p[0] * sa + p[1] * ca - my
        return [round(x, 2), round(y, 2)]
    return f


def floor_geometry(F, xf):
    walls = [{"id": w["id"], "cat": w["cat"], "type": w["type"], "a": xf(w["a"]), "b": xf(w["b"]),
              "t": round(F.thick(w), 3)} for w in F.walls]
    ops = [{"wall": o["wall"], "kind": o["kind"], "s0": o["s0"], "s1": o["s1"], "new": bool(o.get("new"))}
           for o in F.openings]
    rooms = [{"id": r["id"], "name": r["name"], "area": r["area"], "poly": [xf(p) for p in r["poly"]],
              "label": xf(r["label_pt"])} for r in F.rooms]
    return {"index": F.index, "use": F.use, "walls": walls, "openings": ops, "rooms": rooms,
            "footprint": [xf(p) for p in L._rings(F.footprint)[0]],
            "voids": [[xf(p) for p in L._rings(v)[0]] for v in F.voids]}


def kpis(res, profiles):
    floors = res["floors"]
    s = res["summary"]
    gfa = res["footprint"].area * len(floors)
    rows = res["rows"]
    part = sum(r["qty"] for r in rows if r["category"] in ("wall_partition", "wall_corridor", "wall_interior", "wall_added", "wall_support"))
    run = sum(math.dist(w["a"], w["b"]) for F in floors for w in F.walls if w["cat"] in ("P", "C", "I", "A", "S"))
    upper = [F for F in floors[1:]] or floors
    unit_name = profiles[upper[0].use]["room_name"]
    units = sum(1 for F in upper for r in F.rooms if r["name"].startswith(unit_name.split(" ")[0]))
    nfa = sum(r["area"] for F in floors for r in F.rooms if not r["name"].startswith(("Core", "Atrium", "Corridor")))
    t = s["total"]
    return {"gfa_m2": round(gfa), "nfa_m2": round(nfa), "net_to_gross": round(nfa / gfa, 3) if gfa else 0,
            "units": units, "unit_name": unit_name,
            "partition_area_m2": round(part), "partition_run_m": round(run),
            "partition_density": round(part / gfa, 3) if gfa else 0,
            "doors": int(sum(r["qty"] for r in rows if r["category"] == "door")),
            "new_window_m2": round(sum(r["qty"] for r in rows if r["category"] == "window" and r["state"] == "new"), 1),
            "capex_sek": round(t["cost_sek"]), "upfront_kgco2e": round(t["gwp_kgco2e"]),
            "upfront_kgco2e_per_m2": round(t["gwp_kgco2e"] / gfa, 1) if gfa else 0,
            "capex_sek_per_m2": round(t["cost_sek"] / gfa) if gfa else 0,
            "c1c4_kgco2e": round(t["c1c4"]), "d_credit_kgco2e": round(t["d_credit"]),
            "placeholder_share": round(t["placeholder_share"], 3), "mock_priced_rows": t["mock_priced_rows"]}


def scenario(res, profiles, use, ground_use, system):
    s = res["summary"]
    rooms = {}
    for F in res["floors"]:
        for r in F.rooms:
            d = rooms.setdefault(r["name"], {"count": 0, "area": 0.0})
            d["count"] += 1
            d["area"] = round(d["area"] + r["area"], 1)
    return {"id": "%s__%s" % (use, system), "use": use, "use_label": profiles[use]["label"],
            "ground_use": ground_use, "partition_system": system, "kpi": kpis(res, profiles),
            "by_category": {k: {kk: round(vv, 1) if isinstance(vv, float) else vv for kk, vv in v.items()}
                            for k, v in s["by_category"].items()},
            "by_layer": {k: {kk: round(vv) for kk, vv in v.items()} for k, v in s["by_layer"].items()},
            "bill": s["bill"], "unpriced": {k: round(v, 1) for k, v in s["unpriced"].items()},
            "rooms": rooms}


def export(footprint, building_id="B01", name="", n_floors=8, ground_use="retail", floor_heights=(4.5, 3.5),
           uses=None, systems=SYSTEMS, overrides=None, mvplus=None, out_path=None, current=None, mode="conversion",
           site_building=None):
    """Run every use x partition system on the footprint and write the dashboard file. Returns the path."""
    profiles = L.load_profiles()
    db = L.load_db()
    catalogue = pricing.load_catalogue(mvplus)
    fp = footprint if isinstance(footprint, L.Polygon) else L.Polygon(footprint)
    uses = uses or [u for u in profiles if u != "retail"]
    hs = [floor_heights[0]] + [floor_heights[-1]] * (n_floors - 1) if isinstance(floor_heights, (list, tuple)) \
        else [floor_heights] * n_floors
    xf = _xf(fp)
    out = {"schema": SCHEMA, "generated": datetime.now().isoformat(timespec="seconds"),
           "source": "Grasshopper - MVK Building (Marievik+/parametric/mvk)",
           "catalogue": catalogue.get("__path__"),
           "building": {"id": building_id, "name": name or building_id, "floors": n_floors,
                        "floor_heights": hs, "mode": mode, "footprint_m2": round(fp.area, 1),
                        "footprint": [xf(p) for p in L._rings(fp)[0]]},
           "current": current or {}, "scenarios": [], "geometry": {}}
    if site_building:
        sb = site_building
        out["building"]["site"] = {"osm_id": sb.get("osm_id"), "current_use": sb.get("current_use"),
                                   "role": sb.get("role"), "levels": sb.get("levels"),
                                   "plan_footprint": [[round(x, 2), round(y, 2)] for x, y in L._rings(fp)[0]],
                                   "facade": sb.get("facade")}
    for use in uses:
        for system in systems:
            res = L.build(fp, [ground_use] + [use] * (n_floors - 1), floor_heights=hs, overrides=overrides,
                          profiles=profiles, db=db, n_floors=n_floors, mode=mode, partition_system=system,
                          catalogue=catalogue, facade=(site_building or {}).get("facade"))
            out["scenarios"].append(scenario(res, profiles, use, ground_use, system))
            if use not in out["geometry"]:
                fl = res["floors"]
                out["geometry"][use] = {"ground": floor_geometry(fl[0], xf),
                                        "typical": floor_geometry(fl[min(2, len(fl) - 1)], xf)}
    root = mvplus or pricing.MARIEVIK_DEFAULT
    out_path = out_path or os.path.join(root, "runs", "grasshopper", "%s.json" % building_id)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return out_path
