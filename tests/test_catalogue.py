"""Consistency checks for the use catalogue (data/catalogue/).

The catalogue is written by hand and by research passes, one file at a time, so
the things most likely to drift are the links between files: a space that
depends on a space that does not exist, a use shared with a use that was
renamed, a strength label nobody defined. These checks catch that drift; they
say nothing about whether a cited value is right.

Run:  python -m tests.test_catalogue
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data" / "catalogue"

STRENGTHS = {"law", "guidance", "programme", "practice", "none"}
CONFIDENCE = {"verified", "sourced", "indicative"}
FAMILIES = {"education", "care", "housing", "work", "commercial", "community", "health", "hospitality"}

# Uses a rule or a shared space may point to that have no file of their own (yet). Listing them here
# keeps a typo from passing as one of these.
EXTERNAL_USES = {
    "park", "public_square", "sports_ground", "nightclub", "arena", "large_assembly", "museum", "church",
    "prison", "hospital", "industry", "storage", "adult_education", "culture_school", "youth_centre",
    "day_centre", "day_centre_elderly",
}

FAILURES: list[str] = []
WARNINGS: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        print(f"  [FAIL] {message}")
        FAILURES.append(message)


def warn(condition: bool, message: str) -> None:
    if not condition:
        WARNINGS.append(message)


def load_uses() -> dict[str, dict]:
    uses = {}
    for path in sorted((ROOT / "uses").glob("*.json")):
        try:
            uses[path.stem] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            check(False, f"{path.name}: invalid JSON ({e})")
    return uses


def test_use(uid: str, use: dict, uses: dict[str, dict]) -> None:
    check(use.get("id") == uid, f"{uid}: id matches file name (got {use.get('id')!r})")
    check(use.get("family") in FAMILIES, f"{uid}: family {use.get('family')!r} is known")
    for key in ("label_en", "label_sv", "regulatory", "occupancy", "spaces", "sources"):
        check(key in use, f"{uid}: has {key}")

    hourly = use.get("occupancy", {}).get("hourly_presence")
    if hourly is not None:
        check(len(hourly) == 24 and all(0 <= h <= 1 for h in hourly),
              f"{uid}: hourly_presence is 24 shares in 0-1")

    spaces = use.get("spaces", [])
    check(len(spaces) > 0, f"{uid}: has at least one space")
    ids = [s.get("id") for s in spaces]
    check(len(ids) == len(set(ids)), f"{uid}: space ids are unique")

    for s in spaces:
        sid = f"{uid}/{s.get('id')}"
        req = s.get("required", {})
        check(req.get("strength") in STRENGTHS, f"{sid}: required.strength {req.get('strength')!r} is known")
        size = s.get("size") or {}
        if size:
            check(size.get("strength") in STRENGTHS, f"{sid}: size.strength {size.get('strength')!r} is known")
            if size.get("confidence") is not None:
                check(size["confidence"] in CONFIDENCE, f"{sid}: size.confidence {size['confidence']!r} is known")
            if size.get("strength") == "none":
                warn(size.get("value_m2") is None, f"{sid}: size strength 'none' but value_m2 is set")
        for dep in s.get("depends_on", []):
            check(dep in ids, f"{sid}: depends_on {dep!r} is a space in the same use")
        for other in s.get("shareable_with", []):
            warn(other in uses or other in EXTERNAL_USES, f"{sid}: shareable_with {other!r} is not a use file")


def test_cross_cutting(uses: dict[str, dict]) -> None:
    path = ROOT / "cross_cutting.json"
    check(path.exists(), "cross_cutting.json exists")
    if not path.exists():
        return
    cc = json.loads(path.read_text(encoding="utf-8"))
    rule_ids = {e["id"] for section in cc.values() if isinstance(section, list)
                for e in section if isinstance(e, dict) and "id" in e}
    for section, entries in cc.items():
        if not isinstance(entries, list):
            continue
        for e in entries:
            if isinstance(e, dict):
                for u in e.get("applies_to_uses", []):
                    warn(u in uses or u in EXTERNAL_USES or u == "all", f"cross_cutting/{e.get('id')}: applies_to_uses {u!r} is not a use file")
    for uid, use in uses.items():
        for ref in use.get("regulatory", {}).get("cross_cutting_refs", []):
            check(ref in rule_ids, f"{uid}: cross_cutting_refs {ref!r} exists in cross_cutting.json")


def main() -> int:
    uses = load_uses()
    print(f"\nUse catalogue: {len(uses)} uses")
    for uid, use in uses.items():
        test_use(uid, use, uses)
    test_cross_cutting(uses)

    if WARNINGS:
        print(f"\n{len(WARNINGS)} warnings (links to uses or values that may be missing):")
        for w in WARNINGS:
            print(f"  [warn] {w}")
    print(f"\n{len(FAILURES)} failures")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
