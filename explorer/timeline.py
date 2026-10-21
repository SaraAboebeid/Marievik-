"""explorer.timeline - ten years of one building: unchanged use, and pathways of change.

Two segments on one time axis:

  1. Unchanged  the building keeps today's uses for the whole period.
  2. Pathways   at a few decision years (when a lease could end) a floor group changes use.
                Every pathway is generated from the uses the layout engine can draw, checked
                against the use catalogue (data/catalogue), and priced by what actually changes
                between two layouts: the walls that are kept, built and removed, the finishes
                and any new opening in a slab.

Every tested pathway is returned. The highlighted ones are the best by four different measures
(least layout change, lowest investment, most people-hours, most evening life), once with a single
change and once stepwise with two, so the profiles have something to disagree about. Each comes
with its events, a state per year and the KPIs per year.

Every state is checked against the catalogue: the fire class sets the longest allowed walk to an
exit, units that need daylight must have a window, and a use with a higher imposed load than an
office floor is flagged on upper floors. Anything resting on a placeholder says so in its KPI's
status, the same way the CAVF KPIs do.
"""
from __future__ import annotations

import json
import threading
from itertools import combinations

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union

from engine import loader
from . import model as M

PLACEHOLDERS = json.loads((loader.DATA / "kpi" / "placeholders.json").read_text(encoding="utf-8"))

# layout-engine use -> catalogue use (data/catalogue/uses)
CATALOGUE_USE = {"office_ground": "office", "office_cellular": "office", "office_open": "office", "residential": "housing_apartment",
                 "hotel": "hotel", "school": "school_compulsory", "retail": "retail_shop", "restaurant_cafe": "restaurant_cafe"}
GROUND_USES = ["retail", "office_open", "office_cellular", "school", "hotel"]
UPPER_USES = ["office_cellular", "office_open", "residential", "hotel", "school"]
# every use a single floor can take in the floor-scoped timeline (build_floor_timeline); restaurant_cafe
# reuses the retail layout profile (parametric/mvk/use_profiles.json) — no dedicated zoning for it yet
SINGLE_FLOOR_USES = ["office_cellular", "office_open", "residential", "hotel", "school", "retail", "restaurant_cafe"]

# Composite ground-floor states: several AMF-interview uses sharing one floor at once, by area share — the
# same shares as the AMF pilot scenarios (engine/pilot.py, data/pilots/marievik/b01.json scenarios B and D).
# "represent" is which of SINGLE_FLOOR_USES stands in for the mix's own geometry, transformation cost and
# carbon (the layout engine has no way to draw several uses zoned on one floor yet — see the Urban/District/
# Building scope discussion); the catalogue uses in "components" drive people-hours and evening life only,
# blended by their area share (see _mix_density()). Ground floor only: offered by build_floor_timeline()
# when floor_index == 0, not for upper floors.
MIX_STATES = {
    "mix_cafe_amenities": {
        "label": "Café + shared amenities", "represent": "restaurant_cafe",
        "components": [("restaurant_cafe", 0.40), ("shared_amenities", 0.60)],
    },
    "mix_cafe_event_amenities": {
        "label": "Café + event/foyer + shared amenities", "represent": "restaurant_cafe",
        "components": [("restaurant_cafe", 0.45), ("assembly_event", 0.35), ("shared_amenities", 0.20)],
    },
}
# imposed load category per use (BFS 2024:6 table 4:1, via cross_cutting.json); the school, hotel and
# restaurant categories are the Eurocode convention, not stated in BFS 2024:6
LOAD_CATEGORY = {"office_ground": "B_office", "office_cellular": "B_office", "office_open": "B_office", "residential": "A_dwelling",
                 "hotel": "A_dwelling", "school": "C1_assembly_movable_seats", "retail": "D1_retail",
                 "restaurant_cafe": "C3_assembly_free_movement"}
# ASSUMPTION: the upper floors were designed as office floors, so a use above the office load is flagged
EVENING = range(17, 24)
GRID_M = 2.0                        # sample spacing for the walk-to-exit check

# Working values where the catalogue gives no number. Each one marks the KPI it feeds as placeholder.
ASSUME = {
    "retail_m2_per_visitor": (10.0, "PLACEHOLDER: shoppers present at peak; the fire-design density is 2 m²/person"),
    "hotel_guests_per_room": (1.4, "PLACEHOLDER: average guests per occupied room"),
    "restaurant_m2_per_seat": (1.5, "PLACEHOLDER: no Swedish source; dining area ≈ 60 % of gross area (restaurant_cafe.json rest_dining)"),
    "event_m2_per_visitor": (4.0, "PLACEHOLDER: no Swedish source gives a typical day-to-day visitor density for an "
                                   "event/assembly space outside peak events — BFS 2024:7's 2.5 persons/m² (assembly_event.json "
                                   "egress_design_density) is the fire egress design maximum, used here for fire class only, not "
                                   "for the everyday people-hours and evening-life KPIs."),
}

