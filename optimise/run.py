"""One optimiser run, callable from the command line or the editor.

Everything the command line did, as a function with a progress callback,
so the Apartment Lab can start a run in the background and stream its log.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from explore.search import SPEC_VARIANTS

from . import adapt, pipeline, programs, schemes, selection

ROOT = Path(__file__).resolve().parents[1]


def pack(o: pipeline.Option, ranks: dict, reg: dict | None) -> dict:
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


def brief_summary(brief: programs.Brief) -> dict:
    return {
        "id": brief.id, "label": brief.label, "notes": brief.notes,
        "target_area_m2": brief.target_area_m2, "thermal_profile": brief.thermal_profile,
        "densities": [{"occupants": d.occupants, "user_group": d.user_group, "label": d.label}
                      for d in brief.densities],
    }


def optimise(uses: list[str], shell_id: str = schemes.DEFAULT_SHELL, quick: bool = False,
             azimuth: float | None = None, carbon_price: float = adapt.DEFAULT_CARBON_PRICE,
             floor: dict | None = None, seed: int = 0, log=print) -> dict:
    started = time.time()
    furnishings = 1 if quick else 2
    max_geo = 8 if quick else 30
    short_size = 10 if quick else 30
    shell = schemes.site(shell_id).shell
    if azimuth is None:
        azimuth = float(shell.get("facade_azimuth_deg", 180.0))

    results = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "shell_id": shell_id,
        "settings": {"azimuth": azimuth, "carbon_price": carbon_price, "quick": quick,
                     "furnishings": furnishings, "max_geometries": max_geo, "shortlist": short_size},
        "criteria": pipeline.CRITERIA,
        "stakeholders": selection.STAKEHOLDERS,
        "windows": schemes.WINDOWS,
        "partitions": {k: v["label"] for k, v in SPEC_VARIANTS.items()},
        "products": pipeline.PRODUCT_STRATEGIES,
        "uses": {},
    }
    selected: dict[str, list[pipeline.Option]] = {}

    for use in uses:
        brief = programs.brief(use)
        log(f"[{brief.label}] generating, furnishing and screening layouts")
        options, ctx = pipeline.screen(brief, furnishings=furnishings, max_geometries=max_geo,
                                       anneal_iterations=1500, seed=seed, log=log, shell_id=shell_id)
        stats = ctx["stats"]
        if not options:
            log(f"[{brief.label}] no feasible option on this shell")
            results["uses"][use] = {"brief": brief_summary(brief), "stats": stats, "options": [], "all": []}
            continue
        short = pipeline.shortlist(options, size=short_size)
        log(f"[{brief.label}] {len(short)} shortlisted; simulating every window choice in EnergyPlus")
        scored = pipeline.score_with_thermal(brief, short, ctx["by_geometry"], azimuth, log=log)
        if not scored:
            log(f"[{brief.label}] thermal stage produced nothing")
            results["uses"][use] = {"brief": brief_summary(brief), "stats": stats, "options": [], "all": []}
            continue
        ten, ranks = selection.select_ten(scored)
        reg = selection.regret(ten)
        selected[use] = ten
        stats["scored_with_thermal"] = len(scored)
        results["uses"][use] = {
            "brief": brief_summary(brief),
            "stats": stats,
            "options": [pack(o, ranks, reg) for o in ten],
            "recommended": reg["recommended"],
            "favourites": reg["favourites"],
            "all": [{"id": o.id, "front": ranks[o.id], **{k: round(v, 1) for k, v in o.criteria().items()},
                     "window": o.window, "occupants": o.occupants} for o in scored],
        }
        log(f"[{brief.label}] done: recommended {reg['recommended']}")

    if len(selected) > 1:
        log("Comparing futures: each option with every wall system, through changes of use")
        candidates: dict[str, list[pipeline.Option]] = {}
        for use, ten in selected.items():
            pool = list(ten)
            for option in ten:
                for partition in pipeline.PARTITION_SPECS:
                    if partition != option.partition:
                        pool.append(pipeline.respecify(option, partition))
            candidates[use] = pool
        results["adaptability"] = adapt.cross_use(candidates, price=carbon_price, floor=floor)
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
    return results


def save(results: dict) -> Path:
    out_dir = ROOT / "runs" / "optimise" / datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    from . import report
    report.write(results, out_dir / "report.html")
    return out_dir
