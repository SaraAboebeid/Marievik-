"""Smoke tests and conservation checks.

The important tests here are the conservation ones. A transformation ledger
that does not balance will still produce confident-looking numbers, and the
error is invisible in the output — which is exactly the kind of bug that
survives into a publication.

Run:  python -m tests.test_engine
"""

from __future__ import annotations

import json
import sys

from engine import evaluate, fit, loader, scenarios

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  [ok]   {message}")
    else:
        print(f"  [FAIL] {message}")
        FAILURES.append(message)


def test_data_loads() -> None:
    print("\nData loading")
    check(len(loader.user_groups()) >= 10, "user groups load")
    check(len(loader.use_programs()) >= 5, "use programmes load")
    check(len(loader.catalogue()) >= 15, "component catalogue loads")
    check("structure" in loader.shell(), "shell loads")

    components = loader.catalogue()
    for cid, component in components.items():
        for field in ("layer", "unit", "service_life_years", "reversibility", "recovery_rate"):
            if field not in component:
                check(False, f"{cid} missing required field '{field}'")
        if not 0.0 <= component["recovery_rate"] <= component["reversibility"] + 1e-9:
            check(
                False,
                f"{cid}: recovery_rate ({component['recovery_rate']}) exceeds "
                f"reversibility ({component['reversibility']}) — you cannot recover "
                "more of a component than you can detach",
            )
    check(True, "every component has required fields and recovery <= reversibility")


def test_transformation_conserves_quantity() -> None:
    """retained + removed == what was there; retained + provided == what is wanted."""
    print("\nTransformation ledger conservation")
    data = loader.load_json("scenarios/fitouts.json")
    fitouts = data["fitouts"]

    pairs = [
        ("office_flexible__conventional", "student_housing__conventional"),
        ("office_flexible__adaptable", "student_housing__adaptable"),
        ("elderly_care__adaptable", "event_venue__adaptable"),
        ("student_housing__adaptable", "office_flexible__adaptable"),
    ]

    all_balanced = True
    for from_id, to_id in pairs:
        bill_from = fitouts[from_id]["bill"]
        bill_to = fitouts[to_id]["bill"]
        result = scenarios.transform(bill_from, bill_to, year=2040)

        for cid in set(bill_from) | set(bill_to):
            had = bill_from.get(cid, 0.0)
            wanted = bill_to.get(cid, 0.0)
            retained = result.retained.get(cid, 0.0)
            removed = had - retained
            provided = result.reused.get(cid, 0.0) + result.bought_new.get(cid, 0.0)

            if abs(retained + removed - had) > 1e-6:
                check(False, f"{from_id}->{to_id} {cid}: removal side does not balance")
                all_balanced = False
            if abs(retained + provided - wanted) > 1e-6:
                check(
                    False,
                    f"{from_id}->{to_id} {cid}: "
                    f"retained {retained} + provided {provided} != wanted {wanted}",
                )
                all_balanced = False

            # Recovered material must not exceed what was taken out.
            landfilled = result.landfilled.get(cid, 0.0)
            if landfilled > removed + 1e-6:
                check(False, f"{from_id}->{to_id} {cid}: landfilled more than removed")
                all_balanced = False

    if all_balanced:
        check(True, f"quantity conserved across {len(pairs)} transformations")


def test_churn_costs_something() -> None:
    """An unchanged use must not be free over 50 years."""
    print("\nChurn")
    data = loader.load_json("scenarios/fitouts.json")
    bill = data["fitouts"]["office_flexible__conventional"]["bill"]

    without = scenarios.transform(bill, bill, year=2041, churn=0.0)
    with_churn = scenarios.transform(bill, bill, year=2041, churn=0.6)

    check(
        without.transformation_carbon == 0.0,
        "identical fit-out with no churn costs nothing (baseline)",
    )
    check(
        with_churn.transformation_carbon > 0.0,
        "identical fit-out WITH churn costs carbon — business-as-usual is not free",
    )


