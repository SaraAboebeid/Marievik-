"""Command line interface for the Marievik+ digital lab.

    python -m engine.cli doctor     data health and what is still unknown
    python -m engine.cli fit        which uses the shell can host
    python -m engine.cli compare    cost and carbon across use timelines
    python -m engine.cli supplier   a supplier's product in a use timeline (e.g. Smartax walls)
    python -m engine.cli all        everything, written to runs/
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from . import evaluate, experience, fit, layout, loader, scenarios

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
# supplier
# ---------------------------------------------------------------------------

GENERIC_SUPPLIERS = {"GENERIC", "PLACEHOLDER_SUPPLIER"}


def _like_for_like(components: dict, replaces: str) -> str | None:
    """A named supplier's partition with the same fire class and at least the same sound insulation."""
    ref = components[replaces].get("performance", {})
    fire = ref.get("fire_class")
    candidates = [
        (c["performance"].get("Rw_dB", 0), cid)
        for cid, c in components.items()
        if c["supplier"] not in GENERIC_SUPPLIERS and c["layer"] == components[replaces]["layer"]
        and cid.startswith("part.") and c.get("performance", {}).get("fire_class") == fire
        and c["performance"].get("Rw_dB", 0) >= ref.get("Rw_dB", 0)
    ]
    return min(candidates)[1] if candidates else None


def cmd_supplier(args) -> int:
    components = loader.catalogue()
    replaces = args.replaces
    target = args.component or _like_for_like(components, replaces)
    if target not in components:
        named = sorted(cid for cid, c in components.items() if c["supplier"] not in GENERIC_SUPPLIERS)
        print(f"\n  No supplier component to test{f' ({target})' if target else ''}. Named supplier components:")
        for cid in named:
            print(f"    {cid}")
        if not named:
            print("    none: add a file to data/components/suppliers/ (see the README there)")
        return 1

    new, old = components[target], components[replaces]
    print(RULE)
    print(f"SUPPLIER — {new['supplier']}: {new['name']}")
    print(RULE)
    print(f"\n  Replaces {old['name']}\n  in every fit-out of the timeline '{args.timeline}'.\n")
    rows = [
        ("Sound / fire", lambda c: f"{c.get('performance', {}).get('Rw_dB', '?')} dB {c.get('performance', {}).get('fire_class', '?')}"),
        ("Fixing", lambda c: c["fixing"]),
        ("Reversibility / recovery", lambda c: f"{c['reversibility']:.2f} / {c['recovery_rate']:.2f}"),
        ("Capex SEK/m²", lambda c: f"{c['cost_sek']['material'] + c['cost_sek']['labour_install']:,.0f}"),
        ("Upfront kgCO2e/m²", lambda c: f"{c['carbon_kgco2e']['A1A3'] + c['carbon_kgco2e']['A4'] + c['carbon_kgco2e']['A5']:.1f}"),
        ("C1-C4 kgCO2e/m²", lambda c: f"{c['carbon_kgco2e']['C1C4']:.2f}"),
        ("Data", lambda c: "verified" if not loader.is_placeholder(c["carbon_kgco2e"]["provenance"]) else "placeholder / estimate"),
    ]
    print(f"  {'':<26}{replaces[:24]:>25}{target[:24]:>25}")
    for label, get in rows:
        print(f"  {label:<26}{get(old):>25}{get(new):>25}")
    ref, perf = old.get("performance", {}), new.get("performance", {})
    if perf.get("Rw_dB", 0) < ref.get("Rw_dB", 0) or perf.get("fire_class") != ref.get("fire_class"):
        print("\n  NOTE: not like for like on sound or fire, so the comparison flatters the weaker wall.")

    base = scenarios.run_timeline(args.timeline)
    swapped = scenarios.run_timeline(args.timeline, swap={replaces: target})
    adaptable_id = args.timeline.replace("conventional", "adaptable")
    results = [("as in fitouts.json", base), (f"with {new['supplier'].split()[0]} wall", swapped)]
    if adaptable_id != args.timeline and adaptable_id in scenarios._fitouts()["timelines"]:
        results.append(("adaptable variant", scenarios.run_timeline(adaptable_id)))

    print(f"\n{THIN}\n  {'PER m² OF FLOOR':<24}{'UPFRONT':>12}{'CHANGES':>12}{'TOTAL':>12}{'COST':>12}{'REUSE':>8}")
    print(f"  {'':<24}{'kgCO2e':>12}{'kgCO2e':>12}{'kgCO2e':>12}{'SEK':>12}")
    print("  " + "-" * 78)
    for label, r in results:
        changes = sum(t.transformation_carbon for t in r.transformations)
        print(f"  {label[:23]:<24}{r.initial.carbon.upfront / r.area_m2:>12,.1f}{changes / r.area_m2:>12,.1f}"
              f"{r.carbon_per_m2:>12,.0f}{r.cost_per_m2:>12,.0f}{r.mean_circularity:>8.0%}")

    be = scenarios.break_even(base, swapped)
    print(f"""
  {target} INSTEAD OF {replaces}
    upfront carbon .......... {_co2(be.upfront_carbon_premium):>18}
    upfront cost ............ {_sek(be.upfront_cost_premium):>18}
    carbon per change ....... {_co2(-be.carbon_saved_per_change):>18}
    cost per change ......... {_sek(-be.cost_saved_per_change):>18}""")
    if len(results) == 3:
        be2 = scenarios.break_even(swapped, results[2][1])
        print(f"""
  ADAPTABLE (demountable) AGAINST THE {new['supplier'].upper()} VERSION
    upfront premium ......... {_co2(be2.upfront_carbon_premium):>18}   {_sek(be2.upfront_cost_premium):>16}
    break-even, carbon ...... {be2.verdict('carbon')}
    break-even, cost ........ {be2.verdict('cost')}""")
    print(f"""
  {loader.provenance_report().caveat()}
  The supplier's reversibility ({new['reversibility']:.2f}) and recovery ({new['recovery_rate']:.2f}) decide every
  change after the first. They are the numbers to confirm with the supplier.
""")
    return 0


