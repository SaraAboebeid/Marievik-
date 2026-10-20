"""Draw architectural-style use-program diagrams from the standards JSON."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "standards" / "space_requirements.json"
OUTPUT = ROOT / "docs" / "space_requirements_diagrams"

BLACK = "#20292d"
INK = "#344147"
MUTED = "#68777c"
PAPER = "#fbfaf6"
ROOM = "#f3f2ed"
ROOM_ALT = "#e9eeeb"
ORANGE = "#d69a27"
WINDOW = "#4d9baa"
GREEN = "#668d72"
RULE = "#c7ceca"
WHITE = "#ffffff"

CANVAS_W = 1800
CANVAS_H = 1160
PLAN_X = 65
PLAN_Y = 175
PLAN_W = 1010
PLAN_H = 840
INNER_X = PLAN_X + 28
INNER_Y = PLAN_Y + 52
SIDE_X = 1110
SIDE_Y = PLAN_Y
SIDE_W = 625
SIDE_H = PLAN_H


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def label(value: Any, limit: int = 34) -> str:
    value = str(value).replace("_", " ")
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def text(x: float, y: float, value: Any, size: int = 15, color: str = INK,
         weight: int = 400, anchor: str = "start", letter_spacing: float = 0) -> str:
    return (
        f'<text x="{x:g}" y="{y:g}" font-family="Arial, sans-serif" font-size="{size}" '
        f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}" '
        f'letter-spacing="{letter_spacing}">{esc(value)}</text>'
    )


def rect(x: float, y: float, width: float, height: float, fill: str = "none",
         stroke: str = BLACK, sw: float = 1.5, rx: float = 0, dash: str = "") -> str:
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<rect x="{x:g}" y="{y:g}" width="{width:g}" height="{height:g}" rx="{rx:g}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw:g}"{dash_attr}/>'
    )


def line(x1: float, y1: float, x2: float, y2: float, color: str = BLACK,
         sw: float = 1.5, dash: str = "") -> str:
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" '
        f'stroke="{color}" stroke-width="{sw:g}"{dash_attr}/>'
    )


def dimension_h(x1: float, x2: float, y: float, value: str, size: int = 12) -> str:
    mid = (x1 + x2) / 2
    return "".join([
        line(x1, y, x2, y, ORANGE, 1.5),
        line(x1, y - 6, x1, y + 6, ORANGE, 1.5),
        line(x2, y - 6, x2, y + 6, ORANGE, 1.5),
        f'<path d="M{x1 + 7:g},{y - 4:g} l-7,4 l7,4 M{x2 - 7:g},{y - 4:g} l7,4 l-7,4" '
        f'fill="none" stroke="{ORANGE}" stroke-width="1.5"/>',
        text(mid, y - 7, value, size=size, color=BLACK, weight=700, anchor="middle"),
    ])


def dimension_v(x: float, y1: float, y2: float, value: str, size: int = 12) -> str:
    mid = (y1 + y2) / 2
    return "".join([
        line(x, y1, x, y2, ORANGE, 1.5),
        line(x - 6, y1, x + 6, y1, ORANGE, 1.5),
        line(x - 6, y2, x + 6, y2, ORANGE, 1.5),
        f'<path d="M{x - 4:g},{y1 + 7:g} l4,-7 l4,7 M{x - 4:g},{y2 - 7:g} l4,7 l4,-7" '
        f'fill="none" stroke="{ORANGE}" stroke-width="1.5"/>',
        f'<text x="{x + 10:g}" y="{mid:g}" transform="rotate(-90 {x + 10:g} {mid:g})" '
        f'font-family="Arial, sans-serif" font-size="{size}" font-weight="700" fill="{BLACK}" '
        f'text-anchor="middle">{esc(value)}</text>',
    ])


def area_values(unit: dict[str, Any]) -> list[str]:
    values = []
    for key, value in unit.items():
        if not (key.startswith("area_") or key in ("area_factor_of_net", "area_factor_of_hall")):
            continue
        parts = key.removeprefix("area_").split("_")
        if key.startswith("area_factor"):
            rendered = f"{value:g} × {'hall' if 'hall' in key else 'net'} area"
        else:
            if parts and parts[0] == "range":
                parts = parts[1:]
            unit_label = "m²"
            if isinstance(value, list):
                number = f"{value[0]:g}–{value[1]:g}"
            elif isinstance(value, (int, float)):
                number = f"{value:g}"
            else:
                number = str(value)
            basis_parts = parts[1:] if parts and parts[0] == "m2" else parts
            basis = " ".join(basis_parts)
            basis = basis.replace("m2", "m²")
            rendered = f"{number} {unit_label}" + (f" {basis}" if basis else "")
        values.append(rendered)
    return values


def unit_lookup(program: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {unit["id"]: unit for unit in program.get("space_units", [])}


def symbol(kind: str, cx: float, cy: float, scale: float = 1) -> str:
    s = scale
    out = ['<g fill="none" stroke="#536167" stroke-width="1.5">']
    if kind in ("bed", "apartment", "studio", "care"):
        out += [
            f'<rect x="{cx - 47*s:g}" y="{cy - 20*s:g}" width="{94*s:g}" height="{42*s:g}" rx="2"/>',
            line(cx - 46*s, cy - 3*s, cx + 46*s, cy - 3*s, "#536167", 1.5),
            rect(cx - 42*s, cy - 17*s, 24*s, 11*s, WHITE, "#536167", 1, 1),
        ]
    elif kind in ("desk", "office", "study"):
        out += [
            rect(cx - 35*s, cy - 18*s, 70*s, 34*s, "none", "#536167", 1.5, 2),
            rect(cx - 10*s, cy + 18*s, 20*s, 15*s, "none", "#536167", 1.5, 2),
        ]
    elif kind in ("wc", "wet"):
        out += [
            rect(cx - 26*s, cy - 18*s, 52*s, 13*s, "none", "#536167", 1.5, 2),
            f'<ellipse cx="{cx:g}" cy="{cy + 7*s:g}" rx="{14*s:g}" ry="{17*s:g}"/>',
            f'<circle cx="{cx:g}" cy="{cy + 7*s:g}" r="{6*s:g}"/>',
        ]
    elif kind in ("outdoor", "tree"):
        out += [
            f'<circle cx="{cx:g}" cy="{cy - 7*s:g}" r="{23*s:g}" fill="#e4ece3" stroke="{GREEN}"/>',
            line(cx, cy + 15*s, cx, cy + 37*s, GREEN, 3),
        ]
    elif kind in ("hall", "event"):
        for row in range(3):
            for col in range(5):
                out.append(f'<circle cx="{cx + (col - 2)*22*s:g}" cy="{cy + (row - 1)*21*s:g}" r="{5*s:g}"/>')
    elif kind in ("corridor", "circulation"):
        out += [
            line(cx - 70*s, cy, cx + 70*s, cy, ORANGE, 2, "8 6"),
            f'<path d="M{cx + 62*s:g},{cy - 5*s:g} l10,5 l-10,5" fill="none" stroke="{ORANGE}" stroke-width="2"/>',
        ]
    elif kind in ("storage", "aid"):
        out += [
            rect(cx - 38*s, cy - 22*s, 76*s, 44*s, "none", "#536167", 1.5),
            line(cx - 38*s, cy - 7*s, cx + 38*s, cy - 7*s, "#536167", 1),
            line(cx - 38*s, cy + 7*s, cx + 38*s, cy + 7*s, "#536167", 1),
        ]
    else:
        out += [
            rect(cx - 36*s, cy - 18*s, 72*s, 36*s, "none", "#536167", 1.5, 2),
            f'<circle cx="{cx - 45*s:g}" cy="{cy:g}" r="{5*s:g}"/>',
            f'<circle cx="{cx + 45*s:g}" cy="{cy:g}" r="{5*s:g}"/>',
        ]
    out.append("</g>")
    return "".join(out)


def room_box(unit: dict[str, Any], x: float, y: float, width: float, height: float,
             *, title: str | None = None, outdoor: bool = False) -> str:
    unit_id = unit.get("id", "")
    room_fill = "#eef3eb" if outdoor else ROOM
    stroke = GREEN if outdoor else BLACK
    dash = "8 5" if outdoor else ""
    result = [rect(x, y, width, height, room_fill, stroke, 2, 0, dash)]

    name = title or label(unit.get("label", unit_id), 31)
    result.append(text(x + 12, y + 24, name, 14, BLACK, 700))

    areas = area_values(unit)
    if areas:
        result.append(text(x + 12, y + 43, " / ".join(areas[:2]), 11, MUTED, 600))

    if unit.get("facade_required"):
        result.extend([
            line(x + 10, y + 4, x + width - 10, y + 4, WINDOW, 5),
            text(x + width - 12, y + 18, "F", 10, WINDOW, 700, "end"),
        ])

    kind = "default"
    lower = unit_id.lower()
    if "corridor" in lower or "circulation" in lower:
        kind = "corridor"
    elif "care_apartment" in lower or "studio" in lower or "apartment" in lower:
        kind = "bed"
    elif "event" in lower or "hall" in lower:
        kind = "hall"
    elif "wc" in lower or "wet" in lower:
        kind = "wc"
    elif "outdoor" in lower:
        kind = "outdoor"
    elif "storage" in lower or "aid" in lower or "laundry" in lower:
        kind = "storage"
    elif "office" in lower or "work" in lower or "study" in lower or "staff" in lower:
        kind = "desk"
    elif "kitchen" in lower:
        kind = "default"
    if not outdoor:
        result.append(symbol(kind, x + width / 2, y + height * 0.70, min(1.0, width / 180, height / 130)))

    clear_width = unit.get("min_clear_width_mm")
    if clear_width:
        result.append(dimension_h(x + 24, x + width - 24, y + height - 14, f"{clear_width} mm clear", 10))
    return "".join(result)


def program_plan(program: dict[str, Any], units: dict[str, dict[str, Any]]) -> str:
    uid = program["id"]
    p = INNER_X
    q = INNER_Y
    result = [
        rect(p, q, PLAN_W - 56, PLAN_H - 104, PAPER, BLACK, 3),
        text(p + 14, q - 15, "ILLUSTRATIVE PROGRAM PLAN", 12, MUTED, 700, letter_spacing=1.2),
        text(p + PLAN_W - 90, q - 15, "NTS", 12, ORANGE, 700, "end"),
    ]
    placements: list[tuple[str, int, int, int, int, str | None, bool]] = []
    if uid == "elderly_care":
        placements = [
            ("care_apartment", 38, 48, 365, 240, "CARE APARTMENT · TYP.", False),
            ("care_apartment", 525, 48, 365, 240, "CARE APARTMENT · TYP.", False),
            ("care_corridor", 20, 330, 920, 126, "BED-TRANSPORT CORRIDOR", False),
            ("care_common_living", 45, 500, 390, 205, "SHARED LIVING / DINING", False),
            ("care_staff_base", 495, 520, 185, 165, "STAFF BASE", False),
            ("care_aid_storage", 720, 520, 190, 165, "AID STORE", False),
        ]
    elif uid == "student_housing":
        placements = [
            ("student_studio", 28, 40, 350, 170, "STUDIO · TYP.", False),
            ("student_studio", 562, 40, 350, 170, "STUDIO · TYP.", False),
            ("student_studio", 28, 245, 350, 170, "STUDIO · TYP.", False),
            ("student_studio", 562, 245, 350, 170, "STUDIO · TYP.", False),
            ("student_circulation", 405, 35, 125, 550, "CORRIDOR", False),
            ("student_shared_kitchen", 35, 475, 275, 200, "SHARED KITCHEN", False),
            ("student_study", 345, 615, 240, 100, "STUDY", False),
            ("student_laundry_store", 620, 475, 290, 200, "LAUNDRY / STORE", False),
        ]
    elif uid == "event_venue":
        placements = [
            ("event_hall", 115, 52, 690, 440, "ASSEMBLY HALL", False),
            ("event_foyer", 115, 525, 330, 150, "FOYER / ARRIVAL", False),
            ("event_wc", 465, 525, 185, 150, "SANITARY", False),
            ("event_back_of_house", 670, 525, 255, 150, "BACK OF HOUSE", False),
        ]
    elif uid == "office_flexible":
        placements = [
            ("office_open_work", 35, 48, 530, 440, "OPEN WORKSPACE", False),
            ("office_focus_room", 600, 48, 300, 190, "FOCUS / CALL ROOM", False),
            ("office_meeting", 600, 268, 300, 235, "MEETING ROOM", False),
            ("office_support", 600, 535, 300, 150, "SUPPORT", False),
        ]
    elif uid == "preschool":
        placements = [
            ("preschool_outdoor", 35, 35, 890, 220, "OUTDOOR PLAY · SITE ZONE", True),
            ("preschool_home_room", 35, 292, 545, 395, "BASE ROOM · GROUP", False),
            ("preschool_support", 615, 292, 310, 395, "SUPPORT / WC / CHANGING", False),
        ]
    elif uid == "community_hybrid":
        placements = [
            ("hybrid_main_room", 125, 70, 690, 455, "DIVISIBLE MAIN ROOM", False),
            ("hybrid_support", 125, 565, 690, 125, "KITCHEN / WC / STORE", False),
        ]

    placed = set()
    for unit_id, x, y, width, height, title, is_outdoor in placements:
        unit = units.get(unit_id)
        if unit is None:
            continue
        result.append(room_box(unit, p + x, q + y, width, height, title=title, outdoor=is_outdoor))
        placed.add(unit_id)

    if uid == "community_hybrid":
        # The movable partition is an illustrative arrangement element, not source geometry.
        result.append(line(p + 180, q + 300, p + 760, q + 300, ORANGE, 3, "12 8"))
        result.append(text(p + 470, q + 290, "MOVABLE ACOUSTIC WALL · Rw45", 11, ORANGE, 700, "middle"))
    if uid == "event_venue":
        for ex, ey in ((p + 94, q + 280), (p + 820, q + 280)):
            result.extend([
                line(ex, ey, ex - 28, ey, ORANGE, 2),
                f'<path d="M{ex - 36:g},{ey - 7:g} l-10,7 l10,7" fill="none" stroke="{ORANGE}" stroke-width="2"/>',
                text(ex - 4, ey - 13, "EXIT", 10, ORANGE, 700, "end"),
            ])
    if uid == "preschool":
        for index in range(5):
            tx = p + 120 + index * 150
            result.append(symbol("tree", tx, q + 178, 0.65))
    if uid == "elderly_care":
        result.append(line(p + 60, q + 393, p + 910, q + 393, ORANGE, 2, "12 7"))
    if uid == "student_housing":
        result.append(line(p + 467, q + 80, p + 467, q + 550, ORANGE, 2, "12 7"))

    unplaced = [unit for unit in program.get("space_units", []) if unit["id"] not in placed]
    if unplaced:
        result.append(text(p + 12, q + PLAN_H - 132, "ADDITIONAL PROGRAM ELEMENTS", 10, MUTED, 700))
        for index, unit in enumerate(unplaced):
            xx = p + 12 + index * 155
            result.append(rect(xx, q + PLAN_H - 118, 145, 52, ROOM_ALT, RULE, 1))
            result.append(text(xx + 8, q + PLAN_H - 97, label(unit.get("label", unit["id"]), 18), 10, INK, 600))
            areas = area_values(unit)
            if areas:
                result.append(text(xx + 8, q + PLAN_H - 78, areas[0], 9, MUTED))
    return "".join(result)


def shell_section(demands: dict[str, Any], x: float, y: float, width: float) -> str:
    result = [text(x, y, "SHELL / SECTION", 12, MUTED, 700, letter_spacing=1)]
    sx, sy = x + 12, y + 26
    result.extend([
        line(sx, sy + 104, sx + 190, sy + 104, BLACK, 3),
        line(sx, sy + 22, sx + 190, sy + 22, BLACK, 3),
        rect(sx, sy + 96, 190, 8, "#d5d9d5", BLACK, 1),
        rect(sx, sy + 14, 190, 8, "#d5d9d5", BLACK, 1),
        dimension_v(sx + 210, sy + 22, sy + 104,
                    f"{demands.get('min_floor_to_floor_mm', '—')} mm floor-to-floor", 10),
        text(sx, sy + 130, f"SLAB  ≥ {demands.get('min_slab_live_load_kn_m2', '—')} kN/m²", 11, INK, 700),
    ])

    ratio = demands.get("min_facade_ratio_m_per_m2")
    depth = demands.get("max_plan_depth_from_facade_mm")
    lift = demands.get("lift_size_mm")
    flags = []
    if ratio is not None:
        flags.append(f"FAÇADE ≥ {ratio} m/m²")
    if depth is not None:
        flags.append(f"PLAN DEPTH ≤ {depth} mm")
    if lift:
        flags.append(f"LIFT {lift[0]} × {lift[1]} mm")
    if demands.get("ground_floor_required"):
        flags.append("GROUND FLOOR REQUIRED")
    elif demands.get("ground_floor_preferred"):
        flags.append("GROUND FLOOR PREFERRED")
    if demands.get("site_outdoor_area_required"):
        flags.append("OUTDOOR SITE AREA")
    if "wet_room_stack_spacing_mm" in demands:
        flags.append(f"STACKS {demands['wet_room_stack_spacing_mm']} mm")

    tag_y = sy + 155
    for index, value in enumerate(flags):
        result.append(text(x + 6, tag_y + index * 20, value, 10, INK, 600))
    return "".join(result)


def requirement_icons(unit: dict[str, Any], x: float, y: float) -> str:
    tags = []
    if unit.get("facade_required"):
        tags.append("FACADE")
    if unit.get("daylight_required"):
        tags.append("DAYLIGHT")
    if unit.get("wet_room_required"):
        tags.append("WET")
    if unit.get("kitchenette_required"):
        tags.append("KITCHEN")
    if unit.get("ventilation_ls_per_person") is not None:
        tags.append(f"AIR {unit['ventilation_ls_per_person']} l/s·p")
    if unit.get("acoustic_class"):
        tags.append(f"AC {unit['acoustic_class']}")
    if unit.get("fire_compartment"):
        tags.append("FIRE CELL")
    if unit.get("subdivisible"):
        tags.append("DIVISIBLE")
    return "  ·  ".join(tags)


def clearance_details(program: dict[str, Any], x: float, y: float, width: float) -> str:
    units = program.get("space_units", [])
    result = [text(x, y, "SPACE / CLEARANCE DETAILS", 12, MUTED, 700, letter_spacing=1)]
    row_y = y + 28
    row_h = 78
    for index, unit in enumerate(units):
        result.append(line(x, row_y, x + width, row_y, RULE, 1))
        result.append(text(x + 2, row_y + 18, label(unit.get("label", unit["id"]), 34), 12, BLACK, 700))
        clear_width = unit.get("min_clear_width_mm")
        clear_height = unit.get("min_ceiling_height_mm")
        if clear_width:
            result.append(line(x + 8, row_y + 44, x + 150, row_y + 44, BLACK, 2))
            result.append(dimension_h(x + 8, x + 150, row_y + 40, f"{clear_width} mm", 10))
        elif clear_height:
            result.append(line(x + 20, row_y + 32, x + 20, row_y + 65, BLACK, 2))
            result.append(dimension_v(x + 32, row_y + 33, row_y + 65, f"{clear_height} mm", 9))
        areas = area_values(unit)
        if areas:
            result.append(text(x + 170, row_y + 43, areas[0], 11, INK, 600))
        if clear_height and clear_width:
            result.append(text(x + 170, row_y + 60, f"CEILING ≥ {clear_height} mm", 10, INK))
        icons = requirement_icons(unit, x, row_y)
        if icons:
            result.append(text(x + 170, row_y + 76, icons, 9, MUTED, 600))
        constraint = unit.get("binding_constraint")
        if constraint and constraint != "none":
            result.append(text(x + width - 4, row_y + 18, constraint.replace("_", " ").upper(), 9, ORANGE, 700, "end"))
        row_y += row_h
    return "".join(result)


def source_rows(program: dict[str, Any]) -> list[tuple[str, str, str]]:
    """(element, source refs, confidence) for every value block that carries a source_ref."""
    rows = []

    def walk(node: Any, owner: str) -> None:
        if isinstance(node, dict):
            owner = node.get("label", node.get("id", owner))
            if "source_ref" in node:
                refs = node["source_ref"]
                refs = "; ".join(refs) if isinstance(refs, list) else str(refs)
                rows.append((owner, refs, node.get("confidence", "—")))
            for value in node.values():
                walk(value, owner)
        elif isinstance(node, list):
            for value in node:
                walk(value, owner)

    walk(program, program.get("label_en", program["id"]))
    for unit in program.get("space_units", []):
        if not any(row[0] == unit.get("label", unit["id"]) for row in rows):
            rows.append((unit.get("label", unit["id"]), "no source_ref recorded", unit.get("confidence", "indicative")))
    return rows


def svg_for(program: dict[str, Any], meta: dict[str, Any]) -> str:
    units = unit_lookup(program)
    demands = program.get("shell_demands", {})
    title = program.get("label_en", program["id"])
    rows = source_rows(program)
    canvas_h = CANVAS_H + 70 + 19 * len(rows)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{canvas_h}" '
        f'viewBox="0 0 {CANVAS_W} {canvas_h}" role="img" aria-labelledby="title desc">',
        f"<title id=\"title\">{esc(title)} architectural program diagram</title>",
        f'<desc id="desc">An illustrative architectural program plan with dimension callouts drawn from the requirements data. Not to scale.</desc>',
        f'<rect width="{CANVAS_W}" height="{canvas_h}" fill="{PAPER}"/>',
        rect(22, 22, CANVAS_W - 44, canvas_h - 44, "none", BLACK, 1),
        line(48, 125, CANVAS_W - 48, 125, BLACK, 1.5),
        text(62, 72, title.upper(), 29, BLACK, 700, letter_spacing=1.4),
        text(64, 102, f"{program.get('label_sv', '')}   /   {str(program.get('time_horizon', '')).upper()} HORIZON", 12, MUTED, 600),
        text(CANVAS_W - 62, 72, "PROGRAM STUDY", 12, MUTED, 700, "end", 1.3),
        text(CANVAS_W - 62, 102, "ILLUSTRATIVE · NOT TO SCALE", 11, ORANGE, 700, "end", 1),
        rect(PLAN_X, PLAN_Y, PLAN_W, PLAN_H, WHITE, BLACK, 1.5),
        rect(SIDE_X, SIDE_Y, SIDE_W, SIDE_H, WHITE, BLACK, 1.5),
        program_plan(program, units),
    ]

    parts.append(shell_section(demands, SIDE_X + 20, SIDE_Y + 28, SIDE_W - 40))
    clear_y = SIDE_Y + 292
    parts.append(line(SIDE_X + 20, clear_y - 10, SIDE_X + SIDE_W - 20, clear_y - 10, BLACK, 1))
    parts.append(clearance_details(program, SIDE_X + 20, clear_y, SIDE_W - 40))

    footer_y = CANVAS_H - 54
    parts.extend([
        line(48, footer_y - 18, CANVAS_W - 48, footer_y - 18, BLACK, 1),
        text(62, footer_y + 4, "DIMENSIONS / REQUIREMENTS: data/standards/space_requirements.json", 10, MUTED, 600),
        text(CANVAS_W - 62, footer_y + 4, "VALUES ARE INDICATIVE AND UNVERIFIED", 10, ORANGE, 700, "end"),
        text(62, footer_y + 40, f"SOURCES  ·  {meta.get('verification_status', '')}", 12, BLACK, 700, letter_spacing=1),
    ])
    for index, (owner, refs, confidence) in enumerate(rows):
        y = footer_y + 64 + index * 19
        parts.append(text(62, y, f"{index + 1}. {label(owner, 40)}", 11, INK, 700))
        parts.append(text(380, y, f"[{confidence}]", 11, ORANGE, 700))
        parts.append(text(480, y, refs, 11, INK))
    parts.append("</svg>")
    return "\n".join(parts)


def main() -> None:
    with SOURCE.open(encoding="utf-8") as source:
        data = json.load(source)
    programs = data["use_programs"]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for program in programs:
        (OUTPUT / f"{program['id']}.svg").write_text(svg_for(program, data["_meta"]), encoding="utf-8")
    print(f"Drew {len(programs)} architectural-style use diagrams in {OUTPUT}")


if __name__ == "__main__":
    main()
