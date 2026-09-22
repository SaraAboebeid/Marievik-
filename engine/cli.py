"""Command line interface for the Marievik+ digital lab.

    python -m engine.cli doctor     data health and what is still unknown
    python -m engine.cli fit        which uses the shell can host
    python -m engine.cli compare    cost and carbon across use timelines
    python -m engine.cli all        everything, written to runs/
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from . import evaluate, fit, loader, scenarios

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"

RULE = "=" * 78
THIN = "-" * 78


def _sek(value: float) -> str:
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:,.2f} MSEK"
    return f"{value:,.0f} SEK"


def _co2(value: float) -> str:
    if abs(value) >= 1000:
        return f"{value / 1000:,.1f} t CO2e"
    return f"{value:,.0f} kg CO2e"


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------


def cmd_doctor(_args) -> int:
    print(RULE)
    print("DATA HEALTH — what this lab currently knows")
    print(RULE)

    report = loader.provenance_report()
    print(f"\n  {report.caveat()}\n")

    groups = loader.user_groups()
    programs = loader.use_programs()
    components = loader.catalogue()
    print(f"  User groups defined ....... {len(groups)}")
    print(f"  Use programmes defined .... {len(programs)}")
    print(f"  Components in catalogue ... {len(components)}")

    suppliers = {c["supplier"] for c in components.values()}
    named = {s for s in suppliers if s not in {"GENERIC", "PLACEHOLDER_SUPPLIER"}}
    print(f"  Named suppliers ........... {len(named)} of {len(suppliers)} supplier slots")

    print(f"\n{THIN}")
    print("BLOCKING UNKNOWNS — these change conclusions, not just precision")
    print(THIN)
    gaps = loader.unverified_shell_fields()
    if not gaps:
        print("\n  None. Shell data is fully verified.\n")
    else:
        for index, gap in enumerate(gaps, 1):
            print(f"\n  {index}. {gap}")
        print()

    print(THIN)
    print("NEXT DATA TO ACQUIRE, in order of leverage")
    print(THIN)
    print("""
  1. Structural verification of slab live load.
     Decides whether assembly and care uses are available at all.
     Everything downstream is conditional on it.

  2. As-built drawings: grid, core, facade, stack positions.
     Replaces the template in data/building/marievik_shell.json.

  3. EPDs from the component suppliers you are partnering with.
     Replaces PLACEHOLDER carbon values. Ask specifically for
     C1-C4 and module D - most suppliers publish only A1-A3, and
     the missing modules are exactly where reuse arguments are won.

  4. Priced quotations for demount labour.
     The least available number in the whole industry, and the one
     the adaptability case depends on most.
