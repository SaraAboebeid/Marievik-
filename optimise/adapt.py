"""Regret across futures: which fit-out today copes best with a change of use.

The within-use recommendation answers "which option is best for students?".
This answers the question an owner of a 50-year building actually faces:
"if I fit out for students now and it becomes a family flat in year 15,
which of today's options will I regret least?"

For a start option `a` and a future scenario (use B from year T):

    outcome(a, scenario) = min over B's options b of
        running(a, 0..T)  +  change(a -> b) at year T  +  running(b, T..50)

where `change` follows the transformation accounting of engine/scenarios.py,
done at apartment level:

    walls       same line, same product        retained, free
                removed                         demount labour; the recovered
                                                share (recovery_rate) goes to
                                                a reuse stock, the rest pays C1-C4
                added                           from the stock first (install + A5)
                                                then new (full cost, A1-A5)
    doors       counted the same way, not reused
    furniture   retained by type when the new use wants it; otherwise new
    windows     upgrades are kept; a later use that wants better glazing pays
                for the difference only

Money and carbon are combined at a shadow carbon price so one regret number
can be minimised, and both are also reported separately. Money is
discounted, carbon is not, as everywhere else in the lab.

The approximation, stated: running costs over part of the period are taken
pro rata from each option's 50-year figures (annuitised for money, linear
for carbon). Replacements are lumpy in reality; the error is small next to
the transformation itself and is the same for every option compared.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from apartment import evaluate as apt_evaluate
from engine import loader

from .pipeline import Option
from .schemes import WINDOWS

DEFAULT_CARBON_PRICE = 1.5   # SEK per kg CO2e. PLACEHOLDER shadow price.
YEARS = 50
WINDOW_RANK = {"existing": 0, "upgraded": 1, "lowered": 2}


def _annuity(rate: float, years: float) -> float:
    return years if rate == 0 else (1 - (1 + rate) ** -years) / rate


def _walls(option: Option) -> list[dict]:
    return [w for w in option.plan["walls"] if not w.get("wet")]


def _wall_key(w: dict) -> tuple:
    pts = sorted([(round(w["x1"], -1), round(w["y1"], -1)), (round(w["x2"], -1), round(w["y2"], -1))])
    return tuple(pts)


def _wall_area(w: dict, ceiling_m: float) -> float:
    return ((w["x2"] - w["x1"]) ** 2 + (w["y2"] - w["y1"]) ** 2) ** 0.5 / 1000.0 * ceiling_m


def change(a: Option, b: Option) -> dict:
    """Cost (SEK, undiscounted, at the year of change) and carbon of a -> b."""
    catalogue = loader.catalogue()
    ceiling_m = a.plan["shell"].get("ceiling_mm", 2500) / 1000.0
    cost = carbon = 0.0
    lines = defaultdict(float)

    walls_a = {_wall_key(w): w for w in _walls(a)}
    walls_b = {_wall_key(w): w for w in _walls(b)}
    stock: dict[str, float] = defaultdict(float)
    retained_m2 = removed_m2 = reused_m2 = new_m2 = 0.0

    # Strip out what the new layout does not keep.
    for key, w in walls_a.items():
        keep = walls_b.get(key)
        if keep and keep.get("component") == w.get("component"):
            retained_m2 += _wall_area(w, ceiling_m)
            continue
        comp = catalogue[w["component"]]
        area = _wall_area(w, ceiling_m)
        removed_m2 += area
        cost += comp["cost_sek"]["labour_demount"] * area
        lines["Demounting walls"] += comp["cost_sek"]["labour_demount"] * area
        recovered = area * comp["recovery_rate"]
        stock[w["component"]] += recovered
        carbon += comp["carbon_kgco2e"]["C1C4"] * (area - recovered)

    # Build what is new, from the stock first.
    for key, w in walls_b.items():
        keep = walls_a.get(key)
        if keep and keep.get("component") == w.get("component"):
            continue
        comp = catalogue[w["component"]]
        area = _wall_area(w, ceiling_m)
        from_stock = min(area, stock[w["component"]])
        stock[w["component"]] -= from_stock
        fresh = area - from_stock
        reused_m2 += from_stock
        new_m2 += fresh
        c = comp["cost_sek"]
        k = comp["carbon_kgco2e"]
        cost += c["labour_install"] * from_stock + (c["material"] + c["labour_install"]) * fresh
        lines["New and reused walls"] += c["labour_install"] * from_stock + (c["material"] + c["labour_install"]) * fresh
        carbon += k["A5"] * from_stock + (k["A1A3"] + k["A4"] + k["A5"]) * fresh
    # Whatever stays in stock unused is landfilled at the end of the job.
    for cid, left in stock.items():
        carbon += catalogue[cid]["carbon_kgco2e"]["C1C4"] * left

    # Doors: a door on a wall that is kept is kept; every other door is new.
    b_walls_by_id = {w["id"]: w for w in b.plan["walls"]}
    new_doors = 0
    for door in b.plan["doors"]:
        wall = b_walls_by_id.get(door["wall_id"])
        if not wall or wall.get("wet"):
            continue
        kept_wall = walls_a.get(_wall_key(wall))
        if kept_wall and kept_wall.get("component") == wall.get("component"):
            continue
        new_doors += 1
    cost += apt_evaluate.DOOR_COST_SEK * new_doors
    carbon += apt_evaluate.DOOR_CARBON_KG * new_doors
    lines["Doors"] += apt_evaluate.DOOR_COST_SEK * new_doors

    # Furniture: keep what the new use wants, buy the rest.
    have = Counter(i["type"] for i in a.plan["furniture"])
    want_items = b.plan["furniture"]
    kept = 0
    bought = 0
    for item in want_items:
        if have[item["type"]] > 0:
            have[item["type"]] -= 1
            kept += 1
            continue
        spec = apt_evaluate.item_spec(item)
        if not spec:
            continue
        bought += 1
        cost += spec["cost_sek"]
        carbon += spec["carbon_kgco2e"]
        lines["Furniture bought"] += spec["cost_sek"]

    # Windows: an upgrade already made is kept; a better one is paid for.
    window_cost = window_carbon = 0.0
    if WINDOW_RANK[b.window] > WINDOW_RANK[a.window]:
        works_a = {w["component"]: w["quantity"] for w in a.plan.get("works", [])}
        for work in b.plan.get("works", []):
            qty = work["quantity"] - works_a.get(work["component"], 0.0)
            if qty <= 0:
                continue
            comp = catalogue[work["component"]]
            c, k = comp["cost_sek"], comp["carbon_kgco2e"]
            window_cost += (c["material"] + c["labour_install"]) * qty
            window_carbon += (k["A1A3"] + k["A4"] + k["A5"]) * qty
    cost += window_cost
    carbon += window_carbon
    lines["Windows"] += window_cost

    return {
        "cost": cost, "carbon": carbon,
        "walls_retained_m2": round(retained_m2, 1), "walls_removed_m2": round(removed_m2, 1),
        "walls_reused_m2": round(reused_m2, 1), "walls_new_m2": round(new_m2, 1),
        "furniture_kept": kept, "furniture_bought": bought, "new_doors": new_doors,
        "lines": {k: round(v) for k, v in lines.items() if v},
    }


def _running(o: Option, start: float, end: float, rate: float) -> tuple[float, float]:
    """Money (discounted to year 0) and carbon of operating o between two years."""
    m = o.money
    af_total = _annuity(rate, YEARS)
    annual = (m["opex_npv"] + m["replacement_npv"]) / af_total
    money = annual * (_annuity(rate, end) - _annuity(rate, start))
    c = o.carbon
    per_year = (c["b4"] + c["b6"]) / YEARS
    carbon = per_year * (end - start)
    return money, carbon


def outcome(a: Option, b: Option | None, year: int, rate: float, price: float) -> dict:
    """Life outcome of starting with a and, if b is given, changing to it at `year`."""
    m, c = a.money, a.carbon
    if b is None:
        money = m["lcc"]
        carbon = c["total"]
        return {"money": money, "carbon": carbon, "combined": money + price * carbon,
                "via": None, "change": None}
    up_money = m["capex"]
    up_carbon = c["a1a3"] + c["a4"] + c["a5"]
    run_a = _running(a, 0, year, rate)
    ch = change(a, b)
    disc = (1 + rate) ** -year
    run_b = _running(b, year, YEARS, rate)
    residual = b.money["residual_npv"]
    money = up_money + run_a[0] + ch["cost"] * disc + run_b[0] - residual
    carbon = up_carbon + run_a[1] + ch["carbon"] + run_b[1] + b.carbon["c1c4"]
    return {"money": money, "carbon": carbon, "combined": money + price * carbon,
            "via": b.id, "change": ch}


# Money and carbon alone reward the cheapest option, whatever it is like to
# live in. Only options that are acceptable to use compete on robustness.
DEFAULT_FLOOR = {"comfort": 80.0, "usability": 75.0, "functionality": 80.0}


def acceptable(options: list[Option], floor: dict[str, float]) -> tuple[list[Option], bool]:
    ok = [o for o in options if all(o.criteria()[k] >= v for k, v in floor.items())]
    return (ok, True) if ok else (list(options), False)


def cross_use(selected: dict[str, list[Option]], years=(10, 20), price: float = DEFAULT_CARBON_PRICE,
              floor: dict[str, float] | None = None) -> dict:
    """For each start use: regret of each of its options across future-use scenarios."""
    rate = loader.operational_factors()["study_period"]["discount_rate_real"]
    floor = DEFAULT_FLOOR if floor is None else floor
    uses = list(selected)
    out = {"carbon_price_sek_per_kg": price, "years": list(years), "floor": floor,
           "floor_met": {}, "by_start_use": {}}
    pools = {}
    for use in uses:
        pools[use], met = acceptable(selected[use], floor)
        out["floor_met"][use] = met

    for start in uses:
        starts = pools[start]
        scenarios = [{"id": f"{start}:stay", "label": f"Stays {start.replace('_', ' ')}", "to": None, "year": None}]
        for target in uses:
            if target == start:
                continue
            for year in years:
                scenarios.append({"id": f"{target}@{year}", "label": f"Becomes {target.replace('_', ' ')} in year {year}",
                                  "to": target, "year": year})

        matrix = {}
        for a in starts:
            row = {}
            for s in scenarios:
                if s["to"] is None:
                    row[s["id"]] = outcome(a, None, 0, rate, price)
                else:
                    # The future use is converted into an acceptable option too.
                    best = min((outcome(a, b, s["year"], rate, price) for b in pools[s["to"]]),
                               key=lambda r: r["combined"])
                    row[s["id"]] = best
            matrix[a.id] = row

        best_per_scenario = {s["id"]: min(matrix[a.id][s["id"]]["combined"] for a in starts) for s in scenarios}
        table = {}
        for a in starts:
            reg = {s["id"]: matrix[a.id][s["id"]]["combined"] - best_per_scenario[s["id"]] for s in scenarios}
            worst = max(reg, key=reg.get)
            changes = [matrix[a.id][s["id"]]["change"] for s in scenarios if matrix[a.id][s["id"]]["change"]]
            table[a.id] = {
                "regret": {k: round(v) for k, v in reg.items()},
                "max_regret": round(reg[worst]),
                "worst_scenario": worst,
                "mean_change_cost": round(sum(c["cost"] for c in changes) / len(changes)) if changes else 0,
                "mean_change_carbon": round(sum(c["carbon"] for c in changes) / len(changes)) if changes else 0,
                "mean_walls_retained_m2": round(sum(c["walls_retained_m2"] for c in changes) / len(changes), 1) if changes else 0,
            }
        robust = min(starts, key=lambda a: table[a.id]["max_regret"])

        # The same question for one layout at a time: given these rooms and
        # this glazing, which wall system would you least regret?
        by_layout: dict[str, list[Option]] = defaultdict(list)
        for a in starts:
            by_layout[f"{a.geometry_key}|{a.window}|{a.products}"].append(a)
        wall_choice = {}
        for key, group in by_layout.items():
            if len(group) < 2:
                continue
            best = {s["id"]: min(matrix[a.id][s["id"]]["combined"] for a in group) for s in scenarios}
            regrets = {a.id: max(matrix[a.id][s["id"]]["combined"] - best[s["id"]] for s in scenarios)
                       for a in group}
            pick = min(group, key=lambda a: regrets[a.id])
            wall_choice[key] = {"pick": pick.id, "partition": pick.partition,
                                "max_regret": {a.partition: round(regrets[a.id]) for a in group}}

        out["by_start_use"][start] = {
            "scenarios": scenarios,
            "table": table,
            "robust": robust.id,
            "wall_choice": wall_choice,
            "outcomes": {
                a.id: {s: {"money": round(r["money"]), "carbon": round(r["carbon"]),
                           "combined": round(r["combined"]), "via": r["via"],
                           "change": ({k: v for k, v in r["change"].items() if k != "lines"} | {"lines": r["change"]["lines"]})
                           if r["change"] else None}
                       for s, r in matrix[a.id].items()}
                for a in starts
            },
        }
    return out