# ---------------------------------------------------------------------------
# experience
# ---------------------------------------------------------------------------


def _bar(score: float, width: int = 22) -> str:
    filled = int(round(score / 100.0 * width))
    return "#" * filled + "." * (width - filled)


def cmd_experience(args) -> int:
    print(RULE)
    print("EVALUATE — experience and social value")
    print(RULE)
    print("""
  The third KPI. Cost and carbon total easily and therefore dominate; these
  qualities have no natural unit and vanish from comparisons unless forced in.
  Scores are shown per dimension and never only as a blend — weighting
  daylight against acoustics is a value judgement, not a measurement.
""")

    profiles = (
        [experience.profile(args.program)] if args.program else experience.profile_all()
    )
    profiles.sort(key=lambda p: -p.blended)

    print(f"  {'USE':<38}{'DAYLT':>7}{'VIEW':>7}{'ACOUS':>7}{'ACCESS':>7}{'STAFF':>7}{'OUTDR':>7}{'MEAN':>7}")
    print("  " + "-" * 87)
    for p in profiles:
        scores = {d.name: d.score for d in p.dimensions}
        print(
            f"  {p.program_label[:37]:<38}"
            f"{scores.get('Daylight reach', 0):>7.0f}"
            f"{scores.get('Seated view out', 0):>7.0f}"
            f"{scores.get('Acoustic comfort', 0):>7.0f}"
            f"{scores.get('Accessible circulation', 0):>7.0f}"
            f"{scores.get('Staff working conditions', 0):>7.0f}"
            f"{scores.get('Outdoor access', 0):>7.0f}"
            f"{p.blended:>7.0f}"
        )

    for p in profiles:
        print(f"\n{THIN}")
        print(f"{p.program_label.upper()}   mean {p.blended:.0f}/100")
        print(THIN)
        for d in sorted(p.dimensions, key=lambda x: x.score):
            flag = " [hard requirement]" if d.is_hard_requirement else ""
            print(f"\n  {d.name}  {_bar(d.score)}  {d.score:.0f}  ({d.band}){flag}")
            print(f"    {d.basis}")
            if d.affected_groups:
                print(f"    Affected user groups: {', '.join(d.affected_groups)}")

        if p.conflicts:
            print(f"\n  CONFLICTING OBJECTIVES ({len(p.conflicts)}) — recorded, not resolved:")
            for c in p.conflicts:
                print(f"\n    {c.between[0]}  vs  {c.between[1]}")
                print(f"      {c.description}")
                print(f"      Owner: {c.resolution_owner}")
        print()

    return 0


