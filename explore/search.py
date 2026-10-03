"""Generative search — enumerate the options that are actually worth having.

The naive reading of "test all the options" is intractable: twenty items at a
thousand positions and four rotations is 4000^20 arrangements. Nobody will
ever enumerate that, and you would not want to read the answer.

This module implements the decomposition that makes the question tractable.
Three ideas, in order of how much they buy you:

1. SEPARATE THE LEVELS.
   Shell (fixed) -> partition scheme -> furnishing -> specification. Each
   level's choices are conditionally independent given the level above, so
   a product of enormous spaces becomes a sum of small ones.

2. EXPLOIT INDEPENDENCE ACROSS OBJECTIVES.
   Furnishing geometry drives the social metrics. Component specification
   drives cost and carbon. They barely interact, so N furnishings x M specs
   costs N + M evaluations, not N x M. That single observation takes this
   search from minutes to seconds.

3. CONSTRAINTS FIRST, OBJECTIVES SECOND.
   Feasibility is cheap and scoring is not. Reject the unreachable and the
   unusable before spending anything on evaluating them.

And the thing to do with the result: there is no single best option. Three
objectives give you a trade-off surface. What comes back is the PARETO FRONT
— the set of options that nothing beats on cost, carbon AND experience
simultaneously. Everything else is strictly worse than something and can be
discarded without an argument. The front is where the argument starts.
"""

from __future__ import annotations

import json
import random
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path

from apartment import anneal
from apartment import evaluate as apt_evaluate
from apartment import geometry
from engine import loader

DATA = Path(__file__).resolve().parent / "data"

# Level 4: specification. Not spatial at all — pure catalogue selection over
# the partitions, evaluable without touching the geometry.
SPEC_VARIANTS = {
    "conventional": {
        "label": "Stud and gypsum",
        "partition": "part.stud.gypsum.95",
        "note": "Cheapest to build, 5% recoverable. The default, and the thing "
                "every other option is arguing against.",
    },
    "demountable": {
        "label": "Demountable solid",
        "partition": "part.demount.solid.100",
        "note": "Roughly 1.8x the first cost, 80% recoverable. Wins on the "
                "second fit-out, not the first.",
    },
    "demountable_glass": {
        "label": "Demountable glazed",
        "partition": "part.demount.glass.100",
        "note": "Borrows daylight into deep plan. Relieves the constraint that "
                "blocks residential conversion of office shells.",
    },
    "movable": {
        "label": "Movable acoustic wall",
        "partition": "part.movable.acoustic.wall",
        "note": "Reconfiguration in hours at near-zero carbon, at a high first "
                "cost and an annual maintenance bill.",
    },
}

# Sanitary fixtures are tied to drainage and do not move in this search.
# Pretending they float is the fastest way to generate options that cannot
# be built.
FIXED_CATEGORIES = {"sanitary"}


@dataclass
class Option:
    """One fully specified design, with its three consequences."""

    id: str
    scheme: str
    scheme_label: str
    furnishing: int
    spec: str
    spec_label: str
    use: str
    user_group: str

    capex: float = 0.0
    lcc: float = 0.0
    carbon_upfront: float = 0.0
    carbon_total: float = 0.0
    social: float = 0.0
    social_detail: dict = field(default_factory=dict)

    blockers: int = 0
    majors: int = 0
    feasible: bool = True
    equivalent: int = 1   # arrangements that land on identical objectives
    plan: dict = field(default_factory=dict)

    def objectives(self) -> tuple[float, float, float]:
        """Minimise cost, minimise carbon, minimise (100 - social)."""
        return (self.lcc, self.carbon_total, 100.0 - self.social)


def dominates(a: Option, b: Option) -> bool:
    """True if a is at least as good on every objective and better on one."""
    oa, ob = a.objectives(), b.objectives()
    return all(x <= y for x, y in zip(oa, ob)) and any(x < y for x, y in zip(oa, ob))


