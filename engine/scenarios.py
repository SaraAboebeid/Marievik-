"""IMPLEMENT — what it costs to actually change the use.

This module holds the lab's central idea: **flexibility is the cost and
carbon of the transition, not a property of the drawing.**

Transformation accounting, state A -> state B:

  removed   quantity in A, not needed in B
            -> pay demount labour
            -> recovered fraction (recovery_rate) enters the reuse stock
            -> the rest pays C1-C4 disposal carbon
  added     quantity in B, not present in A
            -> drawn from the reuse stock first: install labour + A5 only
            -> shortfall bought new: full material cost + A1-A5 carbon
  retained  quantity present in both -> costs nothing, emits nothing

That last line is the whole argument. The engine's job is to make it
countable.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from . import evaluate, loader
from .evaluate import Bill, CarbonBreakdown, CostBreakdown


@dataclass
class Transformation:
    """One change of use, fully costed."""

    from_label: str
    to_label: str
    year: int
    carbon: CarbonBreakdown = field(default_factory=CarbonBreakdown)
    cost: CostBreakdown = field(default_factory=CostBreakdown)
    retained: Bill = field(default_factory=dict)
    reused: Bill = field(default_factory=dict)
    bought_new: Bill = field(default_factory=dict)
    landfilled: Bill = field(default_factory=dict)
    blockers: list[str] = field(default_factory=list)

    @property
    def transformation_carbon(self) -> float:
        return self.carbon.total_excluding_d

    @property
    def transformation_cost(self) -> float:
        return self.cost.total

    @property
    def circularity(self) -> float:
        """Share of the new fit-out's product-stage carbon avoided by reuse.

        Carbon-weighted, not quantity-weighted. Quantity weighting would
        add square metres of partition to numbers of chairs and call the
        result a percentage, which is meaningless — and it flatters
        strategies that reuse many small light items while buying the
        heavy ones new. This asks the question that matters: of the A1-A3
        carbon this change of use WOULD have cost, how much did we avoid?
        """
        components = loader.catalogue()
        avoided = sum(
            components[cid]["carbon_kgco2e"]["A1A3"] * qty
            for cid, qty in self.reused.items()
        )
        bought = sum(
            components[cid]["carbon_kgco2e"]["A1A3"] * qty
            for cid, qty in self.bought_new.items()
        )
        total = avoided + bought
        return avoided / total if total else 1.0


CHURN_LAYERS = {"space_plan", "stuff"}

# Fraction of the fast layers stripped and rebuilt at a refit where the use
# has NOT changed — tenant churn, redecoration, reorganisation. PLACEHOLDER:
# an indicative figure for commercial office. It matters more than it looks:
# set it to zero and business-as-usual appears to cost nothing at all.
DEFAULT_REFIT_CHURN = 0.6


def transform(
    bill_from: Bill,
    bill_to: Bill,
    year: int,
    from_label: str = "A",
    to_label: str = "B",
    stock: dict[str, float] | None = None,
    churn: float = 0.0,
) -> Transformation:
    """Cost and carbon of moving from one fit-out to another.

    `stock` is the reuse store, and it is MUTATED in place so that a
    timeline can carry recovered components forward from one change of
    use to the next. That carry-forward is the point: a demountable wall
    taken down in 2036 earns its keep by going back up in 2056, and a
    model that empties the store between transitions cannot see that.

    `churn` is the fraction of the fast layers replaced even when the use
    does not change — office refit cycles, redecoration, tenant fit-out.
    Without it, an unchanged use appears to cost nothing over 50 years,
    which flatters business-as-usual against every alternative.
    """
    components = loader.catalogue()
    result = Transformation(from_label=from_label, to_label=to_label, year=year)
    if stock is None:
        stock = defaultdict(float)

    all_ids = set(bill_from) | set(bill_to)

    # Resolve each component into three quantities that always balance:
    #     retained + removed  == what was there
    #     retained + needed   == what the new use wants
    retained_qty: dict[str, float] = {}
    removed_qty: dict[str, float] = {}
    needed_qty: dict[str, float] = {}

    for component_id in all_ids:
        have = bill_from.get(component_id, 0.0)
        want = bill_to.get(component_id, 0.0)
        retained = min(have, want)

        # Churn: fast-layer material torn out and rebuilt even though the
        # new use would have accepted it as-is.
        if churn and retained and components[component_id]["layer"] in CHURN_LAYERS:
            retained *= 1.0 - churn

        retained_qty[component_id] = retained
        removed_qty[component_id] = have - retained
        needed_qty[component_id] = want - retained

    result.retained = {k: v for k, v in retained_qty.items() if v > 0}

    # --- Pass 1: strip out, recovering what survives removal -------------
    for component_id in sorted(all_ids):
        surplus = removed_qty[component_id]
        if surplus <= 0:
            continue

        component = components[component_id]
        carbon = component["carbon_kgco2e"]
        cost = component["cost_sek"]

        result.cost.labour_demount += cost["labour_demount"] * surplus

        recovered = surplus * component["recovery_rate"]
        wasted = surplus - recovered

        if recovered:
            stock[component_id] = stock.get(component_id, 0.0) + recovered
            result.carbon.d_credit += carbon.get("D", 0.0) * recovered
        if wasted:
            result.carbon.c1c4 += carbon["C1C4"] * wasted
            result.landfilled[component_id] = wasted

    # --- Pass 2: build what the new use needs ----------------------------
    # Runs after ALL stripping, so material removed from one part of the
    # floor is available to the rest of the same transformation.
    for component_id in sorted(all_ids):
        shortfall = needed_qty[component_id]
        if shortfall <= 0:
            continue

        component = components[component_id]
        carbon = component["carbon_kgco2e"]
        cost = component["cost_sek"]

        from_stock = min(shortfall, stock.get(component_id, 0.0))
        if from_stock:
            stock[component_id] -= from_stock
            result.reused[component_id] = from_stock
            # Reinstallation only: no product stage, no transport to site.
            result.cost.labour_install += cost["labour_install"] * from_stock
            result.carbon.a5 += carbon["A5"] * from_stock

        new_qty = shortfall - from_stock
        if new_qty:
            result.bought_new[component_id] = new_qty
            result.cost.material += cost["material"] * new_qty
            result.cost.labour_install += cost["labour_install"] * new_qty
            result.carbon.a1a3 += carbon["A1A3"] * new_qty
            result.carbon.a4 += carbon["A4"] * new_qty
            result.carbon.a5 += carbon["A5"] * new_qty

        structural = component.get("structural_demand")
        if structural and new_qty:
            note = structural.get("note", "")
            result.blockers.append(f"{component['name']}: {note}")

    return result


@dataclass
class TimelineResult:
    """A whole sequence of uses, evaluated end to end."""

    timeline_id: str
    label: str
    area_m2: float
    initial: evaluate.Evaluation
    transformations: list[Transformation] = field(default_factory=list)
    operational_carbon: float = 0.0
    operational_cost: float = 0.0
    study_years: int = 50

    @property
    def total_embodied_carbon(self) -> float:
        return self.initial.carbon.upfront + sum(
            t.transformation_carbon for t in self.transformations
        )

    @property
    def total_capital_cost(self) -> float:
        return self.initial.cost.capex + sum(
            t.transformation_cost for t in self.transformations
        )

    @property
    def total_carbon(self) -> float:
        return self.total_embodied_carbon + self.operational_carbon

    @property
    def total_cost(self) -> float:
        return self.total_capital_cost + self.operational_cost

    @property
    def carbon_per_m2(self) -> float:
        return self.total_carbon / self.area_m2 if self.area_m2 else 0.0

    @property
    def cost_per_m2(self) -> float:
        return self.total_cost / self.area_m2 if self.area_m2 else 0.0

    @property
    def adaptability_index(self) -> float:
        """Mean transformation carbon per m² per change of use.

        Lower is better. This is the number the lab exists to minimise:
        it measures what one change of use costs the atmosphere, stripped
        of how many changes a given timeline happens to contain.
        """
        if not self.transformations:
            return 0.0
        mean = sum(t.transformation_carbon for t in self.transformations) / len(
            self.transformations
        )
        return mean / self.area_m2 if self.area_m2 else 0.0

    @property
    def mean_circularity(self) -> float:
        if not self.transformations:
            return 1.0
        return sum(t.circularity for t in self.transformations) / len(self.transformations)

    @property
    def all_blockers(self) -> list[str]:
        seen: list[str] = []
        for transformation in self.transformations:
            for blocker in transformation.blockers:
                if blocker not in seen:
                    seen.append(blocker)
        return seen


def _fitouts() -> dict:
    return loader.load_json("scenarios/fitouts.json")


def swap_bill(bill: dict[str, float], swap: dict[str, str]) -> dict[str, float]:
    """The same bill with components substituted, e.g. a supplier's wall for the generic one."""
    out: dict[str, float] = {}
    for component_id, quantity in bill.items():
        target = swap.get(component_id, component_id)
        out[target] = out.get(target, 0.0) + quantity
    return out