# The project handbook's own 29 KPIs (CAVF KPI cheat sheet; see explorer/kpis.py KPIS for the full set with
# formulas — that panel is the authority). These 7 are the ones this pathway engine can genuinely compute
# per year, from what a layout actually contains; the rest of the handbook (Delivered service, Disruption,
# Adaptability profile, Energy use intensity, Access and affordability, POE performance, Decision influence,
# Institutionalization, CRREM misalignment year, …) needs data this engine does not model (metering, surveys,
# governance records) and is not offered here rather than invented.
KPI_META = {
    "transformation_cost": {"label": "Transformation cost", "group": "Change", "unit": "SEK", "better": "lower", "status": "partial",
                            "note": "CAVF cheat sheet, Change group. New walls and finishes at catalogue prices, cumulative "
                                    "over the pathway — adapted to price only the area that changes at each step, not the "
                                    "whole building. Doors, services and slab openings are not priced yet."},
    "transformation_time": {"label": "Transformation time", "group": "Change", "unit": "months", "better": "lower", "status": "placeholder",
                            "note": "CAVF cheat sheet, Change group. data/kpi/placeholders.json formula (fixed months + "
                                    "months per 1000 m² changed), cumulative over the pathway."},
    "upfront_gwp":          {"label": "Upfront GWP", "group": "Carbon", "unit": "kg CO₂e", "better": "lower", "status": "partial",
                            "note": "CAVF cheat sheet, Carbon group (A1–A5). Adapted here to the changes made (plus C1–C4 "
                                    "of removed walls), cumulative over the pathway, rather than a single design snapshot."},
    "use_diversity":        {"label": "Use diversity", "group": "Use", "unit": "uses", "better": "higher", "status": "computed",
                            "note": "CAVF cheat sheet, Use group. Distinct uses across the floor groups — not inherently "
                                    "good or bad, context-dependent."},
    "data_quality":         {"label": "Decision-critical data quality", "group": "Data", "unit": "%", "better": "higher", "status": "computed",
                            "note": "CAVF cheat sheet, Data group. Share of priced elements resting on verified (not "
                                    "placeholder or estimated) catalogue data, at this year's state. The same measure the "
                                    "Methods & data panel reports as a letter grade."},
    "feasible_uses":        {"label": "Feasible alternative uses", "group": "Feasibility", "unit": "uses", "better": "higher", "status": "placeholder",
                            "note": "CAVF cheat sheet, Feasibility group. data/kpi/placeholders.json; a whole-building "
                                    "figure, not yet computed per state of this pathway."},
    "utilization":          {"label": "Utilization", "group": "Use", "unit": "%", "better": "higher", "status": "placeholder",
                            "note": "CAVF cheat sheet, Use group. data/kpi/placeholders.json; a whole-building figure, not "
                                    "yet computed per state of this pathway."},
    "incremental_npv":      {"label": "Incremental NPV", "group": "Finance", "unit": "SEK", "better": "higher", "status": "placeholder",
                            "note": "CAVF cheat sheet, Finance group. data/kpi/placeholders.json (npv_uplift_share × asset "
                                    "value); a whole-building figure, not yet computed per state of this pathway."},
    "recoverable_mass":     {"label": "Recoverable component mass", "group": "Circularity", "unit": "kg", "better": "higher", "status": "placeholder",
                            "note": "CAVF cheat sheet, Circularity group. data/kpi/placeholders.json (component mass per "
                                    "m² × GFA × recoverable fraction); a whole-building figure, not yet computed per state."},
}


# ---------------------------------------------------------------------------- catalogue helpers
def _cat(use: str) -> dict:
    return loader.catalogue_uses()[CATALOGUE_USE[use]]


def _cat_label(cat_use: str) -> str:
    return loader.catalogue_uses()[cat_use]["label_en"]


def _rules() -> dict:
    return loader.cross_cutting_rules()


def _geom_use(use: str) -> str:
    """The buildable layout-engine use that stands in for a state's own geometry, transformation cost and
    carbon — itself for a real use, or MIX_STATES[...]['represent'] for a mixed ground-floor state."""
    return MIX_STATES[use]["represent"] if use in MIX_STATES else use


def _mix_density(cat_use: str, gfa_share: float) -> tuple[float, list[float], list[str]]:
    """Persons and hourly presence shape for gfa_share m² of one catalogue use inside a mixed floor
    (MIX_STATES) — the same ASSUME placeholders persons_of() uses where the catalogue itself gives no
    m²-per-person figure (data/catalogue/uses/*.json occupancy.gross_m2_per_unit)."""
    cat = loader.catalogue_uses()[cat_use]
    profile = cat["occupancy"].get("hourly_presence") or [0] * 24
    if cat_use == "restaurant_cafe":
        return gfa_share * 0.6 / ASSUME["restaurant_m2_per_seat"][0], profile, ["restaurant_m2_per_seat"]
    if cat_use == "assembly_event":
        return gfa_share / ASSUME["event_m2_per_visitor"][0], profile, ["event_m2_per_visitor"]
    if cat_use == "shared_amenities":
        return 0.0, profile, []          # serves the other uses; no footfall of its own in this model
    per = cat["occupancy"]["gross_m2_per_unit"]["value"]
    return (gfa_share / per, profile, []) if per else (0.0, profile, [])


def persons_of(use: str, gfa: float) -> tuple[float, list[str]]:
    """Persons a floor group holds, and the assumptions that rest on."""
    occ = _cat(use)["occupancy"]
    if use == "retail":
        return gfa / ASSUME["retail_m2_per_visitor"][0], ["retail_m2_per_visitor"]
    if use == "restaurant_cafe":
        return gfa * 0.6 / ASSUME["restaurant_m2_per_seat"][0], ["restaurant_m2_per_seat"]
    per = occ["gross_m2_per_unit"]["value"]
    if use == "hotel":
        return gfa / per * ASSUME["hotel_guests_per_room"][0], ["hotel_guests_per_room"]
    return gfa / per, []


