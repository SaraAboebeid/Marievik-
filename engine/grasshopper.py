"""Grasshopper building models -> dashboard.

    python -m engine.grasshopper          # list what is in runs/grasshopper/ and reconcile it

The Grasshopper definition (parametric/, "MVK Building" component, Export = true)
writes one file per building to runs/grasshopper/<id>.json (schema "mvk.scenarios/1"):
every use x partition system, with a bill of quantities keyed by catalogue ids.

This module does not trust the numbers Grasshopper computed. It prices every bill again
with evaluate.evaluate_bill, against the same catalogue, so a figure on the dashboard has
exactly one method behind it whether it came from the bay engine or from the Rhino model.
Grasshopper's own totals are kept only to check that the two agree.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import evaluate, loader

GH_DIR = loader.ROOT / "runs" / "grasshopper"
SCHEMA = "mvk.scenarios/1"


def model_files() -> list[Path]:
    return sorted(GH_DIR.glob("*.json")) if GH_DIR.exists() else []


def _reprice(scenario: dict, gfa: float) -> dict:
    catalogue = loader.catalogue()
    bill = {cid: qty for cid, qty in scenario["bill"].items() if cid in catalogue}
    missing = sorted(set(scenario["bill"]) - set(bill))
    upfront = evaluate.evaluate_bill(bill, area_m2=gfa, years=50, include_replacements=False)
    life = evaluate.evaluate_bill(bill, area_m2=gfa, years=50, include_replacements=True)
    gh = scenario["kpi"]
    engine_upfront = upfront.carbon.upfront
    return {
        "capex_sek": round(upfront.cost.capex),
        "upfront_kgco2e": round(engine_upfront),
        "upfront_kgco2e_per_m2": round(engine_upfront / gfa, 1) if gfa else 0,
        "c1c4_kgco2e": round(upfront.carbon.c1c4),
        "d_credit_kgco2e": round(upfront.carbon.d_credit),
        "b4_50yr_kgco2e": round(life.carbon.b4),
        "embodied_50yr_kgco2e": round(life.carbon.total_excluding_d),
        "cost_50yr_sek": round(life.cost.total),
        "placeholder_share": round(upfront.placeholder_share, 3),
        "missing_from_catalogue": missing,
        # Grasshopper also prices a few elements the catalogue lacks (flagged mock_csv there);
        # the engine leaves them out, so a small positive gap is expected and reported.
        "gh_minus_engine_kgco2e": round(gh["upfront_kgco2e"] - engine_upfront),
        "gh_minus_engine_sek": round(gh["capex_sek"] - upfront.cost.capex),
        "notes": life.notes,
    }


def load_models() -> list[dict]:
    models = []
    for path in model_files():
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("schema") != SCHEMA:
            continue
        for sc in raw["scenarios"]:
            sc["engine"] = _reprice(sc, sc["kpi"]["gfa_m2"])
        raw["file"] = path.name
        models.append(raw)
    return models


def payload() -> list[dict]:
    """What the dashboard embeds: everything except nothing - the files are already compact."""
    return load_models()


def main() -> None:
    models = load_models()
    if not models:
        print(f"No Grasshopper exports in {GH_DIR.relative_to(loader.ROOT)} - set Export = true in Grasshopper.")
        return
    for m in models:
        b = m["building"]
        print(f"{b['name']}  ({m['file']}, {m['generated']}, {b['floors']} floors, {b['mode']})")
        for sc in m["scenarios"]:
            e = sc["engine"]
            print(f"  {sc['id']:<34} {e['capex_sek'] / 1e6:6.1f} MSEK  {e['upfront_kgco2e'] / 1000:7.0f} t CO2e"
                  f"  ({e['upfront_kgco2e_per_m2']:.0f} kg/m2)  gap vs GH {e['gh_minus_engine_kgco2e']:+,} kg")


if __name__ == "__main__":
    main()
