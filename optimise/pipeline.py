"""Generate, furnish, specify and evaluate every option for one use.

The search runs in three stages, because thermal simulation costs seconds
and everything else costs milliseconds:

  1. SCREEN   every scheme geometry x furnishing x partition spec x product
              strategy, evaluated on cost, carbon, usability and
              functionality with the existing glazing. Infeasible options
              (unreachable rooms, colliding furniture) are dropped here.
  2. SIMULATE the shortlisted geometries, each with all three window
              choices, in EnergyPlus. Windows are never screened out in
              stage 1: their benefit is thermal, and stage 1 cannot see it.
  3. SCORE    the shortlist again with simulated heating replacing the
              placeholder energy use, plus the comfort result.

Every option carries its plan, so any one of them can be opened in the
Apartment Lab and edited by hand.
"""

from __future__ import annotations

import random
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, field

from apartment import evaluate as apt_evaluate
from apartment import geometry
from engine import loader
from explore import search

from . import programs, schemes, thermal

PRODUCT_STRATEGIES = {
    "standard": "New, mid-market",
    "circular": "Refurbished / second-hand",
    "durable": "Premium, durable",
    "mixed": "Durable beds and desks, second-hand the rest",
}
PARTITION_SPECS = ("conventional", "demountable", "demountable_glass", "movable")


@dataclass
class Option:
    id: str
    use: str
    scheme_id: str
    geometry_key: str
    thermal_key: str
    description: str
    density_label: str
    occupants: int
    user_group: str
    side: str
    depth: int
    cells: list
    window: str
    partition: str
    products: str
    furnishing: int

    # consequences
    area_m2: float = 0.0
    capex: float = 0.0
    lcc: float = 0.0
    opex_annual: float = 0.0
    carbon_upfront: float = 0.0
    carbon_embodied: float = 0.0
    carbon_operational: float = 0.0
    carbon_total: float = 0.0
    money: dict = field(default_factory=dict)
    carbon: dict = field(default_factory=dict)
    social: dict = field(default_factory=dict)
    social_detail: dict = field(default_factory=dict)
    usability: float = 0.0
    functionality: float = 0.0
    functionality_detail: dict = field(default_factory=dict)
    comfort: float | None = None
    thermal: dict = field(default_factory=dict)
    heating_kwh_m2: float | None = None
    issues: list = field(default_factory=list)
    feasible: bool = True
    plan: dict = field(default_factory=dict)
    rooms: list = field(default_factory=list)

    @property
    def lcc_per_person(self) -> float:
        return self.lcc / max(1, self.occupants)

    @property
    def carbon_per_person(self) -> float:
        return self.carbon_total / max(1, self.occupants)

    @property
    def m2_per_person(self) -> float:
        return self.area_m2 / max(1, self.occupants)

    def criteria(self) -> dict[str, float]:
        return {
            "lcc": self.lcc_per_person,
            "carbon": self.carbon_per_person,
            "comfort": self.comfort if self.comfort is not None else 0.0,
            "usability": self.usability,
            "functionality": self.functionality,
        }


# Direction of each criterion: +1 more is better, -1 less is better.
CRITERIA = {
    "lcc": {"label": "Life cycle cost per person", "unit": "SEK", "sense": -1},
    "carbon": {"label": "Life cycle carbon per person", "unit": "kg CO2e", "sense": -1},
    "comfort": {"label": "Thermal comfort", "unit": "% hours", "sense": 1},
    "usability": {"label": "Usability", "unit": "/100", "sense": 1},
    "functionality": {"label": "Functionality", "unit": "/100", "sense": 1},
}


# ---------------------------------------------------------------------------
# Specification
# ---------------------------------------------------------------------------


def apply_products(plan: dict, strategy: str) -> dict:
    out = deepcopy(plan)
    for item in out["furniture"]:
        category = apt_evaluate.FURNITURE.get(item["type"], {}).get("category", "")
        if strategy == "mixed":
            chosen = "durable" if category in ("bedroom", "work") else "circular"
        else:
            chosen = strategy
        pid = f"{item['type']}#{chosen}"
        if pid in apt_evaluate.PRODUCTS:
            item["product"] = pid
    return out


def _settings(brief: programs.Brief, density: programs.Density, heating: float | None = None,
              cooling: float | None = None) -> dict:
    settings = {
        "use": brief.id,
        "user_group": density.user_group,
        "occupants": density.occupants,
        "target_area_m2": brief.target_area_m2,
        "needs_beds": brief.needs_beds,
    }
    if heating is not None:
        settings["heating_kwh_m2"] = heating
    if cooling is not None:
        settings["cooling_kwh_m2"] = cooling
    return settings