# ---------------------------------------------------------------------------
# layout
# ---------------------------------------------------------------------------


def cmd_layout(args) -> int:
    programs = [args.program] if args.program else list(loader.use_programs())

    print(RULE)
    print("ADAPT — parametric layout on the structural grid")
    print(RULE)
    print("""
  The plate is allocated bay by bay, because in reuse the grid is fixed and
  the grid decides everything. Zones needing daylight compete for perimeter
  bays; the rest are pushed deep. The number that matters is the partition
  quantity at the bottom — that is what becomes cost and carbon.
""")

    comparison: list[tuple[str, float, float, float]] = []

    for program_id in programs:
        result = layout.generate(program_id, iterations=args.iterations)
        program = loader.use_programs()[program_id]

        print(THIN)
        print(f"{program['label_en'].upper()}")
        print(THIN)
        print(result.to_ascii())

        partition_m = result.partition_length_m
        partition_area = result.partition_area_m2
        floor_area = sum(b.area_m2 for b in result.grid if not b.is_core)

        print(f"""
  Grid ................... {result.n_cols} x {result.n_rows} bays,
                           {result.grid[0].width_m:.1f} x {result.grid[0].depth_m:.1f} m each
  Usable floor area ...... {floor_area:,.0f} m²
  Internal partition ..... {partition_m:,.0f} m run, {partition_area:,.0f} m² face
  Partition density ...... {partition_area / floor_area:.2f} m² wall per m² floor
  Layout penalty score ... {result.score:,.0f}  (lower is better)""")

        # Price the same layout two ways: irreversible vs demountable, plus any named
        # supplier's like-for-like wall (data/components/suppliers/).
        options = [
            ("part.stud.gypsum.95", "stud + gypsum (irreversible)"),
            ("part.demount.solid.100", "demountable  (reversible)"),
        ]
        supplier_wall = _like_for_like(loader.catalogue(), "part.stud.gypsum.95")
        if supplier_wall:
            options.append((supplier_wall, f"{loader.catalogue()[supplier_wall]['supplier'].split()[0]} (supplier)"))
        for component_id, name in options:
            bill = layout.bill_from_layout(result, component_id)
            assessment = evaluate.evaluate_bill(
                bill, area_m2=floor_area, years=50, include_replacements=False
            )
            print(
                f"  {name:<32}"
                f"{_co2(assessment.carbon.upfront):>16}"
                f"{_sek(assessment.cost.capex):>16}"
            )

        comparison.append((program['label_en'], floor_area, partition_area, result.score))
        print()

    if len(comparison) > 1:
        print(RULE)
        print("PARTITION DEMAND BY USE — how much wall each programme needs")
        print(RULE)
        print(f"\n  {'USE':<42}{'m² wall/m² floor':>18}")
        print("  " + "-" * 58)
        for label, floor_area, partition_area, _score in sorted(
            comparison, key=lambda row: row[2] / row[1]
        ):
            print(f"  {label[:41]:<42}{partition_area / floor_area:>18.2f}")
        print("""
  This spread is the flexibility problem in one table. A shell fitted out
  for the lightest programme cannot become the heaviest without buying a
  great deal of new partition; fit out for the heaviest and you have paid
  for wall you do not need. The adaptable strategy is the third option:
  buy partition once, and move it.
""")
    return 0


