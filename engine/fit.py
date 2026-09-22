"""ADAPT — can this shell host this use, and at what capacity?

The fit test is deliberately blunt and fast. It runs before any layout work
and answers the question that actually decides projects: what stops us?

Design intent: report the BINDING constraint first. A list of twelve passing
checks and one failure is not a balanced picture — the failure is the answer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from . import loader

Severity = Literal["blocker", "major", "minor", "pass"]
Stage = Literal["RETAIN", "ENABLE", "ADAPT", "IMPLEMENT", "EVALUATE"]

# Indicative egress capacity. BBR expresses this via exit width and
# occupancy; 150 persons per 1200 mm of exit width is the common rule of
# thumb used for early feasibility. VERIFY before publication.
PERSONS_PER_MM_EXIT = 150.0 / 1200.0

# Fraction of gross floor area that becomes usable net area after cores,
# structure and primary circulation. Varies by plan form; 0.82 is typical
# for a 1980s flat-slab office plate.
NET_TO_GROSS = 0.82


@dataclass
class Check:
    name: str
    required: float | str | bool
    available: float | str | bool
    passed: bool
    severity: Severity
    stage: Stage
    unit: str = ""
    comment: str = ""

    def __str__(self) -> str:
        mark = "OK  " if self.passed else "FAIL"
        return (
            f"  [{mark}] {self.name}: "
            f"need {self.required}{self.unit}, have {self.available}{self.unit}"
            + (f"\n         {self.comment}" if self.comment else "")
        )


SEVERITY_ORDER = {"blocker": 0, "major": 1, "minor": 2, "pass": 3}


@dataclass
class FitResult:
    program_id: str
    program_label: str
    capacity_as_is: float
    capacity_upgraded: float
    capacity_unit: str
    limited_as_is_by: str
    limited_upgraded_by: str
    checks: list[Check] = field(default_factory=list)
    conditional_on: list[str] = field(default_factory=list)

    @property
    def capacity(self) -> float:
        """Headline capacity assumes services can be upgraded.

        Services have a 5-year remaining life in this shell — they are
        being replaced regardless, so treating today's plant capacity as
        a permanent ceiling would understate every programme. The as-is
        figure is kept alongside so the gap between them is visible: that
        gap IS the services investment the programme requires.
        """
        return self.capacity_upgraded

    @property
    def services_headroom_gap(self) -> float:
        """How much capacity is locked behind a services upgrade."""
        return self.capacity_upgraded - self.capacity_as_is

    @property
    def blockers(self) -> list[Check]:
        return [c for c in self.checks if not c.passed and c.severity == "blocker"]

    @property
    def majors(self) -> list[Check]:
        return [c for c in self.checks if not c.passed and c.severity == "major"]

    @property
    def failures(self) -> list[Check]:
        return sorted(
            (c for c in self.checks if not c.passed),
            key=lambda c: SEVERITY_ORDER[c.severity],
        )

    @property
    def verdict(self) -> str:
        if self.blockers:
            return "NOT VIABLE without shell intervention"
        if self.majors:
            return "VIABLE WITH MAJOR WORK"
        return "VIABLE"

    @property
    def binding_constraint(self) -> str:
        """The thing to talk about first — worst severity wins."""
        if self.failures:
            return self.failures[0].name
        return self.limited_upgraded_by


def _plate_dimensions(area_m2: float, perimeter_m: float) -> tuple[float, float]:
    """Infer a rectangular floor plate from area and perimeter.

    Solves W*D = A and 2(W+D) = P. Where no real solution exists (a plan
    more convoluted than a rectangle), falls back to a square, which is
    the optimistic case for daylight — so the result errs toward viability
    and any failure it reports is real.
    """
    half = perimeter_m / 2.0
    discriminant = half * half - 4.0 * area_m2
    if discriminant < 0:
        side = math.sqrt(area_m2)
        return side, side
    root = math.sqrt(discriminant)
    return (half + root) / 2.0, (half - root) / 2.0


def _interpolate(series: dict, year: int) -> float:
    """Interpolate a year-keyed factor series, holding the ends flat."""
    points = sorted(
        (int(k), float(v)) for k, v in series.items() if k.isdigit()
    )
    if year <= points[0][0]:
        return points[0][1]
    if year >= points[-1][0]:
        return points[-1][1]
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y0 <= year <= y1:
            span = y1 - y0
            return v0 + (v1 - v0) * (year - y0) / span
    return points[-1][1]


def _program_area_per_capita(program: dict) -> tuple[float, str]:
    """Total area demanded per unit of capacity, and what that unit is.

    Sums every space unit's contribution to one 'person' of the programme,
    whether expressed per resident, per group, or as a derived factor.
    """
    per_capita = 0.0
    unit = "persons"
    derived_factors = 0.0

    for space in program["space_units"]:
        if space.get("location") == "outdoor":
            continue

        rule = space.get("count_rule", "")
        if "area_m2_per_child" in space:
            per_capita += space["area_m2_per_child"]
            unit = "children"
        elif "area_m2_per_resident" in space:
            per_capita += space["area_m2_per_resident"]
            unit = "residents"
        elif "area_m2_per_workplace" in space:
            per_capita += space["area_m2_per_workplace"]
            unit = "workplaces"
        elif "area_m2_per_person" in space and rule != "derived_from_hall_capacity":
            per_capita += space["area_m2_per_person"]
        elif rule == "per_resident" and "area_m2" in space:
            per_capita += space["area_m2"]
            unit = "residents"
        elif "area_factor_of_net" in space:
            derived_factors += space["area_factor_of_net"]
        elif rule.startswith("per_group_of") and "area_m2" in space:
            size = _group_size(rule)
            if size:
                per_capita += space["area_m2"] / size
        elif rule.startswith("per_") and "area_m2" in space:
            size = _per_n(rule)
            if size:
                per_capita += space["area_m2"] / size

    # Assembly programmes are density-driven rather than per-capita: the room
    # is a fixed size and the question is how many people it holds, which
    # depends on the configuration chosen on the night.
    if per_capita == 0.0:
        hall = program["space_units"][0]
        if "area_m2_per_person_seated_rows" in hall:
            per_capita = hall["area_m2_per_person_seated_rows"]
            unit = "persons (seated rows)"
        else:
            # Mixed-use density: between banquet (1.6) and standing (0.6).
            per_capita = 1.5
            unit = "persons (mixed use)"

    per_capita *= 1.0 + derived_factors
    return per_capita, unit


def _group_size(rule: str) -> int | None:
    # "per_group_of_8_to_10" -> 8 (conservative), "per_group_of_15" -> 15
    digits = [int(token) for token in rule.replace("_", " ").split() if token.isdigit()]
    return digits[0] if digits else None


def _per_n(rule: str) -> int | None:
    digits = [int(token) for token in rule.replace("_", " ").split() if token.isdigit()]
    return digits[0] if digits else None


def _wet_rooms_required(program: dict, capacity: float) -> int:
    for space in program["space_units"]:
        if space.get("wet_room_required"):
            if space.get("count_rule") == "per_resident":
                return int(math.ceil(capacity))
    for space in program["space_units"]:
        if "wc_per_100_persons" in space:
            return int(math.ceil(capacity / 100.0 * space["wc_per_100_persons"]))
    return 0


def fit_program(program_id: str, storeys: int | None = None) -> FitResult:
    """Test one use programme against the shell."""
    programs = loader.use_programs()
    if program_id not in programs:
        raise KeyError(f"Unknown use programme: {program_id}")

    program = programs[program_id]
    data = loader.shell()
    structure = data["structure"]
    envelope = data["envelope"]
    circulation = data["core_and_circulation"]
    services = data["services"]
    demands = program["shell_demands"]

    storeys = storeys or structure["storeys_above_ground"]
    gfa_per_storey = structure["gross_floor_area_per_storey_m2"]
    total_gfa = gfa_per_storey * storeys
    net_area = total_gfa * NET_TO_GROSS

    checks: list[Check] = []

    # --- ENABLE: does the shell have the physical headroom? --------------
    checks.append(Check(
        name="Floor-to-floor height",
        required=demands["min_floor_to_floor_mm"],
        available=structure["floor_to_floor_mm"],
        passed=structure["floor_to_floor_mm"] >= demands["min_floor_to_floor_mm"],
        severity="blocker",
        stage="ENABLE",
        unit=" mm",
        comment="Cannot be increased. If this fails, the programme is off the table for this shell.",
    ))

    load_required = demands["min_slab_live_load_kn_m2"]
    load_available = structure["live_load_capacity_kn_m2"]
    load_passed = load_available >= load_required
    checks.append(Check(
        name="Slab live load capacity",
        required=load_required,
        available=load_available,
        passed=load_passed,
        severity="blocker" if not load_passed else "pass",
        stage="ENABLE",
        unit=" kN/m²",
        comment=(
            "Strengthening is possible but carries high cost and embodied carbon — "
            "often the point at which reuse stops beating new-build."
            if not load_passed else
            "UNVERIFIED capacity — confirm with a structural engineer before relying on this."
            if not structure.get("live_load_verified") else ""
        ),
    ))

    # --- ADAPT: daylight and plan depth ----------------------------------
    width, depth = _plate_dimensions(gfa_per_storey, envelope["facade_perimeter_m_per_storey"])
    max_depth_mm = (min(width, depth) / 2.0) * 1000.0
    depth_limit = demands["max_plan_depth_from_facade_mm"]
    checks.append(Check(
        name="Plan depth from facade",
        required=depth_limit,
        available=round(max_depth_mm),
        passed=max_depth_mm <= depth_limit,
        severity="minor",
        stage="ADAPT",
        unit=" mm",
        comment=(
            f"Inferred plate ≈ {width:.1f} × {depth:.1f} m. Deep zones can still serve "
            "programme elements that need no daylight — study rooms, stores, focus rooms. "
            "This is a planning problem, not a blocker."
            if max_depth_mm > depth_limit else ""
        ),
    ))

    facade_available = envelope["facade_perimeter_m_per_storey"] * storeys
    facade_required = demands["min_facade_ratio_m_per_m2"] * net_area
    checks.append(Check(
        name="Facade length available",
        required=round(facade_required, 1),
        available=round(facade_available, 1),
        passed=facade_available >= facade_required,
        severity="major",
        stage="ADAPT",
        unit=" m",
        comment=(
            "Every habitable room needs a window. Insufficient facade caps capacity "
            "below what floor area alone suggests."
            if facade_available < facade_required else ""
        ),
    ))

    # --- ADAPT: circulation width ----------------------------------------
    corridor_required = max(
        (s.get("min_clear_width_mm", 0) for s in program["space_units"]
         if "corridor" in s["id"] or "circulation" in s["id"]),
        default=0,
    )
    if corridor_required:
        corridor_available = circulation["corridor_clear_width_mm"]
        checks.append(Check(
            name="Corridor clear width",
            required=corridor_required,
            available=corridor_available,
            passed=corridor_available >= corridor_required,
            severity="major",
            stage="ADAPT",
            unit=" mm",
            comment=(
                "Widening corridors consumes lettable area on every floor — a compounding "
                "cost that early feasibility studies routinely miss."
                if corridor_available < corridor_required else ""
            ),
        ))

    # --- ADAPT: lift ------------------------------------------------------
    if demands.get("lift_required"):
        lift_needed = demands.get("lift_size_mm", [1100, 1400])
        lift_have = circulation["cores"][0]["lift_car_mm"]
        lift_ok = lift_have[0] >= lift_needed[0] and lift_have[1] >= lift_needed[1]
        checks.append(Check(
            name="Lift car size",
            required=f"{lift_needed[0]}×{lift_needed[1]}",
            available=f"{lift_have[0]}×{lift_have[1]}",
            passed=lift_ok,
            severity="blocker" if not lift_ok else "pass",
            stage="IMPLEMENT",
            unit=" mm",
            comment=(
                "A bed-capable lift means enlarging the shaft through every floor — "
                "a structural intervention in the core. Frequently the single item that "
                "decides whether a care programme is affordable."
                if not lift_ok else ""
            ),
        ))

    # --- Capacity, and what limits it ------------------------------------
    # Capacity is computed twice, against two different kinds of limit.
    #
    #   permanent  — geometry and structure. Changing these means touching
    #                the shell, so they are the real ceiling.
    #   services   — plant and stacks. These have 5 years of life left and
    #                are being replaced anyway, so treating them as a
    #                permanent ceiling would understate every programme.
    #
    # The gap between the two IS the services investment the programme needs.
    area_per_capita, capacity_unit = _program_area_per_capita(program)
    capacity_by_area = net_area / area_per_capita if area_per_capita else 0.0
    permanent_limits: list[tuple[float, str]] = [(capacity_by_area, "net floor area")]
    service_limits: list[tuple[float, str]] = []

    if demands["min_facade_ratio_m_per_m2"] > 0:
        facade_per_capita = demands["min_facade_ratio_m_per_m2"] * area_per_capita
        if facade_per_capita > 0:
            permanent_limits.append((facade_available / facade_per_capita, "facade length"))

    # Egress — the constraint that defines assembly use. Widening stairs is
    # a core intervention, so this counts as permanent.
    exit_width_mm = circulation["escape_routes"] * circulation["cores"][0]["stair_clear_width_mm"]
    capacity_by_egress = exit_width_mm * PERSONS_PER_MM_EXIT
    if program["id"] in {"event_venue", "community_hybrid"}:
        permanent_limits.append((capacity_by_egress, "egress capacity"))

    # Ventilation — existing plant against peak occupancy.
    vent_per_person = max(
        (s.get("ventilation_ls_per_person", 0) for s in program["space_units"]),
        default=7,
    )
    vent_area_component = 0.35 * net_area
    vent_spare = services["ahu_capacity_ls"] - vent_area_component
    if vent_per_person > 0:
        service_limits.append(
            (max(0.0, vent_spare) / vent_per_person, "existing ventilation plant")
        )

    # Drainage — existing stacks against wet rooms demanded.
    stack_capacity = sum(s["wet_rooms_served_max"] for s in services["drainage_stacks"])
    needs_wet_rooms = any(s.get("wet_room_required") for s in program["space_units"])
    if needs_wet_rooms:
        service_limits.append((float(stack_capacity), "existing drainage stacks"))

    if needs_wet_rooms:
        wet_required = _wet_rooms_required(program, capacity_by_area)
        checks.append(Check(
            name="Drainage stack capacity",
            required=wet_required,
            available=stack_capacity,
            passed=stack_capacity >= wet_required,
            severity="major",
            stage="IMPLEMENT",
            unit=" wet rooms",
            comment=(
                f"Shortfall of {wet_required - stack_capacity} wet rooms means new stacks "
                "cored through every slab. Check whether the slab is post-tensioned first — "
                "if it is, this may be prohibited outright rather than merely expensive."
                if stack_capacity < wet_required else ""
            ),
        ))

    # --- Site: outdoor area (decides preschool before anything else) -----
    if demands.get("site_outdoor_area_required"):
        outdoor_space = next(
            (s for s in program["space_units"] if s.get("location") == "outdoor"), None
        )
        if outdoor_space:
            per_child = outdoor_space["area_m2_per_child"]
            outdoor_available = data["site"]["outdoor_area_available_m2"]
            outdoor_capacity = outdoor_available / per_child
            permanent_limits.append((outdoor_capacity, "outdoor play area"))
            checks.append(Check(
                name="Outdoor area per child",
                required=round(per_child * capacity_by_area),
                available=outdoor_available,
                passed=outdoor_available >= per_child * capacity_by_area,
                severity="blocker",
                stage="RETAIN",
                unit=" m²",
                comment=(
                    f"Site supports about {outdoor_capacity:.0f} children against "
                    f"{capacity_by_area:.0f} the building could hold. The site, not the "
                    "building, is the constraint — and reprogramming the 40 parking spaces "
                    "is the cheapest available move in this whole project."
                    if outdoor_available < per_child * capacity_by_area else ""
                ),
            ))

    # --- Seated view: a social-value check, not a code check -------------
    if program["id"] in {"elderly_care", "student_housing"}:
        checks.append(Check(
            name="Seated view from facade",
            required="sill ≤ 700",
            available=f"sill {envelope['sill_height_mm']}",
            passed=envelope.get("seated_view_available", False),
            severity="minor",
            stage="EVALUATE",
            unit=" mm",
            comment=(
                "Compliant but poor: wheelchair users and bed-bound residents get no view out. "
                "Costs nothing in the KPI table and a great deal in lived experience — record "
                "it as a social-value conflict rather than letting it vanish."
                if not envelope.get("seated_view_available", False) else ""
            ),
        ))

    capacity_upgraded, limited_upgraded_by = min(permanent_limits, key=lambda item: item[0])
    capacity_as_is, limited_as_is_by = min(
        permanent_limits + service_limits, key=lambda item: item[0]
    )

    conditional = loader.unverified_shell_fields()

    return FitResult(
        program_id=program["id"],
        program_label=program["label_en"],
        capacity_as_is=max(0.0, capacity_as_is),
        capacity_upgraded=max(0.0, capacity_upgraded),
        capacity_unit=capacity_unit,
        limited_as_is_by=limited_as_is_by,
        limited_upgraded_by=limited_upgraded_by,
        checks=checks,
        conditional_on=conditional,
    )


def fit_all() -> list[FitResult]:
    """Test every programme in the standards library against the shell."""
    return [fit_program(pid) for pid in loader.use_programs()]
