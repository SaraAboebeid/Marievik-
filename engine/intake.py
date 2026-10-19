"""Supplier intake — validate submissions before they enter the catalogue.

A dependency-free validator covering the JSON Schema subset the submission
schema actually uses. Written this way so a supplier can run it too: no pip
install, no environment, just Python.

Beyond schema conformance it applies the cross-field rules that matter here
and that no schema can express — recovery cannot exceed reversibility,
declared reversibility must match the fixing method, and a product claiming
reuse credit must say what happens at end of life.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from . import loader

SCHEMA_PATH = loader.DATA / "schema" / "supplier_submission.schema.json"

# Reversibility implied by fixing method. A submission may sit below its
# implied value (a bolted product in an awkward position) but claiming to
# sit far above it is a physical claim needing justification.
FIXING_REVERSIBILITY = {
    "loose_laid": 1.00,
    "clamped": 0.90,
    "bolted": 0.85,
    "bolted_track": 0.80,
    "screwed": 0.70,
    "screwed_and_skimmed": 0.15,
    "nailed": 0.30,
    "glued": 0.10,
    "welded": 0.05,
    "cast_in_situ": 0.00,
}

# Word-boundary matched, and only applied to the 'stuff' layer — otherwise
# "drainage stack" trips the "stack" hint, which is how a validator loses
# the reader's trust.
STACKABLE_HINTS = ("stacking", "stackable", "folding", "mobile", "castors", "nesting")


@dataclass
class Issue:
    severity: str  # "error" | "warning" | "note"
    path: str
    message: str

    def __str__(self) -> str:
        marker = {"error": "ERROR  ", "warning": "WARNING", "note": "NOTE   "}[self.severity]
        return f"  [{marker}] {self.path}: {self.message}"


@dataclass
class ValidationResult:
    component_id: str
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def accepted(self) -> bool:
        return not self.errors


# ---------------------------------------------------------------------------
# Schema validation (the subset we use)
# ---------------------------------------------------------------------------


def _type_matches(value, expected: str) -> bool:
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    return True


def _validate_against(value, schema: dict, path: str, issues: list[Issue]) -> None:
    if "enum" in schema and value not in schema["enum"]:
        issues.append(Issue(
            "error", path,
            f"{value!r} is not one of {schema['enum']}",
        ))
        return

    expected = schema.get("type")
    if expected and not _type_matches(value, expected):
        issues.append(Issue("error", path, f"expected {expected}, got {type(value).__name__}"))
        return

    if expected == "number":
        if "minimum" in schema and value < schema["minimum"]:
            issues.append(Issue("error", path, f"{value} is below minimum {schema['minimum']}"))
        if "maximum" in schema and value > schema["maximum"]:
            issues.append(Issue("error", path, f"{value} is above maximum {schema['maximum']}"))

    if expected == "string":
        if "minLength" in schema and len(value) < schema["minLength"]:
            issues.append(Issue("error", path, f"shorter than {schema['minLength']} characters"))
        if "pattern" in schema and not re.match(schema["pattern"], value):
            issues.append(Issue("error", path, f"{value!r} does not match {schema['pattern']}"))

    if expected == "object" or isinstance(value, dict):
        for required in schema.get("required", []):
            if required not in value:
                issues.append(Issue("error", f"{path}.{required}", "required field is missing"))
        for key, child in value.items():
            child_schema = schema.get("properties", {}).get(key)
            if child_schema:
                _validate_against(child, child_schema, f"{path}.{key}", issues)


# ---------------------------------------------------------------------------
# Cross-field rules — the part a schema cannot express
# ---------------------------------------------------------------------------


def _apply_domain_rules(submission: dict, issues: list[Issue]) -> None:
    reversibility = submission.get("reversibility")
    recovery = submission.get("recovery_rate")
    fixing = submission.get("fixing")

    if isinstance(reversibility, (int, float)) and isinstance(recovery, (int, float)):
        if recovery > reversibility + 1e-9:
            issues.append(Issue(
                "error", "recovery_rate",
                f"recovery_rate ({recovery}) exceeds reversibility ({reversibility}). "
                "You cannot recover more of a product than you can detach.",
            ))
        elif recovery == reversibility and reversibility > 0.5:
            issues.append(Issue(
                "warning", "recovery_rate",
                "recovery_rate equals reversibility. That claims nothing is damaged on "
                "removal, which is unusual — demountable tiles typically detach cleanly "
                "and still break. Confirm this is measured rather than assumed.",
            ))

    if fixing in FIXING_REVERSIBILITY and isinstance(reversibility, (int, float)):
        implied = FIXING_REVERSIBILITY[fixing]
        if reversibility > implied + 0.15:
            issues.append(Issue(
                "warning", "reversibility",
                f"declared {reversibility} against ~{implied} implied by fixing "
                f"'{fixing}'. Justify, or reconsider the fixing classification.",
            ))

    carbon = submission.get("carbon_kgco2e", {})
    if isinstance(carbon, dict):
        if carbon.get("D", -1) == 0 and (recovery or 0) > 0.5:
            issues.append(Issue(
                "warning", "carbon_kgco2e.D",
                f"recovery_rate is {recovery} but module D is zero. A product that is "
                "recoverable should carry a reuse benefit — or explain why not.",
            ))
        if "C1C4" in carbon and carbon["C1C4"] == 0:
            issues.append(Issue(
                "warning", "carbon_kgco2e.C1C4",
                "C1-C4 is zero. End of life is never free; a missing module reported as "
                "zero silently improves the product's ranking.",
            ))
        provenance = str(carbon.get("provenance", "")).upper()
        if "PLACEHOLDER" in provenance:
            issues.append(Issue(
                "note", "carbon_kgco2e.provenance",
                "PLACEHOLDER carbon data — usable for model development, excluded from "
                "publishable results.",
            ))
        elif loader.is_placeholder(provenance):
            issues.append(Issue(
                "note", "carbon_kgco2e.provenance",
                "ESTIMATE — derived by the lab, not stated by the supplier. Counted as "
                "unverified until the supplier confirms it.",
            ))
        elif "EPD" not in provenance:
            issues.append(Issue(
                "note", "carbon_kgco2e.provenance",
                "No EPD referenced. Ask whether one exists — including for C1-C4 and D.",
            ))

    cost = submission.get("cost_sek", {})
    if isinstance(cost, dict) and cost.get("labour_demount") == 0:
        if submission.get("fixing") not in {"loose_laid"}:
            issues.append(Issue(
                "warning", "cost_sek.labour_demount",
                "Zero demount cost for a fixed product. Only genuinely loose-laid items "
                "cost nothing to remove; a zero here quietly subsidises the adaptability case.",
            ))

    name = str(submission.get("name", "")).lower()
    performance = submission.get("performance", {})
    looks_stackable = (
        submission.get("layer") == "stuff"
        and any(re.search(rf"\b{hint}\b", name) for hint in STACKABLE_HINTS)
    )
    if looks_stackable and isinstance(performance, dict):
        if "stored_footprint_m2" not in performance:
            issues.append(Issue(
                "warning", "performance.stored_footprint_m2",
                "This looks like a stackable or movable product but declares no stored "
                "footprint. A reconfigurable programme has to store what it is not using, "
                "and that storage is real floor area the model cannot see without this.",
            ))

    if submission.get("layer") == "structure" and (reversibility or 0) > 0.5:
        issues.append(Issue(
            "note", "layer",
            "A highly reversible structural product is unusual and interesting — "
            "demountable structure is exactly what this project is looking for. Flag it "
            "for closer review rather than treating it as a data error.",
        ))


# ---------------------------------------------------------------------------


def validate(submission: dict) -> ValidationResult:
    """Validate one component submission."""
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        schema = json.load(handle)

    issues: list[Issue] = []
    _validate_against(submission, schema, "", issues)
    _apply_domain_rules(submission, issues)

    # Clean up the root path prefix.
    for issue in issues:
        issue.path = issue.path.lstrip(".") or "(root)"

    return ValidationResult(
        component_id=str(submission.get("id", "<no id>")),
        issues=issues,
    )


def validate_file(path: Path) -> list[ValidationResult]:
    """Validate a submission file: one object, a list, or a catalogue."""
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, dict) and "components" in payload:
        submissions = payload["components"]
    elif isinstance(payload, list):
        submissions = payload
    else:
        submissions = [payload]

    return [validate(item) for item in submissions]


def validate_catalogue() -> list[ValidationResult]:
    """Hold the lab's own catalogue to the standard it asks suppliers to meet."""
    return [validate(component) for component in loader.catalogue().values()]