def run_timeline(
    timeline_id: str, area_m2: float | None = None, swap: dict[str, str] | None = None
) -> TimelineResult:
    """Evaluate a full sequence of uses over the study period.

    swap substitutes components in every bill of the timeline ({from_id: to_id}), so one
    supplier product can be tested against the same sequence of uses without editing
    data/scenarios/fitouts.json.
    """
    data = _fitouts()
    timelines = data["timelines"]
    if timeline_id not in timelines:
        raise KeyError(f"Unknown timeline: {timeline_id}")

    timeline = dict(timelines[timeline_id])
    fitouts = data["fitouts"]
    if swap:
        fitouts = {k: dict(f, bill=swap_bill(f["bill"], swap)) if isinstance(f, dict) and "bill" in f else f
                   for k, f in fitouts.items()}
        timeline["label"] = timeline["label"] + " — with " + ", ".join(swap.values())
    area = area_m2 or data["_meta"]["reference_floor_area_m2"]

    period = loader.operational_factors()["study_period"]
    start_year = period["start_year"]
    study_years = period["length_years"]
    end_year = start_year + study_years

    phases = timeline["phases"]
    first = fitouts[phases[0]["fitout"]]

    # Initial fit-out: no replacements here — the timeline's own phase
    # changes supersede like-for-like replacement cycles.
    initial = evaluate.evaluate_bill(
        first["bill"],
        area_m2=area,
        years=study_years,
        label=f"{timeline['label']} — initial fit-out",
        include_replacements=False,
    )

    result = TimelineResult(
        timeline_id=timeline_id,
        label=timeline["label"],
        area_m2=area,
        initial=initial,
        study_years=study_years,
    )

    # Transformations between consecutive phases.
    #
    # One reuse store persists across the whole timeline: a demountable
    # partition taken down in 2036 sits in the store and goes back up in
    # 2056. Resetting it per transition would delete the entire benefit
    # the adaptable strategy is supposed to deliver.
    stock: dict[str, float] = {}

    for previous, current in zip(phases, phases[1:]):
        same_use = previous["fitout"] == current["fitout"]
        churn = current.get("churn", DEFAULT_REFIT_CHURN if same_use else 0.0)
        result.transformations.append(
            transform(
                bill_from=fitouts[previous["fitout"]]["bill"],
                bill_to=fitouts[current["fitout"]]["bill"],
                year=current["year"],
                from_label=previous["fitout"],
                to_label=current["fitout"],
                stock=stock,
                churn=churn,
            )
        )

    # Operational carbon and cost, phase by phase, with a decarbonising grid.
    for index, phase in enumerate(phases):
        phase_start = phase["year"]
        phase_end = phases[index + 1]["year"] if index + 1 < len(phases) else end_year
        duration = max(0, min(phase_end, end_year) - phase_start)
        if duration == 0:
            continue
        use_id = fitouts[phase["fitout"]]["use_id"]
        stub = evaluate.Evaluation(label=phase["fitout"], area_m2=area, years=duration)
        evaluate.add_operational(stub, use_id, area, phase_start, duration)
        result.operational_carbon += stub.operational_carbon_kgco2e
        result.operational_cost += stub.operational_cost_sek

    return result