def fire_class(use: str, gfa: float) -> str:
    if use in ("office_cellular", "office_open"):
        return "1"
    if use == "residential":
        return "3A"
    if use == "hotel":
        return "4"
    threshold = _rules()["fire_vk_2abc"]["values"]["threshold_persons"]
    if use == "retail":   # fire design uses the legal density, not the typical crowd
        design = gfa * 0.82 * _rules()["occ_density_law_2024"]["values"]["persons_per_m2"]["affarslokal_retail"]
    else:
        design = persons_of(use, gfa)[0]
    return "2B" if design > threshold else "2A"


def max_walk(vk: str) -> float:
    r = _rules()
    if vk == "1":
        return r["fire_vk_1"]["values"]["max_travel_to_exit_m"]
    if vk.startswith("3"):
        return r["fire_vk_3abc"]["values"]["max_travel_to_exit_m"]
    if vk == "4":
        return r["fire_vk_4"]["values"]["max_travel_to_exit_m"]
    return r["fire_vk_2abc"]["values"]["max_travel_to_exit_m"][vk]


def load_kn(use: str) -> float:
    return _rules()["loads_imposed_table_4_1"]["values"]["kN_per_m2_floor"][LOAD_CATEGORY[use]]


# ---------------------------------------------------------------------------- one state
def longest_walk(F, ground: bool) -> float:
    """Longest straight-line distance from any point on the floor to a core (the stairs), or on the
    ground floor to the facade if that is nearer. Straight line: the real walking route is longer."""
    cores = [z for n, z in F.zones if n == "Core"]
    if not cores:
        return 0.0
    targets = unary_union([c.boundary for c in cores])
    if ground:
        targets = unary_union([targets, F.footprint.exterior])
    usable = F.footprint.difference(unary_union(cores + list(F.voids)))
    minx, miny, maxx, maxy = F.footprint.bounds
    xs, ys = np.meshgrid(np.arange(minx + GRID_M / 2, maxx, GRID_M), np.arange(miny + GRID_M / 2, maxy, GRID_M))
    xs, ys = xs.ravel(), ys.ravel()
    inside = shapely.contains_xy(usable, xs, ys)
    if not inside.any():
        return 0.0
    return float(shapely.distance(targets, shapely.points(xs[inside], ys[inside])).max())


def evaluate_state(site: M.Site, bid: str, ground: str, upper: str) -> dict:
    sc = site.scenario(bid, {"ground_use": ground, "use": upper})
    floors = sc["res"]["floors"]
    groups = {"ground": (ground, [floors[0]]), "upper": (upper, floors[1:])}
    hourly, issues, used = [0.0] * 24, [], set()
    out_groups = {}
    for gid, (use, fs) in groups.items():
        if not fs:
            continue
        gfa = sum(F.footprint.area for F in fs)
        persons, a = persons_of(use, gfa)
        used.update(a)
        profile = _cat(use)["occupancy"].get("hourly_presence") or [0] * 24
        for h in range(24):
            hourly[h] += persons * profile[h]
        vk = fire_class(use, gfa)
        limit = max_walk(vk)
        # upper floors share one layout except a set-back top floor: check the first and the last
        walk = max(longest_walk(F, F.index == 0) for F in {fs[0].index: fs[0], fs[-1].index: fs[-1]}.values())
        if walk > limit:
            issues.append({"severity": "blocker", "group": gid, "kind": "fire",
                           "text": f"{_label(use)}: longest walk to a stair {walk:.0f} m (straight line) exceeds "
                                   f"{limit} m for fire class {vk} (BFS 2024:7). Needs another stair or exits."})
        dark = sum(1 for F in fs for u in sc["units"][F.index] if u["kind"] == "unit" and not u["windows"])
        if dark and use != "retail":
            issues.append({"severity": "major", "group": gid, "kind": "daylight",
                           "text": f"{_label(use)}: {dark} units without a window; dwellings and permanent workplaces "
                                   "need daylight and a view (BFS 2024:8, AFS 2023:12)."})
        if gid == "upper" and load_kn(use) > load_kn("office_open"):
            issues.append({"severity": "blocker", "group": gid, "kind": "structure",
                           "text": f"{_label(use)}: imposed load {load_kn(use)} kN/m² against "
                                   f"{load_kn('office_open')} kN/m² for an office floor (BFS 2024:6). Structural check needed."})
        voids = sum(v.area for F in fs for v in F.voids)
        if voids:
            issues.append({"severity": "major", "group": gid, "kind": "structure",
                           "text": f"{_label(use)}: the layout cuts {voids:.0f} m² of atrium through the slabs to bring in "
                                   "daylight. A structure move: not priced yet."})
        out_groups[gid] = {"use": use, "label": _label(use), "catalogue_use": CATALOGUE_USE[use], "gfa_m2": round(gfa),
                           "persons": round(persons), "fire_class": vk, "walk_m": round(walk, 1), "walk_limit_m": limit,
                           "units_without_window": dark}
    total = sum(hourly)
    return {
        "key": f"{ground}|{upper}", "settings": {"ground_use": ground, "use": upper},
        "groups": out_groups, "issues": issues, "assumptions": sorted(used),
        "gfa_m2": sc["kpi"]["gfa_m2"],
        "people": round(max(hourly)), "people_hours": round(total),
        "evening_share": round(sum(hourly[h] for h in EVENING) / total, 3) if total else 0.0,
        "uses_count": len({g["catalogue_use"] for g in out_groups.values()}),
        # CAVF "Decision-critical data quality": share of this state's priced elements that rest on verified
        # (not placeholder/estimated) catalogue data — the same figure explorer/kpis.py reports as a grade.
        "data_quality": round(1 - sc["kpi"].get("placeholder_share", 1.0), 3),
        "blocked": any(i["severity"] == "blocker" for i in issues),
    }