""")
    return 0


# ---------------------------------------------------------------------------
# fit
# ---------------------------------------------------------------------------


def cmd_fit(args) -> int:
    print(RULE)
    print("ADAPT — which uses can this shell host?")
    print(RULE)

    results = fit.fit_all() if not args.program else [fit.fit_program(args.program)]
    results.sort(key=lambda r: (len(r.blockers), len(r.majors)))

    for result in results:
        print(f"\n{THIN}")
        print(f"{result.program_label.upper()}  [{result.verdict}]")
        print(THIN)
        print(
            f"  Capacity with services renewed: {result.capacity:,.0f} {result.capacity_unit}"
            f"  (then limited by {result.limited_upgraded_by})"
        )
        print(
            f"  Capacity on existing services:  {result.capacity_as_is:,.0f} {result.capacity_unit}"
            f"  (limited by {result.limited_as_is_by})"
        )
        if result.services_headroom_gap > 1:
            print(
                f"    -> {result.services_headroom_gap:,.0f} {result.capacity_unit} are locked "
                "behind a services upgrade that is due anyway (5 yr remaining life)."
            )
        print(f"  Binding constraint: {result.binding_constraint}")

        failures = result.failures
        passes = [c for c in result.checks if c.passed]

        if failures:
            print("\n  What stops us:")
            for check in failures:
                print(f"    [{check.severity.upper()}] {check.name} ({check.stage})")
                print(f"        need {check.required}{check.unit}, have {check.available}{check.unit}")
                if check.comment:
                    print(f"        {check.comment}")
        if passes and args.verbose:
            print("\n  Passing checks:")
            for check in passes:
                print(f"    [ok] {check.name}: {check.available}{check.unit}")

    if results and results[0].conditional_on:
        print(f"\n{THIN}")
        print("ALL RESULTS ABOVE ARE CONDITIONAL ON:")
        print(THIN)
        for item in results[0].conditional_on:
            print(f"  - {item}")
    print()
    return 0


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------


def cmd_compare(args) -> int:
    print(RULE)
    print("EVALUATE — cost and carbon across a sequence of uses")
    print(RULE)

    results = scenarios.compare_timelines()
    period = loader.operational_factors()["study_period"]
    area = results[0].area_m2 if results else 0.0

    print(
        f"\n  Study period: {period['length_years']} years from {period['start_year']}"
        f"   |   Reference floor: {area:,.0f} m²"
    )
    print("  Carbon is NOT discounted. Module D is excluded from all totals.\n")

    header = (
        f"  {'TIMELINE':<42}{'kgCO2e/m²':>11}{'SEK/m²':>11}"
        f"{'ADAPT IDX':>11}{'REUSE':>8}"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))

    for result in sorted(results, key=lambda r: r.carbon_per_m2):
        print(
            f"  {result.label[:41]:<42}"
            f"{result.carbon_per_m2:>11,.0f}"
            f"{result.cost_per_m2:>11,.0f}"
            f"{result.adaptability_index:>11,.1f}"
            f"{result.mean_circularity:>7.0%}"
        )

    print("\n  ADAPT IDX = mean transformation carbon per m² per change of use. Lower is better.")
    print("  REUSE     = share of each new fit-out met from recovered components.\n")

    for result in sorted(results, key=lambda r: r.carbon_per_m2):
        print(THIN)
        print(f"{result.label}")
        print(THIN)
        print(f"  Upfront fit-out (A1-A5) ..... {_co2(result.initial.carbon.upfront):>18}")
        transformation_carbon = sum(t.transformation_carbon for t in result.transformations)
        print(f"  Transformations ({len(result.transformations)}) ......... {_co2(transformation_carbon):>18}")
        print(f"  Operational over period ..... {_co2(result.operational_carbon):>18}")
        print(f"  {'':.<30} {'':>18}")
        print(f"  TOTAL CARBON ................ {_co2(result.total_carbon):>18}")
        embodied_share = (
            result.total_embodied_carbon / result.total_carbon if result.total_carbon else 0
        )
        print(f"    of which embodied ......... {embodied_share:>17.0%}")
        print(f"  TOTAL COST .................. {_sek(result.total_cost):>18}")

        if result.transformations and args.verbose:
            print("\n  Each change of use:")
            for t in result.transformations:
                print(
                    f"    {t.year}  {t.from_label[:28]:<30} -> {t.to_label[:28]}"
                )
                print(
                    f"           {_co2(t.transformation_carbon):>14}"
                    f"   {_sek(t.transformation_cost):>14}"
                    f"   reuse {t.circularity:>4.0%}"
                )
        if result.all_blockers:
            print("\n  IMPLEMENT-stage obstacles raised by this timeline:")
            for blocker in result.all_blockers:
                print(f"    - {blocker}")
        print()

    # The headline comparison.
    by_id = {r.timeline_id: r for r in results}
    if "conventional_change_of_use" in by_id and "adaptable_change_of_use" in by_id:
        conventional = by_id["conventional_change_of_use"]
        adaptable = by_id["adaptable_change_of_use"]
        carbon_delta = conventional.total_carbon - adaptable.total_carbon
        cost_delta = conventional.total_cost - adaptable.total_cost
        be = scenarios.break_even(conventional, adaptable)

        print(RULE)
        print("THE HEADLINE: same uses, same sequence, different construction logic")
        print(RULE)
        print(f"""
  UPFRONT PREMIUM for building adaptably
    carbon .................. {_co2(be.upfront_carbon_premium):>18}
    cost .................... {_sek(be.upfront_cost_premium):>18}

  SAVED AT EACH CHANGE OF USE
    carbon .................. {_co2(be.carbon_saved_per_change):>18}
    cost .................... {_sek(be.cost_saved_per_change):>18}

  BREAK-EVEN
    carbon .................. {be.verdict('carbon')}
    cost .................... {be.verdict('cost')}

  OVER THE FULL {conventional.study_years} YEARS ({len(conventional.transformations)} changes of use)
    carbon .................. adaptable is {_co2(abs(carbon_delta))} {'BETTER' if carbon_delta > 0 else 'WORSE'}
    cost .................... adaptable is {_sek(abs(cost_delta))} {'BETTER' if cost_delta > 0 else 'WORSE'}

  Adaptability index: {conventional.adaptability_index:,.1f} -> {adaptable.adaptability_index:,.1f} kgCO2e/m² per change
  Reuse (carbon-weighted): {conventional.mean_circularity:.0%} -> {adaptable.mean_circularity:.0%}
