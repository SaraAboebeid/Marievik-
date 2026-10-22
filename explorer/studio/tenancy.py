"""Who rents which suite — from data/projects/<project>/leases.json (example data until AMF's rent roll arrives)."""
from __future__ import annotations

import json
from pathlib import Path

from .layouts import ATRIUM, CORES

ROOT = Path(__file__).resolve().parents[2]
VACANT_COLOUR, SHARED_COLOUR = "#9a978e", "#d8d3bf"


def leases(project: str) -> dict | None:
    p = ROOT / "data" / "projects" / project / "leases.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def _overlap(a, b):
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def _net(r, ground: bool) -> int:
    """Net lettable area of a suite: its rectangle less the cores and (above the ground floor) the atrium,
    less walls, shafts and columns (8 %)."""
    a = (r[2] - r[0]) * (r[3] - r[1]) - sum(_overlap(r, c["r"]) for c in CORES) - (0 if ground else _overlap(r, ATRIUM))
    return round(a * 0.92)


def _summary(floor: int, suites: list[dict]) -> dict:
    def total(f):
        return sum(s["area"] for s in suites if f(s))
    shared = total(lambda s: s["shared"])
    rented = total(lambda s: not s["shared"] and s["tenant"])
    vacant = total(lambda s: not s["shared"] and not s["tenant"])
    return {"floor": floor, "leasable": rented + vacant, "rented": rented, "vacant": vacant, "shared": shared, "suites": suites}


def floor_tenancy(project: str, building: str, floor: int, gfa: float) -> dict:
    """Suites of one floor with their tenant (or vacant / shared). Buildings without suites in the rent roll get
    an example vacant share, fixed per building and floor."""
    data = leases(project) or {}
    b = data.get("buildings", {}).get(building)
    if not b:
        h = 2166136261
        for ch in f"{building}:{floor}":
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
        share = [0, 0, 0.15, 0.3, 0.5, 1][h % 6]
        leasable = round(gfa * data.get("other_buildings", {}).get("lettable_share_of_gfa", 0.85))
        vacant = round(leasable * share)
        return {"floor": floor, "leasable": leasable, "rented": leasable - vacant, "vacant": vacant, "shared": round(gfa - leasable), "suites": [], "example": True}
    ground = floor == 0
    tenants = data.get("tenants", {})
    let = {s: l for l in b.get("leases", []) if l["floor"] == floor for s in l["suites"]}
    if not ground and floor not in {l["floor"] for l in b.get("leases", [])}:
        let = {}
    suites = []
    for s in b["suites"]["ground" if ground else "typical"]:
        lease = let.get(s["id"])
        t = tenants.get(lease["tenant"], {}) if lease else {}
        shared = bool(s.get("shared"))
        suites.append({"id": s["id"], "label": s["label"], "r": s["rect"], "area": _net(s["rect"], ground), "shared": shared,
                       "tenant": lease["tenant"] if lease else None, "sector": t.get("sector"), "rent": lease["rent_sek_m2"] if lease else None,
                       "leaseStart": lease["start"] if lease else None, "leaseEnd": lease["end"] if lease else None,
                       "colour": SHARED_COLOUR if shared else t.get("colour", "#4aa3b5") if lease else VACANT_COLOUR})
    out = _summary(floor, suites)
    out["example"] = "EXAMPLE" in data.get("_meta", {}).get("status", "")
    return out