def _label(use: str) -> str:
    return M.L.load_profiles()[use]["label"]


# ---------------------------------------------------------------------------- what changes between two states
def _diff_floor_pair(A, B, db: dict, cat: dict) -> dict:
    """Walls kept, built and removed between one floor's two layouts (same geometry and wall type
    counts as kept), plus finishes replaced where the use's finish changes and any new slab opening.
    Shared by transition() (every floor of a ground/upper pathway) and floor_transition() (one floor)."""
    h = B.wall_h

    def by_type(F):
        out = {}
        for w in F.walls:
            if w["cat"] not in M.L.RETAINED_CATS:
                out.setdefault(w["type"], []).append(LineString([w["a"], w["b"]]))
        return out

    new_m2 = removed_m2 = capex = co2 = finish_m2 = 0.0
    wa, wb = by_type(A), by_type(B)
    for t, lines in wb.items():
        keep = unary_union(wa[t]).buffer(0.15) if t in wa else None
        length = sum(l.length - (l.intersection(keep).length if keep else 0.0) for l in lines)
        p = M.PR.price(length * h, t, db, cat, "new")
        new_m2 += length * h
        capex += p["capex_sek"]
        co2 += p["upfront_kgco2e"]
    for t, lines in wa.items():
        keep = unary_union(wb[t]).buffer(0.15) if t in wb else None
        length = sum(l.length - (l.intersection(keep).length if keep else 0.0) for l in lines)
        area = length * h
        removed_m2 += area
        c = cat.get((db.get(t) or {}).get("catalogue_id") or "")
        if c:
            capex += area * c["cost_sek"].get("labour_demount", 0.0)
            co2 += area * (1 - c.get("recovery_rate", 0.0)) * c["carbon_kgco2e"].get("C1C4", 0.0)
    fin_a, fin_b = A.prof.get("finishes") or {}, B.prof.get("finishes") or {}
    area = sum(r["area"] for r in B.rooms if not r["name"].startswith(("Core", "Atrium")))
    for kind in ("floor", "ceiling"):
        if fin_b.get(kind) and fin_b.get(kind) != fin_a.get(kind):
            p = M.PR.price(area, fin_b[kind], db, cat, "new")
            finish_m2 += area
            capex += p["capex_sek"]
            co2 += p["upfront_kgco2e"]
    void_m2 = max(0.0, sum(v.area for v in B.voids) - sum(v.area for v in A.voids))
    return {"new_m2": new_m2, "removed_m2": removed_m2, "capex_sek": capex, "co2_kg": co2,
            "finish_m2": finish_m2, "void_m2": void_m2}


def transition(site: M.Site, bid: str, a: dict, b: dict) -> dict:
    """What changes between two whole-building (ground, upper) states, every floor compared."""
    fa = site.scenario(bid, a["settings"])["res"]["floors"]
    fb = site.scenario(bid, b["settings"])["res"]["floors"]
    db, cat = site.db, site.catalogue
    new_m2 = removed_m2 = capex = co2 = finish_m2 = void_m2 = 0.0
    floors_changed = 0
    for A, B in zip(fa, fb):
        if A.use == B.use:
            continue
        floors_changed += 1
        d = _diff_floor_pair(A, B, db, cat)
        new_m2 += d["new_m2"]; removed_m2 += d["removed_m2"]; capex += d["capex_sek"]; co2 += d["co2_kg"]
        finish_m2 += d["finish_m2"]; void_m2 += d["void_m2"]
    changed_area = sum(B.footprint.area for A, B in zip(fa, fb) if A.use != B.use)
    months = (PLACEHOLDERS["transformation_months_base"]["value"]
              + PLACEHOLDERS["transformation_months_per_1000m2"]["value"] * changed_area / 1000) if floors_changed else 0.0
    return {"walls_new_m2": round(new_m2), "walls_removed_m2": round(removed_m2),
            "walls_changed_m2": round(new_m2 + removed_m2), "finish_m2": round(finish_m2),
            "slab_opening_m2": round(void_m2), "capex_sek": round(capex), "co2_kg": round(co2),
            "months": round(months, 1), "floors_changed": floors_changed}


def floor_transition(site: M.Site, bid: str, floor_index: int, a_use: str, b_use: str) -> dict:
    """What changes on one floor, between it holding a_use and holding b_use — every other floor untouched."""
    db, cat = site.db, site.catalogue
    if a_use == b_use:
        return {"walls_new_m2": 0, "walls_removed_m2": 0, "walls_changed_m2": 0, "finish_m2": 0,
                "slab_opening_m2": 0, "capex_sek": 0, "co2_kg": 0, "months": 0.0, "floors_changed": 0}
    A = site.floor_scenario(bid, floor_index, _geom_use(a_use))["res"]["floors"][floor_index]
    B = site.floor_scenario(bid, floor_index, _geom_use(b_use))["res"]["floors"][floor_index]
    d = _diff_floor_pair(A, B, db, cat)
    months = (PLACEHOLDERS["transformation_months_base"]["value"]
              + PLACEHOLDERS["transformation_months_per_1000m2"]["value"] * B.footprint.area / 1000)
    return {"walls_new_m2": round(d["new_m2"]), "walls_removed_m2": round(d["removed_m2"]),
            "walls_changed_m2": round(d["new_m2"] + d["removed_m2"]), "finish_m2": round(d["finish_m2"]),
            "slab_opening_m2": round(d["void_m2"]), "capex_sek": round(d["capex_sek"]), "co2_kg": round(d["co2_kg"]),
            "months": round(months, 1), "floors_changed": 1}