""")
        print(THIN)
        print("READ THIS BEFORE QUOTING THE NUMBERS ABOVE")
        print(THIN)
        report = loader.provenance_report()
        print(f"""
  {report.caveat()}

  The two variants do not carry identical scope. The adaptable bills include
  a raised access floor and decentralised ventilation — real adaptability
  investments that buy servicing freedom for every later fit-out, but also
  real extra material the conventional option never installs. That premium is
  a design choice being tested, not a rigged comparison, and the break-even
  figure above is the right way to judge it.

  If adaptable loses here, the useful question is not 'is adaptability worth
  it' but 'which of these components earns its carbon back': strip the raised
  floor from the adaptable bills and re-run to find out. That experiment is
  two edits in data/scenarios/fitouts.json, and it is the kind of question
  this lab exists to answer.
""")

    return 0


# ---------------------------------------------------------------------------
# all
# ---------------------------------------------------------------------------


def cmd_all(args) -> int:
    RUNS.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    cmd_doctor(args)
    cmd_fit(args)
    cmd_compare(args)

    payload = {
        "run_timestamp": stamp,
        "engine_version": "0.1.0",
        "provenance": loader.provenance_report().caveat(),
        "unverified": loader.unverified_shell_fields(),
        "fit": [
            {
                "program": r.program_id,
                "verdict": r.verdict,
                "capacity": round(r.capacity, 1),
                "capacity_unit": r.capacity_unit,
                "binding_constraint": r.binding_constraint,
                "blockers": [c.name for c in r.blockers],
                "majors": [c.name for c in r.majors],
            }
            for r in fit.fit_all()
        ],
        "timelines": [
            {
                "id": r.timeline_id,
                "label": r.label,
                "carbon_per_m2": round(r.carbon_per_m2, 1),
                "cost_per_m2": round(r.cost_per_m2, 1),
                "total_carbon_kgco2e": round(r.total_carbon),
                "total_cost_sek": round(r.total_cost),
                "embodied_carbon_kgco2e": round(r.total_embodied_carbon),
                "operational_carbon_kgco2e": round(r.operational_carbon),
                "adaptability_index": round(r.adaptability_index, 2),
                "mean_circularity": round(r.mean_circularity, 3),
            }
            for r in scenarios.compare_timelines()
        ],
    }

    out = RUNS / f"run_{stamp}.json"
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\n  Run written to {out.relative_to(ROOT)}")
    print("  This file is the LEARN layer — keep it, diff it, cite it.\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="engine.cli", description="Marievik+ digital lab for adaptive reuse"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="show passing checks and per-transition detail")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor", help="data health and blocking unknowns")
    doctor.set_defaults(func=cmd_doctor)

    fit_parser = sub.add_parser("fit", help="test use programmes against the shell")
    fit_parser.add_argument("-p", "--program", help="single programme id, e.g. elderly_care")
    fit_parser.set_defaults(func=cmd_fit)

    compare = sub.add_parser("compare", help="compare use timelines on cost and carbon")
    compare.set_defaults(func=cmd_compare)

    run_all = sub.add_parser("all", help="run everything and write a timestamped record")
    run_all.add_argument("-p", "--program", default=None, help=argparse.SUPPRESS)
    run_all.set_defaults(func=cmd_all)

    args = parser.parse_args(argv)
    if not hasattr(args, "program"):
        args.program = None
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
