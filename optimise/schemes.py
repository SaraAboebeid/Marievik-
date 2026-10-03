"""Parametric partition schemes on the fixed shell.

The shell does not move: facade along y=0, entry at the corridor side, and
a wet core in the corner over the drainage stack. What the generator varies
is everything a fit-out contractor can change:

    which enclosed rooms there are      from the brief's cell sets
    how wide each one is                from the cell's candidate widths
    how deep the room band is           DEPTHS
    which end of the facade they sit at left, right, or split
    the window intervention             WINDOWS (existing / upgraded / lowered sill)

and draws the walls and doors that result. Each scheme also carries its
rooms as rectangles, which is what the thermal model needs, and a
furniture list with every item seeded in the room it belongs to; the
annealer then decides where in that room it goes.

The generator is deliberately stupid about quality and strict about
validity. It rejects what cannot work (a bedroom with no window, a door
that cannot fit) and leaves every judgement of better or worse to the
evaluation, where it can be seen and argued with.
"""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from pathlib import Path

from .programs import Brief, Cell, Density

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "apartment" / "data" / "demo_plans.json"

WALL_T = 100
DEPTHS = (3000, 3300, 3600, 3900)
# Wet core over the drainage stack: the one room no scheme may move.
WET = {"x0": 5150, "y0": 4050, "x1": 8150, "y1": 6950}
MIN_LIVING_FACADE = 2400   # the open space keeps at least this much window wall
MIN_WINDOW_OVERLAP = 900   # an enclosed room needs this much of a window

WINDOWS = {
    "existing": {
        "label": "Existing 1985 glazing",
        "envelope": "existing", "sill_mm": 900,
        "note": "Fixed double glazing, U 2.8. No cost, no carbon, and no way to open a window.",
    },
    "upgraded": {
        "label": "New openable triple glazing",
        "envelope": "upgraded", "sill_mm": 900,
        "note": "Same openings, U 0.9, openable sashes for purge ventilation.",
    },
    "lowered": {
        "label": "Triple glazing, sill lowered to 600",
        "envelope": "upgraded", "sill_mm": 600,
        "note": "Adds a seated view and daylight; costs a cut spandrel.",
    },
}


def load_shell() -> dict:
    return json.loads(DEMO.read_text(encoding="utf-8"))["shell"]


@dataclass
class Scheme:
    id: str
    use: str
    density: Density
    cells: list[dict]              # placed cells: kind, label, x0, x1
    depth: int
    side: str
    window: str
    plan: dict = field(default_factory=dict)
    rooms: list[dict] = field(default_factory=list)   # rectangles for thermal

    @property
    def geometry_key(self) -> str:
        """Same walls, same rooms: furniture and thermal can be shared."""
        cells = ",".join(f"{c['kind']}:{c['x0']}-{c['x1']}" for c in self.cells)
        return f"{self.use}|{self.density.occupants}|{self.density.user_group}|{self.depth}|{cells}"

    @property
    def thermal_key(self) -> str:
        cells = ",".join(f"{c['x0']}-{c['x1']}" for c in self.cells)
        return (f"{WINDOWS[self.window]['envelope']}|{WINDOWS[self.window]['sill_mm']}|"
                f"{self.depth}|{cells}|{self.density.occupants}|{self.use}")

    def describe(self) -> str:
        if not self.cells:
            rooms = "open plan"
        else:
            rooms = " + ".join(c["label"] for c in self.cells) + f", {self.side}"
        return f"{self.density.label}: {rooms}, {self.depth / 1000:.1f} m deep"


# ---------------------------------------------------------------------------
# Placement of cells along the facade
# ---------------------------------------------------------------------------