def pareto_front(options: list[Option]) -> list[Option]:
    """The options nothing beats on all three objectives at once.

    O(n^2), which is fine at this scale and honest about what it does. For
    thousands of options, sort by one objective first and sweep.
    """
    front: list[Option] = []
    for candidate in options:
        if any(dominates(other, candidate) for other in options if other is not candidate):
            continue
        front.append(candidate)

    # Several arrangements often land on identical objectives. They are one
    # point on the front, not four, and listing them four times makes the
    # trade-off look richer than it is. Keep one and count the rest.
    unique: dict[tuple, Option] = {}
    for option in front:
        key = option.objectives()
        if key not in unique:
            option.equivalent = 1
            unique[key] = option
        else:
            unique[key].equivalent += 1
    return sorted(unique.values(), key=lambda o: o.lcc)


# ---------------------------------------------------------------------------
# Level 3: furnishing variants
# ---------------------------------------------------------------------------


def generate_furnishings(
    base_plan: dict,
    specs: dict,
    count: int = 8,
    seed: int = 0,
    anneal_iterations: int = 2500,
    weights: anneal.Weights | None = None,
) -> list[dict]:
    """Produce distinct furnishing arrangements of the same item list.

    Placement is sequential and order-dependent, so shuffling the order and
    the anchor gives genuinely different packings rather than jitter on one
    arrangement. Items that fail to place are dropped and the arrangement is
    reported short, rather than being forced somewhere invalid.
    """
    def is_fixed(item: dict) -> bool:
        return item.get("fixed") or specs.get(item["type"], {}).get("category") in FIXED_CATEGORIES

    movable = [item for item in base_plan.get("furniture", []) if not is_fixed(item)]
    fixed = [item for item in base_plan.get("furniture", []) if is_fixed(item)]

    # Anchors spread over the actual floor, not the bounding box: an
    # L-shaped flat has corners of its bounding box that are not inside it.
    interior = geometry.interior_polygon(base_plan["shell"])
    x0, y0, x1, y1 = interior.bounds
    corners = [
        (x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy)
        for fx in (0.25, 0.75) for fy in (0.25, 0.75)
    ]

    # Which room does each item start in? Arrangements vary WITHIN a room;
    # which room a thing belongs to is a programme decision, not something
    # a packing heuristic should be allowed to scramble.
    base_geo = geometry.analyse(base_plan, specs, 1200, 900, 800)
    room_map = base_geo.room_map
    room_masks: dict[int, object] = {}
    if room_map is not None:
        for room_index in set(base_geo.item_rooms.values()):
            room_masks[room_index] = room_map == room_index

    rng = random.Random(seed)
    results: list[dict] = []
    seen: set[str] = set()

    # Seed each variant with a greedy pass, then hand it to the annealer.
    # Greedy alone gave about four distinct packings before converging, and
    # none of them were good — only valid.
    for index in range(count):
        plan = deepcopy(base_plan)
        plan["furniture"] = list(fixed)

        order = list(movable)
        if index > 0:
            rng.shuffle(order)
        anchor = corners[index % len(corners)] if index > 0 else None

        for item in order:
            home = base_geo.item_rooms.get(item.get("id", ""))
            region = room_masks.get(home) if home else None
            spot = geometry.find_placement(plan, specs, item["type"], anchor, region)
            if spot is None:
                # Keep it where it was rather than dropping it: a variant
                # that silently loses the bed is not a variant of the brief.
                plan["furniture"].append(dict(item))
                continue
            plan["furniture"].append({**item, **spot})

        if anneal_iterations:
            improved = anneal.arrange(
                plan, specs, weights=weights, variants=1,
                iterations=anneal_iterations, seed=seed + index * 31,
            )
            if improved:
                plan = improved[0]["plan"]

        # Deduplicate: different orders often converge on the same packing.
        key = json.dumps(
            sorted((f["type"], f["x"], f["y"], f["rot"]) for f in plan["furniture"])
        )
        if key in seen:
            continue
        seen.add(key)
        results.append(plan)

    return results


# ---------------------------------------------------------------------------
# Level 4: specification variants
# ---------------------------------------------------------------------------


def apply_spec(plan: dict, spec_id: str) -> dict:
    """Re-specify the non-wet partitions. Geometry is untouched.

    This is the cheap axis and the one that is routinely under-searched:
    it changes cost, carbon and acoustic performance without moving a
    single line on the drawing.
    """
    variant = SPEC_VARIANTS[spec_id]
    out = deepcopy(plan)
    for wall in out.get("walls", []):
        # Wet-room walls stay as built: tiled, sealed, waterproofed
        # construction cannot be made reversible with current products.
        if wall.get("wet"):
            continue
        wall["component"] = variant["partition"]
    return out