def evaluate_floor_state(site: M.Site, bid: str, floor_index: int, use: str) -> dict:
    """One floor at one use, every other floor left at today's own use."""
    sc = site.floor_scenario(bid, floor_index, use)
    F = sc["res"]["floors"][floor_index]
    gfa = F.footprint.area
    persons, a = persons_of(use, gfa)
    profile = _cat(use)["occupancy"].get("hourly_presence") or [0] * 24
    hourly = [persons * p for p in profile]
    total = sum(hourly)
    vk = fire_class(use, gfa)
    limit = max_walk(vk)
    walk = longest_walk(F, floor_index == 0)
    issues = []
    if walk > limit:
        issues.append({"severity": "blocker", "kind": "fire",
                       "text": f"{_label(use)}: longest walk to a stair {walk:.0f} m (straight line) exceeds "
                               f"{limit} m for fire class {vk} (BFS 2024:7). Needs another stair or exits."})
    dark = sum(1 for u in sc["units"][floor_index] if u["kind"] == "unit" and not u["windows"])
    if dark and use not in ("retail", "restaurant_cafe"):
        issues.append({"severity": "major", "kind": "daylight",
                       "text": f"{_label(use)}: {dark} units without a window; dwellings and permanent workplaces "
                               "need daylight and a view (BFS 2024:8, AFS 2023:12)."})
    if floor_index > 0 and load_kn(use) > load_kn("office_open"):
        issues.append({"severity": "blocker", "kind": "structure",
                       "text": f"{_label(use)}: imposed load {load_kn(use)} kN/m² against "
                               f"{load_kn('office_open')} kN/m² for an office floor (BFS 2024:6). Structural check needed."})
    voids = sum(v.area for v in F.voids)
    if voids:
        issues.append({"severity": "major", "kind": "structure",
                       "text": f"{_label(use)}: the layout cuts {voids:.0f} m² of atrium through the slab to bring in "
                               "daylight. A structure move: not priced yet."})
    k = M.MX.kpis(sc["res"], site.profiles)
    # Same shape as evaluate_state() (one "groups" entry per floor group), with a single "floor" group,
    # so the frontend's Gantt and narrative panels need no floor-mode-specific branching.
    return {
        "key": use, "settings": {"use": use},
        "groups": {"floor": {"use": use, "label": _label(use), "catalogue_use": CATALOGUE_USE[use],
                             "gfa_m2": round(gfa), "persons": round(persons), "fire_class": vk,
                             "walk_m": round(walk, 1), "walk_limit_m": limit, "units_without_window": dark}},
        "issues": issues, "assumptions": a, "gfa_m2": round(gfa),
        "people": round(persons), "people_hours": round(total),
        "evening_share": round(sum(hourly[h] for h in EVENING) / total, 3) if total else 0.0,
        "data_quality": round(1 - k.get("placeholder_share", 1.0), 3),
        "blocked": any(i["severity"] == "blocker" for i in issues),
    }


def evaluate_floor_state_mixed(site: M.Site, bid: str, floor_index: int, mix_id: str) -> dict:
    """A mixed ground-floor state (MIX_STATES): several AMF-interview uses sharing the floor by area share.
    People-hours and evening life are blended across the components from the use catalogue (_mix_density());
    the floor's own geometry, transformation cost and carbon are approximated by one representative buildable
    layout (MIX_STATES[mix_id]['represent']) — a simplification, not zoned walls per use (see MIX_STATES)."""
    mix = MIX_STATES[mix_id]
    represent = mix["represent"]
    sc = site.floor_scenario(bid, floor_index, represent)
    F = sc["res"]["floors"][floor_index]
    gfa = F.footprint.area

    hourly = [0.0] * 24
    persons_total = 0.0
    used: list[str] = []
    parts = []
    for cat_use, share in mix["components"]:
        p, profile, a = _mix_density(cat_use, gfa * share)
        persons_total += p
        used += a
        for h in range(24):
            hourly[h] += p * profile[h]
        parts.append({"use": cat_use, "label": _cat_label(cat_use), "share": share})
    total = sum(hourly)

    vk = fire_class(represent, gfa)
    limit = max_walk(vk)
    walk = longest_walk(F, floor_index == 0)
    issues = []
    if walk > limit:
        issues.append({"severity": "blocker", "kind": "fire",
                       "text": f"{mix['label']}: longest walk to a stair {walk:.0f} m (straight line) exceeds "
                               f"{limit} m for fire class {vk} (BFS 2024:7). Needs another stair or exits."})
    dark = sum(1 for u in sc["units"][floor_index] if u["kind"] == "unit" and not u["windows"])
    if dark and represent not in ("retail", "restaurant_cafe"):
        issues.append({"severity": "major", "kind": "daylight",
                       "text": f"{mix['label']}: {dark} units without a window; dwellings and permanent workplaces "
                               "need daylight and a view (BFS 2024:8, AFS 2023:12)."})
    voids = sum(v.area for v in F.voids)
    if voids:
        issues.append({"severity": "major", "kind": "structure",
                       "text": f"{mix['label']}: the layout cuts {voids:.0f} m² of atrium through the slab to bring in "
                               "daylight. A structure move: not priced yet."})
    k = M.MX.kpis(sc["res"], site.profiles)
    return {
        "key": mix_id, "settings": {"use": represent},
        "groups": {"floor": {"use": mix_id, "label": mix["label"],
                             "catalogue_use": "mixed:" + "+".join(c for c, _ in mix["components"]),
                             "gfa_m2": round(gfa), "persons": round(persons_total), "fire_class": vk,
                             "walk_m": round(walk, 1), "walk_limit_m": limit, "units_without_window": dark,
                             "mix": parts}},
        "issues": issues, "assumptions": sorted(set(used)), "gfa_m2": round(gfa),
        "people": round(persons_total), "people_hours": round(total),
        "evening_share": round(sum(hourly[h] for h in EVENING) / total, 3) if total else 0.0,
        "data_quality": round(1 - k.get("placeholder_share", 1.0), 3),
        "blocked": any(i["severity"] == "blocker" for i in issues),
    }


