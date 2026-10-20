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

# layout-engine use -> catalogue use (data/catalogue/uses)
CATALOGUE_USE = {"office_ground": "office", "office_cellular": "office", "office_open": "office", "residential": "housing_apartment",
                 "hotel": "hotel", "school": "school_compulsory", "retail": "retail_shop"}
GROUND_USES = ["retail", "office_open", "office_cellular", "school", "hotel"]
UPPER_USES = ["office_cellular", "office_open", "residential", "hotel", "school"]
# imposed load category per use (BFS 2024:6 table 4:1, via cross_cutting.json); the school and hotel
# categories are the Eurocode convention, not stated in BFS 2024:6
LOAD_CATEGORY = {"office_ground": "B_office", "office_cellular": "B_office", "office_open": "B_office", "residential": "A_dwelling",
                 "hotel": "A_dwelling", "school": "C1_assembly_movable_seats", "retail": "D1_retail"}
# ASSUMPTION: the upper floors were designed as office floors, so a use above the office load is flagged
EVENING = range(17, 24)
GRID_M = 2.0                        # sample spacing for the walk-to-exit check

# Working values where the catalogue gives no number. Each one marks the KPI it feeds as placeholder.
ASSUME = {
    "retail_m2_per_visitor": (10.0, "PLACEHOLDER: shoppers present at peak; the fire-design density is 2 m²/person"),
    "hotel_guests_per_room": (1.4, "PLACEHOLDER: average guests per occupied room"),
}

KPI_META = {
    "people":            {"label": "People in the building at peak", "unit": "people", "better": "higher", "status": "partial",
                          "note": "Gross area / catalogue m² per person (office 15, school 16, housing 45, hotel 38 per room); "
                                  "peak of the hourly presence profiles."},
    "people_hours":      {"label": "People-hours per weekday", "unit": "h", "better": "higher", "status": "partial",
                          "note": "Persons × the catalogue's hourly presence profile, summed over 24 h. Profiles are indicative."},
    "evening_share":     {"label": "Share of people-hours after 17:00", "unit": "%", "better": "higher", "status": "partial",
                          "note": "17:00–24:00 share of the weekday people-hours."},
    "capex_cum":         {"label": "Investment, cumulative", "unit": "SEK", "better": "lower", "status": "partial",
                          "note": "New walls and finishes at catalogue prices, plus demounting removed walls. Doors, services "
                                  "and slab openings are not priced yet."},
    "co2_cum":           {"label": "Embodied carbon of changes, cumulative", "unit": "kg CO₂e", "better": "lower", "status": "partial",
                          "note": "A1–A5 of new walls and finishes plus C1–C4 of removed walls (catalogue)."},
    "walls_changed_cum": {"label": "Walls built or removed, cumulative", "unit": "m²", "better": "lower", "status": "computed",
                          "note": "Wall area that differs between two layouts, by geometry and wall type."},
    "disruption_cum":    {"label": "Months of works, cumulative", "unit": "months", "better": "lower", "status": "placeholder",
                          "note": "data/kpi/placeholders.json: fixed months per change plus months per 1000 m² changed."},
    "uses_count":        {"label": "Different uses in the building", "unit": "uses", "better": "higher", "status": "computed",
                          "note": "Distinct uses across the floor groups."},
    "issues":            {"label": "Standards issues", "unit": "issues", "better": "lower", "status": "computed",
                          "note": "Catalogue checks: walk to exit vs. fire class, units without windows, imposed load, slab openings."},
}


# ---------------------------------------------------------------------------- catalogue helpers
def _cat(use: str) -> dict:
    return loader.catalogue_uses()[CATALOGUE_USE[use]]


def _rules() -> dict:
    return loader.cross_cutting_rules()


def persons_of(use: str, gfa: float) -> tuple[float, list[str]]:
    """Persons a floor group holds, and the assumptions that rest on."""
    occ = _cat(use)["occupancy"]
    if use == "retail":
        return gfa / ASSUME["retail_m2_per_visitor"][0], ["retail_m2_per_visitor"]
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
        "people": round(max(hourly)), "people_hours": round(total),
        "evening_share": round(sum(hourly[h] for h in EVENING) / total, 3) if total else 0.0,
        "uses_count": len({g["catalogue_use"] for g in out_groups.values()}),
        "blocked": any(i["severity"] == "blocker" for i in issues),
    }


def _label(use: str) -> str:
    return M.L.load_profiles()[use]["label"]


