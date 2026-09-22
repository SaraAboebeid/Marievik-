"""EVALUATE — the third KPI: experience and social value.

Cost and carbon are easy to total and therefore easy to over-weight. The
qualities that decide whether a converted building is good to be in —
daylight, quiet, a view from a seated position, finding your way, whether
staff can work without injuring themselves — have no natural unit, so they
drop out of comparisons unless something forces them in. This module is
that something.

Three rules:

1. **Never report a single blended score alone.** Weighting daylight
   against acoustics is a value judgement, not a measurement. The
   dimensions are always shown separately; the blend is a convenience.

2. **Score per user group.** A sill height that is unremarkable for an
   ambulant adult denies a wheelchair user the view entirely. A single
   "accessibility" score hides exactly the thing worth seeing.

3. **Log conflicts rather than resolving them.** Where two objectives
   genuinely oppose each other — exposed thermal mass against acoustic
   absorption is the recurring one — the model records the trade-off and
   makes someone decide. Silently optimising one away is how models
   launder design decisions into technical results.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import fit, loader


@dataclass
class DimensionScore:
    """One experience dimension, scored 0-100 with its reasoning attached."""

    name: str
    score: float
    basis: str
    affected_groups: list[str] = field(default_factory=list)
    is_hard_requirement: bool = False

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
class Conflict:
    """Two objectives that cannot both be maximised."""

    between: tuple[str, str]
    description: str
    resolution_owner: str = "design team"


@dataclass
class ExperienceProfile:
    program_id: str
    program_label: str
    dimensions: list[DimensionScore] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)

    @property
    def blended(self) -> float:
        """Unweighted mean. Unweighted on purpose — any weighting is a
        value judgement that belongs to the project, not to this file."""
        if not self.dimensions:
            return 0.0
        return sum(d.score for d in self.dimensions) / len(self.dimensions)

    @property
    def weakest(self) -> DimensionScore | None:
        return min(self.dimensions, key=lambda d: d.score) if self.dimensions else None

    @property
    def failing(self) -> list[DimensionScore]:
        return [d for d in self.dimensions if d.score < 40]


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


def _groups_for(program: dict) -> list[dict]:
    groups = loader.user_groups()
    return [groups[g] for g in program.get("primary_user_groups", []) if g in groups]


# ---------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------


def _daylight(program: dict, shell: dict) -> DimensionScore:
    """How much of the habitable programme can reach a window."""
    envelope = shell["envelope"]
    structure = shell["structure"]
    demands = program["shell_demands"]

    width, depth = fit._plate_dimensions(
        structure["gross_floor_area_per_storey_m2"],
        envelope["facade_perimeter_m_per_storey"],
    )
    max_depth_m = min(width, depth) / 2.0
    limit_m = demands["max_plan_depth_from_facade_mm"] / 1000.0

    # Share of the plate within the daylight-usable band.
    usable_band = min(limit_m, max_depth_m)
    share = usable_band / max_depth_m if max_depth_m else 1.0

    daylight_units = [s for s in program["space_units"] if s.get("daylight_required")]
    demand_ratio = len(daylight_units) / max(1, len(program["space_units"]))

    # Penalty grows with how much of the programme needs daylight.
    score = _clamp(100.0 * (share ** (0.5 + demand_ratio)))

    return DimensionScore(
        name="Daylight reach",
        score=score,
        basis=(
            f"Plate ~{width:.0f}x{depth:.0f} m gives {max_depth_m:.1f} m max depth from "
            f"facade against a {limit_m:.1f} m limit; {len(daylight_units)} of "
            f"{len(program['space_units'])} space types need daylight. "
            + (
                "Deep zones can absorb the windowless programme elements."
                if share >= 0.8
                else "A large share of the plate cannot serve daylit rooms — either the "
                "programme sheds habitable area or the shell needs an atrium or light wells, "
                "which is a structural intervention."
            )
        ),
        is_hard_requirement=True,
    )


def _seated_view(program: dict, shell: dict) -> DimensionScore:
    """Can someone seated see out? Scored against each group's eye height."""
    sill_mm = shell["envelope"]["sill_height_mm"]
    groups = _groups_for(program)

    seated = [
        (g["id"], g["anthropometrics_mm"]["seated_eye_height"])
        for g in groups
        if "seated_eye_height" in g.get("anthropometrics_mm", {})
    ]
    if not seated:
        return DimensionScore(
            name="Seated view out",
            score=100.0,
            basis="No predominantly seated user group in this programme.",
        )

    # Eye above sill is not a view. What matters is the downward sightline:
    # how far from the building the ground first becomes visible. A sill only
    # slightly below eye level pushes that distance so far out that the
    # occupant sees sky and rooftops and never the street, the garden or
    # other people — the things a view is actually for.
    #
    # Sightline from eye height E, over a sill at height S, seated distance d
    # back from the window, meets the ground at:  E * d / (E - S)
    VIEWING_DISTANCE_MM = 2000.0
    GOOD_MM, POOR_MM = 4000.0, 12000.0

    distances: list[tuple[str, float]] = []
    for group_id, eye_mm in seated:
        if eye_mm <= sill_mm:
            distances.append((group_id, float("inf")))
            continue
        distances.append(
            (group_id, eye_mm * VIEWING_DISTANCE_MM / (eye_mm - sill_mm))
        )

    scores = [
        _clamp(100.0 * (POOR_MM - d) / (POOR_MM - GOOD_MM)) for _gid, d in distances
    ]
    score = sum(scores) / len(scores)
    denied = [gid for (gid, d), s in zip(distances, scores) if s < 50]
    worst = max(distances, key=lambda item: item[1])

    return DimensionScore(
        name="Seated view out",
        score=score,
        basis=(
            f"Sill {sill_mm} mm. Seated {VIEWING_DISTANCE_MM / 1000:.0f} m back, the "
            f"ground first becomes visible "
            + (
                "never — the sill is above eye level."
                if worst[1] == float("inf")
                else f"{worst[1] / 1000:.1f} m from the facade for {worst[0]}."
            )
            + (
                " Occupants see sky and rooftops, not the street or the garden. "
                "Lowering the sill is a SKIN-layer intervention: high cost, high embodied "
                "carbon, and it registers in the carbon KPI as pure loss because the "
                "benefit has no carbon unit. It shows up only here."
                if score < 60
                else " Adequate downward sightline."
            )
        ),
        affected_groups=denied,
    )


