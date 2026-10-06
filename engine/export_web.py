"""Export everything the dashboard needs as one JSON payload.

Run:  python -m engine.export_web

Writes runs/dashboard_data.json. The dashboard embeds this rather than
calling the engine live, so the published page is a snapshot with a
timestamp and a provenance caveat baked in — which is the honest way to
publish a result that rests on placeholder data.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from . import evaluate, experience, fit, grasshopper, intake, layout, loader, scenarios

OUT = loader.ROOT / "runs" / "dashboard_data.json"


def build() -> dict:
    report = loader.provenance_report()
    programs = loader.use_programs()

    payload: dict = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "provenance": {
            "caveat": report.caveat(),
            "placeholder_share": round(report.placeholder_share, 4),
            "confidence_label": report.confidence_label,
            "total_values": report.total_values,
        },
        "unverified": loader.unverified_shell_fields(),
        "shell": loader.shell(),
        "user_groups": [
            {
                "id": g["id"],
                "label": g["label_en"],
                "label_sv": g.get("label_sv", ""),
                "age_range": g.get("age_range_years"),
                "turning_circle": g.get("clearances_mm", {}).get("turning_circle"),
                "door_width": g.get("clearances_mm", {}).get("door_clear_width"),
                "passage_width": g.get("clearances_mm", {}).get("passage_width_single"),
                "seated_eye_height": g.get("anthropometrics_mm", {}).get("seated_eye_height"),
                "illuminance": g.get("environment", {}).get("illuminance_lux_general"),
                "reverberation": g.get("environment", {}).get("max_reverberation_time_s"),
                "notes": g.get("notes", ""),
            }
            for g in loader.user_groups().values()
        ],
        "fit": [],
        "experience": [],
        "layouts": [],
        "timelines": [],
        "components": [],
    }

    # --- Fit ------------------------------------------------------------
    for result in fit.fit_all():
        payload["fit"].append({
            "program": result.program_id,
            "label": result.program_label,
            "verdict": result.verdict,
            "capacity": round(result.capacity, 1),
            "capacity_as_is": round(result.capacity_as_is, 1),
            "capacity_unit": result.capacity_unit,
            "limited_by": result.limited_upgraded_by,
            "limited_as_is_by": result.limited_as_is_by,
            "binding_constraint": result.binding_constraint,
            "checks": [
                {
                    "name": c.name,
                    "required": str(c.required) + c.unit,
                    "available": str(c.available) + c.unit,
                    "passed": c.passed,
                    "severity": c.severity,
                    "stage": c.stage,
                    "comment": c.comment,
                }
                for c in result.checks
            ],
        })

    # --- Experience -------------------------------------------------------
    for profile in experience.profile_all():
        payload["experience"].append({
            "program": profile.program_id,
            "label": profile.program_label,
            "blended": round(profile.blended, 1),
            "dimensions": [
                {
                    "name": d.name,
                    "score": round(d.score, 1),
                    "band": d.band,
                    "basis": d.basis,
                    "groups": d.affected_groups,
                    "hard": d.is_hard_requirement,
                }
                for d in profile.dimensions
            ],
            "conflicts": [
                {"between": list(c.between), "description": c.description, "owner": c.resolution_owner}
                for c in profile.conflicts
            ],
        })

    # --- Layouts ----------------------------------------------------------
    for program_id in programs:
        result = layout.generate(program_id)
        floor_area = sum(b.area_m2 for b in result.grid if not b.is_core)
        priced = {}
        for component_id, key in (
            ("part.stud.gypsum.95", "conventional"),
            ("part.demount.solid.100", "demountable"),
        ):
            bill = layout.bill_from_layout(result, component_id)
            assessment = evaluate.evaluate_bill(
                bill, area_m2=floor_area, years=50, include_replacements=False
            )
            priced[key] = {
                "carbon_kg": round(assessment.carbon.upfront),
                "cost_sek": round(assessment.cost.capex),
            }

        payload["layouts"].append({
            "program": program_id,
            "label": programs[program_id]["label_en"],
            "n_cols": result.n_cols,
            "n_rows": result.n_rows,
            "bay_w": round(result.grid[0].width_m, 2),
            "bay_d": round(result.grid[0].depth_m, 2),
            "floor_area": round(floor_area),
            "partition_m": round(result.partition_length_m),
            "partition_area": round(result.partition_area_m2),
            "partition_density": round(result.partition_area_m2 / floor_area, 3),
            "score": round(result.score),
            "priced": priced,
            "cells": [
                {
                    "col": bay.col,
                    "row": bay.row,
                    "zone": result.assignment[i],
                    "facade": bay.has_facade,
                    "core": bay.is_core,
                }
                for i, bay in enumerate(result.grid)
            ],
            "zones": [
                {
                    "id": z.space_id,
                    "label": z.label,
                    "target": round(z.target_area_m2),
                    "actual": round(result.zone_area(z.space_id)),
                    "daylight": z.daylight_required,
                }
                for z in result.zones.values()
            ],
        })

    # --- Timelines --------------------------------------------------------
    for result in scenarios.compare_timelines():
        payload["timelines"].append({
            "id": result.timeline_id,
            "label": result.label,
            "area": round(result.area_m2),
            "years": result.study_years,
            "carbon_per_m2": round(result.carbon_per_m2, 1),
            "cost_per_m2": round(result.cost_per_m2),
            "upfront_carbon": round(result.initial.carbon.upfront),
            "transformation_carbon": round(
                sum(t.transformation_carbon for t in result.transformations)
            ),
            "operational_carbon": round(result.operational_carbon),
            "total_carbon": round(result.total_carbon),
            "total_cost": round(result.total_cost),
            "embodied_share": round(
                result.total_embodied_carbon / result.total_carbon, 3
            ) if result.total_carbon else 0,
            "adaptability_index": round(result.adaptability_index, 2),
            "circularity": round(result.mean_circularity, 3),
            "blockers": result.all_blockers,
            "transitions": [
                {
                    "year": t.year,
                    "from": t.from_label,
                    "to": t.to_label,
                    "carbon": round(t.transformation_carbon),
                    "cost": round(t.transformation_cost),
                    "circularity": round(t.circularity, 3),
                }
                for t in result.transformations
            ],
        })

    # --- Break-even -------------------------------------------------------
    by_id = {t["id"]: t for t in payload["timelines"]}
    if "conventional_change_of_use" in by_id and "adaptable_change_of_use" in by_id:
        results = {r.timeline_id: r for r in scenarios.compare_timelines()}
        be = scenarios.break_even(
            results["conventional_change_of_use"], results["adaptable_change_of_use"]
        )
        payload["break_even"] = {
            "upfront_carbon_premium": round(be.upfront_carbon_premium),
            "upfront_cost_premium": round(be.upfront_cost_premium),
            "carbon_saved_per_change": round(be.carbon_saved_per_change),
            "cost_saved_per_change": round(be.cost_saved_per_change),
            "changes_modelled": be.changes_modelled,
            "carbon_break_even": be.carbon_break_even,
            "cost_break_even": be.cost_break_even,
            "carbon_verdict": be.verdict("carbon"),
            "cost_verdict": be.verdict("cost"),
        }

    # --- Components -------------------------------------------------------
    validations = {v.component_id: v for v in intake.validate_catalogue()}
    for component_id, component in loader.catalogue().items():
        validation = validations.get(component_id)
        payload["components"].append({
            "id": component_id,
            "name": component["name"],
            "supplier": component["supplier"],
            "layer": component["layer"],
            "unit": component["unit"],
            "service_life": component["service_life_years"],
            "fixing": component["fixing"],
            "reversibility": component["reversibility"],
            "recovery_rate": component["recovery_rate"],
            "a1a3": component["carbon_kgco2e"]["A1A3"],
            "a4": component["carbon_kgco2e"].get("A4", 0),
            "a5": component["carbon_kgco2e"].get("A5", 0),
            "c1c4": component["carbon_kgco2e"]["C1C4"],
            "d_credit": component["carbon_kgco2e"].get("D", 0),
            "cost_material": component["cost_sek"]["material"],
            "cost_install": component["cost_sek"]["labour_install"],
            "cost_demount": component["cost_sek"]["labour_demount"],
            "placeholder": str(
                component["carbon_kgco2e"].get("provenance", "")
            ).upper() == "PLACEHOLDER",
            "warnings": [i.message for i in validation.warnings] if validation else [],
            "notes": component.get("notes", ""),
        })

    # --- Grasshopper building models ---------------------------------------
    # Written by the Grasshopper "MVK Building" component (Export = true) and
    # re-priced here with evaluate_bill, so both routes share one method.
    payload["models"] = grasshopper.payload()

    payload["schema"] = json.loads(
        (loader.DATA / "schema" / "supplier_submission.schema.json").read_text(encoding="utf-8")
    )
    payload["intake_template"] = intake.template()

    return payload


def main() -> Path:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    size = OUT.stat().st_size
    print(f"Wrote {OUT.relative_to(loader.ROOT)}  ({size:,} bytes)")
    print(f"  {len(payload['fit'])} fit results, {len(payload['layouts'])} layouts, "
          f"{len(payload['timelines'])} timelines, {len(payload['components'])} components, "
          f"{len(payload['models'])} Grasshopper model(s)")
    print(f"  {payload['provenance']['caveat']}")
    return OUT


if __name__ == "__main__":
    main()