# ---------------------------------------------------------------------------
# cad
# ---------------------------------------------------------------------------


def cmd_cad(args) -> int:
    from . import bridge

    print(RULE)
    print("CAD BRIDGE")
    print(RULE)
    print(f"\n  rhino3dm .... {'available' if bridge.RHINO_AVAILABLE else 'NOT INSTALLED'}")
    print(f"  ifcopenshell  {'available' if bridge.IFC_AVAILABLE else 'NOT INSTALLED'}")
    if not bridge.IFC_AVAILABLE:
        print(f"\n  {bridge.IFC_INSTALL_HINT}")

    if args.read:
        print(f"\n{THIN}")
        print(f"MEASURING PLATE FROM {args.read}")
        print(THIN)
        plate = bridge.read_plate_from_3dm(args.read, layer_name=args.layer)
        print(f"""
  Closed curves found .... {plate.curve_count}
  Measured area .......... {plate.area_m2:,.1f} m²
  Measured perimeter ..... {plate.perimeter_m:,.1f} m
  Bounding box ........... {plate.bounding_width_m:.1f} x {plate.bounding_depth_m:.1f} m
  Compactness ............ {plate.compactness:.2f}

  {plate.inferred_vs_measured_note}""")
        if plate.warning:
            print(f"\n  WARNING: {plate.warning}")
        print("\n  Patch for data/building/marievik_shell.json:")
        print(json.dumps(plate.as_shell_patch(), indent=4))
        return 0

    programs = [args.program] if args.program else list(loader.use_programs())
    print(f"\n{THIN}")
    print("EXPORTING LAYOUTS")
    print(THIN)
    for program_id in programs:
        written = bridge.export_all(program_id)
        print(f"\n  {program_id}")
        for kind, path in written.items():
            print(f"    {kind:<5} {path.relative_to(ROOT)}  ({path.stat().st_size:,} bytes)")

    print("""
  Rhino layers written:
    Zone_<id>    one layer per programme zone, bay rectangles
    Partitions   lines where zones meet — this is the quantity that
                 becomes cost and carbon
    Core         the fixed core
  The CSV is flat and unnested on purpose: one row per bay, absolute
  coordinates, ready for Grasshopper without any parsing gymnastics.
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

    supplier = sub.add_parser("supplier", help="test a supplier's product in a use timeline")
    supplier.add_argument("component", nargs="?", help="catalogue id; default: like for like with --replaces")
    supplier.add_argument("--replaces", default="part.stud.gypsum.95", help="component it replaces")
    supplier.add_argument("--timeline", default="conventional_change_of_use", help="timeline id in fitouts.json")
    supplier.set_defaults(func=cmd_supplier)

    cad = sub.add_parser("cad", help="import geometry from / export layouts to CAD")
    cad.add_argument("-p", "--program", help="single programme id to export")
    cad.add_argument("-r", "--read", help="measure a floor plate from a .3dm file")
    cad.add_argument("-l", "--layer", help="restrict --read to this Rhino layer")
    cad.set_defaults(func=cmd_cad)

    exp = sub.add_parser("experience", help="score experience and social value")
    exp.add_argument("-p", "--program", help="single programme id")
    exp.set_defaults(func=cmd_experience)

    layout_parser = sub.add_parser("layout", help="generate parametric bay layouts")
    layout_parser.add_argument("-p", "--program", help="single programme id")
    layout_parser.add_argument(
        "-n", "--iterations", type=int, default=12000, help="annealing iterations"
    )
    layout_parser.set_defaults(func=cmd_layout)

    run_all = sub.add_parser("all", help="run everything and write a timestamped record")
    run_all.add_argument("-p", "--program", default=None, help=argparse.SUPPRESS)
    run_all.set_defaults(func=cmd_all)

    args = parser.parse_args(argv)
    if not hasattr(args, "program"):
        args.program = None
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
