"""Run the optimiser.

    python -m optimise                                   all four uses
    python -m optimise --uses student_housing family_housing
    python -m optimise --azimuth 90 --carbon-price 2.0   east facade, dearer carbon
    python -m optimise --quick                           smaller search, for testing

Writes runs/optimise/<timestamp>/results.json and report.html.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from . import adapt, pipeline, programs, selection

ROOT = Path(__file__).resolve().parents[1]


def _pack(o: pipeline.Option, ranks: dict, reg: dict | None) -> dict:
    data = {k: v for k, v in o.__dict__.items() if not k.startswith("_")}
    data["lcc_per_person"] = round(o.lcc_per_person)
    data["carbon_per_person"] = round(o.carbon_per_person)
    data["m2_per_person"] = round(o.m2_per_person, 1)
    data["front"] = ranks.get(o.id)
    if reg:
        data["regret"] = reg["table"].get(o.id)
        data["criterion_gaps"] = reg["criterion_gaps"].get(o.id)
        data["normalised"] = reg["normalised"].get(o.id)
    return data


def main(argv: list[str] | None = None) -> Path:
    parser = argparse.ArgumentParser(prog="python -m optimise")
    parser.add_argument("--uses", nargs="+", default=list(programs.BRIEFS))
    parser.add_argument("--azimuth", type=float, default=180.0,
                        help="facade orientation, degrees clockwise from north (180 = south)")
    parser.add_argument("--carbon-price", type=float, default=adapt.DEFAULT_CARBON_PRICE)
    parser.add_argument("--min-comfort", type=float, default=adapt.DEFAULT_FLOOR["comfort"],
                        help="quality floor for the cross-use recommendation, %% comfortable hours")
    parser.add_argument("--min-usability", type=float, default=adapt.DEFAULT_FLOOR["usability"])
    parser.add_argument("--min-functionality", type=float, default=adapt.DEFAULT_FLOOR["functionality"])
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    started = time.time()
    furnishings = 1 if args.quick else 2
    max_geo = 8 if args.quick else 30
    short_size = 10 if args.quick else 30

    results = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "settings": {"azimuth": args.azimuth, "carbon_price": args.carbon_price,
                     "furnishings": furnishings, "max_geometries": max_geo, "shortlist": short_size},
        "criteria": pipeline.CRITERIA,
        "stakeholders": selection.STAKEHOLDERS,
        "windows": {k: {kk: vv for kk, vv in v.items()} for k, v in __import__("optimise.schemes", fromlist=["WINDOWS"]).WINDOWS.items()},
        "partitions": {k: v["label"] for k, v in __import__("explore.search", fromlist=["SPEC_VARIANTS"]).SPEC_VARIANTS.items()},
        "products": pipeline.PRODUCT_STRATEGIES,
        "uses": {},
    }
    selected: dict[str, list[pipeline.Option]] = {}

    for use in args.uses:
        brief = programs.brief(use)
        print(f"\n[{use}] stage 1: generate, furnish, screen")
        options, ctx = pipeline.screen(brief, furnishings=furnishings, max_geometries=max_geo,
                                       anneal_iterations=1500, seed=args.seed)
        stats = ctx["stats"]
        if not options:
            print(f"[{use}] no feasible option")
            results["uses"][use] = {"brief": _brief(brief), "stats": stats, "options": [], "all": []}
            continue
        short = pipeline.shortlist(options, size=short_size)
        print(f"[{use}] stage 2-3: {len(short)} shortlisted, simulating every window choice")
        scored = pipeline.score_with_thermal(brief, short, ctx["by_geometry"], args.azimuth)
        if not scored:
            print(f"[{use}] thermal stage produced nothing")
            continue
        ten, ranks = selection.select_ten(scored)
        reg = selection.regret(ten)
        selected[use] = ten
        stats["scored_with_thermal"] = len(scored)
        results["uses"][use] = {
            "brief": _brief(brief),
            "stats": stats,
            "options": [_pack(o, ranks, reg) for o in ten],
            "recommended": reg["recommended"],
            "favourites": reg["favourites"],
            # Every thermally scored option, light: for the trade-off cloud.
            "all": [{"id": o.id, "front": ranks[o.id], **{k: round(v, 1) for k, v in o.criteria().items()},
                     "window": o.window, "occupants": o.occupants} for o in scored],
        }
        print(f"[{use}] recommended: {reg['recommended']}")

    if len(selected) > 1:
        print("\ncross-use regret (each selected option also tried with every partition system)")
        candidates: dict[str, list[pipeline.Option]] = {}
        for use, ten in selected.items():
            pool = list(ten)
            for option in ten:
                for partition in pipeline.PARTITION_SPECS:
                    if partition != option.partition:
                        pool.append(pipeline.respecify(option, partition))
            candidates[use] = pool
        floor = {"comfort": args.min_comfort, "usability": args.min_usability,
                 "functionality": args.min_functionality}
        results["adaptability"] = adapt.cross_use(candidates, price=args.carbon_price, floor=floor)
        results["adaptability"]["candidates"] = {
            use: {o.id: {"base": o.id.rsplit(".", 2)[0], "partition": o.partition,
                         "description": o.description, "window": o.window, "products": o.products,
                         "occupants": o.occupants, "lcc": o.lcc, "carbon_total": o.carbon_total,
                         "lcc_per_person": round(o.lcc_per_person),
                         "carbon_per_person": round(o.carbon_per_person),
                         "in_ten": o.id in {t.id for t in selected[use]}}
                  for o in pool}
            for use, pool in candidates.items()
        }

    results["elapsed_s"] = round(time.time() - started)
    out_dir = ROOT / "runs" / "optimise" / datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    try:
        from . import report
        report.write(results, out_dir / "report.html")
    except ImportError:
        pass
    print(f"\nwrote {out_dir} in {results['elapsed_s']} s")
    return out_dir


def _brief(brief: programs.Brief) -> dict:
    return {
        "id": brief.id, "label": brief.label, "notes": brief.notes,
        "target_area_m2": brief.target_area_m2, "thermal_profile": brief.thermal_profile,
        "densities": [{"occupants": d.occupants, "user_group": d.user_group, "label": d.label}
                      for d in brief.densities],
    }


if __name__ == "__main__":
    main()