def _acoustics(program: dict) -> DimensionScore:
    """Reverberation demand against what a hard-surfaced reuse typically delivers."""
    groups = _groups_for(program)

    requirements = [
        s["max_reverberation_time_s"]
        for s in program["space_units"]
        if "max_reverberation_time_s" in s
    ]
    group_requirements = [
        g["environment"]["max_reverberation_time_s"]
        for g in groups
        if "max_reverberation_time_s" in g.get("environment", {})
    ]
    all_requirements = requirements + group_requirements
    if not all_requirements:
        return DimensionScore(
            name="Acoustic comfort",
            score=70.0,
            basis="No explicit reverberation requirement recorded for this programme.",
        )

    strictest = min(all_requirements)
    # An untreated concrete-frame plate with a hard floor sits around 1.4 s.
    baseline = 1.4
    # Score reflects how much absorption must be added, not whether it is possible.
    ratio = strictest / baseline
    score = _clamp(30.0 + 70.0 * ratio)

    sensitive = [
        g["id"]
        for g in groups
        if g.get("environment", {}).get("max_reverberation_time_s", 9.9) <= 0.6
    ]

    return DimensionScore(
        name="Acoustic comfort",
        score=score,
        basis=(
            f"Strictest requirement {strictest:.1f} s against ~{baseline:.1f} s untreated. "
            + (
                "Substantial absorber area required. Absorbers are a reversible fast-layer "
                "component, so this costs little in adaptability terms — but it does "
                "compete for the ceiling."
                if ratio < 0.6
                else "Achievable with moderate treatment."
            )
        ),
        affected_groups=sensitive,
        is_hard_requirement=True,
    )


