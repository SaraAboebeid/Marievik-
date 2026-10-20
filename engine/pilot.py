"""PILOT — scenarios for one building, built from the use catalogue.

A pilot file (data/pilots/<project>/<building>.json) names a building, a few
design assumptions and a handful of scenarios: which use goes on which floor,
in what share. Everything else comes from the catalogue:

  - which spaces each use must have (strength law or guidance),
  - the fire class, and with it the maximum distance to an exit,
  - WC count and outdoor-air demand,
  - people per hour, from each use's hourly presence profile.

The catalogue rarely says how big a space must be. Where it does not, the
pilot's labelled assumptions fill in, and each result lists the assumptions it
used. A scenario is never better sourced than its weakest assumption, and the
report says so instead of hiding it.

Run:  python -m engine.pilot data/pilots/marievik/b01.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from . import loader

EVENING_HOURS = range(17, 24)
# Binding constraints that mean work on the services or structure layers, not just new walls.
HEAVY_CONSTRAINTS = ("exhaust", "vertical", "floor_load", "structure")
PUBLIC_USES = {"retail_shop", "grocery_store", "restaurant_cafe", "assembly_event", "gym_fitness", "library",
               "community_hybrid", "food_hall"}


# ---------------------------------------------------------------------------- geometry

def plate(building: dict, depth: float) -> dict:
    """Areas of a rectangular plate: total, facade zone, dark middle, core."""
    length, width = building["plate_m"]
    core_l, core_w = building["core"]["size_m"]
    total = length * width
    inner = max(length - 2 * depth, 0) * max(width - 2 * depth, 0)
    core = core_l * core_w
    return {
        "gross_m2": total,
        "perimeter_m": 2 * (length + width),
        "facade_zone_m2": total - inner,
        "dark_middle_m2": inner - core,
        "core_m2": core,
        "ring_corridor_m": 2 * ((length - 2 * depth) + (width - 2 * depth)),
    }


def travel_distance(building: dict, street_access: bool) -> tuple[float, str]:
    """Longest walk to an exit, as a conservative straight-axis (Manhattan) estimate.

    Street-level public uses can exit through facade doors, so the deepest point
    is half the short side away. Upper floors exit through the stairs in the core.
    """
    length, width = building["plate_m"]
    if street_access:
        return min(length, width) / 2, "to the nearest facade door"
    core_l, core_w = building["core"]["size_m"]
    return (length - core_l) / 2 + (width - core_w) / 2, "from the far corner to a stair in the core"


# ---------------------------------------------------------------------------- per use

def fire_class(use_id: str, persons: float, item: dict) -> str:
    """Fire occupancy class (BFS 2024:7 2 kap.), from the use and its fire-design occupancy.

    Shared amenities have no class of their own: a shared room takes the class of the use it serves.
    """
    if use_id in {"office", "coworking"} or item.get("members_only"):
        return "1"
    if use_id in PUBLIC_USES:
        vk0 = loader.cross_cutting_rules()["fire_vk_0"]["values"]["thresholds_persons"]
        if persons > (vk0["unfamiliar_with_alcohol"] if item.get("alcohol") else vk0["unfamiliar"]):
            return "0"
        if persons > loader.cross_cutting_rules()["fire_vk_2abc"]["values"]["threshold_persons"]:
            return "2C" if item.get("alcohol") else "2B"
        return "2A"
    return "shared"


def max_travel(vk: str) -> float | None:
    rules = loader.cross_cutting_rules()
    if vk == "1":
        return rules["fire_vk_1"]["values"]["max_travel_to_exit_m"]
    if vk in {"2A", "2B", "2C"}:
        return rules["fire_vk_2abc"]["values"]["max_travel_to_exit_m"][vk]
    return None


def size_use(item: dict, floor: dict, geo: dict, assume: dict) -> tuple[dict, list[str]]:
    """Persons for one use on one floor, and the assumptions that number rests on."""
    use_id, share = item["use"], item["share"]
    used: list[str] = ["net_to_gross"]
    net = geo["gross_m2"] * share * assume["net_to_gross"]["value"]
    out: dict = {"net_m2": net}

    if use_id in {"office", "coworking"}:
        corridor_m2 = 0.0
        if item.get("tenancies", 1) > 1:
            corridor_m2 = geo["ring_corridor_m"] * share * assume["suite_corridor_m"]["value"]
            used.append("suite_corridor_m")
        by_area = (net - corridor_m2) / item["m2_per_person"]
        if item.get("variant") == "office_cellular":
            by_daylight = geo["perimeter_m"] * share / assume["cell_room_facade_m"]["value"]
            used.append("cell_room_facade_m")
        else:
            desks = geo["facade_zone_m2"] * share / assume["desk_m2_in_facade_zone"]["value"]
            by_daylight = desks / item.get("desk_ratio", 1.0)  # ABW: more employees than desks
            used.append("desk_m2_in_facade_zone")
        persons = min(by_area, by_daylight)
        out.update(persons=persons, limited_by="daylight (workplaces need a view)" if by_daylight < by_area else "m² per person",
                   corridor_m2=corridor_m2, by_area=by_area, by_daylight=by_daylight)
    elif use_id == "retail_shop":
        per = loader.catalogue_uses()[use_id]["occupancy"]["gross_m2_per_unit"]["value"]
        persons = net / assume["retail_m2_per_visitor"]["value"]
        used.append("retail_m2_per_visitor")
        out.update(persons=persons, legal_max_persons=net / per, limited_by="typical shoppers present (fire design uses 0.5 persons/m²)")
    elif use_id == "restaurant_cafe":
        seats = net * 0.6 / assume["restaurant_m2_per_seat"]["value"]  # ~60% of a restaurant is dining
        used.append("restaurant_m2_per_seat")
        out.update(persons=seats, limited_by="seats (dining ≈ 60% of area)")
    elif use_id == "assembly_event":
        legal = net * loader.cross_cutting_rules()["occ_density_law_2024"]["values"]["persons_per_m2"]["samlingslokal_assembly"]
        persons = net / assume["event_m2_per_person"]["value"]
        used.append("event_m2_per_person")
        out.update(persons=persons, legal_max_persons=legal, limited_by="banquet layout")
    else:
        out.update(persons=0.0, limited_by="amenity (no own headcount)")
    return out, used


def required_spaces(use: dict, item: dict, persons: float) -> list[dict]:
    """Spaces the catalogue says the use must or should have, with what we can size."""
    wanted = set(item.get("spaces", []))
    rows = []
    for s in use["spaces"]:
        strength = s["required"]["strength"]
        if strength not in {"law", "guidance"} or (wanted and s["id"] not in wanted):
            continue
        size = s.get("size") or {}
        if size.get("value_m2") and "15" in str(size.get("count", "")):  # WCs: 1 per started 15
            n = max(1, math.ceil(persons / 15))
            sized = f"{n} × {size['value_m2']} m² = {n * size['value_m2']:.0f} m²"
        elif size.get("value_m2"):
            sized = f"{size['value_m2']} m² {size.get('rule', '')}".strip()
        else:
            sized = "required — no size in any source; size by design"
        heavy = any(k in str(s.get("binding_constraint", "")) for k in HEAVY_CONSTRAINTS)
        rows.append({"id": s["id"], "label": s.get("label_en"), "strength": strength, "sized": sized,
                     "heavy_move": s.get("binding_constraint") if heavy else None,
                     "basis": s["required"].get("basis", "")})
    return rows


# ---------------------------------------------------------------------------- scenario

def run_scenario(sc: dict, building: dict, assume: dict) -> dict:
    geo = plate(building, assume["facade_zone_depth_m"]["value"])
    uses = loader.catalogue_uses()
    hourly = [0.0] * 24
    floors_out, assumptions_used, heavy_moves = {}, set(), []

    for floor_id, items in sc["floors"].items():
        floor = building["floors"][floor_id]
        walk, walk_how = travel_distance(building, floor["street_access"])
        floor_rows = []
        for item in items:
            use = uses[item["use"]]
            sized, used = size_use(item, floor, geo, assume)
            assumptions_used.update(used)
            persons = sized["persons"]
            vk = fire_class(item["use"], sized.get("legal_max_persons", persons), item)
            limit = max_travel(vk)
            profile = use["occupancy"].get("hourly_presence") or [0] * 24
            for h in range(24):
                hourly[h] += persons * profile[h]
            spaces = required_spaces(use, item, persons)
            heavy_moves += [f"{floor_id} {use['label_en']}: {r['label']} ({r['heavy_move']})" for r in spaces if r["heavy_move"]]
            floor_rows.append({
                "use": item["use"], "variant": item.get("variant"), "label": use["label_en"], "share": item["share"],
                "net_m2": round(sized["net_m2"]), "persons": round(persons), "limited_by": sized["limited_by"],
                "fire_class": vk, "fire_basis": "occupancy by legal default density" if "legal_max_persons" in sized else "design occupancy",
                "travel_m": round(walk, 1), "travel_limit_m": limit, "travel_how": walk_how,
                "travel_ok": None if limit is None else walk <= limit,
                "outdoor_air_ls": round(7 * persons * max(profile, default=1) + 0.35 * sized["net_m2"]),
                "required_spaces": spaces,
                "detail": {k: round(v) for k, v in sized.items() if isinstance(v, float)},
            })
        floors_out[floor_id] = floor_rows

    return {
        "id": sc["id"], "label": sc["label"], "story": sc["story"], "cards": sc["cards"],
        "floors": floors_out,
        "people_peak": round(max(hourly)),
        "people_hours_day": round(sum(hourly)),
        "people_hours_evening": round(sum(hourly[h] for h in EVENING_HOURS)),
        "hourly_people": [round(h) for h in hourly],
        "heavy_moves": heavy_moves,
        "assumptions_used": sorted(assumptions_used),
    }


def run(pilot_path: Path) -> dict:
    pilot = json.loads(pilot_path.read_text(encoding="utf-8"))
    building, assume = pilot["building"], pilot["assumptions"]
    geo = plate(building, assume["facade_zone_depth_m"]["value"])
    return {
        "pilot": str(pilot_path), "building": building["id"], "status": pilot["_meta"]["status"],
        "plate": {k: round(v, 1) for k, v in geo.items()},
        "scenarios": [run_scenario(sc, building, assume) for sc in pilot["scenarios"]],
    }


# ---------------------------------------------------------------------------- report

def report(result: dict) -> str:
    p = result["plate"]
    lines = [f"# {result['building']} — ground floor and first floor", "",
             f"Status: {result['status']}", "",
             f"Per floor: {p['gross_m2']:.0f} m² gross · facade zone {p['facade_zone_m2']:.0f} m² · "
             f"dark middle {p['dark_middle_m2']:.0f} m² · core {p['core_m2']:.0f} m² · facade {p['perimeter_m']:.0f} m", "",
             "| Scenario | Peak people | People-hours / day | of which 17–24 | Fire escape | Heavy moves |",
             "|---|---|---|---|---|---|"]
    for s in result["scenarios"]:
        rows = [r for f in s["floors"].values() for r in f]
        fails = [f"{r['label']} {r['travel_m']}>{r['travel_limit_m']} m" for r in rows if r["travel_ok"] is False]
        fails += [f"{r['label']}: Vk 0, fire analysis" for r in rows if r["fire_class"] == "0"]
        lines.append(f"| {s['label']} | {s['people_peak']} | {s['people_hours_day']} | {s['people_hours_evening']} | "
                     f"{'; '.join(fails) or 'ok'} | {len(s['heavy_moves'])} |")
    for s in result["scenarios"]:
        lines += ["", f"## {s['label']}", "", s["story"], ""]
        for floor_id, rows in s["floors"].items():
            for r in rows:
                if r["fire_class"] == "shared":
                    walk = "takes the fire class of the uses it serves"
                elif r["fire_class"] == "0":
                    walk = "Vk 0: no prescriptive limit, must be designed by fire analysis"
                else:
                    walk = (f"exit {r['travel_m']} m {r['travel_how']}, limit {r['travel_limit_m']} m: "
                            f"{'ok' if r['travel_ok'] else 'TOO FAR'}")
                people = f"{r['persons']} people, limited by {r['limited_by']}" if r["persons"] else "amenity, no own headcount"
                lines.append(f"- **{floor_id} · {r['label']}** ({r['variant']}, {r['share']:.0%}): "
                             f"{people} · fire class {r['fire_class']} · {walk} · outdoor air {r['outdoor_air_ls']} l/s")
                unsized = sum(1 for x in r["required_spaces"] if x["sized"].startswith("required"))
                lines.append(f"  - {len(r['required_spaces'])} required spaces from the catalogue, {unsized} with no size in any source")
        if s["heavy_moves"]:
            lines.append("- Heavy moves: " + "; ".join(s["heavy_moves"]))
        lines.append("- Assumptions used: " + ", ".join(s["assumptions_used"]))
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else loader.DATA / "pilots" / "marievik" / "b01.json"
    result = run(path)
    out_dir = loader.ROOT / "runs" / "pilots"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{result['building'].lower()}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    text = report(result)
    (out_dir / f"{result['building'].lower()}.md").write_text(text, encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