def test_stock_carries_forward() -> None:
    """Material recovered at one change must be available at the next."""
    print("\nReuse stock carry-forward")
    stock: dict[str, float] = {}
    bill_many = {"part.demount.solid.100": 600.0}
    bill_few = {"part.demount.solid.100": 100.0}

    first = scenarios.transform(bill_many, bill_few, year=2036, stock=stock)
    check(
        stock.get("part.demount.solid.100", 0.0) > 0,
        "removing partitions puts recovered material into the stock",
    )
    check(first.landfilled.get("part.demount.solid.100", 0.0) > 0, "unrecovered share is waste")

    second = scenarios.transform(bill_few, bill_many, year=2056, stock=stock)
    check(
        second.reused.get("part.demount.solid.100", 0.0) > 0,
        "the next change of use draws on that stock instead of buying new",
    )
    check(
        second.circularity > 0.0,
        f"carbon-weighted reuse is non-zero ({second.circularity:.0%})",
    )


def test_module_d_excluded() -> None:
    print("\nLCA conventions")
    bill = {"part.demount.solid.100": 100.0}
    result = evaluate.evaluate_bill(bill, area_m2=1040, years=50)
    check(result.carbon.d_credit < 0, "module D is recorded and negative")
    check(
        result.carbon.d_credit not in (result.carbon.total_excluding_d,),
        "module D is not folded into the headline total",
    )
    manual = (
        result.carbon.a1a3 + result.carbon.a4 + result.carbon.a5
        + result.carbon.b4 + result.carbon.c1c4
    )
    check(
        abs(manual - result.carbon.total_excluding_d) < 1e-6,
        "headline total = A1-A3 + A4 + A5 + B4 + C1-C4, with D excluded",
    )


def test_fit_runs() -> None:
    print("\nFit engine")
    results = fit.fit_all()
    check(len(results) == len(loader.use_programs()), "every programme is tested")
    for result in results:
        check(
            result.capacity_upgraded >= result.capacity_as_is - 1e-6,
            f"{result.program_id}: upgraded capacity >= as-is capacity",
        )
    care = fit.fit_program("elderly_care")
    check(
        any(c.name == "Lift car size" for c in care.blockers),
        "elderly care correctly blocks on the 1100x1400 lift",
    )


def test_timelines_run() -> None:
    print("\nTimelines")
    results = scenarios.compare_timelines()
    check(len(results) >= 4, "all timelines evaluate")
    for result in results:
        check(
            result.total_carbon > 0 and result.total_cost > 0,
            f"{result.timeline_id}: produces positive totals",
        )


def test_supplier_data() -> None:
    """Supplier files merge into the catalogue; swapping a product conserves quantities."""
    print("\nSupplier data")
    check(loader.is_placeholder("PLACEHOLDER") and loader.is_placeholder("ESTIMATE: derived")
          and not loader.is_placeholder("EPD S-P-07305"), "provenance markers: PLACEHOLDER and ESTIMATE are unverified")

    bill = {"part.stud.gypsum.95": 100.0, "part.demount.solid.100": 50.0}
    swapped = scenarios.swap_bill(bill, {"part.stud.gypsum.95": "part.demount.solid.100"})
    check(swapped == {"part.demount.solid.100": 150.0}, "swap_bill merges quantities and keeps the total")

    files = loader.supplier_files()
    if not files:
        print("  [skip] no local supplier files in data/components/suppliers/")
        return
    from engine import intake
    for path in files:
        rejected = [r.component_id for r in intake.validate_file(path) if not r.accepted]
        check(not rejected, f"{path.name}: every entry passes the supplier schema {rejected or ''}")
    catalogue = loader.catalogue()
    ids = [c["id"] for p in files for c in json.loads(p.read_text(encoding="utf-8"))["components"]]
    check(all(i in catalogue for i in ids), f"{len(ids)} supplier components merged into the catalogue")
    if "part.smartax.70.ei60" in catalogue:
        base = scenarios.run_timeline("conventional_change_of_use")
        smartax = scenarios.run_timeline("conventional_change_of_use",
                                         swap={"part.stud.gypsum.95": "part.smartax.70.ei60"})
        check(smartax.initial.carbon.upfront < base.initial.carbon.upfront,
              "Smartax EI60 lowers the upfront carbon of the conventional timeline")
        check(len(smartax.transformations) == len(base.transformations),
              "the swapped timeline has the same changes of use")


def main() -> int:
    print("=" * 70)
    print("Marievik+ engine tests")
    print("=" * 70)

    test_data_loads()
    test_transformation_conserves_quantity()
    test_churn_costs_something()
    test_stock_carries_forward()
    test_module_d_excluded()
    test_fit_runs()
    test_timelines_run()
    test_supplier_data()

    print("\n" + "=" * 70)
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S)")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