# ---------------------------------------------------------------------------
# Scoring beyond the evaluator: usability and functionality
# ---------------------------------------------------------------------------


def _usability(brief: programs.Brief, social: dict) -> float:
    names = ["Accessible circulation", "Daylight", "Furniture usability", "Space per occupant"]
    if brief.separate_sleeping:
        names.append("Acoustic privacy")
    values = [social[n] for n in names if n in social]
    return round(sum(values) / len(values), 1) if values else 0.0


def _functionality(brief: programs.Brief, density: programs.Density, scheme: schemes.Scheme,
                   plan: dict, geo: geometry.GeometryResult, social: dict) -> tuple[float, dict]:
    """Does the layout do what the use needs, beyond fitting on the floor?"""
    furniture = apt_evaluate.FURNITURE
    items = plan["furniture"]
    count = defaultdict(int)
    for item in items:
        count[item["type"]] += 1
    occupants = density.occupants
    parts: dict[str, float] = {}

    # 1. Capacity: a place to sleep, sit and work for everyone the use claims.
    sleeps = sum(furniture[i["type"]].get("sleeps", 0) for i in items)
    desks = sum(furniture[i["type"]].get("workplaces", 0) for i in items
                if furniture[i["type"]]["category"] == "work")
    dining = count["chair.dining"] + 6 * count["table.dining.1800"]
    if brief.needs_beds:
        parts["Sleeping places"] = min(1.0, sleeps / occupants)
        parts["Dining places"] = min(1.0, dining / occupants)
    else:
        parts["Workplaces"] = min(1.0, desks / occupants)

    # 2. Separation: who can close a door.
    room_of = geo.item_rooms
    rooms_by_index = {r.index: r for r in geo.rooms}
    if brief.needs_beds:
        living_rooms = {room_of.get(i["id"]) for i in items
                        if furniture[i["type"]]["category"] in ("living", "kitchen")}
        separated = sum(furniture[i["type"]].get("sleeps", 0) for i in items
                        if furniture[i["type"]].get("sleeps") and room_of.get(i["id"]) not in living_rooms)
        parts["Sleeping separated from living"] = min(1.0, separated / occupants) if occupants else 1.0
    else:
        has_meeting = any(c["kind"] == "meeting" for c in scheme.cells)
        needs_meeting = occupants >= brief.meeting_room_from > 0
        parts["Enclosed meeting room"] = 1.0 if has_meeting else (0.3 if needs_meeting else 0.7)
        # Desks with daylight: a workplace without a window is a storage room.
        lit = 0
        total = 0
        for i in items:
            if furniture[i["type"]].get("workplaces"):
                total += 1
                room = rooms_by_index.get(room_of.get(i["id"], -1))
                if room and room.has_daylight and room.daylight_depth_mm <= 6000:
                    lit += 1
        parts["Desks within 6 m of a window"] = lit / total if total else 0.0

    # 3. Storage, from the evaluator.
    parts["Storage"] = social.get("Storage", 0.0) / 100.0

    # 4. A seated view out, where the user sits.
    if brief.seated_view_matters:
        parts["Seated view out"] = 1.0 if schemes.WINDOWS[scheme.window]["sill_mm"] <= 700 else 0.3

    # 5. What the products themselves do: adjustability, repairability.
    funcs = []
    for i in items:
        product = apt_evaluate.PRODUCTS.get(i.get("product", ""))
        if product:
            funcs.append(product["functionality"])
    if funcs:
        parts["Product quality"] = min(1.0, (sum(funcs) / len(funcs)) / 0.9)

    score = 100.0 * sum(parts.values()) / len(parts)
    return round(score, 1), {k: round(100 * v) for k, v in parts.items()}


# ---------------------------------------------------------------------------
# Stage 1: screen
# ---------------------------------------------------------------------------


def _clearances(user_group: str) -> dict:
    groups = loader.user_groups()
    return groups.get(user_group, groups["adult"]).get("clearances_mm", {})