@dataclass
class BreakEven:
    """How many changes of use before adaptable construction pays back.

    Design for adaptability costs more carbon and money upfront and less
    at every subsequent change. That is a payback question, not a yes/no
    question, and answering it as yes/no is how the whole field gets
    argued past each other. The honest output is a number of changes —
    which the client can then compare against how volatile they actually
    expect demand to be.
    """

    upfront_carbon_premium: float
    upfront_cost_premium: float
    carbon_saved_per_change: float
    cost_saved_per_change: float
    changes_modelled: int

    @property
    def carbon_break_even(self) -> float | None:
        if self.carbon_saved_per_change <= 0:
            return None
        return self.upfront_carbon_premium / self.carbon_saved_per_change

    @property
    def cost_break_even(self) -> float | None:
        if self.cost_saved_per_change <= 0:
            return None
        return self.upfront_cost_premium / self.cost_saved_per_change

    def verdict(self, metric: str = "carbon") -> str:
        break_even = self.carbon_break_even if metric == "carbon" else self.cost_break_even
        premium = (
            self.upfront_carbon_premium if metric == "carbon" else self.upfront_cost_premium
        )
        saved = (
            self.carbon_saved_per_change if metric == "carbon" else self.cost_saved_per_change
        )
        if premium <= 0 and saved >= 0:
            return "Adaptable wins outright — cheaper upfront AND per change."
        if saved <= 0:
            return (
                "Adaptable never pays back on this metric: it costs more upfront "
                "AND more per change. The specification is carrying scope the "
                "conventional option does not — check that before concluding "
                "anything about adaptability itself."
            )
        if break_even is None:
            return "Indeterminate."
        return (
            f"Pays back after {break_even:.1f} changes of use. "
            + (
                f"The {self.changes_modelled} changes modelled here are enough."
                if break_even <= self.changes_modelled
                else f"The {self.changes_modelled} changes modelled here are NOT enough."
            )
        )


