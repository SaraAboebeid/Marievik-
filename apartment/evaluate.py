"""Cost, carbon and social value for one apartment configuration.

Covers the three aspects together, because separating them is how the
cheap-and-inaccessible option wins:

    financial      capex, opex, life cycle cost (NPV, with residual value)
    environmental  embodied A1-A5 + B4 + C, operational B6, life cycle carbon
    social         accessibility, daylight, acoustic privacy, space, storage

Conventions carried over from the main engine, and worth stating because
each is a position rather than an oversight:
  - money is discounted, carbon is not
  - module D is reported separately and never netted into a total
  - residual value IS counted in LCC, because at the end of the study
    period a demountable wall is worth something and a skimmed one is not.
    That is precisely the difference the adaptability case rests on.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from engine import loader

from . import geometry

# Cleaning and management, SEK per m² per year. PLACEHOLDER.
CLEANING_SEK_M2_YR = 95.0
# Door leaf, frame, ironmongery, fitted. PLACEHOLDER.
DOOR_COST_SEK = 6800.0
DOOR_CARBON_KG = 42.0
DOOR_SERVICE_LIFE = 30


def _furniture_specs() -> dict[str, dict]:
    from pathlib import Path
    import json

    path = Path(__file__).resolve().parent / "data" / "furniture.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {item["id"]: item for item in raw["items"]}


FURNITURE = _furniture_specs()


@dataclass
class Money:
    capex: float = 0.0
    opex_annual: float = 0.0
    replacement_npv: float = 0.0
    residual_npv: float = 0.0
    opex_npv: float = 0.0

    @property
    def lcc(self) -> float:
        return self.capex + self.opex_npv + self.replacement_npv - self.residual_npv


@dataclass
class Carbon:
    a1a3: float = 0.0
    a4: float = 0.0
    a5: float = 0.0
    b4: float = 0.0
    c1c4: float = 0.0
    d_credit: float = 0.0
    operational: float = 0.0

    @property
    def embodied(self) -> float:
        return self.a1a3 + self.a4 + self.a5 + self.b4 + self.c1c4

    @property
    def upfront(self) -> float:
        return self.a1a3 + self.a4 + self.a5

    @property
    def total(self) -> float:
        return self.embodied + self.operational


@dataclass
class SocialMetric:
    name: str
    score: float
    detail: str
    hard_fail: bool = False

    @property
    def band(self) -> str:
        if self.score >= 80:
            return "good"
        if self.score >= 60:
            return "acceptable"
        if self.score >= 40:
            return "poor"
        return "failing"


@dataclass
class Result:
    money: Money = field(default_factory=Money)
    carbon: Carbon = field(default_factory=Carbon)
    social: list[SocialMetric] = field(default_factory=list)
    rooms: list[dict] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)
    area_m2: float = 0.0
    years: int = 50
    occupants: int = 1
    user_group: str = "adult"

    @property
    def social_mean(self) -> float:
        return sum(m.score for m in self.social) / len(self.social) if self.social else 0.0

    @property
    def hard_fails(self) -> list[SocialMetric]:
        return [m for m in self.social if m.hard_fail]


def _annuity_factor(rate: float, years: int) -> float:
    if rate == 0:
        return float(years)
    return (1 - (1 + rate) ** -years) / rate


def _discount(value: float, rate: float, year: int) -> float:
    return value / ((1 + rate) ** year)


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def evaluate(plan: dict, geo: geometry.GeometryResult, settings: dict) -> Result:
    catalogue = loader.catalogue()
    factors = loader.operational_factors()
    period = factors["study_period"]

    years = int(settings.get("years", period["length_years"]))
    rate = float(settings.get("discount_rate", period["discount_rate_real"]))
    occupants = int(settings.get("occupants", 1))
    group_id = settings.get("user_group", "adult")
    use_id = settings.get("use", "student_housing")
    start_year = period["start_year"]

    groups = loader.user_groups()
    group = groups.get(group_id, groups["adult"])

    result = Result(
        area_m2=geo.total_floor_m2, years=years,
        occupants=occupants, user_group=group_id,
    )
    ceiling_m = plan["shell"].get("ceiling_mm", 2500) / 1000.0

    # -----------------------------------------------------------------
    # Walls
    # -----------------------------------------------------------------
    for wall in plan.get("walls", []):
        component = catalogue.get(wall.get("component"))
        if not component:
            continue
        length_m = (
            (wall["x2"] - wall["x1"]) ** 2 + (wall["y2"] - wall["y1"]) ** 2
        ) ** 0.5 / 1000.0
        area = length_m * ceiling_m

        cost, carbon = component["cost_sek"], component["carbon_kgco2e"]
        result.money.capex += (cost["material"] + cost["labour_install"]) * area
        result.money.opex_annual += cost.get("maintenance_sek_per_year", 0.0) * area

        result.carbon.a1a3 += carbon["A1A3"] * area
        result.carbon.a4 += carbon["A4"] * area
        result.carbon.a5 += carbon["A5"] * area
        result.carbon.c1c4 += carbon["C1C4"] * area
        result.carbon.d_credit += carbon.get("D", 0.0) * area

        life = component["service_life_years"]
        for n in range(1, int(years // life) + 1):
            year = int(n * life)
            if year >= years:
                break
            result.money.replacement_npv += _discount(
                (cost["material"] + cost["labour_install"] + cost["labour_demount"]) * area,
                rate, year,
            )
            result.carbon.b4 += (
                carbon["A1A3"] + carbon["A4"] + carbon["A5"] + carbon["C1C4"]
            ) * area

        # Residual: what is still worth money at the end of the period.
        age = years % life
        remaining = max(0.0, (life - age) / life)
        result.money.residual_npv += _discount(
            cost["material"] * area * component["recovery_rate"] * remaining, rate, years
        )

    # -----------------------------------------------------------------
    # Doors
    # -----------------------------------------------------------------
    n_doors = len(plan.get("doors", []))
    result.money.capex += DOOR_COST_SEK * n_doors
    result.carbon.a1a3 += DOOR_CARBON_KG * n_doors
    for n in range(1, int(years // DOOR_SERVICE_LIFE) + 1):
        year = int(n * DOOR_SERVICE_LIFE)
        if year < years:
            result.money.replacement_npv += _discount(DOOR_COST_SEK * n_doors, rate, year)
            result.carbon.b4 += DOOR_CARBON_KG * n_doors

    # -----------------------------------------------------------------
    # Furniture and fittings
    # -----------------------------------------------------------------
    appliance_kwh = 0.0
    storage_m3 = 0.0
    seats = beds = workplaces = 0

    for item in plan.get("furniture", []):
        spec = FURNITURE.get(item["type"])
        if not spec:
            continue
        result.money.capex += spec["cost_sek"]
        result.carbon.a1a3 += spec["carbon_kgco2e"]

        life = spec["service_life_years"]
        for n in range(1, int(years // life) + 1):
            year = int(n * life)
            if year < years:
                result.money.replacement_npv += _discount(spec["cost_sek"], rate, year)
                result.carbon.b4 += spec["carbon_kgco2e"]

        age = years % life
        remaining = max(0.0, (life - age) / life)
        result.money.residual_npv += _discount(
            spec["cost_sek"] * spec["recovery_rate"] * remaining, rate, years
        )

        appliance_kwh += spec.get("operational_kwh_yr", 0.0)
        storage_m3 += spec.get("storage_m3", 0.0)
        seats += spec.get("seats", 0)
        beds += spec.get("sleeps", 0)
        workplaces += spec.get("workplaces", 0)

    # -----------------------------------------------------------------
    # Operational: energy, cleaning
    # -----------------------------------------------------------------
    area = max(1.0, geo.total_floor_m2)
    eui = factors["energy_use_intensity_kwh_m2_yr"].get(
        use_id, factors["energy_use_intensity_kwh_m2_yr"]["student_housing"]
    )
    heating_kwh = eui["heating"] * area
    cooling_kwh = eui["cooling"] * area
    elec_kwh = eui["electricity"] * area + appliance_kwh

    carbon_factors = factors["carbon_intensity_kgco2e_per_kwh"]
    price = factors["energy_price_sek_per_kwh"]

    def interp(series: dict, year: int) -> float:
        points = sorted((int(k), float(v)) for k, v in series.items() if str(k).isdigit())
        if year <= points[0][0]:
            return points[0][1]
        if year >= points[-1][0]:
            return points[-1][1]
        for (y0, v0), (y1, v1) in zip(points, points[1:]):
            if y0 <= year <= y1:
                return v0 + (v1 - v0) * (year - y0) / (y1 - y0)
        return points[-1][1]

    energy_cost_year_one = (
        heating_kwh * interp(price["district_heating"], start_year)
        + cooling_kwh * interp(price["district_cooling"], start_year)
        + elec_kwh * interp(price["electricity"], start_year)
    )
    cleaning = CLEANING_SEK_M2_YR * area
    result.money.opex_annual += energy_cost_year_one + cleaning

    # Energy prices drift, so discount year by year rather than annuitising.
    energy_npv = 0.0
    for offset in range(years):
        year = start_year + offset
        annual = (
            heating_kwh * interp(price["district_heating"], year)
            + cooling_kwh * interp(price["district_cooling"], year)
            + elec_kwh * interp(price["electricity"], year)
        )
        energy_npv += _discount(annual, rate, offset)
        result.carbon.operational += (
            heating_kwh * interp(carbon_factors["district_heating_stockholm"], year)
            + cooling_kwh * interp(carbon_factors["district_cooling_stockholm"], year)
            + elec_kwh * interp(carbon_factors["electricity_se"], year)
        )

    fixed_annual = result.money.opex_annual - energy_cost_year_one
    result.money.opex_npv = energy_npv + fixed_annual * _annuity_factor(rate, years)

    # -----------------------------------------------------------------
    # Social
    # -----------------------------------------------------------------
    clearances = group.get("clearances_mm", {})
    turning = clearances.get("turning_circle", 1200)
    passage = clearances.get("passage_width_single", 900)
    door_min = clearances.get("door_clear_width", 800)

    # 1. Accessible circulation
    unreachable = len(geo.unreachable_rooms)
    tight = len(geo.tight_rooms)
    narrow_doors = [
        d for d in plan.get("doors", []) if d.get("clear_mm", 850) < door_min
    ]
    turn_ok = geo.max_turn_mm >= turning
    access = 100.0
    detail = []
    if unreachable:
        access -= 45 * min(2, unreachable)
        detail.append(
            f"{unreachable} room(s) cannot be reached at all — no route from the "
            "entry, so a door is missing or furniture blocks the only way through"
        )
    if tight:
        access -= 25 * min(2, tight)
        detail.append(
            f"{tight} room(s) reachable on foot but not at the {passage} mm clear "
            f"width {group['label_en'].lower()} needs — a dimensional problem, not "
            "a layout one"
        )
    if not turn_ok:
        access -= 35
        detail.append(
            f"largest turning space is {geo.max_turn_mm:.0f} mm against "
            f"{turning} mm required for {group['label_en'].lower()}"
        )
    if narrow_doors:
        access -= 12 * len(narrow_doors)
        detail.append(f"{len(narrow_doors)} door(s) below {door_min} mm clear")
    if not detail:
        detail.append(
            f"every room reachable; turning space {geo.max_turn_mm:.0f} mm available "
            f"across {geo.turn_coverage:.0%} of free floor"
        )
    result.social.append(SocialMetric(
        "Accessible circulation", _clamp(access), "; ".join(detail),
        hard_fail=bool(unreachable) or bool(tight) or not turn_ok,
    ))

    # 2. Daylight
    rooms = geo.rooms
    habitable = [r for r in rooms if r.needs_daylight]
    lit = [r for r in habitable if r.has_daylight]
    if habitable:
        share = len(lit) / len(habitable)
        deep = [r for r in lit if r.daylight_depth_mm > 6000]
        score = 100.0 * share - 12 * len(deep)
        d = f"{len(lit)} of {len(habitable)} habitable rooms reach a window"
        if deep:
            d += f"; {len(deep)} deeper than 6 m from the glazing"
    else:
        score, d = 60.0, "no rooms above 6 m² to assess"
    result.social.append(SocialMetric(
        "Daylight", _clamp(score), d,
        hard_fail=bool(habitable) and len(lit) < len(habitable),
    ))

    # 3. Acoustic privacy — is sleeping separated from living?
    #
    # The question is NOT whether the building contains a wall. A studio has
    # a bathroom wall and no privacy whatsoever. What matters is whether the
    # bed is in a different room from the sofa, the table and the kitchen,
    # and only then how good the wall between them is.
    sleep_rooms = {
        geo.item_rooms.get(item["id"])
        for item in plan.get("furniture", [])
        if FURNITURE.get(item["type"], {}).get("sleeps")
    } - {None}
    social_rooms = {
        geo.item_rooms.get(item["id"])
        for item in plan.get("furniture", [])
        if FURNITURE.get(item["type"], {}).get("category") in {"living", "kitchen"}
    } - {None}

    partition_rw = [
        catalogue[w["component"]].get("performance", {}).get("Rw_dB", 0)
        for w in plan.get("walls", [])
        if w.get("component") in catalogue
    ]

    if not sleep_rooms:
        score = 70.0
        d = "no sleeping space in this plan, so there is nothing to separate"
    elif sleep_rooms & social_rooms:
        # Bed and living space share a room. No wall will fix that.
        score = 25.0 if occupants > 1 else 40.0
        d = (
            "the bed shares a room with the living and cooking space — there is "
            "no acoustic privacy to measure"
            + (", and two people have nowhere to be apart" if occupants > 1
               else ". Acceptable for one person who chooses it; not for two")
        )
    else:
        weakest = min(partition_rw) if partition_rw else 0
        target = 40 if occupants > 1 else 32
        score = _clamp(100.0 - max(0, target - weakest) * 7)
        d = (
            f"sleeping is separated from living; weakest partition Rw {weakest} dB "
            f"against {target} dB for {occupants} occupant(s)"
        )
        if weakest < target:
            d += " — normal conversation is audible through it"
    result.social.append(SocialMetric(
        "Acoustic privacy", score, d, hard_fail=bool(sleep_rooms & social_rooms) and occupants > 1,
    ))

    # 4. Space adequacy
    per_person = geo.total_floor_m2 / max(1, occupants)
    target_area = {"student_housing": 20.0, "elderly_care": 32.0}.get(use_id, 25.0)
    score = _clamp(100.0 * min(1.4, per_person / target_area) / 1.0)
    result.social.append(SocialMetric(
        "Space per occupant", min(100.0, score),
        f"{per_person:.1f} m² per occupant against ~{target_area:.0f} m² typical for this use",
    ))

    # 5. Usable furniture — clearance actually available
    blocked_major = [b for b in geo.blocked_items if b["severity"] == "major"]
    score = _clamp(100.0 - 22 * len(blocked_major) - 8 * (
        len(geo.blocked_items) - len(blocked_major)
    ))
    if geo.blocked_items:
        d = (
            f"{len(geo.blocked_items)} item(s) lack the clearance to be used properly, "
            f"{len(blocked_major)} seriously"
        )
    else:
        d = "every item has its required approach and transfer space"
    result.social.append(SocialMetric(
        "Furniture usability", score, d, hard_fail=bool(blocked_major)
    ))

    # 6. Storage
    need_m3 = 2.0 * occupants
    score = _clamp(100.0 * min(1.0, storage_m3 / need_m3)) if need_m3 else 100.0
    result.social.append(SocialMetric(
        "Storage", score,
        f"{storage_m3:.1f} m³ provided against ~{need_m3:.1f} m³ needed for "
        f"{occupants} occupant(s)",
    ))

    # -----------------------------------------------------------------
    # Issues and room table
    # -----------------------------------------------------------------
    for clash in geo.overlaps:
        result.issues.append({
            "severity": clash["severity"],
            "title": f'{clash["a_name"]} overlaps {clash["b_name"]}',
            "detail": (
                f'{clash["area_m2"]} m2 of shared floor. Two things cannot occupy the '
                "same place; one of them has to move."
            ),
        })
    for blocked in geo.blocked_items:
        result.issues.append({
            "severity": blocked["severity"],
            "title": blocked["name"],
            "detail": blocked["detail"],
        })
    for index in geo.unreachable_rooms:
        result.issues.append({
            "severity": "blocker",
            "title": f"Room {index} cannot be reached",
            "detail": (
                "No route from the entry at any usable width. Either the room has no "
                "door, or furniture is blocking the only way in."
            ),
        })
    for index in geo.tight_rooms:
        result.issues.append({
            "severity": "major",
            "title": f"Room {index} too tight for this user",
            "detail": (
                f"Reachable on foot, but no route holds {passage} mm of clear width, "
                f"which is what {group['label_en'].lower()} needs. Moving furniture "
                "will not fix this — the room or the route has to get bigger."
            ),
        })
    if beds < occupants:
        result.issues.append({
            "severity": "major",
            "title": "Not enough beds",
            "detail": f"{beds} sleeping place(s) for {occupants} occupant(s).",
        })

    for room in geo.rooms:
        result.rooms.append({
            "index": room.index,
            "area_m2": room.area_m2,
            "kind": room.kind,
            "daylight": room.has_daylight,
            "depth_mm": room.daylight_depth_mm,
            "turn_mm": room.max_turn_mm,
            "reachable": room.reachable,
            "window_m": round(room.window_length_mm / 1000.0, 1),
            "centroid": [round(room.centroid[0]), round(room.centroid[1])],
        })

    return result