def template() -> dict:
    """A blank submission with every required field, for sending to suppliers."""
    return {
        "id": "part.example.product.100",
        "name": "Example product, 100 mm",
        "supplier": "Your company name",
        "product_url": "",
        "epd_reference": "",
        "layer": "space_plan",
        "unit": "m2",
        "service_life_years": 30,
        "fixing": "bolted",
        "reversibility": 0.85,
        "recovery_rate": 0.75,
        "cost_sek": {
            "material": 0,
            "labour_install": 0,
            "labour_demount": 0,
            "provenance": "list price 2026",
        },
        "carbon_kgco2e": {
            "A1A3": 0,
            "A4": 0,
            "A5": 0,
            "C1C4": 0,
            "D": 0,
            "transport_distance_km": 0,
            "provenance": "EPD S-P-xxxxx",
        },
        "performance": {},
        "reuse_offer": {
            "takeback_scheme": False,
            "residual_value_share": 0,
            "refurbishment_available": False,
        },
        "notes": "",
    }


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    results = validate_file(target) if target else validate_catalogue()
    failed = 0
    for result in results:
        if result.issues:
            print(f"\n{result.component_id}")
            for issue in result.issues:
                print(issue)
        if not result.accepted:
            failed += 1
    print(f"\n{len(results)} submission(s), {failed} rejected.")
    sys.exit(1 if failed else 0)