def _evaluate(brief, density, scheme, plan, geo, partition, products, furnishing,
              heating=None, cooling=None) -> Option:
    result = apt_evaluate.evaluate(plan, geo, _settings(brief, density, heating, cooling))
    social = {m.name: round(m.score, 1) for m in result.social}
    func, func_detail = _functionality(brief, density, scheme, plan, geo, social)
    blockers = [i for i in result.issues if i["severity"] == "blocker"]
    major_overlap = [o for o in geo.overlaps if o["severity"] == "major"]
    option = Option(
        id=f"{scheme.id}.f{furnishing}.{partition}.{products}",
        use=brief.id,
        scheme_id=scheme.id,
        geometry_key=scheme.geometry_key,
        thermal_key=scheme.thermal_key,
        description=scheme.describe(),
        density_label=density.label,
        occupants=density.occupants,
        user_group=density.user_group,
        side=scheme.side,
        depth=scheme.depth,
        cells=[{k: c[k] for k in ("kind", "label", "x0", "x1")} for c in scheme.cells],
        window=scheme.window,
        partition=partition,
        products=products,
        furnishing=furnishing,
        area_m2=round(result.area_m2, 1),
        capex=round(result.money.capex),
        lcc=round(result.money.lcc),
        opex_annual=round(result.money.opex_annual),
        carbon_upfront=round(result.carbon.upfront),
        carbon_embodied=round(result.carbon.embodied),
        carbon_operational=round(result.carbon.operational),
        carbon_total=round(result.carbon.total),
        money={
            "capex": round(result.money.capex),
            "opex_npv": round(result.money.opex_npv),
            "replacement_npv": round(result.money.replacement_npv),
            "residual_npv": round(result.money.residual_npv),
            "lcc": round(result.money.lcc),
        },
        carbon={
            "a1a3": round(result.carbon.a1a3), "a4": round(result.carbon.a4),
            "a5": round(result.carbon.a5), "b4": round(result.carbon.b4),
            "c1c4": round(result.carbon.c1c4), "b6": round(result.carbon.operational),
            "d": round(result.carbon.d_credit), "total": round(result.carbon.total),
        },
        social=social,
        social_detail={m.name: m.detail for m in result.social},
        usability=_usability(brief, social),
        functionality=func,
        functionality_detail=func_detail,
        heating_kwh_m2=heating,
        issues=[{"severity": i["severity"], "title": i["title"]} for i in result.issues],
        feasible=not blockers and not major_overlap,
        plan=plan,
        rooms=scheme.rooms,
    )
    # Everything needed to re-specify this option later without redoing the
    # geometry. Private: never written to the results.
    option._ctx = (brief, density, scheme, geo, heating, cooling)
    return option


def respecify(option: Option, partition: str) -> Option:
    """The same layout, furniture, glazing and products with other partitions.

    Within one use a demountable wall only ever costs more: its benefit is
    collected at the next change of use. The cross-use regret therefore
    needs these twins even though the within-use selection never picks them.
    """
    brief, density, scheme, geo, heating, cooling = option._ctx
    plan = search.apply_spec(option.plan, partition)
    twin = _evaluate(brief, density, scheme, plan, geo, partition, option.products,
                     option.furnishing, heating, cooling)
    twin.comfort, twin.thermal = option.comfort, option.thermal
    return twin


