"""Data loading and provenance tracking.

Every number that enters the lab passes through here, and every number is
asked the same question: where did you come from? Results that rest on
placeholder data are still useful for developing the model — they are not
useful for making claims. The distinction is enforced here rather than
left to memory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

PLACEHOLDER_MARKERS = {"PLACEHOLDER", "UNKNOWN", "GENERIC", "ESTIMATE"}
SUPPLIERS = DATA / "components" / "suppliers"


def is_placeholder(provenance: Any) -> bool:
    """PLACEHOLDER, UNKNOWN, GENERIC, or a stated derivation such as 'ESTIMATE: ...'."""
    head = str(provenance).split(":", 1)[0].strip().upper()
    return head in PLACEHOLDER_MARKERS


def load_json(relative_path: str) -> dict[str, Any]:
    path = DATA / relative_path
    if not path.exists():
        raise FileNotFoundError(
            f"Missing data file: {path}\n"
            f"The lab cannot run without it. See README.md for the expected layout."
        )
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=None)
def user_groups() -> dict[str, dict]:
    raw = load_json("standards/user_groups.json")
    return {group["id"]: group for group in raw["groups"]}


@lru_cache(maxsize=None)
def use_programs() -> dict[str, dict]:
    raw = load_json("standards/space_requirements.json")
    return {program["id"]: program for program in raw["use_programs"]}


@lru_cache(maxsize=None)
def catalogue_uses() -> dict[str, dict]:
    """The project-neutral use catalogue (data/catalogue/uses), keyed by use id."""
    return {path.stem: load_json(f"catalogue/uses/{path.name}")
            for path in sorted((DATA / "catalogue" / "uses").glob("*.json"))}


@lru_cache(maxsize=None)
def cross_cutting_rules() -> dict[str, dict]:
    """Rules that apply across uses (data/catalogue/cross_cutting.json), keyed by rule id."""
    raw = load_json("catalogue/cross_cutting.json")
    return {rule["id"]: rule for section in raw.values() if isinstance(section, list)
            for rule in section if isinstance(rule, dict) and "id" in rule}


def supplier_files() -> list[Path]:
    """Local supplier catalogues (gitignored), merged into the catalogue when present."""
    return sorted(SUPPLIERS.glob("*.json")) if SUPPLIERS.is_dir() else []


@lru_cache(maxsize=None)
def catalogue() -> dict[str, dict]:
    raw = load_json("components/catalogue.json")
    components = {component["id"]: component for component in raw["components"]}
    for path in supplier_files():
        with path.open(encoding="utf-8") as handle:
            for component in json.load(handle)["components"]:
                if component["id"] in components:
                    raise ValueError(f"{path.name}: {component['id']} is already in the catalogue")
                components[component["id"]] = component
    return components


@lru_cache(maxsize=None)
def shell() -> dict[str, Any]:
    return load_json("building/marievik_shell.json")


@lru_cache(maxsize=None)
def operational_factors() -> dict[str, Any]:
    return load_json("factors/operational.json")


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


@dataclass
class ProvenanceReport:
    """How much of this dataset is real, and how much is scaffolding."""

    total_values: int = 0
    placeholder_values: int = 0
    unverified_records: list[str] = field(default_factory=list)

    @property
    def placeholder_share(self) -> float:
        if self.total_values == 0:
            return 0.0
        return self.placeholder_values / self.total_values

    @property
    def confidence_label(self) -> str:
        share = self.placeholder_share
        if share == 0.0:
            return "VERIFIED"
        if share < 0.25:
            return "MOSTLY VERIFIED"
        if share < 0.75:
            return "MIXED — development only"
        return "PLACEHOLDER — development only, not publishable"

    def caveat(self) -> str:
        return (
            f"[{self.confidence_label}] "
            f"{self.placeholder_values}/{self.total_values} values "
            f"({self.placeholder_share:.0%}) are placeholders."
        )


def _walk_provenance(node: Any, path: str, report: ProvenanceReport) -> None:
    """Recursively count values and flag placeholder provenance."""
    if isinstance(node, dict):
        provenance = node.get("provenance")
        numeric_siblings = [
            key
            for key, value in node.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        ]
        if provenance is not None and numeric_siblings:
            report.total_values += len(numeric_siblings)
            if is_placeholder(provenance):
                report.placeholder_values += len(numeric_siblings)
                report.unverified_records.append(path)

        confidence = node.get("confidence")
        if confidence == "indicative":
            report.unverified_records.append(f"{path} (indicative)")

        for key, value in node.items():
            if key.startswith("_") or key in {"notes", "note"}:
                continue
            _walk_provenance(value, f"{path}/{key}" if path else key, report)

    elif isinstance(node, list):
        for index, value in enumerate(node):
            label = value.get("id", index) if isinstance(value, dict) else index
            _walk_provenance(value, f"{path}[{label}]", report)


def provenance_report() -> ProvenanceReport:
    """Audit every dataset the lab will use in a run."""
    report = ProvenanceReport()
    for name, payload in (
        ("user_groups", load_json("standards/user_groups.json")),
        ("space_requirements", load_json("standards/space_requirements.json")),
        ("catalogue", load_json("components/catalogue.json")),
        ("shell", load_json("building/marievik_shell.json")),
    ):
        _walk_provenance(payload, name, report)
    for path in supplier_files():
        with path.open(encoding="utf-8") as handle:
            _walk_provenance(json.load(handle), f"suppliers/{path.stem}", report)
    return report


def unverified_shell_fields() -> list[str]:
    """Shell facts that are explicitly flagged as unconfirmed.

    These matter more than the placeholder count: a wrong live-load
    assumption does not make a result imprecise, it makes it wrong.
    """
    data = shell()
    gaps: list[str] = []

    if not data["structure"].get("live_load_verified", False):
        gaps.append(
            "structure.live_load_capacity_kn_m2 is UNVERIFIED — "
            "all assembly and care results are conditional on a structural check"
        )
    if not data["condition_survey"].get("asbestos_survey_done", False):
        gaps.append(
            "condition_survey.asbestos_survey_done is false — "
            "no demolition or transformation cost can be relied on until screened"
        )
    for key, value in data["condition_survey"].items():
        if value == "UNKNOWN":
            gaps.append(f"condition_survey.{key} is UNKNOWN")
    if data["building"]["protection_status"].get("detaljplan_constraints", "").startswith("UNKNOWN"):
        gaps.append(
            "building.protection_status.detaljplan_constraints is UNKNOWN — "
            "planning permission may decide use before any technical analysis does"
        )
    for core in data["core_and_circulation"]["cores"]:
        if core.get("riser_spare_capacity") == "UNKNOWN":
            gaps.append(f"core_and_circulation.{core['id']}.riser_spare_capacity is UNKNOWN")
    return gaps