# ---------------------------------------------------------------------------- what changes between two states
def transition(site: M.Site, bid: str, a: dict, b: dict) -> dict:
    """Walls kept, built and removed between two layouts (same geometry and type counts as kept),
    finishes replaced where the use's finish changes, and slab opening added."""
    fa = site.scenario(bid, a["settings"])["res"]["floors"]
    fb = site.scenario(bid, b["settings"])["res"]["floors"]
    db, cat = site.db, site.catalogue
    new_m2 = removed_m2 = capex = co2 = finish_m2 = void_m2 = 0.0
    floors_changed = 0
    for A, B in zip(fa, fb):
        if A.use == B.use:
            continue
        floors_changed += 1
        h = B.wall_h

        def by_type(F):
            out = {}
            for w in F.walls:
                if w["cat"] not in M.L.RETAINED_CATS:
                    out.setdefault(w["type"], []).append(LineString([w["a"], w["b"]]))
            return out

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
        void_m2 += max(0.0, sum(v.area for v in B.voids) - sum(v.area for v in A.voids))
    ph = json.loads((loader.DATA / "kpi" / "placeholders.json").read_text(encoding="utf-8"))
    changed_area = sum(B.footprint.area for A, B in zip(fa, fb) if A.use != B.use)
    months = (ph["transformation_months_base"]["value"]
              + ph["transformation_months_per_1000m2"]["value"] * changed_area / 1000) if floors_changed else 0.0
    return {"walls_new_m2": round(new_m2), "walls_removed_m2": round(removed_m2),
            "walls_changed_m2": round(new_m2 + removed_m2), "finish_m2": round(finish_m2),
            "slab_opening_m2": round(void_m2), "capex_sek": round(capex), "co2_kg": round(co2),
            "months": round(months, 1), "floors_changed": floors_changed}


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
                     "kpi": {"people": s["people"], "people_hours": s["people_hours"],
                             "evening_share": s["evening_share"], "uses_count": s["uses_count"],
                             "issues": sum(1 for i in s["issues"] if i["severity"] in ("blocker", "major")),
                             **{k: round(v, 1) for k, v in cum.items()}}})
    return rows, cum


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

    # every pathway with one or two changes at the decision years, ending in a state with no blocker
    candidates = []
    for y1 in decisions:
        for s1 in _neighbours(today):
            if not states[s1]["blocked"]:
                candidates.append([(years[0], today), (y1, s1)])
            if tl.get("max_changes", 2) < 2:
                continue
            for y2 in (y for y in decisions if y > y1):
                for s2 in _neighbours(s1):
                    if s2 != today and not states[s2]["blocked"]:
                        candidates.append([(years[0], today), (y1, s1), (y2, s2)])
    scored = []
    for path in candidates:
        series, cum = _series(path, years, states, trans)
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

    unchanged, _ = _series([(years[0], today)], years, states, trans)
    segments = [{"id": "unchanged", "label": "Unchanged use", "segment": 1, "events": [], "years": unchanged}]
    others = []
    for n, p in enumerate(sorted(scored, key=lambda p: (p["cum"]["walls_changed_cum"], p["cum"]["capex_cum"]))):
        hid, label = highlight.get(id(p), (f"p{n + 1:03d}", None))
        seg = {"id": hid, "label": label or f"Pathway {n + 1}", "segment": 2, "highlight": label is not None,
               "changes": len(p["path"]) - 1,
               "summary": " → ".join(_state_label(states[k]) for _, k in p["path"]),
               "steps": [{"year": y, "state": k, "label": _state_label(states[k])} for y, k in p["path"]],
               "events": [r["event"] | {"year": r["year"]} for r in p["series"] if r["event"]],
               "totals": {"walls_changed_m2": round(p["cum"]["walls_changed_cum"]), "capex_sek": round(p["cum"]["capex_cum"]),
                          "people_hours_10y": round(p["people_hours_10y"])},
               "years": p["series"]}
        (segments if seg["highlight"] else others).append(seg)
    order = [m[0] for m in measures]
    segments[1:] = sorted(segments[1:], key=lambda s: (s["changes"], order.index(s["id"].removesuffix("_2"))))
    segments += others
    used = sorted({a for k in {r["state"] for s in segments for r in s["years"]} for a in states[k]["assumptions"]})
    return {
        "building": bid, "project": project["id"], "years": years, "decision_years": decisions,
        "decision_years_source": tl.get("decision_years_source"), "today": today,
        "states": {k: states[k] for k in {r["state"] for s in segments for r in s["years"]}},
        "segments": segments, "kpis": KPI_META,
        "assumptions": {k: {"value": ASSUME[k][0], "source": ASSUME[k][1]} for k in used},
        "pathways_tested": len(scored), "states_tested": len(states),
    }


def _state_label(s: dict) -> str:
    g, u = s["groups"]["ground"]["label"], s["groups"].get("upper", {}).get("label", "")
    return f"{g} / {u}"


# ---------------------------------------------------------------------------- jobs (the first run takes a while)
class Timelines:
    def __init__(self, site_getter):
        self.site = site_getter
        self.jobs: dict[tuple[str, str], dict] = {}
        self.lock = threading.Lock()

    def get(self, bid: str, project: dict) -> dict:
        key = (bid, project["id"])
        with self.lock:
            job = self.jobs.get(key)
            if job is None:
                job = self.jobs[key] = {"status": "computing", "done": 0, "total": 0}
                threading.Thread(target=self._run, args=(key, bid, project), daemon=True).start()
        return job["result"] if job["status"] == "ready" else {k: v for k, v in job.items() if k != "result"}

    def _run(self, key, bid, project):
        job = self.jobs[key]

        def progress(done, total):
            job.update(done=done, total=total)
        try:
            job["result"] = dict(build_timeline(self.site(), bid, project, progress), status="ready")
            job["status"] = "ready"
        except Exception as e:   # reported to the browser; a server restart tries again
            job.update(status="failed", error=f"{type(e).__name__}: {e}")