def screen(brief: programs.Brief, furnishings: int = 2, anneal_iterations: int = 1500,
           max_geometries: int = 36, seed: int = 0, log=print) -> tuple[list[Option], dict]:
    """Stage 1. Returns every feasible option (existing glazing) and the schemes by geometry."""
    from apartment.server import specs_for

    groups = loader.user_groups()
    door_clear = {k: g.get("clearances_mm", {}).get("door_clear_width", 850) for k, g in groups.items()}
    passage = {k: g.get("clearances_mm", {}).get("passage_width_single", 900) for k, g in groups.items()}
    all_schemes = schemes.generate(brief, door_clear, passage_for=passage)

    by_geometry: dict[str, list[schemes.Scheme]] = defaultdict(list)
    for s in all_schemes:
        by_geometry[s.geometry_key].append(s)

    # Too many geometries to furnish all of them: sample, stratified by
    # density and room programme so no density is starved.
    keys = list(by_geometry)
    if len(keys) > max_geometries:
        rng = random.Random(seed)
        strata: dict[tuple, list[str]] = defaultdict(list)
        for k in keys:
            s = by_geometry[k][0]
            strata[(s.density.occupants, s.density.user_group, len(s.cells))].append(k)
        picked: list[str] = []
        per = max(1, max_geometries // len(strata))
        for group in strata.values():
            rng.shuffle(group)
            picked.extend(group[:per])
        rest = [k for k in keys if k not in picked]
        rng.shuffle(rest)
        picked.extend(rest[: max(0, max_geometries - len(picked))])
        keys = picked

    stats = {"schemes": len(all_schemes), "geometries": len(by_geometry),
             "geometries_furnished": len(keys), "evaluated": 0, "feasible": 0,
             "infeasible_reasons": defaultdict(int)}
    options: list[Option] = []
    for n, key in enumerate(keys):
        variants = by_geometry[key]
        base = next(v for v in variants if v.window == "existing")
        density = base.density
        specs = specs_for(density.user_group)
        clear = _clearances(density.user_group)
        furnished = search.generate_furnishings(
            {k: base.plan[k] for k in ("shell", "walls", "doors", "furniture")},
            specs, count=furnishings, anneal_iterations=anneal_iterations, seed=seed + n,
        )
        for f_index, plan in enumerate(furnished):
            plan["works"] = []
            geo = geometry.analyse(
                plan, specs,
                turning_circle_mm=clear.get("turning_circle", 1200),
                passage_width_mm=clear.get("passage_width_single", 900),
                door_clear_mm=clear.get("door_clear_width", 800),
            )
            for partition in PARTITION_SPECS:
                specified = search.apply_spec(plan, partition)
                for products in PRODUCT_STRATEGIES:
                    final = apply_products(specified, products)
                    option = _evaluate(brief, density, base, final, geo, partition, products, f_index)
                    stats["evaluated"] += 1
                    if not option.feasible:
                        for issue in option.issues:
                            if issue["severity"] in ("blocker", "major"):
                                stats["infeasible_reasons"][issue["title"].split(" ")[0]] += 1
                        continue
                    option._geo = geo  # kept for stage 3, never serialised
                    options.append(option)
        log(f"  {brief.id}: furnished {n + 1}/{len(keys)} geometries, {len(options)} feasible options")
    stats["feasible"] = len(options)
    stats["infeasible_reasons"] = dict(stats["infeasible_reasons"])
    return options, {"by_geometry": by_geometry, "stats": stats}


# ---------------------------------------------------------------------------
# Stage 2 and 3: simulate the shortlist, then score it properly
# ---------------------------------------------------------------------------


def shortlist(options: list[Option], size: int = 40) -> list[Option]:
    """Best by non-dominated rank on the four screen criteria, deduplicated."""
    from .selection import nondominated_ranks

    keys = ("lcc", "carbon", "usability", "functionality")
    ranks = nondominated_ranks(options, keys)
    ordered = sorted(options, key=lambda o: (ranks[o.id], -o.functionality - o.usability))
    out, seen = [], set()
    for o in ordered:
        # One per geometry x spec x products: furnishing twins add nothing.
        key = (o.geometry_key, o.partition, o.products)
        if key in seen:
            continue
        seen.add(key)
        out.append(o)
        if len(out) >= size:
            break
    return out


def score_with_thermal(brief: programs.Brief, short: list[Option], by_geometry: dict,
                       azimuth: float, log=print) -> list[Option]:
    """Expand each shortlisted option to every window choice, simulate, re-evaluate."""
    expanded: list[tuple[Option, schemes.Scheme]] = []
    for option in short:
        for variant in by_geometry[option.geometry_key]:
            expanded.append((option, variant))

    cases = {}
    for _option, variant in expanded:
        cases[variant.thermal_key] = thermal.case_for(brief, variant, azimuth)
    log(f"  {brief.id}: {len(cases)} thermal cases for {len(expanded)} options")
    results = thermal.run(list(cases.values()), log=log)

    scored: list[Option] = []
    for option, variant in expanded:
        sim = results.get(cases[variant.thermal_key]["id"])
        density = variant.density
        plan = deepcopy(option.plan)
        plan["shell"] = variant.plan["shell"]
        plan["works"] = variant.plan["works"]
        heating = cooling = None
        if sim and sim.get("ok"):
            heating = sim["heating_kwh_m2"] + brief.hot_water_kwh_m2
            cooling = sim["cooling_kwh_m2"]
        new = _evaluate(brief, density, variant, plan, option._geo, option.partition,
                        option.products, option.furnishing, heating, cooling)
        if sim and sim.get("ok"):
            new.comfort, new.thermal = thermal.summarise(sim, variant.rooms)
        scored.append(new)
    return [o for o in scored if o.feasible and o.comfort is not None]