def _accessibility(program: dict, shell: dict) -> DimensionScore:
    """Turning circles and door widths against the groups this programme serves."""
    circulation = shell["core_and_circulation"]
    corridor_mm = circulation["corridor_clear_width_mm"]
    groups = _groups_for(program)

    failures: list[str] = []
    tested = 0
    for group in groups:
        clearances = group.get("clearances_mm", {})
        needed = clearances.get("passage_width_single")
        turning = clearances.get("turning_circle")
        if needed is None and turning is None:
            continue
        tested += 1
        # A corridor must pass a single user AND allow turning at its ends.
        if (needed and corridor_mm < needed) or (turning and corridor_mm < turning):
            failures.append(group["id"])

    if not tested:
        return DimensionScore(
            name="Accessible circulation",
            score=100.0,
            basis="No dimensional clearance requirements recorded.",
        )

    score = _clamp(100.0 * (1.0 - len(failures) / tested))
    return DimensionScore(
        name="Accessible circulation",
        score=score,
        basis=(
            f"Existing corridors {corridor_mm} mm clear. "
            + (
                f"Too narrow for {len(failures)} of {tested} user groups in this "
                "programme. Widening consumes lettable area on every floor."
                if failures
                else f"Adequate for all {tested} user groups tested."
            )
        ),
        affected_groups=failures,
        is_hard_requirement=True,
    )


def _staff_conditions(program: dict, shell: dict) -> DimensionScore:
    """Working conditions — a legal requirement in Sweden, not a nicety."""
    groups = loader.user_groups()
    staff_ids = [g for g in program.get("primary_user_groups", []) if g.startswith("staff")]
    if not staff_ids:
        return DimensionScore(
            name="Staff working conditions",
            score=100.0,
            basis="No staff user group defined for this programme.",
        )

    corridor_mm = shell["core_and_circulation"]["corridor_clear_width_mm"]
    issues: list[str] = []
    for staff_id in staff_ids:
        needed = groups[staff_id]["clearances_mm"].get("passage_width_single", 0)
        if corridor_mm < needed:
            issues.append(f"corridor {corridor_mm} < {needed} mm")

    # Bed-transport corridors are the binding staff requirement in care.
    bed_corridor = max(
        (
            s.get("min_clear_width_mm", 0)
            for s in program["space_units"]
            if "corridor" in s["id"]
        ),
        default=0,
    )
    if bed_corridor and corridor_mm < bed_corridor:
        issues.append(f"bed transport needs {bed_corridor} mm, have {corridor_mm} mm")

    score = _clamp(100.0 - 40.0 * len(issues))
    return DimensionScore(
        name="Staff working conditions",
        score=score,
        basis=(
            "; ".join(issues) + ". Arbetsmiljölagen gives staff legal standing as a user "
            "group — these cannot be value-engineered away."
            if issues
            else "Circulation adequate for staff working requirements."
        ),
        affected_groups=staff_ids,
        is_hard_requirement=True,
    )