# ---------------------------------------------------------------------------- pathways
def _neighbours(state_key: str) -> list[str]:
    g, u = state_key.split("|")
    return [f"{x}|{u}" for x in GROUND_USES if x != g] + [f"{g}|{x}" for x in UPPER_USES if x != u]


def _series(path: list[tuple[int, str]], years: list[int], states: dict, trans) -> tuple[list[dict], dict]:
    """KPIs per year for a pathway: [(year, state key), ...] starting with (start year, today)."""
    rows, cum = [], {"capex_cum": 0.0, "co2_cum": 0.0, "walls_changed_cum": 0.0, "disruption_cum": 0.0}
    current, idx = path[0][1], 0
    for y in years:
        event = None
        while idx + 1 < len(path) and path[idx + 1][0] <= y:
            idx += 1
            t = trans(current, path[idx][1])
            cum["capex_cum"] += t["capex_sek"]
            cum["co2_cum"] += t["co2_kg"]
            cum["walls_changed_cum"] += t["walls_changed_m2"]
            cum["disruption_cum"] += t["months"]
            event = {"from": current, "to": path[idx][1], **t}
            current = path[idx][1]
        s = states[current]
        rows.append({"year": y, "state": current, "event": event,
                     "kpi": {
                         # the 7 handbook KPIs this engine can compute (KPI_META) — see there for sourcing
                         "transformation_cost": round(cum["capex_cum"], 1),
                         "transformation_time": round(cum["disruption_cum"], 1),
                         "upfront_gwp": round(cum["co2_cum"], 1),
                         "use_diversity": s["uses_count"],
                         "data_quality": s["data_quality"],
                         "feasible_uses": PLACEHOLDERS["feasible_uses"]["value"],
                         "utilization": PLACEHOLDERS["utilization"]["value"],
                         "incremental_npv": round(PLACEHOLDERS["npv_uplift_share"]["value"]
                                                   * PLACEHOLDERS["market_value_sek_per_m2"]["value"] * s["gfa_m2"]),
                         "recoverable_mass": round(PLACEHOLDERS["component_mass_kg_per_m2"]["value"] * s["gfa_m2"]
                                                    * PLACEHOLDERS["recoverable_fraction"]["value"]),
                         # kept for the per-year narrative and pathway scoring, not offered as a pickable KPI
                         "people": s["people"], "people_hours": s["people_hours"],
                         "evening_share": s["evening_share"], "uses_count": s["uses_count"],
                         "issues": sum(1 for i in s["issues"] if i["severity"] in ("blocker", "major")),
                         **{k: round(v, 1) for k, v in cum.items()},
                     }})
    return rows, cum


def _series_floor(path: list[tuple[int, str]], years: list[int], states: dict, trans) -> tuple[list[dict], dict]:
    """Like _series(), for one floor. 'Use diversity' becomes the number of distinct uses this floor
    has already held by this year (always 1 for a single state, so the per-state field doesn't apply)."""
    rows, cum = [], {"capex_cum": 0.0, "co2_cum": 0.0, "walls_changed_cum": 0.0, "disruption_cum": 0.0}
    seen_uses: set[str] = set()
    current, idx = path[0][1], 0
    for y in years:
        event = None
        while idx + 1 < len(path) and path[idx + 1][0] <= y:
            idx += 1
            t = trans(current, path[idx][1])
            cum["capex_cum"] += t["capex_sek"]
            cum["co2_cum"] += t["co2_kg"]
            cum["walls_changed_cum"] += t["walls_changed_m2"]
            cum["disruption_cum"] += t["months"]
            event = {"from": current, "to": path[idx][1], **t}
            current = path[idx][1]
        s = states[current]
        seen_uses.add(current)
        rows.append({"year": y, "state": current, "event": event,
                     "kpi": {
                         "transformation_cost": round(cum["capex_cum"], 1),
                         "transformation_time": round(cum["disruption_cum"], 1),
                         "upfront_gwp": round(cum["co2_cum"], 1),
                         "use_diversity": len(seen_uses),
                         "data_quality": s["data_quality"],
                         "feasible_uses": PLACEHOLDERS["feasible_uses"]["value"],
                         "utilization": PLACEHOLDERS["utilization"]["value"],
                         "incremental_npv": round(PLACEHOLDERS["npv_uplift_share"]["value"]
                                                   * PLACEHOLDERS["market_value_sek_per_m2"]["value"] * s["gfa_m2"]),
                         "recoverable_mass": round(PLACEHOLDERS["component_mass_kg_per_m2"]["value"] * s["gfa_m2"]
                                                    * PLACEHOLDERS["recoverable_fraction"]["value"]),
                         "people": s["people"], "people_hours": s["people_hours"],
                         "evening_share": s["evening_share"],
                         "issues": sum(1 for i in s["issues"] if i["severity"] in ("blocker", "major")),
                         **{k: round(v, 1) for k, v in cum.items()},
                     }})
    return rows, cum