def _placements(cells: tuple[Cell, ...], interior: tuple[int, int]):
    """Yield (side, [(cell, width, x0, x1)]) for every width combination."""
    left, right = interior
    if not cells:
        yield "open", []
        return

    width_options = [c.widths for c in cells]
    orders = {tuple(cells)}
    if len(cells) > 1:
        orders |= set(itertools.permutations(cells))

    for order in orders:
        for widths in itertools.product(*[c.widths for c in order]):
            total = sum(widths)
            # All at the left end, all at the right end.
            for side in ("left", "right"):
                x = left if side == "left" else right - total
                placed = []
                for cell, w in zip(order, widths):
                    placed.append((cell, w, x, x + w))
                    x += w
                yield side, placed
            # Split: first cell at the left, the rest at the right.
            if len(order) >= 2:
                placed = [(order[0], widths[0], left, left + widths[0])]
                x = right - sum(widths[1:])
                for cell, w in zip(order[1:], widths[1:]):
                    placed.append((cell, w, x, x + w))
                    x += w
                yield "split", placed


def _window_overlap(x0: int, x1: int, windows: list[dict]) -> int:
    return sum(max(0, min(x1, w["x2"]) - max(x0, w["x1"])) for w in windows)


def _valid(placed, shell: dict) -> bool:
    windows = shell["windows"]
    left = shell["external_wall_thickness_mm"]
    right = shell["width_mm"] - left
    xs = sorted((x0, x1) for _c, _w, x0, x1 in placed)
    # No overlaps, all inside.
    for (a0, a1), (b0, b1) in zip(xs, xs[1:]):
        if b0 < a1:
            return False
    if xs and (xs[0][0] < left or xs[-1][1] > right):
        return False
    # Every enclosed room gets daylight.
    for _cell, _w, x0, x1 in placed:
        if _window_overlap(x0, x1, windows) < MIN_WINDOW_OVERLAP:
            return False
    # The open space keeps enough window wall to be lived in.
    free = []
    cursor = left
    for x0, x1 in xs:
        if x0 > cursor:
            free.append((cursor, x0))
        cursor = max(cursor, x1)
    if cursor < right:
        free.append((cursor, right))
    living_window = sum(_window_overlap(a, b, windows) for a, b in free)
    if living_window < MIN_LIVING_FACADE * 0.6:
        return False
    return True


# ---------------------------------------------------------------------------
# Drawing a scheme
# ---------------------------------------------------------------------------


def _wet_walls() -> list[dict]:
    return [
        {"id": "wet1", "x1": WET["x0"], "y1": WET["y0"], "x2": WET["x0"], "y2": WET["y1"],
         "thickness": WALL_T, "component": "part.stud.gypsum.95", "wet": True},
        {"id": "wet2", "x1": WET["x0"], "y1": WET["y0"], "x2": WET["x1"], "y2": WET["y0"],
         "thickness": WALL_T, "component": "part.stud.gypsum.95", "wet": True},
    ]


def _door_t(x0: int, x1: int, side_hint: float, clear: int) -> float:
    """Position of a door along a wall, keeping it clear of the corners."""
    length = x1 - x0
    margin = (clear / 2 + 250) / length
    return max(margin, min(1 - margin, side_hint))