# ---------------------------------------------------------------------------
# The search
# ---------------------------------------------------------------------------


def explore(
    schemes: dict[str, dict],
    settings: dict,
    furnishings_per_scheme: int = 6,
    spec_ids: list[str] | None = None,
    keep_infeasible: bool = False,
    anneal_iterations: int = 2500,
    weights: anneal.Weights | None = None,
) -> dict:
    """Search partition schemes x furnishings x specifications.

    Returns every option plus the Pareto front. The saving that makes this
    fast is in here: geometry is computed once per (scheme, furnishing) and
    reused across every specification, because changing a wall's material
    does not move it.
    """
    from apartment.server import specs_for

    user_group = settings.get("user_group", "adult")
    specs = specs_for(user_group)
    groups = loader.user_groups()
    group = groups.get(user_group, groups["adult"])
    clearances = group.get("clearances_mm", {})
    spec_ids = spec_ids or list(SPEC_VARIANTS)

    options: list[Option] = []
    geometry_runs = 0
    evaluations = 0

    for scheme_id, scheme in schemes.items():
        base = {
            "shell": scheme["shell"],
            "walls": scheme["walls"],
            "doors": scheme["doors"],
            "furniture": scheme["furniture"],
        }

        for f_index, furnished in enumerate(generate_furnishings(
            base, specs, count=furnishings_per_scheme,
            anneal_iterations=anneal_iterations, weights=weights,
        )):
            # --- one geometry run, reused across every specification ---
            geo = geometry.analyse(
                furnished, specs,
                turning_circle_mm=clearances.get("turning_circle", 1200),
                passage_width_mm=clearances.get("passage_width_single", 900),
                door_clear_mm=clearances.get("door_clear_width", 800),
            )
            geometry_runs += 1

            for spec_id in spec_ids:
                plan = apply_spec(furnished, spec_id)
                result = apt_evaluate.evaluate(plan, geo, settings)
                evaluations += 1

                blockers = sum(1 for i in result.issues if i["severity"] == "blocker")
                majors = sum(1 for i in result.issues if i["severity"] == "major")
                feasible = blockers == 0

                if not feasible and not keep_infeasible:
                    continue

                options.append(Option(
                    id=f"{scheme_id}.{f_index}.{spec_id}",
                    scheme=scheme_id,
                    scheme_label=scheme.get("label", scheme_id),
                    furnishing=f_index,
                    spec=spec_id,
                    spec_label=SPEC_VARIANTS[spec_id]["label"],
                    use=settings.get("use", ""),
                    user_group=user_group,
                    capex=round(result.money.capex),
                    lcc=round(result.money.lcc),
                    carbon_upfront=round(result.carbon.upfront),
                    carbon_total=round(result.carbon.total),
                    social=round(result.social_mean, 1),
                    social_detail={m.name: round(m.score) for m in result.social},
                    blockers=blockers,
                    majors=majors,
                    feasible=feasible,
                    plan=plan,
                ))

    front = pareto_front(options)

    return {
        "options": options,
        "front": front,
        "stats": {
            "options": len(options),
            "front": len(front),
            "geometry_runs": geometry_runs,
            "evaluations": evaluations,
            "naive_geometry_runs": evaluations,
            "saved_by_separation": evaluations - geometry_runs,
        },
    }


def summarise(front: list[Option]) -> dict:
    """The extremes of the front, which is what a client asks for first."""
    if not front:
        return {}
    return {
        "cheapest": min(front, key=lambda o: o.lcc).id,
        "lowest_carbon": min(front, key=lambda o: o.carbon_total).id,
        "best_experience": max(front, key=lambda o: o.social).id,
        "lcc_range": [min(o.lcc for o in front), max(o.lcc for o in front)],
        "carbon_range": [min(o.carbon_total for o in front), max(o.carbon_total for o in front)],
        "social_range": [min(o.social for o in front), max(o.social for o in front)],
    }