def _build_pathways(today: str, states: dict, years: list[int], decisions: list[int], max_changes: int,
                    neighbours, series_fn, label_fn, trans) -> tuple[list[dict], int]:
    """Every pathway with one or two changes at the given decision points, ending in a state with no
    blocker; the best four by four measures are highlighted, once per change count. Shared by the
    whole-building (ground, upper) timeline and the single-floor one — they differ only in what a
    'state' and a 'neighbour' are, and in how a year's KPIs are built (series_fn)."""
    candidates = []
    for y1 in decisions:
        for s1 in neighbours(today):
            if not states[s1]["blocked"]:
                candidates.append([(years[0], today), (y1, s1)])
            if max_changes < 2:
                continue
            for y2 in (y for y in decisions if y > y1):
                for s2 in neighbours(s1):
                    if s2 != today and not states[s2]["blocked"]:
                        candidates.append([(years[0], today), (y1, s1), (y2, s2)])
    scored = []
    for path in candidates:
        series, cum = series_fn(path, years, states, trans)
        scored.append({"path": path, "series": series, "cum": cum,
                       "people_hours_10y": sum(r["kpi"]["people_hours"] for r in series),
                       "evening_hours_10y": sum(r["kpi"]["people_hours"] * r["kpi"]["evening_share"] for r in series)})

    # Highlights: the best pathway by four measures, once with a single change and once stepwise (two changes),
    # because the cheapest moves are nearly always single ones and would hide every stepwise pathway.
    measures = [("least_change", "Least layout change", lambda p: (p["cum"]["walls_changed_cum"], p["cum"]["capex_cum"])),
                ("lowest_cost", "Lowest investment", lambda p: (p["cum"]["capex_cum"], p["cum"]["walls_changed_cum"])),
                ("most_life", "Most people-hours", lambda p: (-p["people_hours_10y"], p["cum"]["capex_cum"])),
                ("most_evening", "Most evening life", lambda p: (-p["evening_hours_10y"], p["cum"]["capex_cum"]))]
    highlight, seen = {}, set()
    for changes, prefix in ((1, ""), (2, "Stepwise: ")):
        pool = [p for p in scored if len(p["path"]) - 1 == changes]
        for pid, label, key in measures:
            for p in sorted(pool, key=key):
                sig = tuple(k for _, k in p["path"])     # distinct by what changes, not by when
                if sig not in seen:
                    seen.add(sig)
                    highlight[id(p)] = (f"{pid}{'_2' if changes == 2 else ''}", prefix + label)
                    break

    unchanged, _ = series_fn([(years[0], today)], years, states, trans)
    segments = [{"id": "unchanged", "label": "Unchanged use", "segment": 1, "events": [], "years": unchanged}]
    others = []
    for n, p in enumerate(sorted(scored, key=lambda p: (p["cum"]["walls_changed_cum"], p["cum"]["capex_cum"]))):
        hid, label = highlight.get(id(p), (f"p{n + 1:03d}", None))
        seg = {"id": hid, "label": label or f"Pathway {n + 1}", "segment": 2, "highlight": label is not None,
               "changes": len(p["path"]) - 1,
               "summary": " → ".join(label_fn(states[k]) for _, k in p["path"]),
               "steps": [{"year": y, "state": k, "label": label_fn(states[k])} for y, k in p["path"]],
               "events": [r["event"] | {"year": r["year"]} for r in p["series"] if r["event"]],
               "totals": {"walls_changed_m2": round(p["cum"]["walls_changed_cum"]), "capex_sek": round(p["cum"]["capex_cum"]),
                          "people_hours_10y": round(p["people_hours_10y"])},
               "years": p["series"]}
        (segments if seg["highlight"] else others).append(seg)
    order = [m[0] for m in measures]
    segments[1:] = sorted(segments[1:], key=lambda s: (s["changes"], order.index(s["id"].removesuffix("_2"))))
    segments += others
    return segments, len(scored)


