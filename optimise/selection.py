"""Choosing ten options worth showing, and the one worth recommending.

TEN OPTIONS. Not the ten best by a weighted score: that collapses to ten
near-copies of one idea. Options are ranked into non-dominated fronts (the
first front is everything nothing beats on all five criteria at once), and
the ten are drawn from the best fronts by farthest-point sampling, seeded
with the best option on each criterion. The result spans the trade-off
rather than clustering at one end of it.

REGRET. Any weighting of cost against carbon against comfort is an opinion,
and different stakeholders hold different ones. Rather than pick one, the
recommendation is the option with the smallest MAXIMUM REGRET across a set
of stakeholder weightings: for each weighting, regret is how far an option
falls short of the best option under that weighting; the minimax-regret
option is the one nobody at the table can be very unhappy with. It is
rarely the best for anyone, and that is the point.
"""

from __future__ import annotations

import math

from .pipeline import CRITERIA, Option

STAKEHOLDERS = {
    "balanced": {"label": "Balanced", "w": {"lcc": 0.2, "carbon": 0.2, "comfort": 0.2, "usability": 0.2, "functionality": 0.2}},
    "investor": {"label": "Investor (cost-led)", "w": {"lcc": 0.5, "carbon": 0.1, "comfort": 0.1, "usability": 0.15, "functionality": 0.15}},
    "climate": {"label": "Climate (carbon-led)", "w": {"lcc": 0.1, "carbon": 0.5, "comfort": 0.15, "usability": 0.1, "functionality": 0.15}},
    "resident": {"label": "Resident / user", "w": {"lcc": 0.1, "carbon": 0.1, "comfort": 0.3, "usability": 0.25, "functionality": 0.25}},
    "operator": {"label": "Long-term owner", "w": {"lcc": 0.35, "carbon": 0.15, "comfort": 0.2, "usability": 0.1, "functionality": 0.2}},
}


def _dominates(a: dict, b: dict, keys) -> bool:
    better = False
    for k in keys:
        sa, sb = a[k] * CRITERIA[k]["sense"], b[k] * CRITERIA[k]["sense"]
        if sa < sb:
            return False
        if sa > sb:
            better = True
    return better


def nondominated_ranks(options: list[Option], keys=tuple(CRITERIA)) -> dict[str, int]:
    """Front number for every option (1 = Pareto front). Simple O(n^2) per front."""
    crit = {o.id: o.criteria() for o in options}
    remaining = {o.id for o in options}
    ranks: dict[str, int] = {}
    front = 1
    while remaining:
        current = {
            i for i in remaining
            if not any(_dominates(crit[j], crit[i], keys) for j in remaining if j != i)
        }
        for i in current:
            ranks[i] = front
        remaining -= current
        front += 1
    return ranks


def normalise(options: list[Option]) -> dict[str, dict[str, float]]:
    """0 = worst, 1 = best on each criterion, across the given options."""
    out = {o.id: {} for o in options}
    for k, meta in CRITERIA.items():
        values = [o.criteria()[k] for o in options]
        lo, hi = min(values), max(values)
        span = hi - lo
        for o in options:
            v = o.criteria()[k]
            score = 0.5 if span == 0 else (v - lo) / span
            out[o.id][k] = score if meta["sense"] > 0 else 1.0 - score
    return out


def _signature(o: Option) -> tuple:
    return (o.geometry_key, o.window, o.partition, o.products)


def select_ten(options: list[Option], n: int = 10) -> tuple[list[Option], dict[str, int]]:
    ranks = nondominated_ranks(options)
    pool: list[Option] = []
    for front in sorted(set(ranks.values())):
        pool.extend(o for o in options if ranks[o.id] == front)
        if len(pool) >= 3 * n:
            break
    if len(pool) <= n:
        return sorted(pool, key=lambda o: o.lcc_per_person), ranks

    norm = normalise(pool)

    def distance(a: Option, b: Option) -> float:
        d = math.sqrt(sum((norm[a.id][k] - norm[b.id][k]) ** 2 for k in CRITERIA))
        # Design difference counts too: two options with the same walls and
        # windows are one idea, however their numbers differ.
        design = sum(x != y for x, y in zip(_signature(a), _signature(b))) / 4.0
        return d + 0.6 * design

    chosen: list[Option] = []
    # Seed with the best on each criterion, from the first front first.
    for k in CRITERIA:
        best = max(pool, key=lambda o: (norm[o.id][k], -ranks[o.id]))
        if best not in chosen:
            chosen.append(best)
    while len(chosen) < n:
        candidate = max(
            (o for o in pool if o not in chosen),
            key=lambda o: min(distance(o, c) for c in chosen) - 0.15 * (ranks[o.id] - 1),
        )
        chosen.append(candidate)
    return sorted(chosen[:n], key=lambda o: o.lcc_per_person), ranks


def regret(options: list[Option]) -> dict:
    """Minimax regret across stakeholder weightings, on the given options."""
    norm = normalise(options)
    utilities = {
        s: {o.id: sum(meta["w"][k] * norm[o.id][k] for k in CRITERIA) for o in options}
        for s, meta in STAKEHOLDERS.items()
    }
    best = {s: max(u.values()) for s, u in utilities.items()}
    table = {}
    for o in options:
        per = {s: round(best[s] - utilities[s][o.id], 4) for s in STAKEHOLDERS}
        worst = max(per, key=per.get)
        table[o.id] = {
            "utility": {s: round(utilities[s][o.id], 4) for s in STAKEHOLDERS},
            "regret": per,
            "max_regret": per[worst],
            "worst_for": worst,
        }
    recommended = min(options, key=lambda o: (table[o.id]["max_regret"], o.lcc_per_person))
    favourites = {s: max(options, key=lambda o: utilities[s][o.id]).id for s in STAKEHOLDERS}

    # Plain-units regret: how far each option is from the best on each criterion.
    gaps = {}
    for o in options:
        row = {}
        for k, meta in CRITERIA.items():
            values = [x.criteria()[k] for x in options]
            target = max(values) if meta["sense"] > 0 else min(values)
            row[k] = round(abs(target - o.criteria()[k]), 1)
        gaps[o.id] = row

    return {
        "table": table,
        "recommended": recommended.id,
        "favourites": favourites,
        "criterion_gaps": gaps,
        "normalised": norm,
    }