def draw(brief: Brief, density: Density, placed, side: str, depth: int,
         window: str, shell: dict, door_clear: int, passage: int = 900) -> Scheme | None:
    ext = shell["external_wall_thickness_mm"]
    left, right = ext, shell["width_mm"] - ext
    bottom = shell["depth_mm"] - ext

    win = WINDOWS[window]
    shell = json.loads(json.dumps(shell))
    for w in shell["windows"]:
        w["sill_mm"] = win["sill_mm"]

    walls = _wet_walls()
    doors = [{"id": "dwet", "wall_id": "wet1", "t": 0.81, "clear_mm": max(850, door_clear)}]
    cells = []
    rooms = []

    xs = sorted(placed, key=lambda p: p[2])
    boundaries = set()
    for _cell, _w, x0, x1 in xs:
        for x in (x0, x1):
            if left < x < right:
                boundaries.add(x)
    for n, x in enumerate(sorted(boundaries)):
        walls.append({"id": f"v{n}", "x1": x, "y1": ext, "x2": x, "y2": depth,
                      "thickness": WALL_T, "component": "part.stud.gypsum.95"})

    centre = (left + right) / 2
    # Clear width of the strip between the room band and the wet core. A
    # door opening onto it leads nowhere if a person cannot pass along it.
    strip_clear = WET["y0"] - depth - WALL_T
    for n, (cell, _w, x0, x1) in enumerate(xs):
        wall_id = f"h{n}"
        walls.append({"id": wall_id, "x1": x0, "y1": depth, "x2": x1, "y2": depth,
                      "thickness": WALL_T, "component": "part.stud.gypsum.95"})
        # Door at the end of the room nearer the middle of the plan, where
        # the living space is.
        hint = 0.85 if (x0 + x1) / 2 < centre else 0.15
        t = _door_t(x0, x1, hint, door_clear)
        door_x = x0 + t * (x1 - x0)
        if door_x + door_clear / 2 > WET["x0"] - 50 and strip_clear < passage:
            # Over the wet core: move the door to the part of the wall that
            # faces the living space, if there is enough of it.
            usable = WET["x0"] - 50 - x0
            if usable < door_clear + 300:
                return None
            door_x = x0 + usable - door_clear / 2 - 150
            t = (door_x - x0) / (x1 - x0)
        doors.append({"id": f"d{n}", "wall_id": wall_id,
                      "t": round(t, 3),
                      "clear_mm": max(850, door_clear)})
        cell_id = f"c{n}"
        cells.append({"id": cell_id, "kind": cell.kind, "label": cell.label or cell.kind.title(),
                      "x0": x0, "x1": x1, "items": list(cell.items)})
        rooms.append({"id": cell_id, "label": cell.label or cell.kind, "kind": cell.kind,
                      "x0": x0, "y0": ext, "x1": x1, "y1": depth})

    # The open space as rectangles: facade gaps between cells, then the band
    # behind the cells, then the strip beside the wet core.
    cursor = left
    gaps = []
    for _cell, _w, x0, x1 in xs:
        if x0 > cursor:
            gaps.append((cursor, x0))
        cursor = x1
    if cursor < right:
        gaps.append((cursor, right))
    open_label = "Open office" if brief.thermal_profile == "office" else "Living"
    for n, (a, b) in enumerate(gaps):
        rooms.append({"id": f"open_f{n}", "space": "open", "label": open_label, "kind": "open",
                      "x0": a, "y0": ext, "x1": b, "y1": depth if xs else WET["y0"]})
    if xs:
        rooms.append({"id": "open_mid", "space": "open", "label": open_label, "kind": "open",
                      "x0": left, "y0": depth, "x1": right, "y1": WET["y0"]})
    rooms.append({"id": "open_back", "space": "open", "label": open_label, "kind": "open",
                  "x0": left, "y0": WET["y0"], "x1": WET["x0"], "y1": bottom})
    rooms.append({"id": "wet", "label": "Bathroom", "kind": "wet", **WET})

    # People for the thermal gains: residents split between their rooms and
    # the shared space; desks in the open plan sit in the open plan.
    occupants = density.occupants
    bed_cells = [r for r in rooms if r["kind"] in ("bedroom", "care_room")]
    open_rooms = [r for r in rooms if r["kind"] == "open"]
    open_area = sum((r["x1"] - r["x0"]) * (r["y1"] - r["y0"]) for r in open_rooms) or 1
    if brief.thermal_profile == "office":
        for r in rooms:
            r["people"] = 0.0
        focus = [r for r in rooms if r["kind"] == "focus"]
        for r in focus:
            r["people"] = 1.0
        rest = max(0, occupants - len(focus))
        for r in open_rooms:
            r["people"] = rest * (r["x1"] - r["x0"]) * (r["y1"] - r["y0"]) / open_area
    else:
        share = occupants / max(1, len(bed_cells)) if bed_cells else 0.0
        for r in rooms:
            r["people"] = 0.0
        for r in bed_cells:
            r["people"] = 0.5 * share
        for r in open_rooms:
            weight = 1.0 if not bed_cells else 0.5
            r["people"] = weight * occupants * (r["x1"] - r["x0"]) * (r["y1"] - r["y0"]) / open_area

    # Furniture, seeded at the centre of the room it belongs to.
    furniture = []
    counter = itertools.count(1)
    for cell in cells:
        cx, cy = (cell["x0"] + cell["x1"]) / 2, (ext + depth) / 2
        for type_id in cell["items"]:
            furniture.append({"id": f"f{next(counter)}", "type": type_id,
                              "x": int(cx), "y": int(cy), "rot": 0, "room": cell["id"]})
    living_seed = (left + (WET["x0"] - left) / 2, (depth + bottom) / 2 if xs else shell["depth_mm"] / 2)
    for type_id in density.living_items:
        furniture.append({"id": f"f{next(counter)}", "type": type_id,
                          "x": int(living_seed[0]), "y": int(living_seed[1]), "rot": 0, "room": "open"})
    # Wet fixtures where the drainage is, as in the surveyed demo plans.
    fixed = {"shower.900": (5750, 4650, 0), "basin.600": (7700, 4550, 0),
             "wc.pan": (7750, 6500, 180), "washer.600": (5550, 6500, 180)}
    for type_id in density.wet_items:
        x, y, rot = fixed[type_id]
        furniture.append({"id": f"f{next(counter)}", "type": type_id,
                          "x": x, "y": y, "rot": rot, "room": "wet"})

    cells_key = "-".join(f"{c['kind'][0]}{c['x0']}" for c in cells) or "open"
    scheme_id = f"{brief.id}.{density.occupants}{density.user_group[:4]}.{side}.{depth}.{cells_key}.{window}"
    scheme = Scheme(
        id=scheme_id, use=brief.id, density=density, cells=cells, depth=depth,
        side=side, window=window, rooms=rooms,
    )
    scheme.plan = {"shell": shell, "walls": walls, "doors": doors, "furniture": furniture}
    return scheme


