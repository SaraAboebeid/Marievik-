"""KPIs above the building: the district (all of Marievik's blocks together) and the urban scale (Marievik in
Liljeholmen). Building and floor scale use explorer/kpis.py building_kpis as they are.

Going up a scale, a KPI does one of three things:
  sums        cost, carbon, mass and money add up over the buildings (each in its current scenario)
  changes     it means something else one scale up: utilization becomes the let share of all floor area today,
              use diversity the uses across all blocks, and at urban scale the kinds of place within a walk
  stops       it has no meaning here yet (adaptability profile, POE, ...): left out, the explorer says so

Each value keeps the weakest status of what went into it (a sum of placeholders is a placeholder).
"""
from __future__ import annotations

import math
from datetime import date

from parametric.mvk import site as S

from . import urban_life
from .kpis import _msek, _sp, _t, building_kpis
from .studio import tenancy as studio_tenancy

RANK = {"computed": 0, "partial": 1, "placeholder": 2}
WALK_M = 600   # the "within a walk" radius, same as the amenity pins on the urban map

# district: how each building KPI adds up, and how the total reads
SUM = {
    "transformation_cost": _msek, "lcc": _msek, "incremental_npv": _msek, "option_value": _msek,
    "downside_loss": _msek, "break_even_premium": _msek, "retained_material_value": _msek,
    "upfront_gwp": _t, "whole_life_gwp": _t, "avoided_gwp": _t,
    "recoverable_mass": lambda v: f"{_sp(v / 1000)} t",
    "shiftable_load": lambda v: f"{v / 1000:.0f} kW",
}
WEIGHTED = {   # mean over the buildings, weighted by floor area
    "value_retention": lambda v: f"{v * 100:.0f} %",
    "hazard_adaptation": lambda v: f"{v:.2f} / 1",
    "replication": lambda v: f"{v:.1f} / 1",
    "carbon_payback": lambda v: f"{v:.0f} years",
}

_cache: dict[str, dict] = {}


def _worst(*statuses: str) -> str:
    return max(statuses, key=lambda s: RANK.get(s, 2))


def district_kpis(site, settings: dict[str, dict] | None = None) -> dict:
    """{id: {value, display, status, note}} for the whole district, each building in its scenario from
    `settings` (building id -> scenario settings; buildings not named keep their defaults)."""
    settings = settings or {}
    key = repr(sorted((k, sorted(v.items())) for k, v in settings.items()))
    if key in _cache:
        return _cache[key]
    blds = site.site["buildings"]
    per = {b["id"]: building_kpis(site, b["id"], settings.get(b["id"]), alternatives=False)["kpis"] for b in blds}
    gfa = {b["id"]: site.scenario(b["id"], settings.get(b["id"]))["kpi"]["gfa_m2"] or 0 for b in blds}
    n = len(blds)
    out: dict[str, dict] = {}

    def put(kid, v, display, status, note):
        out[kid] = {"value": v, "display": display, "status": status, "note": note}

    for kid, fmt in SUM.items():
        vals = [per[b][kid] for b in per if kid in per[b] and isinstance(per[b][kid]["value"], (int, float))]
        if vals:
            put(kid, sum(v["value"] for v in vals), fmt(sum(v["value"] for v in vals)),
                _worst(*(v["status"] for v in vals)), f"sum over {len(vals)} buildings, each in its current scenario")
    total = sum(gfa.values()) or 1
    for kid, fmt in WEIGHTED.items():
        vals = [(per[b][kid], gfa[b]) for b in per if kid in per[b] and isinstance(per[b][kid]["value"], (int, float))]
        if vals:
            m = sum(v["value"] * g for v, g in vals) / (sum(g for _, g in vals) or 1)
            put(kid, m, fmt(m), _worst(*(v["status"] for v, _ in vals)), f"mean of {len(vals)} buildings, weighted by floor area")

    # works don't all happen at once: the longest single building is the floor under the district's timeline
    tt = [per[b]["transformation_time"] for b in per]
    put("transformation_time", max(v["value"] for v in tt), f"≥ {max(v['value'] for v in tt):.0f} months",
        _worst(*(v["status"] for v in tt)), "the longest single building; the real figure depends on how works are phased")
    crrem = [per[b]["crrem_year"] for b in per]
    put("crrem_year", min(v["value"] for v in crrem), str(min(v["value"] for v in crrem)),
        _worst(*(v["status"] for v in crrem)), "the first building to fall off the CRREM pathway")
    dq = [(per[b]["data_quality"]["value"], gfa[b]) for b in per]
    q = sum(v * g for v, g in dq) / total
    put("data_quality", q, f"{q * 100:.0f} % verified", "computed", "share of priced items on verified data, over all buildings")
    dw = [per[b]["disruptions"] for b in per]
    put("disruptions", sum(v["value"] for v in dw), f"{sum(v['value'] for v in dw)} building-weeks",
        _worst(*(v["status"] for v in dw)), f"weeks of disruption added up over {n} buildings")

    # changes meaning: the uses across all blocks
    uses = sorted({u for b in blds for u in site.scenario(b["id"], settings.get(b["id"]))["uses"]})
    put("use_diversity", len(uses), f"{len(uses)} uses", "computed",
        "distinct uses across the district: " + ", ".join(u.replace("_", " ") for u in uses))
    # changes meaning: the let share of all floor area today (real leases and AMF's phasing, else authored estimates)
    rented = vacant = 0.0
    for b in blds:
        a = S.footprint(b).area
        for f in range(int(b["levels"])):
            ft = studio_tenancy.floor_tenancy("marievik", b["id"], f, a, today=date.today().year)
            rented += ft["rented"]
            vacant += ft["vacant"]
    let = rented / (rented + vacant) if rented + vacant else 0
    put("utilization", let, f"{let * 100:.0f} % let", "partial",
        f"let share of all floor area today, {date.today().year}: AMF's phasing for B01-B03, estimates for the rest")

    if len(_cache) > 20:
        _cache.pop(next(iter(_cache)))
    _cache[key] = out
    return out


def urban_kpis(site, settings: dict[str, dict] | None = None, project: str = "marievik") -> dict:
    """Marievik in its surroundings: what lies within a walk (OpenStreetMap amenities, explorer/urban_life.py),
    and the district totals that matter at city scale (carbon, CRREM, replication)."""
    d = district_kpis(site, settings)
    out = {k: dict(d[k], note="Marievik as a whole: " + d[k]["note"])
           for k in ("whole_life_gwp", "avoided_gwp", "crrem_year", "replication", "hazard_adaptation") if k in d}
    life = urban_life.site_life(site, project)
    near = [a for a in life["amenities"] if math.hypot(a["x"], a["y"]) < WALK_M]
    kinds = sorted({a["type"] for a in near})
    now = date.today().year
    events = [t for t in life["timeline"] if t["year"] <= now and (t["kind"] == "permanent" or t["year"] == now)]
    out["delivered_services"] = {"value": len(near), "display": f"{len(near)} places · {len(kinds)} kinds", "status": "computed",
                                 "note": f"amenities within {WALK_M} m (OpenStreetMap), plus {len(events)} of AMF's activities on site in {now}"}
    out["use_diversity"] = {"value": len(kinds), "display": f"{len(kinds)} kinds of place", "status": "computed",
                            "note": f"kinds of amenity within {WALK_M} m: " + ", ".join(k.replace("_", " ") for k in kinds)}
    return out


def scale_kpis(site, scale: str, settings: dict[str, dict] | None = None, project: str = "marievik") -> dict:
    return {"scale": scale, "kpis": urban_kpis(site, settings, project) if scale == "urban" else district_kpis(site, settings)}
