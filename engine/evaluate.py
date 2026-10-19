"""EVALUATE — cost and carbon for a given fit-out over a study period.

Two rules govern this module, and both are deliberate:

1. Module D (reuse/recycling credit) is NEVER netted into the headline.
   EN 15978 keeps it outside the system boundary for good reason: it is a
   benefit to a future project, not a reduction of this one's emissions.
   Netting it is the most common way circular-design claims become
   unfalsifiable.

2. Carbon is not discounted; money is. A tonne of CO2e in 2070 is the same
   tonne. This is a stated position, not an oversight — see
   data/factors/operational.json.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import loader

Bill = dict[str, float]  # component_id -> quantity in the component's declared unit


@dataclass
class CarbonBreakdown:
    """Embodied carbon by LCA module, kg CO2e."""

    a1a3: float = 0.0
    a4: float = 0.0
    a5: float = 0.0
    b4: float = 0.0
    c1c4: float = 0.0
    d_credit: float = 0.0  # reported separately, negative by convention

    @property
    def total_excluding_d(self) -> float:
        """The headline figure. What this project actually puts in the air."""
        return self.a1a3 + self.a4 + self.a5 + self.b4 + self.c1c4

    @property
    def upfront(self) -> float:
        """A1–A5: emitted before the building is occupied, and unrecoverable."""
        return self.a1a3 + self.a4 + self.a5

    def __add__(self, other: "CarbonBreakdown") -> "CarbonBreakdown":
        return CarbonBreakdown(
            a1a3=self.a1a3 + other.a1a3,
            a4=self.a4 + other.a4,
            a5=self.a5 + other.a5,
            b4=self.b4 + other.b4,
            c1c4=self.c1c4 + other.c1c4,
            d_credit=self.d_credit + other.d_credit,
        )


@dataclass
class CostBreakdown:
    """Cost in SEK, real terms."""

    material: float = 0.0
    labour_install: float = 0.0
    labour_demount: float = 0.0
    replacement: float = 0.0
    maintenance: float = 0.0

    @property
    def capex(self) -> float:
        return self.material + self.labour_install

    @property
    def total(self) -> float:
        return self.capex + self.labour_demount + self.replacement + self.maintenance

    def __add__(self, other: "CostBreakdown") -> "CostBreakdown":
        return CostBreakdown(
            material=self.material + other.material,
            labour_install=self.labour_install + other.labour_install,
            labour_demount=self.labour_demount + other.labour_demount,
            replacement=self.replacement + other.replacement,
            maintenance=self.maintenance + other.maintenance,
        )


@dataclass
class Evaluation:
    label: str
    area_m2: float
    carbon: CarbonBreakdown = field(default_factory=CarbonBreakdown)
    cost: CostBreakdown = field(default_factory=CostBreakdown)
    operational_carbon_kgco2e: float = 0.0
    operational_cost_sek: float = 0.0
    years: int = 0
    placeholder_share: float = 1.0
    notes: list[str] = field(default_factory=list)

    @property
    def total_carbon(self) -> float:
        return self.carbon.total_excluding_d + self.operational_carbon_kgco2e

    @property
    def total_cost(self) -> float:
        return self.cost.total + self.operational_cost_sek

    @property
    def carbon_per_m2(self) -> float:
        return self.total_carbon / self.area_m2 if self.area_m2 else 0.0

    @property
    def cost_per_m2(self) -> float:
        return self.total_cost / self.area_m2 if self.area_m2 else 0.0

    @property
    def embodied_share(self) -> float:
        """How much of the total is material rather than energy.

        Above ~50% means material choices dominate the outcome and
        chasing further operational savings is the wrong lever.
        """
        return self.carbon.total_excluding_d / self.total_carbon if self.total_carbon else 0.0


def _interpolate_year(series: dict, year: int) -> float:
    points = sorted((int(k), float(v)) for k, v in series.items() if str(k).isdigit())
    if not points:
        return 0.0
    if year <= points[0][0]:
        return points[0][1]
    if year >= points[-1][0]:
        return points[-1][1]
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y0 <= year <= y1:
            return v0 + (v1 - v0) * (year - y0) / (y1 - y0)
    return points[-1][1]


def evaluate_bill(
    bill: Bill,
    area_m2: float,
    years: int = 50,
    label: str = "fit-out",
    include_replacements: bool = True,
) -> Evaluation:
    """Cost and embodied carbon of installing and maintaining a bill of quantities."""
    components = loader.catalogue()
    result = Evaluation(label=label, area_m2=area_m2, years=years)

    placeholder_count = 0
    total_count = 0

    for component_id, quantity in bill.items():
        if component_id not in components:
            raise KeyError(f"Component not in catalogue: {component_id}")
        component = components[component_id]
        carbon = component["carbon_kgco2e"]
        cost = component["cost_sek"]

        total_count += 2
        if loader.is_placeholder(carbon.get("provenance", "")):
            placeholder_count += 1
        if loader.is_placeholder(cost.get("provenance", "")):
            placeholder_count += 1

        result.carbon.a1a3 += carbon["A1A3"] * quantity
        result.carbon.a4 += carbon["A4"] * quantity
        result.carbon.a5 += carbon["A5"] * quantity
        result.carbon.c1c4 += carbon["C1C4"] * quantity
        result.carbon.d_credit += carbon.get("D", 0.0) * quantity

        result.cost.material += cost["material"] * quantity
        result.cost.labour_install += cost["labour_install"] * quantity
        result.cost.maintenance += cost.get("maintenance_sek_per_year", 0.0) * quantity * years

        if include_replacements:
            service_life = component["service_life_years"]
            replacements = max(0, math.ceil(years / service_life) - 1)
            if replacements:
                cycle_carbon = (
                    carbon["A1A3"] + carbon["A4"] + carbon["A5"] + carbon["C1C4"]
                ) * quantity
                result.carbon.b4 += cycle_carbon * replacements
                result.cost.replacement += (
                    cost["material"] + cost["labour_install"] + cost["labour_demount"]
                ) * quantity * replacements

    result.placeholder_share = placeholder_count / total_count if total_count else 1.0

    short_life = [
        components[cid]["name"]
        for cid in bill
        if components[cid]["service_life_years"] < years / 3
    ]
    if short_life:
        result.notes.append(
            f"{len(short_life)} component type(s) will be replaced 3+ times over "
            f"{years} years. Replacement carbon (B4) is {result.carbon.b4:,.0f} kg CO2e — "
            f"{result.carbon.b4 / result.carbon.total_excluding_d:.0%} of embodied total. "
            "Service life, not unit carbon, is doing the work here."
        )

    return result


def add_operational(
    evaluation: Evaluation,
    use_id: str,
    area_m2: float,
    start_year: int,
    years: int,
) -> Evaluation:
    """Add module B6 — operational energy carbon and cost, year by year.

    Year-by-year integration matters: with a decarbonising grid, a flat
    average overstates operational carbon by a wide margin and quietly
    biases every comparison toward energy retrofit over material restraint.
    """
    factors = loader.operational_factors()
    intensities = factors["energy_use_intensity_kwh_m2_yr"]
    if use_id not in intensities:
        evaluation.notes.append(f"No energy intensity data for use '{use_id}' — B6 omitted.")
        return evaluation

    eui = intensities[use_id]
    carbon_factors = factors["carbon_intensity_kgco2e_per_kwh"]
    price_factors = factors["energy_price_sek_per_kwh"]

    heating_kwh = eui["heating"] * area_m2
    cooling_kwh = eui["cooling"] * area_m2
    electricity_kwh = eui["electricity"] * area_m2

    total_carbon = 0.0
    total_cost = 0.0

    for offset in range(years):
        year = start_year + offset
        total_carbon += (
            heating_kwh * _interpolate_year(carbon_factors["district_heating_stockholm"], year)
            + cooling_kwh * _interpolate_year(carbon_factors["district_cooling_stockholm"], year)
            + electricity_kwh * _interpolate_year(carbon_factors["electricity_se"], year)
        )
        total_cost += (
            heating_kwh * _interpolate_year(price_factors["district_heating"], year)
            + cooling_kwh * _interpolate_year(price_factors["district_cooling"], year)
            + electricity_kwh * _interpolate_year(price_factors["electricity"], year)
        )

    evaluation.operational_carbon_kgco2e += total_carbon
    evaluation.operational_cost_sek += total_cost

    if evaluation.embodied_share > 0.5:
        evaluation.notes.append(
            f"Embodied carbon is {evaluation.embodied_share:.0%} of the {years}-year total. "
            "Material and transformation decisions dominate this result — further operational "
            "efficiency measures have limited headroom, and any that require heavy new "
            "material will make the total worse, not better."
        )

    return evaluation