def _outdoor_access(program: dict, shell: dict) -> DimensionScore:
    site = shell["site"]
    demands = program["shell_demands"]
    available = site["outdoor_area_available_m2"]

    outdoor_unit = next(
        (s for s in program["space_units"] if s.get("location") == "outdoor"), None
    )
    if outdoor_unit:
        result = fit.fit_program(program["id"])
        needed = outdoor_unit["area_m2_per_child"] * result.capacity_upgraded
        ratio = available / needed if needed else 1.0
        return DimensionScore(
            name="Outdoor access",
            score=_clamp(100.0 * ratio),
            basis=(
                f"{available:,.0f} m² available against {needed:,.0f} m² required. "
                f"The site, not the building, is the constraint. Reprogramming the "
                f"{site['parking_spaces']} parking spaces is the cheapest available move."
            ),
            is_hard_requirement=True,
        )

    if not demands.get("min_facade_ratio_m_per_m2"):
        return DimensionScore(
            name="Outdoor access", score=70.0, basis="No outdoor requirement recorded."
        )

    # For residential and care programmes outdoor access is a quality driver.
    per_occupant = available / max(1.0, fit.fit_program(program["id"]).capacity_upgraded)
    score = _clamp(per_occupant / 10.0 * 100.0)
    return DimensionScore(
        name="Outdoor access",
        score=score,
        basis=(
            f"{per_occupant:.1f} m² of outdoor space per occupant. "
            f"{site['outdoor_area_south_facing_m2']:,.0f} m² of it is south-facing — "
            "the part that actually gets used."
        ),
    )


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------


def _detect_conflicts(program: dict, dimensions: list[DimensionScore]) -> list[Conflict]:
    conflicts: list[Conflict] = []
    by_name = {d.name: d for d in dimensions}

    acoustics = by_name.get("Acoustic comfort")
    if acoustics and acoustics.score < 70:
        conflicts.append(Conflict(
            between=("Acoustic comfort", "Operational carbon"),
            description=(
                "Meeting the reverberation target needs absorber area on the soffit, "
                "which covers the exposed concrete providing free night cooling. Every "
                "m² of absorber buys quiet and costs thermal mass. Suspended baffles are "
                "the usual compromise — partial coverage, most of the slab still exposed — "
                "but the trade-off is real and someone has to own it."
            ),
        ))

    seated = by_name.get("Seated view out")
    if seated and seated.score < 60:
        conflicts.append(Conflict(
            between=("Seated view out", "Embodied carbon"),
            description=(
                "Lowering the sill to give seated users a view means cutting the precast "
                "facade: high embodied carbon, high cost, and it shows up in the carbon KPI "
                "as pure loss because the benefit has no carbon unit. This is precisely the "
                "kind of decision a cost-and-carbon-only model will always get wrong."
            ),
            resolution_owner="client + design team — this is a values decision",
        ))

    access = by_name.get("Accessible circulation")
    if access and access.score < 70:
        conflicts.append(Conflict(
            between=("Accessible circulation", "Lettable area"),
            description=(
                "Widening corridors to serve powered wheelchairs and bed transport takes "
                "area from every floor, reducing capacity and therefore revenue. The "
                "business case and the accessibility case pull in opposite directions; "
                "capacity figures quoted elsewhere assume the narrow corridor."
            ),
        ))

    if program["time_horizon"] == "short":
        conflicts.append(Conflict(
            between=("Short-term use", "Long-term value"),
            description=(
                "A short-horizon programme rewards minimal, reversible intervention — but "
                "the cheapest reversible fit-out often defers the shell work (services, "
                "accessibility, facade) that any long-term use will need anyway. Deferring "
                "is not always wrong; doing it without naming it is."
            ),
        ))

    return conflicts


# ---------------------------------------------------------------------------


def profile(program_id: str) -> ExperienceProfile:
    """Score one use programme on experience and social value."""
    program = loader.use_programs()[program_id]
    shell = loader.shell()

    dimensions = [
        _daylight(program, shell),
        _seated_view(program, shell),
        _acoustics(program),
        _accessibility(program, shell),
        _staff_conditions(program, shell),
        _outdoor_access(program, shell),
    ]

    return ExperienceProfile(
        program_id=program_id,
        program_label=program["label_en"],
        dimensions=dimensions,
        conflicts=_detect_conflicts(program, dimensions),
    )


def profile_all() -> list[ExperienceProfile]:
    return [profile(pid) for pid in loader.use_programs()]
