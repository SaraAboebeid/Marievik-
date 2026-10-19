"""CAVF KPIs per stakeholder profile, with their equations and the data behind them.

Definitions follow the CAVF KPI calculation reference (KPI equations and definitions cheat sheet).
Each KPI value carries a status, shown as a tag in the explorer:

  computed      from this engine run (layout, quantities, catalogue prices and carbon)
  partial       computed, but part of the system boundary is not modelled yet (stated in `note`)
  placeholder   illustrative, built from data/kpi/placeholders.json until the method and inputs exist

Money is SEK (the cheat sheet writes EUR; the formulas are currency-neutral).
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDERS = ROOT / "data" / "kpi" / "placeholders.json"
CATALOGUE = ROOT / "data" / "components" / "catalogue.json"
OPERATIONAL = ROOT / "data" / "factors" / "operational.json"

CHEAT = "CAVF KPI cheat sheet"
PENDING = "Definition pending (not in the CAVF cheat sheet yet)"

# ---------------------------------------------------------------------------- definitions
# id: name, group, scale, formula, definitions, meaning (and unit), status (method status), notes, source
KPIS: dict[str, dict] = {
    "transformation_cost": dict(
        name="Transformation cost", group="Finance", scale="Meso → Macro",
        formula="C_transform = C_design + C_materials + C_labour + C_permits + C_decommission + C_disruption + C_contingency",
        definitions="Define included cost categories; C_disruption captures financial loss only when not otherwise counted.",
        meaning="Total cost of executing a transformation (SEK); can be CAPEX-only or full economic cost — label explicitly.",
        status="Project cost aggregation.",
        notes="Avoid counting rental losses both in disruption costs and reduced NOI.", source=CHEAT,
        explorer="CAPEX-only: C_materials + C_labour from the catalogue for every new element. Design, permits, "
                 "decommissioning, disruption and contingency are not included yet."),
    "incremental_npv": dict(
        name="Incremental NPV", group="Finance", scale="Macro",
        formula="ΔNPV(a,s) = NPV(a,s) − NPV(reference,s)",
        definitions="NPV = discounted incremental owner cash flows, including investment and eventual sale proceeds.",
        meaning="Additional value created by an alternative relative to the same-scenario counterfactual (SEK PV).",
        status="Established NPV comparison.",
        notes="ΔNPV > 0 means the alternative outperforms its counterfactual under stated assumptions.", source=CHEAT,
        explorer="Placeholder: npv_uplift_share × asset value (market_value_sek_per_m2 × GFA)."),
    "break_even_premium": dict(
        name="Break-even premium", group="Finance", scale="Macro",
        formula="P_BE = PV(benefits of flexibility) − PV(incremental future costs of flexibility)",
        definitions="Premium = additional upfront capital cost of adaptable design versus conventional alternative; benefits "
                    "include attributable reduced adaptation costs and/or changed income.",
        meaning="Maximum justified additional upfront investment in flexibility (SEK PV).",
        status="Proposed CAVF application of incremental NPV.",
        notes="At break-even ΔNPV = 0; do not also add benefits already capitalized into terminal value.", source=CHEAT,
        explorer="Placeholder: flex_premium_sek_per_m2 × GFA."),
    "option_value": dict(
        name="Option value", group="Finance", scale="Macro",
        formula="OV = V(with flexible choice) − V(without choice) − incremental flexibility investment not already included",
        definitions="Compare otherwise equivalent models; a formal approach values contingent decisions using scenario trees "
                    "or dynamic programming.",
        meaning="Incremental value of being able to defer, expand, switch use, or abandon (SEK PV).",
        status="Model-dependent; no universal one-line real-option formula.",
        notes="Only report a separate option value where the option is identifiable, exercise is feasible, timing and "
              "triggers are modelled, uncertainty matters, and benefits are not already in DCF.", source=CHEAT,
        explorer="Placeholder: option_value_share × asset value."),
    "value_retention": dict(
        name="Value retention", group="Finance", scale="Macro",
        formula="VRR(a,s,t) = 100 × V(a,s,t) / V(a,S0,t)",
        definitions="V(a,s,t) = market/DCF value of alternative a in scenario s at year t; V(a,S0,t) = its stable-case value "
                    "at the same year.",
        meaning="Share of the stable-case property value retained under a scenario (%).",
        status="Proposed CAVF operational definition.",
        notes="Can exceed 100 % (upside). Distinguish from retained material value. When V(a,s,t) ≤ V(a,S0,t), "
              "VRR = 100 − DL%.", source=CHEAT,
        explorer="Placeholder: the adaptable alternative under S2 adverse at year 10 from the cheat sheet's worked example."),
    "downside_loss": dict(
        name="Downside loss", group="Finance", scale="Macro",
        formula="DL(a,s,t) = max(0, V(a,S0,t) − V(a,s,t));  DL% = 100 × DL / V(a,S0,t)",
        definitions="Reference and alternative values at the same valuation date and with an explicitly stated counterfactual.",
        meaning="Loss in a specified adverse scenario (SEK and %).",
        status="Scenario-based proposed CAVF operational definition.",
        notes="If values are NPV rather than market values, label this 'NPV downside'. For S0, DL = 0 by construction; an "
              "upside (S3) is reported separately, never as negative loss.", source=CHEAT,
        explorer="Placeholder: downside_loss_s2_y10 × asset value (S2 adverse, year 10)."),
    "crrem_year": dict(
        name="CRREM misalignment year", group="Finance", scale="Macro; Meso",
        formula="t_misalign = min{ t : I_building,t > I_CRREM,path,t }",
        definitions="I_building,t = projected energy or GHG intensity; I_CRREM,path,t = selected CRREM pathway intensity in "
                    "the matching metric and units.",
        meaning="First projected year in which the building exceeds its decarbonisation pathway (year).",
        status="Framework-specific pathway comparison; simplified expression.",
        notes="Specify asset type, geography, version and pathway metric; use the official CRREM tool for reporting.",
        source=CHEAT, explorer="Placeholder: crrem_misalignment_year."),
    "carbon_payback": dict(
        name="Carbon payback", group="Environment", scale="Meso → Macro",
        formula="t_payback = min{ t : Σ_{τ=1..t} carbon_savings_τ ≥ additional_upfront_GWP }",
        definitions="Annual savings are scenario- and alternative-specific; extra upfront GWP is the carbon premium over the "
                    "reference.",
        meaning="Earliest year when cumulative operational/future carbon savings offset extra upfront emissions (years).",
        status="Common payback construction; depends on carbon accounting boundaries.",
        notes="Not defined if cumulative savings never reach the premium. Use consistent emission factors and boundaries.",
        source=CHEAT, explorer="Placeholder: carbon_payback_years."),
    "upfront_gwp": dict(
        name="Upfront GWP", group="Environment", scale="Meso; Micro",
        formula="GWP_upfront = GWP_A1–A3 + GWP_A4 + GWP_A5",
        definitions="Life-cycle modules: product, transport and construction installation.",
        meaning="Embodied climate impact before use (kg CO₂e or kg CO₂e/m²).",
        status="Module-based LCA accounting.",
        notes="Supplier EPDs may provide A1–A3; quantities and site-specific A4–A5 need separate modelling.", source=CHEAT,
        explorer="Computed: catalogue A1–A3, A4, A5 × quantities of every new element. Retained shell elements carry no "
                 "new carbon."),
    "whole_life_gwp": dict(
        name="Whole-life GWP", group="Environment", scale="Meso → Macro",
        formula="GWP_WL = GWP_A1–A5 + GWP_B + GWP_C",
        definitions="B includes applicable use-stage modules; C end-of-life. Record module D separately.",
        meaning="Life-cycle climate impact within the stated system boundary (kg CO₂e).",
        status="Module-based LCA accounting; align with the chosen standard.",
        notes="Do NOT net D credits against A–C in the headline indicator; report D separately.", source=CHEAT,
        explorer="Partial: A1–A5 + C1–C4 of the new elements. Use stage B (replacements B4, operational energy B6) is not "
                 "included yet; D is reported separately."),
    "avoided_gwp": dict(
        name="Avoided GWP", group="Environment", scale="Meso → Macro",
        formula="GWP_avoided = GWP_counterfactual − GWP_alternative",
        definitions="Same service delivered, functional unit, analysis horizon and life-cycle modules.",
        meaning="Emissions avoided relative to an explicit counterfactual (kg CO₂e).",
        status="Comparative scenario KPI.",
        notes="Not a negative emission and not automatically additive to A–C or module D.", source=CHEAT,
        explorer="Placeholder counterfactual (demolish and rebuild, counterfactual_newbuild_kgco2e_per_m2 × GFA) minus the "
                 "computed upfront GWP of this scenario."),
    "carbon_premium": dict(
        name="Carbon premium", group="Environment", scale="Meso → Macro",
        formula="ΔGWP_upfront = GWP_upfront,adaptable − GWP_upfront,conventional",
        definitions="Alternatives must meet equivalent functional requirements.",
        meaning="Additional upfront climate impact attributable to flexibility (kg CO₂e).",
        status="Comparative design KPI.",
        notes="Negative values mean the adaptable solution has lower upfront emissions.", source=CHEAT,
        explorer="Computed: the same building and uses laid out twice, with demountable and with conventional partitions."),
    "recoverable_mass": dict(
        name="Recoverable component mass", group="Circularity", scale="Micro → Meso",
        formula="M_recoverable = Σ_i m_i × q_i",
        definitions="m_i component mass; q_i = recoverable fraction (0–1), based on documented disassembly/recovery criteria.",
        meaning="Expected technically recoverable component mass (kg or tonnes).",
        status="Proposed mass-balance KPI.",
        notes="Scenario prediction is not the same as actual recovery; distinguish reusable vs recyclable fractions.",
        source=CHEAT, explorer="Placeholder: component_mass_kg_per_m2 × GFA × recoverable_fraction (the catalogue has "
                               "recovery rates but no component masses yet)."),
    "retained_material_value": dict(
        name="Retained material value", group="Circularity", scale="Micro → Macro",
        formula="V_material,retained = Σ_i q_i × max(0, P_reuse,i − C_recovery,i)",
        definitions="P_reuse = expected resale / avoided procurement value; C_recovery = recovery, processing, storage and "
                    "transport costs.",
        meaning="Net recoverable economic material value (SEK).",
        status="Proposed estimate; pricing and marketability uncertain.",
        notes="Not equivalent to whole-property VRR; avoid adding this separately if already embedded in residual value or "
              "cost savings.", source=CHEAT,
        explorer="Placeholder: recoverable mass × reuse_value_sek_per_kg."),
    "lcc": dict(
        name="Life cycle cost", group="Finance", scale="Meso → Macro",
        formula="LCC = CAPEX + Σ_{t=1..T} OPEX_t / (1+r)^t  (+ replacements − residual value)",
        definitions="r = real discount rate; T = study period. Standard life-cycle costing (ISO 15686-5).",
        meaning="Discounted cost of owning and running the alternative over the study period (SEK PV).",
        status="Standard definition; not in the CAVF cheat sheet.",
        notes="Money is discounted, carbon is not (data/factors/operational.json).", source="ISO 15686-5 (standard LCC)",
        explorer="Placeholder: computed CAPEX + opex_sek_per_m2_yr × GFA discounted at r over T from "
                 "data/factors/operational.json. The operating cost is illustrative."),
    # ---------------------------------------------------------------- named in the profiles, not yet defined
    "feasible_uses": dict(name="Feasible alternative uses", group="Use", scale="Meso",
                          explorer="Placeholder: feasible_uses (of the six use profiles)."),
    "adaptability_profile": dict(name="Adaptability profile", group="Use", scale="Meso",
                                 explorer="Placeholder: adaptability_grade."),
    "transformation_time": dict(name="Transformation time", group="Use", scale="Meso → Macro",
                                explorer="Placeholder: transformation_months_base + transformation_months_per_1000m2 × GFA/1000."),
    "disruptions": dict(name="Disruptions", group="Use", scale="Meso", explorer="Placeholder: disruption_weeks."),
    "utilization": dict(name="Utilization", group="Use", scale="Meso", explorer="Placeholder: utilization."),
    "delivered_services": dict(name="Delivered services", group="Use", scale="Meso",
                               explorer="Placeholder: delivered_services."),
    "replication": dict(name="Replication", group="Use", scale="Macro", explorer="Placeholder: replication_index."),
    "energy_flexibility": dict(name="Energy flexibility", group="Environment", scale="Meso",
                               explorer="Placeholder: energy_flexibility_share."),
    "shiftable_load": dict(name="Shiftable load", group="Environment", scale="Micro → Meso",
                           explorer="Placeholder: shiftable_load_w_per_m2 × GFA."),
    "hazard_adaptation": dict(name="Hazard adaptation performance", group="Environment", scale="Meso",
                              explorer="Placeholder: hazard_adaptation_score."),
    "data_quality": dict(
        name="Decision-critical data quality", group="Data", scale="All",
        meaning="Share of the cost and carbon figures that rest on verified data, with a CAVF A–D grade.",
        explorer="Computed: share of priced rows whose catalogue entry is not PLACEHOLDER (or our own ESTIMATE). "
                 "Grade A ≥ 90 %, B ≥ 70 %, "
                 "C ≥ 40 %, else D (provisional thresholds)."),
}
for _k, _d in KPIS.items():
    _d.setdefault("source", PENDING)
    for _f in ("formula", "definitions", "meaning", "status", "notes"):
        _d.setdefault(_f, "")

# ---------------------------------------------------------------------------- profiles
# KPIs per stakeholder profile, all equally weighted (from the CAVF stakeholder diagram).
PROFILES: dict[str, dict] = {
    "developer": dict(name="Project developer", scale="Meso", kpis=[
        "feasible_uses", "adaptability_profile", "transformation_cost", "transformation_time", "disruptions",
        "utilization", "delivered_services", "upfront_gwp", "lcc", "data_quality"]),
    "investor": dict(name="Real estate investor", scale="Macro", kpis=[
        "lcc", "incremental_npv", "break_even_premium", "option_value", "value_retention", "downside_loss",
        "crrem_year", "carbon_payback", "feasible_uses", "replication", "transformation_cost", "transformation_time",
        "utilization"]),
    "finance": dict(name="Financial consultant", scale="Meso–Macro", kpis=[
        "lcc", "incremental_npv", "break_even_premium", "option_value", "value_retention", "downside_loss",
        "crrem_year", "carbon_payback", "feasible_uses", "replication", "transformation_cost", "transformation_time",
        "utilization"]),
    "environmental": dict(name="Environmental consultant", scale="Meso–Micro", kpis=[
        "upfront_gwp", "whole_life_gwp", "avoided_gwp", "carbon_payback", "energy_flexibility", "recoverable_mass",
        "hazard_adaptation", "shiftable_load", "adaptability_profile", "data_quality"]),
    "supplier": dict(name="Material supplier", scale="Micro–Meso", provisional=True, kpis=[
        "recoverable_mass", "retained_material_value", "upfront_gwp", "carbon_premium", "transformation_cost",
        "replication"]),
}

# ---------------------------------------------------------------------------- scenarios (cheat sheet appendix A)
SCENARIOS = {
    "scenarios": [
        {"id": "S0", "name": "Stable", "meaning": "Current use and demand remain broadly stable",
         "driver": "Normal rent growth, maintenance and occupancy"},
        {"id": "S1", "name": "Expected", "meaning": "Most plausible anticipated change",
         "driver": "Likely changes in occupancy and use"},
        {"id": "S2", "name": "Adverse", "meaning": "Unfavourable market/use conditions",
         "driver": "Vacancy increase, conversion costs or falling income"},
        {"id": "S3", "name": "Opportunity", "meaning": "Potential upside / new use",
         "driver": "New demand, rent improvement or conversion opportunity"},
        {"id": "S4", "name": "Climate stress", "meaning": "Physical / transition climate pressure",
         "driver": "Retrofit cost, insurance, disruption and climate exposure"},
    ],
    "years": [10, 20],
    "rules": [
        "Value every alternative a under every scenario s ∈ {S0…S4} at years t ∈ {10, 20}.",
        "DL(a,s,t) = max(0, V(a,S0,t) − V(a,s,t));  DL% = 100 × DL / V(a,S0,t).",
        "VRR(a,s,t) = 100 × V(a,s,t) / V(a,S0,t). Above 100 % is upside, not an error.",
        "Avoided downside loss(a,s,t) = DL(reference,s,t) − DL(a,s,t).",
        "EDL(a,t) = Σ_s p_s × DL(a,s,t) only where probabilities are defensible; otherwise report S0–S4, the worst case "
        "and ranges.",
        "Do not add avoided downside loss or retained value again if already in the scenario DCF values.",
    ],
    "example": {
        "note": "Worked example from the cheat sheet (illustrative, million): stable-case values 10 at year 10 and 12 at "
                "year 20 for both alternatives.",
        "columns": ["Conventional Y10", "Adaptable Y10", "Conventional Y20", "Adaptable Y20"],
        "rows": [["S0 Stable", 10, 10, 12, 12], ["S1 Expected", 9, 9.5, 10, 11.5], ["S2 Adverse", 7, 9, 7.5, 10.5],
                 ["S3 Opportunity", 10.5, 11, 13, 14.5], ["S4 Climate stress", 8, 9.2, 8, 10.8]],
        "worked": ["S2, year 10 — conventional: DL = 3, DL% = 30 %, VRR = 70 %; adaptable: DL = 1, DL% = 10 %, VRR = 90 %; "
                   "avoided downside loss = 2.",
                   "S2, year 20 — conventional: DL = 4.5, VRR = 62.5 %; adaptable: DL = 1.5, VRR = 87.5 %; avoided "
                   "downside loss = 3."],
    },
    "symbols": "s = future scenario; a = design alternative; t = year; T = assessment horizon; r = real discount rate; "
               "GWP = global warming potential (kg CO₂e); CAPEX = capital expenditure; OPEX = operating expenditure; "
               "NOI = net operating income.",
}


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def methods_payload() -> dict:
    """Everything the Methods & data panel shows: KPI definitions, profiles, scenarios, databases, constants."""
    cat = _load(CATALOGUE)
    suppliers = sorted((CATALOGUE.parent / "suppliers").glob("*.json"))   # local, gitignored
    components = cat["components"] + [c for p in suppliers for c in _load(p)["components"]]
    op = _load(OPERATIONAL)
    return {
        "kpis": KPIS, "profiles": PROFILES, "scenarios": SCENARIOS,
        "data": {
            "catalogue": {"meta": {k: cat["_meta"].get(k) for k in ("version", "updated", "currency", "carbon_unit")},
                          "file": "data/components/catalogue.json" + "".join(
                              " + suppliers/" + p.name for p in suppliers),
                          "components": components},
            "study_period": dict(op["study_period"], file="data/factors/operational.json"),
            "placeholders": dict(_load(PLACEHOLDERS), file="data/kpi/placeholders.json"),
        },
    }


# ---------------------------------------------------------------------------- values
def _sp(n: float) -> str:
    return f"{n:,.0f}".replace(",", " ")


def _msek(v: float) -> str:
    return f"{v / 1e6:,.1f} MSEK".replace(",", " ")


def _t(v: float) -> str:
    return f"{_sp(v / 1000)} t CO₂e"


def building_kpis(site, bid: str, raw: dict | None) -> dict:
    """Every CAVF KPI for one building scenario: {id: {value, display, status, note}}."""
    sc = site.scenario(bid, raw)
    k = sc["kpi"]
    gfa = k["gfa_m2"] or 1
    P = {key: v["value"] for key, v in _load(PLACEHOLDERS).items() if not key.startswith("_")}
    study = _load(OPERATIONAL)["study_period"]
    r, T = study["discount_rate_real"], study["length_years"]
    value = P["market_value_sek_per_m2"] * gfa
    out: dict[str, dict] = {}

    def put(kid, v, display, status="placeholder", note=""):
        out[kid] = {"value": v, "display": display, "status": status, "note": note}

    # ---- computed from the engine run
    put("transformation_cost", k["capex_sek"], _msek(k["capex_sek"]), "partial",
        f"CAPEX only (materials + labour) · {_sp(k['capex_sek_per_m2'])} SEK/m²")
    put("upfront_gwp", k["upfront_kgco2e"], _t(k["upfront_kgco2e"]), "computed",
        f"A1–A5 · {k['upfront_kgco2e_per_m2']:.1f} kg CO₂e/m²")
    wl = k["upfront_kgco2e"] + k["c1c4_kgco2e"]
    put("whole_life_gwp", wl, _t(wl), "partial", "A1–A5 + C1–C4; use stage B not included · D reported separately")
    verified = 1 - k["placeholder_share"]
    grade = "A" if verified >= .9 else "B" if verified >= .7 else "C" if verified >= .4 else "D"
    put("data_quality", verified, f"Grade {grade} · {verified * 100:.0f} % verified", "computed",
        f"{k['placeholder_share'] * 100:.0f} % of priced items rest on PLACEHOLDER or estimated catalogue data")
    try:   # same building and uses, demountable vs conventional partitions
        base = dict(raw or {})
        dem = site.scenario(bid, dict(base, partition_system="demountable"))["kpi"]["upfront_kgco2e"]
        con = site.scenario(bid, dict(base, partition_system="conventional"))["kpi"]["upfront_kgco2e"]
        d = dem - con
        put("carbon_premium", d, ("+" if d > 0 else "−" if d < 0 else "") + _t(abs(d)), "computed",
            "demountable minus conventional partitions, same layout")
    except Exception as e:  # report, never fail the panel
        put("carbon_premium", None, "–", "placeholder", "could not lay out the alternatives: %s" % e)

    # ---- placeholders (data/kpi/placeholders.json)
    opex_pv = sum(P["opex_sek_per_m2_yr"] * gfa / (1 + r) ** t for t in range(1, T + 1))
    put("lcc", k["capex_sek"] + opex_pv, _msek(k["capex_sek"] + opex_pv), note=f"CAPEX + illustrative OPEX, r = {r:.0%}, T = {T} y")
    put("incremental_npv", P["npv_uplift_share"] * value, _msek(P["npv_uplift_share"] * value), note="vs continue as is")
    put("break_even_premium", P["flex_premium_sek_per_m2"] * gfa, _msek(P["flex_premium_sek_per_m2"] * gfa))
    put("option_value", P["option_value_share"] * value, _msek(P["option_value_share"] * value))
    put("value_retention", P["value_retention_s2_y10"], f"{P['value_retention_s2_y10'] * 100:.0f} %", note="S2 adverse, year 10")
    dl = P["downside_loss_s2_y10"] * value
    put("downside_loss", dl, f"{_msek(dl)} · {P['downside_loss_s2_y10'] * 100:.0f} %", note="S2 adverse, year 10")
    put("crrem_year", P["crrem_misalignment_year"], str(P["crrem_misalignment_year"]))
    put("carbon_payback", P["carbon_payback_years"], f"{P['carbon_payback_years']} years")
    put("feasible_uses", P["feasible_uses"], f"{P['feasible_uses']} of 6 uses")
    put("replication", P["replication_index"], f"{P['replication_index']:.1f} / 1")
    months = P["transformation_months_base"] + P["transformation_months_per_1000m2"] * gfa / 1000
    put("transformation_time", months, f"{months:.0f} months")
    put("disruptions", P["disruption_weeks"], f"{P['disruption_weeks']} weeks")
    put("utilization", P["utilization"], f"{P['utilization'] * 100:.0f} %")
    put("delivered_services", P["delivered_services"], f"{P['delivered_services']} services")
    put("adaptability_profile", P["adaptability_grade"], f"Grade {P['adaptability_grade']}")
    put("energy_flexibility", P["energy_flexibility_share"], f"{P['energy_flexibility_share'] * 100:.0f} % of peak")
    put("shiftable_load", P["shiftable_load_w_per_m2"] * gfa, f"{P['shiftable_load_w_per_m2'] * gfa / 1000:.0f} kW")
    put("hazard_adaptation", P["hazard_adaptation_score"], f"{P['hazard_adaptation_score']:.2f} / 1")
    mass = P["component_mass_kg_per_m2"] * gfa * P["recoverable_fraction"]
    put("recoverable_mass", mass, f"{_sp(mass / 1000)} t")
    put("retained_material_value", mass * P["reuse_value_sek_per_kg"], _msek(mass * P["reuse_value_sek_per_kg"]))
    av = P["counterfactual_newbuild_kgco2e_per_m2"] * gfa - k["upfront_kgco2e"]
    put("avoided_gwp", av, _t(av), note="vs illustrative demolish and rebuild")
    return {"building": bid, "key": sc["key"], "kpis": out}
