"""Run the optimiser.

    python -m optimise                                   all four uses, Marievik+ bay
    python -m optimise --shell mandolingatan_1802        a traced real plan
    python -m optimise --uses student_housing family_housing
    python -m optimise --azimuth 90 --carbon-price 2.0   east facade, dearer carbon
    python -m optimise --quick                           smaller search, for testing

Writes runs/optimise/<timestamp>/results.json and report.html. The same run
can be started from the Apartment Lab's Optimise tab.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from apartment import shells

from . import adapt, programs, run


def main(argv: list[str] | None = None) -> Path:
    parser = argparse.ArgumentParser(prog="python -m optimise")
    parser.add_argument("--shell", default="marievik_bay", choices=list(shells.all_shells()))
    parser.add_argument("--uses", nargs="+", default=list(programs.BRIEFS))
    parser.add_argument("--azimuth", type=float, default=None,
                        help="facade orientation, degrees clockwise from north (default: the shell's own)")
    parser.add_argument("--carbon-price", type=float, default=adapt.DEFAULT_CARBON_PRICE)
    parser.add_argument("--min-comfort", type=float, default=adapt.DEFAULT_FLOOR["comfort"],
                        help="quality floor for the cross-use recommendation, %% comfortable hours")
    parser.add_argument("--min-usability", type=float, default=adapt.DEFAULT_FLOOR["usability"])
    parser.add_argument("--min-functionality", type=float, default=adapt.DEFAULT_FLOOR["functionality"])
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    floor = {"comfort": args.min_comfort, "usability": args.min_usability,
             "functionality": args.min_functionality}
    results = run.optimise(args.uses, shell_id=args.shell, quick=args.quick, azimuth=args.azimuth,
                           carbon_price=args.carbon_price, floor=floor, seed=args.seed)
    out_dir = run.save(results)
    print(f"\nwrote {out_dir} in {results['elapsed_s']} s")
    return out_dir


if __name__ == "__main__":
    main()
