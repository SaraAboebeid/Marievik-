"""B01's geometry, room types and the floor layouts of the floor studio.

Coordinates are metres in B01's own plan frame (data/plans/marievik/B01.json): x along the street frontage,
y from the street inward. Each layout is a function of a few movable-wall parameters, with limits so a wall
can only move where the plan still works.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

W, H, CELL = 43.25, 53.47, 0.3
NX, NY = int(-(-W // CELL)), int(-(-H // CELL))       # ceil
FRAME = {"origin": [25.81, -24.86], "x": [0.55653, 0.83077]}
CORES = [{"id": "W", "r": (12, 13, 15.6, 31), "stair": (12, 24, 15.6, 31)},
         {"id": "E", "r": (27.6, 13, 31.2, 31), "stair": (27.6, 24, 31.2, 31)}]
ATRIUM = (16.6, 15, 26.6, 35)
EXITS_TYP = [{"id": "Stair west", "x": 11.7, "y": 27.5, "w": 1.2}, {"id": "Stair east", "x": 31.5, "y": 27.5, "w": 1.2}]
# on the ground floor the stairs lead straight outside, so they count as exits too
EXITS_GF = [{"id": "Main entrance", "x": 21.6, "y": 0.3, "w": 1.8}, {"id": "Loading door", "x": 5.8, "y": H - 0.3, "w": 1.8}] + EXITS_TYP
LIFTS = [(11.7, 18.5), (31.5, 18.5)]
GFA_TYP = round(W * H - (ATRIUM[2] - ATRIUM[0]) * (ATRIUM[3] - ATRIUM[1]))
GFA_GF = round(W * H)
WALL_H, ESCAPE_LIMIT = 2.7, 45.0

# room type -> label, furniture kit, design density for the legal maximum (persons/m2), glazed partitions
TYPES: dict[str, dict] = {
    "teamroom":   {"label": "Team room", "kit": "desks", "dens": 0.1, "glass": True},
    "backoffice": {"label": "Back office", "kit": "desks", "dens": 0.1},
    "studio":     {"label": "Studio", "kit": "desks", "dens": 0.1, "glass": True},
    "cell":       {"label": "Office", "kit": "cell", "dens": 0.1},
    "meeting":    {"label": "Meeting room", "kit": "meeting", "dens": 0.7, "glass": True},
    "project":    {"label": "Project room", "kit": "meeting", "dens": 0.7, "glass": True},
    "booth":      {"label": "Focus room", "kit": "booth", "dens": 0.1, "glass": True},
    "library":    {"label": "Quiet library", "kit": "library", "dens": 0.3},
    "pantry":     {"label": "Pantry", "kit": "pantry", "dens": 0.5},
    "lounge":     {"label": "Lounge", "kit": "lounge", "dens": 0.5, "glass": True},
    "cafe":       {"label": "Café", "kit": "cafe", "dens": 1.0, "glass": True},
    "kitchen":    {"label": "Kitchen", "kit": "kitchen", "dens": 0.1},
    "event":      {"label": "Event space", "kit": "event", "dens": 1.5},
    "wc":         {"label": "WC", "kit": "wc", "dens": 0},
    "store":      {"label": "Store", "kit": "store", "dens": 0},
    "plant":      {"label": "Plant room", "kit": "plant", "dens": 0},
    "loading":    {"label": "Loading", "kit": "loading", "dens": 0},
    "it":         {"label": "IT / comms", "kit": "it", "dens": 0.1},
    "security":   {"label": "Security", "kit": "security", "dens": 0.1},
    "firstaid":   {"label": "First aid", "kit": "firstaid", "dens": 0.1},
    "garden":     {"label": "Atrium garden", "kit": "garden", "dens": 0.3},
}


@dataclass
class Layout:
    id: str
    name: str
    short: str
    use: str                       # office | cowork | cafe | restaurant | ground (running-cost family)
    open_fill: str                 # what fills the open area: bench | cafe | dining | none
    open_dens: float               # design density of the open area
    defaults: dict
    rooms: Callable[[dict], list]
    zones: Callable[[dict], list] = lambda p: []
    handles: Callable[[dict], list] = lambda p: []
    ground: bool = False
    desk_ratio: float | None = None


def R(name, t, x0, y0, x1, y1, **o):
    return {"name": name, "t": t, "r": (x0, y0, x1, y1), **o}


def strip(name, t, axis, frm, to, step, a0, a1, **o):
    """A run of equal rooms along x (axis 'x') or y."""
    n = max(1, int((to - frm) / step + 0.25))
    s = (to - frm) / n
    return [R(name, t, frm + i * s, a0, frm + (i + 1) * s, a1, **o) if axis == "x" else R(name, t, a0, frm + i * s, a1, frm + (i + 1) * s, **o)
            for i in range(n)]


def hx(key, label, span, lo, hi):
    return {"key": key, "axis": "x", "span": span, "min": lo, "max": hi, "label": label}


def hy(key, label, span, lo, hi):
    return {"key": key, "axis": "y", "span": span, "min": lo, "max": hi, "label": label}


# the traced upper floors show no toilets: a WC block beside each core stands in for them
WC_BLOCKS = [R("WC west", "wc", 12, 31, 15.6, 38.5, acc=True, door="W", fixed=True),
             R("WC east", "wc", 27.6, 31, 31.2, 38.5, acc=True, door="E", fixed=True)]
GARDEN = R("Atrium garden", "garden", *ATRIUM, open=True)


def north_band_gf(p):
    return [R("Loading & delivery", "loading", 0, p["nb"], 11.6, H, door="S"), R("Bin store", "store", 11.6, p["nb"], 16.8, H),
            R("Plant room", "plant", 16.8, p["nb"], 27.2, H), R("Facilities store", "store", 27.2, p["nb"], 33.0, H),
            R("WC men", "wc", 33.0, p["nb"], 38.1, H), R("WC women + accessible", "wc", 38.1, p["nb"], W, H, acc=True)]


def _cellular(p):
    d, cw = p["d"], p["cw"]
    c = d + 1.8
    out = (strip("Office", "cell", "x", 0, W, cw, 0, d) + strip("Office", "cell", "x", 0, W, cw, H - d, H)
           + strip("Office", "cell", "y", c, H - c, cw, 0, d) + strip("Office", "cell", "y", c, H - c, cw, W - d, W))
    if 11.4 - c >= 3:
        out += [R("Pantry", "pantry", c, c, c + 9, 11.4), R("Meeting room", "meeting", c + 9, c, c + 16, 11.4), R("Meeting room", "meeting", c + 16, c, W - c, 11.4)]
    if H - c - 40.1 >= 3:
        out += [R("Meeting room", "meeting", c, 40.1, c + 8, H - c), R("Project room", "project", c + 8, 40.1, c + 17, H - c),
                R("Print & store", "store", c + 17, 40.1, c + 21, H - c), R("Meeting room", "meeting", c + 21, 40.1, W - c, H - c)]
    if 10.4 - c >= 2.4:
        out += strip("Focus room", "booth", "y", 13, 31, 2.6, c, 10.4)
    if W - c - 32.8 >= 2.4:
        out += strip("Focus room", "booth", "y", 13, 31, 2.6, 32.8, W - c)
    return out


LAYOUTS: dict[str, Layout] = {l.id: l for l in [
    Layout("gf_reception", "Reception & building services (as drawn)", "Reception", "ground", "none", 0.3, ground=True,
           defaults={"nb": 42.6, "wb": 9.6, "w1": 20.0, "w2": 29.0, "cs": 11.0, "eb": 34.4, "e1": 21.8, "e2": 27.0, "e3": 33.0},
           rooms=lambda p: north_band_gf(p) + [
               R("Meeting room 1", "meeting", 0, p["w2"], p["wb"], 38.5), R("Meeting room 2", "meeting", 0, p["w1"], p["wb"], p["w2"]),
               R("Visitor lounge", "lounge", 0, p["cs"], p["wb"], p["w1"]), R("Café", "cafe", 0, 0, 16.0, p["cs"]),
               R("IT / comms", "it", p["eb"], p["e3"], W, 39.5), R("Security control", "security", p["eb"], p["e2"], W, p["e3"]),
               R("First aid", "firstaid", p["eb"], p["e1"], W, p["e2"]), R("Back office", "backoffice", p["eb"], 10.0, W, p["e1"]), GARDEN],
           zones=lambda p: [{"k": "reception", "r": (17.2, 2.4, 27.2, 8.6)}, {"k": "lounge", "r": (17.5, 36.4, 32.4, p["nb"] - 1.2)}],
           handles=lambda p: [hy("nb", "Service rooms (north band)", [0, W], 39.5, 47), hx("wb", "West meeting rooms, depth", [p["cs"], 38.5], 6.5, 11.6),
                              hx("eb", "East rooms (back office, IT, security), depth", [10, 39.5], 32.8, 38), hy("w1", "Lounge / meeting room 2", [0, p["wb"]], p["cs"] + 4, p["w2"] - 4),
                              hy("w2", "Meeting room 1 / 2", [0, p["wb"]], p["w1"] + 4, 34.5), hy("e1", "Back office / first aid", [p["eb"], W], 14, p["e2"] - 3),
                              hy("e2", "First aid / security", [p["eb"], W], p["e1"] + 3, p["e3"] - 3), hy("e3", "Security / IT", [p["eb"], W], p["e2"] + 3, 36.5)]),
    Layout("gf_food", "Restaurant & café", "Restaurant", "restaurant", "dining", 1.0, ground=True,
           defaults={"nb": 42.6, "eb": 33.6},
           rooms=lambda p: north_band_gf(p) + [R("Kitchen", "kitchen", p["eb"], 17, W, 39.5), R("Cold & dry store", "store", p["eb"], 10, W, 17), GARDEN],
           zones=lambda p: [{"k": "clear", "r": (16.8, 0, 26.4, 6.5)}, {"k": "cafe", "r": (0.6, 0.6, 16.4, 12)}, {"k": "bar", "r": (p["eb"] - 3.6, 21, p["eb"] - 1.2, 33)}],
           handles=lambda p: [hy("nb", "Service rooms (north band)", [0, W], 39.5, 47), hx("eb", "Kitchen, depth", [10, 39.5], 33, 37)]),
    Layout("gf_cowork", "Coworking lounge", "Cowork GF", "cowork", "bench", 0.3, ground=True,
           defaults={"nb": 42.6, "eb": 34.4, "wb": 7.0},
           rooms=lambda p: north_band_gf(p) + strip("Studio", "studio", "y", 10, 39.5, 7, p["eb"], W) + strip("Phone booth", "booth", "y", 14, 24, 2.5, 0, 2.4)
           + [R("Meeting room", "meeting", 0, 26, p["wb"], 33), R("Meeting room", "meeting", 0, 33, p["wb"], 40), GARDEN],
           zones=lambda p: [{"k": "clear", "r": (16.8, 0, 26.4, 6)}, {"k": "reception", "r": (27, 1.5, 35, 6.5)}, {"k": "lounge", "r": (0.6, 0.6, 15.5, 12)},
                            {"k": "cafe", "r": (17.5, 36.4, 32.4, p["nb"] - 1.2)}],
           handles=lambda p: [hy("nb", "Service rooms (north band)", [0, W], 39.5, 47), hx("eb", "Studios, depth", [10, 39.5], 33, 37.5), hx("wb", "Meeting rooms, depth", [26, 40], 5, 11)]),
    Layout("open", "Open plan (as drawn)", "Open plan", "office", "bench", 0.1,
           defaults={"wx": 8.6, "w2": 25.5, "w3": 33.5, "ex": 34.0, "e2": 23.5, "e3": 34.0},
           rooms=lambda p: [R("Team room", "teamroom", 0, 16.5, p["wx"], p["w2"]), R("Team room", "teamroom", 0, p["w2"], p["wx"], p["w3"]),
                            R("Team room", "teamroom", 0, p["w3"], p["wx"], 41.5), R("Pantry", "pantry", p["ex"], 14, W, p["e2"]),
                            R("Meeting room", "meeting", p["ex"], p["e2"], W, p["e3"]), R("Meeting room", "meeting", p["ex"], p["e3"], W, 42)],
           zones=lambda p: [{"k": "lounge", "r": (16.6, 39.6, 27.4, 46.2)}],
           handles=lambda p: [hx("wx", "Team rooms, depth", [16.5, 41.5], 5.5, 10.6), hx("ex", "Pantry and meeting rooms, depth", [14, 42], 32.8, 38.5),
                              hy("w2", "Team room 1 / 2", [0, p["wx"]], 20.5, p["w3"] - 4), hy("w3", "Team room 2 / 3", [0, p["wx"]], p["w2"] + 4, 37.5),
                              hy("e2", "Pantry / meeting room", [p["ex"], W], 18, p["e3"] - 4), hy("e3", "Meeting room / meeting room", [p["ex"], W], p["e2"] + 4, 38)]),
    Layout("cellular", "Cellular offices", "Cellular", "office", "none", 0.1,
           defaults={"d": 4.8, "cw": 3.0}, rooms=_cellular,
           handles=lambda p: [hy("d", "Office depth (corridor wall)", [0, W], 3.6, 6.0), hx("cw", "Office width", [0, p["d"]], 2.4, 4.5)]),
    Layout("abw", "Activity-based working", "Activity-based", "office", "bench", 0.1, desk_ratio=0.7,
           defaults={"bx": 3.0, "ex": 36.4, "nb": 41.0},
           rooms=lambda p: strip("Focus room", "booth", "y", 8, 40, 2.6, 0, p["bx"]) + strip("Project room", "project", "y", 9, 39, 10, p["ex"], W)
           + [R("Quiet library", "library", 0, p["nb"], 14, H), R("Café-pantry", "pantry", W - 14, p["nb"], W, H)],
           zones=lambda p: [{"k": "lounge", "r": (14.6, p["nb"] + 0.6, W - 14.6, H - 0.6)}, {"k": "collab", "r": (6, 0.8, 17, 8)}, {"k": "lockers", "r": (5.6, 13, 10.4, 20.5)}],
           handles=lambda p: [hx("bx", "Focus rooms, depth", [8, 40], 2.2, 4.2), hx("ex", "Project rooms, depth", [9, 39], 33.2, 39), hy("nb", "Library and café-pantry (north band)", [0, W], 39.5, 45)]),
    Layout("teams", "Team zones", "Team zones", "office", "bench", 0.1,
           defaults={"tx": 10.0, "td": 7.0},
           rooms=lambda p: [R("Team room SW", "meeting", 0, 0, p["tx"], p["td"]), R("Team room SE", "meeting", W - p["tx"], 0, W, p["td"]),
                            R("Team room NW", "meeting", 0, H - p["td"], p["tx"], H), R("Team room NE", "meeting", W - p["tx"], H - p["td"], W, H),
                            R("Pantry", "pantry", 17, 39.6, 27, 45.6), R("Focus room", "booth", 0, 22, 2.4, 24.6), R("Focus room", "booth", 0, 24.6, 2.4, 27.2),
                            R("Focus room", "booth", W - 2.4, 22, W, 24.6), R("Focus room", "booth", W - 2.4, 24.6, W, 27.2)],
           zones=lambda p: [{"k": "collab", "r": (16.8, 8.6, 27.4, 13.4)}],
           handles=lambda p: [hx("tx", "Team rooms, width", [0, p["td"]], 6, 14), hy("td", "Team rooms, depth", [0, p["tx"]], 4.5, 9.5)]),
    Layout("cowork", "Coworking", "Coworking", "cowork", "bench", 0.1,
           defaults={"sx": 35.4, "ev": 9.5},
           rooms=lambda p: strip("Studio", "studio", "y", p["ev"] + 1.6, 45, 5, p["sx"], W) + strip("Phone booth", "booth", "y", 13, 24, 2.2, 0, 2.2)
           + [R("Event space", "event", 0, 0, 24, p["ev"]), R("Café bar", "cafe", 0, H - 8, 13, H), R("Meeting room", "meeting", 13, H - 8, 20, H), R("Meeting room", "meeting", 20, H - 8, 27, H)],
           zones=lambda p: [{"k": "lounge", "r": (16.6, 39.6, 27.4, H - 9)}],
           handles=lambda p: [hx("sx", "Studios, depth", [p["ev"] + 1.6, 45], 33, 38.5), hy("ev", "Event space, depth", [0, 24], 6, 11.4)]),
    Layout("mixed", "Cellular + open mix", "Mix", "office", "bench", 0.1,
           defaults={"d": 4.5},
           rooms=lambda p: strip("Office", "cell", "y", 8, 46, 3, 0, p["d"]) + strip("Office", "cell", "y", 8, 46, 3, W - p["d"], W)
           + [R("Meeting room", "meeting", 14, H - 6, 21.5, H), R("Meeting room", "meeting", 21.5, H - 6, 29.5, H), R("Pantry", "pantry", 15, 0, 28, 6)],
           handles=lambda p: [hx("d", "Offices, depth", [8, 46], 3.6, 6.5)]),
    Layout("cafe", "Café & lounge", "Café", "cafe", "cafe", 1.0,
           defaults={"ky": 9.0, "kx": 14.0},
           rooms=lambda p: [R("Kitchen & counter", "kitchen", W - p["kx"], H - p["ky"], W, H), R("Staff room", "store", W - p["kx"] - 5, H - p["ky"], W - p["kx"], H)],
           zones=lambda p: [{"k": "lounge", "r": (16.6, 39.6, 26.8, 45.4)}, {"k": "bar", "r": (33.2, 22, 35.4, 34)}],
           handles=lambda p: [hy("ky", "Kitchen, depth", [20, W], 7, 13), hx("kx", "Kitchen, width", [40, H], 10, 18)]),
    Layout("restaurant", "Restaurant", "Restaurant", "restaurant", "dining", 1.0,
           defaults={"ky": 12.0, "kx": 22.0},
           rooms=lambda p: [R("Kitchen", "kitchen", W - p["kx"], H - p["ky"], W, H), R("Cold store", "store", W - p["kx"] - 4, H - p["ky"], W - p["kx"], H),
                            R("Staff & changing", "store", 0, H - 6, 8, H)],
           zones=lambda p: [{"k": "bar", "r": (33.2, 18, 35.4, 30)}],
           handles=lambda p: [hy("ky", "Kitchen, depth", [18, W], 9, 16), hx("kx", "Kitchen, width", [37, H], 16, 26)]),
]}
TYPICAL_LAYOUTS = ["open", "cellular", "abw", "teams", "cowork", "mixed", "cafe", "restaurant"]
GROUND_LAYOUTS = ["gf_reception", "gf_food", "gf_cowork"]
# today's layout per B01 floor in the mock-up: the ground floor as drawn, then a different office on each floor
DEFAULT_FLOOR_LAYOUT = ["gf_reception", "open", "cellular", "abw", "teams", "cowork", "mixed"]


def get(lid: str) -> Layout:
    """A layout by id: one of the drawn ones above, or a generated variant ("gen-<seed>", explorer/studio/generator.py)."""
    if lid in LAYOUTS:
        return LAYOUTS[lid]
    from .generator import from_id
    L = from_id(lid)
    if L is None:
        raise KeyError(lid)
    return L


def layout_for(floor: int) -> str:
    return DEFAULT_FLOOR_LAYOUT[floor] if 0 <= floor < len(DEFAULT_FLOOR_LAYOUT) else "open"


def layout_for_use(use: str, ground: bool) -> str | None:
    """The furnished layout that stands for one of the 10-year timeline's floor uses (explorer/timeline.py), if any."""
    if use == "office_open":
        return "gf_cowork" if ground else "open"
    if use == "office_cellular":
        return "gf_reception" if ground else "cellular"
    if use in ("restaurant_cafe", "retail") or use.startswith("mix_"):
        return "gf_food" if ground else "cafe"
    return None   # housing, hotel and school have no furnished layout yet