def break_even(conventional: TimelineResult, adaptable: TimelineResult) -> BreakEven:
    """Compare two timelines with the same use sequence, different construction."""
    n_conv = len(conventional.transformations) or 1
    n_adapt = len(adaptable.transformations) or 1

    conv_per_change = (
        sum(t.transformation_carbon for t in conventional.transformations) / n_conv
    )
    adapt_per_change = (
        sum(t.transformation_carbon for t in adaptable.transformations) / n_adapt
    )
    conv_cost_per_change = (
        sum(t.transformation_cost for t in conventional.transformations) / n_conv
    )
    adapt_cost_per_change = (
        sum(t.transformation_cost for t in adaptable.transformations) / n_adapt
    )

    return BreakEven(
        upfront_carbon_premium=adaptable.initial.carbon.upfront
        - conventional.initial.carbon.upfront,
        upfront_cost_premium=adaptable.initial.cost.capex - conventional.initial.cost.capex,
        carbon_saved_per_change=conv_per_change - adapt_per_change,
        cost_saved_per_change=conv_cost_per_change - adapt_cost_per_change,
        changes_modelled=n_adapt,
    )


def compare_timelines(timeline_ids: list[str] | None = None) -> list[TimelineResult]:
    data = _fitouts()
    ids = timeline_ids or [k for k in data["timelines"] if not k.startswith("_")]
    return [run_timeline(tid) for tid in ids]
