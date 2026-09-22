"""The standards engine — dimensional requirements derived, not asserted.

This is the layer Neufert occupies in a design office, rebuilt as code that
the rest of the project queries:

    ergonomics.json    bodies, reach envelopes, the space an ACTIVITY needs
    space_types.json   rooms declared as the activities they must support
    rules.py           resolves one against the other for a given user group

The point of the indirection: a wardrobe does not have a clearance. A
wardrobe has an ACTIVITY — standing at it with the door open — and that
activity has a different depth for an ambulant adult than for a wheelchair
user. Hard-coding "750 mm" into the furniture record hides that and makes the
model wrong for every user group but one.

Every resolved requirement carries its citation back out, so any number the
platform shows can be traced to the clause it came from — or flagged as
uncited, which is just as useful.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"


@lru_cache(maxsize=None)
def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def envelopes() -> dict[str, dict]:
    return {e["id"]: e for e in _load("ergonomics.json")["envelopes"]}


@lru_cache(maxsize=None)
def activity_zones() -> dict[str, dict]:
    return {z["id"]: z for z in _load("ergonomics.json")["activity_zones"]["zones"]}


@lru_cache(maxsize=None)
def space_types() -> dict[str, dict]:
    return {s["id"]: s for s in _load("space_types.json")["space_types"]}


@lru_cache(maxsize=None)
def item_activities() -> dict[str, dict]:
    raw = _load("space_types.json")["item_activities"]
    return {k: v for k, v in raw.items() if not k.startswith("_")}


@lru_cache(maxsize=None)
def fixture_families() -> dict[str, list]:
    raw = _load("space_types.json")["fixture_families"]
    return {k: v for k, v in raw.items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
# Scaling an activity to a user group
# ---------------------------------------------------------------------------

# How much of an activity zone is the body, and how much is the task. The
# body part grows with the user's occupied size; the task part does not —
# an oven door opens the same distance whoever is standing at it.
#
# The growth is ADDITIVE, not multiplicative. Multiplying by the ratio of
# occupied depths compounds: a wheelchair's 1200 mm occupied depth is 2.7x
# a standing adult's 450 mm, which turned "turn around on the spot" into a
# 2400 mm requirement. Adding the difference gives 1500 mm, which is the
# real accessible figure. Body depth is an offset, not a multiplier.
BODY_SHARE = {
    "pass_single": 1.0,
    "pass_two": 1.0,
    "open_drawer": 0.5,
    "open_wardrobe": 0.6,
    "sit_at_table": 0.7,
    "work_at_counter": 0.5,
    "bend_to_oven": 0.5,
    "make_bed": 0.8,
}

# Zones already dimensioned around a device or a task, not a generic body.
# Scaling these would double-count the wheelchair that defines them. The
# turning zone resolves to the group's own turning circle instead.
ABSOLUTE_ZONES = {
    "stand_and_turn", "transfer_wheelchair", "assist_two_staff", "hoist_transfer",
}

REFERENCE_DEPTH = 450  # occupied depth of the reference ambulant adult, mm
REFERENCE_WIDTH = 600  # occupied width of the same reference body, mm


@dataclass
class Requirement:
    """One resolved dimensional requirement, with its reasoning attached."""

    key: str
    value_mm: float
    basis: str
    source_ref: list[str] = field(default_factory=list)
    neufert_ref: str = ""
    derived: bool = True

    @property
    def cited(self) -> bool:
        return bool(self.source_ref) or bool(self.neufert_ref)


def turning_circle(user_group: str, level: str = "raised") -> Requirement:
    """Manoeuvring diameter for a user group at a given level of provision."""
    circles = _load("ergonomics.json")["turning"]["circles"]
    matches = [c for c in circles if c["user_group"] == user_group]
    if not matches:
        return Requirement("turning_circle", 1200,
                           "no entry for this user group; ambulant adult assumed",
                           derived=False)
    exact = [c for c in matches if c["level"] in (level, "any")]
    chosen = max(exact or matches, key=lambda c: c["turn_mm"])
    return Requirement(
        "turning_circle", chosen["turn_mm"],
        f"{user_group} at {chosen['level']} level of provision",
        chosen.get("source_ref", []), chosen.get("neufert_ref", ""),
        derived=False,
    )


def activity_clearance(activity_id: str, user_group: str) -> Requirement:
    """Depth an activity needs, scaled to the body doing it.

    The zone's depth is split into a body part and a task part. Only the
    body part scales with the user group, because the oven door opens the
    same distance for everyone.
    """
    zone = activity_zones().get(activity_id)
    if not zone:
        return Requirement(activity_id, 0, "unknown activity", derived=False)

    envelope = envelopes().get(user_group) or envelopes()["adult"]
    base_depth = zone.get("depth", 0)
    if base_depth == 0:
        return Requirement(activity_id, 0, f"{zone['label']}: no depth requirement",
                           zone.get("source_ref", []), zone.get("neufert_ref", ""))

    # Turning on the spot IS the turning circle — don't derive it twice.
    if activity_id == "stand_and_turn":
        turn = turning_circle(user_group)
        return Requirement(
            activity_id, turn.value_mm,
            f"{zone['label']}: resolves to the turning circle — {turn.basis}",
            turn.source_ref or zone.get("source_ref", []),
            zone.get("neufert_ref", ""),
        )

    if activity_id in ABSOLUTE_ZONES:
        return Requirement(
            activity_id, base_depth,
            f"{zone['label']}: {base_depth} mm, dimensioned around the device "
            "rather than a generic body, so it does not scale",
            zone.get("source_ref", []), zone.get("neufert_ref", ""),
        )

    share = BODY_SHARE.get(activity_id, 0.6)
    occupied = envelope.get("occupied_depth", REFERENCE_DEPTH)
    extra = (occupied - REFERENCE_DEPTH) * share
    value = round(max(base_depth, base_depth + extra) / 50) * 50

    return Requirement(
        key=activity_id,
        value_mm=value,
        basis=(
            f"{zone['label']}: {base_depth} mm for a reference adult, plus "
            f"{extra:+.0f} mm — {envelope['label'].lower()} occupies "
            f"{occupied} mm of depth against the reference {REFERENCE_DEPTH} mm, "
            f"and {int(share * 100)}% of this zone is body rather than task"
        ),
        source_ref=zone.get("source_ref", []),
        neufert_ref=zone.get("neufert_ref", ""),
    )


def activity_width(activity_id: str, user_group: str) -> Requirement:
    zone = activity_zones().get(activity_id)
    if not zone:
        return Requirement(activity_id, 0, "unknown activity", derived=False)
    envelope = envelopes().get(user_group) or envelopes()["adult"]
    base = zone.get("width", 0)
    if base == 0:
        return Requirement(activity_id, 0, f"{zone['label']}: no width requirement",
                           zone.get("source_ref", []))

    if activity_id == "stand_and_turn":
        turn = turning_circle(user_group)
        return Requirement(activity_id, turn.value_mm,
                           f"{zone['label']}: turning circle — {turn.basis}",
                           turn.source_ref, zone.get("neufert_ref", ""))
    if activity_id in ABSOLUTE_ZONES:
        return Requirement(activity_id, base,
                           f"{zone['label']}: {base} mm, device-dimensioned, does not scale",
                           zone.get("source_ref", []), zone.get("neufert_ref", ""))

    extra = envelope.get("occupied_width", REFERENCE_WIDTH) - REFERENCE_WIDTH
    value = round(max(base, base + extra) / 50) * 50
    return Requirement(
        activity_id, value,
        f"{zone['label']}: {base} mm plus {extra:+.0f} mm of body width for "
        f"{envelope['label'].lower()}",
        zone.get("source_ref", []), zone.get("neufert_ref", ""),
    )


def item_clearances(item_type: str, user_group: str) -> dict[str, Requirement]:
    """Front and side clearance an item needs, for this user group.

    This replaces the flat numbers in furniture.json. Those remain as a
    fallback for items the standards layer has no activity mapping for.
    """
    mapping = item_activities().get(item_type)
    out: dict[str, Requirement] = {}
    if not mapping:
        return out
    if mapping.get("front"):
        out["front"] = activity_clearance(mapping["front"], user_group)
    if mapping.get("side"):
        out["side"] = activity_clearance(mapping["side"], user_group)
    return out


def reach_band(user_group: str) -> tuple[int, int] | None:
    """The height band everything operable should sit within."""
    envelope = envelopes().get(user_group) or envelopes()["adult"]
    band = envelope.get("reach_band")
    if band:
        return tuple(band)
    low = envelope.get("reach_down_comfortable")
    high = envelope.get("reach_up_comfortable")
    return (low, high) if low and high else None


def sill_for_seated_view(user_group: str, margin_mm: int = 450) -> Requirement:
    """Sill height that leaves a real view, not just eye-above-sill.

    A view needs a downward sightline, so the sill must sit meaningfully
    below eye height rather than just under it.
    """
    envelope = envelopes().get(user_group) or envelopes()["adult"]
    eye = envelope.get("eye_height_p50", 1600)
    return Requirement(
        "max_sill_for_view", max(0, eye - margin_mm),
        f"eye height {eye} mm for {envelope['label'].lower()}, less {margin_mm} mm "
        "so the sightline reaches the ground nearby rather than the sky",
        envelope.get("source_ref", []), envelope.get("neufert_ref", ""),
    )


# ---------------------------------------------------------------------------
# Validating a room
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    severity: str          # blocker | major | minor | pass
    rule: str
    required: str
    actual: str
    message: str
    source_ref: list[str] = field(default_factory=list)
    space_type: str = ""

    @property
    def passed(self) -> bool:
        return self.severity == "pass"


def check_space(
    space_type_id: str,
    user_group: str,
    *,
    area_m2: float,
    min_width_mm: float,
    turn_available_mm: float,
    has_daylight: bool,
    fixtures_present: list[str],
    ceiling_mm: float = 2500,
) -> list[Finding]:
    """Test one room against its space-type standard for one user group."""
    spec = space_types().get(space_type_id)
    if not spec:
        return [Finding("minor", "space_type", space_type_id, "-",
                        f"No standard defined for space type '{space_type_id}'.")]

    findings: list[Finding] = []
    cite = spec.get("source_ref", [])

    # Area and width: regulatory minima, cited directly.
    if area_m2 < spec["min_area_m2"]:
        findings.append(Finding(
            "blocker", "min_area", f"{spec['min_area_m2']} m²", f"{area_m2:.1f} m²",
            f"{spec['label']} is below the regulatory minimum area.", cite, space_type_id))
    else:
        findings.append(Finding("pass", "min_area", f"{spec['min_area_m2']} m²",
                                f"{area_m2:.1f} m²", "Area meets the minimum.",
                                cite, space_type_id))

    if min_width_mm < spec["min_width_mm"]:
        findings.append(Finding(
            "blocker", "min_width", f"{spec['min_width_mm']} mm", f"{min_width_mm:.0f} mm",
            f"{spec['label']} is too narrow. Area alone does not make a room work — "
            "a long thin room of the right area fails this and is the classic "
            "conversion trap.", cite, space_type_id))

    if ceiling_mm < spec.get("min_ceiling_mm", 0):
        findings.append(Finding(
            "blocker", "min_ceiling", f"{spec['min_ceiling_mm']} mm", f"{ceiling_mm:.0f} mm",
            "Ceiling height below the minimum, and it cannot be increased.",
            cite, space_type_id))

    # Activities: derived from the ergonomic layer for THIS user group.
    for activity_id in spec.get("activities", []):
        need = activity_clearance(activity_id, user_group)
        width_need = activity_width(activity_id, user_group)
        governing = max(need.value_mm, width_need.value_mm)
        if governing == 0:
            continue
        if turn_available_mm < governing:
            findings.append(Finding(
                "major", f"activity:{activity_id}", f"{governing:.0f} mm",
                f"{turn_available_mm:.0f} mm",
                f"Not enough clear space for '{activity_zones()[activity_id]['label']}'. "
                + need.basis,
                need.source_ref, space_type_id))

    # Turning.
    turn = turning_circle(user_group)
    if turn_available_mm < turn.value_mm:
        findings.append(Finding(
            "major", "turning_circle", f"{turn.value_mm:.0f} mm",
            f"{turn_available_mm:.0f} mm",
            f"No turning space for {envelopes().get(user_group, {}).get('label', user_group)}. "
            + turn.basis, turn.source_ref, space_type_id))

    # Daylight.
    if spec.get("requires_daylight") and not has_daylight:
        findings.append(Finding(
            "blocker", "daylight", "window required", "none",
            f"{spec['label']} must have daylight.", cite, space_type_id))

    # Fixtures.
    families = fixture_families()
    for required in spec.get("required_fixtures", []):
        allowed = families.get(required, [])
        if not any(f in allowed for f in fixtures_present):
            findings.append(Finding(
                "major", f"fixture:{required}", required, "missing",
                f"{spec['label']} needs a {required} and none is present.",
                cite, space_type_id))

    return findings


def summary(user_group: str) -> dict:
    """Everything the standards layer says about one user group.

    Useful on its own: this is the sheet a designer would otherwise look up
    in a book, assembled for the specific person being designed for.
    """
    envelope = envelopes().get(user_group) or envelopes()["adult"]
    turn = turning_circle(user_group)
    band = reach_band(user_group)
    sill = sill_for_seated_view(user_group)

    activities = []
    for activity_id in activity_zones():
        depth = activity_clearance(activity_id, user_group)
        width = activity_width(activity_id, user_group)
        if depth.value_mm or width.value_mm:
            activities.append({
                "id": activity_id,
                "label": activity_zones()[activity_id]["label"],
                "depth_mm": depth.value_mm,
                "width_mm": width.value_mm,
                "basis": depth.basis or width.basis,
                "source_ref": depth.source_ref or width.source_ref,
                "cited": depth.cited or width.cited,
            })

    return {
        "user_group": user_group,
        "label": envelope["label"],
        "posture": envelope.get("posture", ""),
        "envelope": envelope,
        "turning_circle_mm": turn.value_mm,
        "turning_basis": turn.basis,
        "turning_source": turn.source_ref,
        "reach_band_mm": list(band) if band else None,
        "max_sill_for_view_mm": sill.value_mm,
        "sill_basis": sill.basis,
        "activities": activities,
        "uncited_count": sum(1 for a in activities if not a["cited"]),
    }


def coverage() -> dict:
    """How much of the standards library is traced to a source.

    A standards engine that cannot say which of its rules are uncited is
    an opinion with a schema.
    """
    total = cited = neufert = 0
    gaps: list[str] = []

    for zone in activity_zones().values():
        total += 1
        if zone.get("source_ref"):
            cited += 1
        else:
            gaps.append(f"activity_zone:{zone['id']}")
        if zone.get("neufert_ref"):
            neufert += 1

    for envelope in envelopes().values():
        total += 1
        if envelope.get("source_ref"):
            cited += 1
        else:
            gaps.append(f"envelope:{envelope['id']}")
        if envelope.get("neufert_ref"):
            neufert += 1

    for spec in space_types().values():
        total += 1
        if spec.get("source_ref"):
            cited += 1
        else:
            gaps.append(f"space_type:{spec['id']}")
        if spec.get("neufert_ref"):
            neufert += 1

    return {
        "records": total,
        "cited": cited,
        "cited_share": round(cited / total, 3) if total else 0,
        "neufert_verified": neufert,
        "neufert_share": round(neufert / total, 3) if total else 0,
        "uncited": gaps,
    }