def window_works(scheme: Scheme) -> list[dict]:
    """Envelope works implied by the window choice, as costed quantities."""
    win = WINDOWS[scheme.window]
    if win["envelope"] == "existing":
        return []
    shell = scheme.plan["shell"]
    length_m = sum((w["x2"] - w["x1"]) for w in shell["windows"]) / 1000.0
    head = max(w["head_mm"] for w in shell["windows"])
    works = [{"component": "skin.window.triple.openable",
              "quantity": round(length_m * (head - 900) / 1000.0, 2)}]
    if win["sill_mm"] < 900:
        works.append({"component": "skin.window.lowered.sill",
                      "quantity": round(length_m * (900 - win["sill_mm"]) / 1000.0, 2)})
    return works


def generate(brief: Brief, door_clear_for: dict[str, int],
             windows: tuple[str, ...] = tuple(WINDOWS),
             passage_for: dict[str, int] | None = None) -> list[Scheme]:
    """Every valid scheme for a brief, across densities, layouts and windows."""
    shell = load_shell()
    ext = shell["external_wall_thickness_mm"]
    interior = (ext, shell["width_mm"] - ext)
    out: list[Scheme] = []
    seen: set[str] = set()
    passage_for = passage_for or {}
    for density in brief.densities:
        door_clear = door_clear_for.get(density.user_group, 850)
        passage = passage_for.get(density.user_group, 900)
        for cells in density.cell_sets:
            depths = DEPTHS if cells else (0,)
            for side, placed in _placements(cells, interior):
                if not _valid(placed, shell):
                    continue
                for depth in depths:
                    for window in windows:
                        scheme = draw(brief, density, placed, side, depth, window, shell,
                                      door_clear, passage)
                        if scheme is None or scheme.id in seen:
                            continue
                        seen.add(scheme.id)
                        scheme.plan["works"] = window_works(scheme)
                        out.append(scheme)
    return out