def build_timeline(site: M.Site, bid: str, project: dict, progress=None) -> dict:
    tl = project["timeline"]
    years = list(range(tl["start_year"], tl["start_year"] + tl["years"] + 1))
    decisions = [y for y in tl["decision_years"] if years[0] < y <= years[-1]]
    g0, u0 = (lambda uses: (uses[0], uses[1] if len(uses) > 1 else uses[0]))(site.scenario(bid, {})["uses"])
    today = f"{g0}|{u0}"

    keys = {today} | set(_neighbours(today))
    for k in list(keys - {today}):
        keys |= set(_neighbours(k))          # two changes away
    keys = sorted(keys)
    states = {}
    for i, k in enumerate(keys):
        g, u = k.split("|")
        states[k] = evaluate_state(site, bid, g, u)
        if progress:
            progress(i + 1, len(keys))

    cache: dict = {}

    def trans(a: str, b: str) -> dict:
        if (a, b) not in cache:
            cache[(a, b)] = transition(site, bid, states[a], states[b])
        return cache[(a, b)]

    segments, n_scored = _build_pathways(today, states, years, decisions, tl.get("max_changes", 2),
                                         _neighbours, _series, _state_label, trans)
    used = sorted({a for k in {r["state"] for s in segments for r in s["years"]} for a in states[k]["assumptions"]})
    return {
        "building": bid, "project": project["id"], "years": years, "decision_years": decisions,
        "decision_years_source": tl.get("decision_years_source"), "today": today,
        "states": {k: states[k] for k in {r["state"] for s in segments for r in s["years"]}},
        "segments": segments, "kpis": KPI_META, "group_titles": {"ground": "Ground floor", "upper": "Upper floors"},
        "assumptions": {k: {"value": ASSUME[k][0], "source": ASSUME[k][1]} for k in used},
        "pathways_tested": n_scored, "states_tested": len(states),
    }


def _state_label(s: dict) -> str:
    g, u = s["groups"]["ground"]["label"], s["groups"].get("upper", {}).get("label", "")
    return f"{g} / {u}"


def build_floor_timeline(site: M.Site, bid: str, floor_index: int, project: dict, progress=None) -> dict:
    """The same 10-year pathway search as build_timeline(), scoped to one floor: segment 1 keeps that
    floor's own current use for all 10 years; segment 2's pathways may change it at any year (not just
    a few lease-like decision years, since one floor is cheap enough to search freely), between any of
    the 7 uses the layout engine can draw, including restaurant_cafe — and, on the ground floor, between
    MIX_STATES' composite AMF-interview mixes (café + event/foyer + shared amenities, etc.) too. Every
    other floor is left exactly as it is today — floor_scenario() builds one floor's use without moving
    its neighbours."""
    tl = project["timeline"]
    years = list(range(tl["start_year"], tl["start_year"] + tl["years"] + 1))
    decisions = years[1:]                              # any year after today is a free decision point
    today = site.scenario(bid, {})["uses"][floor_index]
    if today not in SINGLE_FLOOR_USES:                 # e.g. B01's drawn office_ground: treat as its nearest kind
        today = "office_cellular" if "office" in today else "retail"

    use_ids = SINGLE_FLOOR_USES + (list(MIX_STATES) if floor_index == 0 else [])

    def neighbours(use: str) -> list[str]:
        return [u for u in use_ids if u != use]

    states = {}
    for i, use in enumerate(use_ids):
        states[use] = (evaluate_floor_state_mixed(site, bid, floor_index, use) if use in MIX_STATES
                        else evaluate_floor_state(site, bid, floor_index, use))
        if progress:
            progress(i + 1, len(use_ids))

    cache: dict = {}

    def trans(a: str, b: str) -> dict:
        if (a, b) not in cache:
            cache[(a, b)] = floor_transition(site, bid, floor_index, a, b)
        return cache[(a, b)]

    segments, n_scored = _build_pathways(today, states, years, decisions, tl.get("max_changes", 2),
                                         neighbours, _series_floor, lambda s: s["groups"]["floor"]["label"], trans)
    used = sorted({a for k in {r["state"] for s in segments for r in s["years"]} for a in states[k]["assumptions"]})
    return {
        "building": bid, "floor": floor_index, "project": project["id"], "years": years,
        "decision_years": decisions, "decision_years_source": "Any year can be a decision point for one floor.",
        "today": today, "states": {k: states[k] for k in {r["state"] for s in segments for r in s["years"]}},
        "segments": segments, "kpis": KPI_META, "group_titles": {"floor": f"Floor {floor_index}"},
        "assumptions": {k: {"value": ASSUME[k][0], "source": ASSUME[k][1]} for k in used},
        "pathways_tested": n_scored, "states_tested": len(use_ids),
    }


# ---------------------------------------------------------------------------- jobs (the first run takes a while)
class Timelines:
    def __init__(self, site_getter):
        self.site = site_getter
        self.jobs: dict[tuple, dict] = {}
        self.lock = threading.Lock()

    def get(self, bid: str, project: dict, floor: int | None = None) -> dict:
        key = (bid, project["id"], floor)
        with self.lock:
            job = self.jobs.get(key)
            if job is None:
                job = self.jobs[key] = {"status": "computing", "done": 0, "total": 0}
                threading.Thread(target=self._run, args=(key, bid, project, floor), daemon=True).start()
        return job["result"] if job["status"] == "ready" else {k: v for k, v in job.items() if k != "result"}

    def _run(self, key, bid, project, floor):
        job = self.jobs[key]

        def progress(done, total):
            job.update(done=done, total=total)
        try:
            if floor is None:
                result = build_timeline(self.site(), bid, project, progress)
            else:
                result = build_floor_timeline(self.site(), bid, floor, project, progress)
            job["result"] = dict(result, status="ready")
            job["status"] = "ready"
        except Exception as e:   # reported to the browser; a server restart tries again
            job.update(status="failed", error=f"{type(e).__name__}: {e}")
