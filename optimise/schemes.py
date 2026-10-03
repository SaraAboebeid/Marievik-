"""Parametric partition schemes on a fixed shell.

The shell does not move: its outline, its windows as built, the entry, the
wet core over the drainage and anything marked fixed (bathroom walls, a
fitted kitchen). What the generator varies is everything a fit-out
contractor can change:

    which enclosed rooms there are      from the brief's cell sets
    how wide each one is                from the cell's candidate widths
    how deep the room band is           CLEAR_DEPTHS from the facade
    which end of the facade they sit at left, right, or split
    the window intervention             WINDOWS (existing / upgraded / lowered sill)

and draws the walls and doors that result, with every item of furniture
seeded in the room it belongs to; the annealer then decides where in that
room it goes.

It works on any shell in apartment/shells.py — the Marievik+ bay or a
traced real plan — because it reads the outline, wet core and fixed
elements from the shell rather than assuming them.

The generator is deliberately stupid about quality and strict about
validity. It rejects what cannot work (a bedroom with no window, a room you
cannot reach) and leaves every judgement of better or worse to the
evaluation, where it can be seen and argued with.
"""

from __future__ import annotations

import itertools
import json
from copy import deepcopy
from dataclasses import dataclass, field

import shapely
from shapely.geometry import LineString, box

from apartment import envelope, geometry
from apartment import shells as shell_registry

from .programs import Brief, Cell, Density

WALL_T = 100
CLEAR_DEPTHS = (2750, 3050, 3350, 3650)   # room depth from the inside of the facade
MIN_LIVING_FACADE = 2400   # the open space keeps at least this much window wall
MIN_WINDOW_OVERLAP = 900   # an enclosed room needs this much of a window
DEFAULT_SHELL = "marievik_bay"

WINDOWS = {
    "existing": {
        "label": "Existing glazing",
        "envelope": "existing", "sill_mm": None,
        "note": "The windows as built. No cost, no carbon.",
    },
    "upgraded": {
        "label": "New openable triple glazing",
        "envelope": "upgraded", "sill_mm": None,
        "note": "Same openings, U 0.9, openable sashes for purge ventilation.",
    },
    "lowered": {
        "label": "Triple glazing, sill lowered to 600",
        "envelope": "upgraded", "sill_mm": 600,
        "note": "Adds a seated view and daylight; costs a cut spandrel.",
    },
}

# Where the Marievik bay's wet fixtures sit, over its drainage stack.
_BAY_FIXTURES = {"shower.900": (5750, 4650, 0), "basin.600": (7700, 4550, 0),
                 "wc.pan": (7750, 6500, 180), "washer.600": (5550, 6500, 180)}


# ---------------------------------------------------------------------------
# The site: what a shell fixes
# ---------------------------------------------------------------------------


@dataclass
class Site:
    id: str
    shell: dict
    interior: object
    facade_y: float
    left: float
    right: float
    wet: dict
    fixed_walls: list[dict]
    fixed_doors: list[dict]
    fixed_furniture: list[dict]
    fitted_categories: set[str]

    @property
    def area_m2(self) -> float:
        return self.interior.area / 1e6


def site(shell_id: str = DEFAULT_SHELL) -> Site:
    entry = shell_registry.shell(shell_id)
    shell = deepcopy(entry["shell"])
    interior = geometry.interior_polygon(shell)
    facade_y = shell.get("facade_y_mm", shell.get("external_wall_thickness_mm", 250))
    span = interior.intersection(LineString([(-1e5, facade_y + 20), (1e5, facade_y + 20)]))
    left, right = span.bounds[0], span.bounds[2]
    wet = shell["wet"]

    base = next(iter(entry["configurations"].values()))
    fixed_ids = set(shell.get("fixed_walls", []))
    if fixed_ids:
        fixed_walls = [w for w in base["walls"] if w["id"] in fixed_ids]
        fixed_doors = [d for d in base["doors"] if d["wall_id"] in fixed_ids]
        fixed_furniture = [dict(f) for f in base["furniture"] if f.get("fixed")]
    else:
        # The Marievik bay: two wet-core walls and a door, drawn here.
        fixed_walls = [
            {"id": "wet1", "x1": wet["x0"], "y1": wet["y0"], "x2": wet["x0"], "y2": wet["y1"],
             "thickness": WALL_T, "component": "part.stud.gypsum.95", "wet": True, "fixed": True},
            {"id": "wet2", "x1": wet["x0"], "y1": wet["y0"], "x2": wet["x1"], "y2": wet["y0"],
             "thickness": WALL_T, "component": "part.stud.gypsum.95", "wet": True, "fixed": True},
        ]
        fixed_doors = [{"id": "dwet", "wall_id": "wet1", "t": 0.81, "clear_mm": 850}]
        fixed_furniture = []
    from apartment.evaluate import FURNITURE
    fitted = {FURNITURE[f["type"]]["category"] for f in fixed_furniture if f["type"] in FURNITURE}
    return Site(shell_id, shell, interior, facade_y, left, right, wet,
                fixed_walls, fixed_doors, fixed_furniture, fitted - {"sanitary"})


@dataclass
class Scheme:
    id: str
    use: str
    density: Density
    cells: list[dict]              # placed cells: kind, label, x0, x1
    depth: int
    side: str
    window: str
    shell_id: str = DEFAULT_SHELL
    plan: dict = field(default_factory=dict)
    rooms: list[dict] = field(default_factory=list)   # kept for compatibility; zones come from the plan

    @property
    def geometry_key(self) -> str:
        """Same walls, same rooms: furniture and thermal can be shared."""
        cells = ",".join(f"{c['kind']}:{c['x0']}-{c['x1']}" for c in self.cells)
        return f"{self.shell_id}|{self.use}|{self.density.occupants}|{self.density.user_group}|{self.depth}|{cells}"

    @property
    def thermal_key(self) -> str:
        return f"{self.geometry_key}|{self.window}"

    def describe(self) -> str:
        if not self.cells:
            rooms = "open plan"
        else:
            rooms = " + ".join(c["label"] for c in self.cells) + f", {self.side}"
        depth = f", {self.depth / 1000:.1f} m deep" if self.cells else ""
        return f"{self.density.label}: {rooms}{depth}"


# ---------------------------------------------------------------------------
# Placement of cells along the facade
# ---------------------------------------------------------------------------


def _placements(cells: tuple[Cell, ...], left: float, right: float):
    """Yield (side, [(cell, width, x0, x1)]) for every width combination."""
    if not cells:
        yield "open", []
        return
    orders = {tuple(cells)}
    if len(cells) > 1:
        orders |= set(itertools.permutations(cells))
    for order in orders:
        for widths in itertools.product(*[c.widths for c in order]):
            total = sum(widths)
            for side in ("left", "right"):
                x = left if side == "left" else right - total
                placed = []
                for cell, w in zip(order, widths):
                    placed.append((cell, w, round(x), round(x + w)))
                    x += w
                yield side, placed
            if len(order) >= 2:
                placed = [(order[0], widths[0], round(left), round(left + widths[0]))]
                x = right - sum(widths[1:])
                for cell, w in zip(order[1:], widths[1:]):
                    placed.append((cell, w, round(x), round(x + w)))
                    x += w
                yield "split", placed


def _window_overlap(x0: float, x1: float, windows: list[dict]) -> float:
    return sum(max(0, min(x1, w["x2"]) - max(x0, w["x1"])) for w in windows)


def _valid_facade(placed, s: Site) -> bool:
    windows = s.shell["windows"]
    xs = sorted((x0, x1) for _c, _w, x0, x1 in placed)
    for (a0, a1), (b0, b1) in zip(xs, xs[1:]):
        if b0 < a1:
            return False
    if xs and (xs[0][0] < s.left - 1 or xs[-1][1] > s.right + 1):
        return False
    for _cell, _w, x0, x1 in placed:
        if _window_overlap(x0, x1, windows) < MIN_WINDOW_OVERLAP:
            return False
    free, cursor = [], s.left
    for x0, x1 in xs:
        if x0 > cursor:
            free.append((cursor, x0))
        cursor = max(cursor, x1)
    if cursor < s.right:
        free.append((cursor, s.right))
    return sum(_window_overlap(a, b, windows) for a, b in free) >= MIN_LIVING_FACADE * 0.6


def _cell_fits(x0: float, x1: float, depth: float, s: Site) -> bool:
    """Inside the floor, clear of the wet core, fixed walls and fitted items."""
    rect = box(x0, s.facade_y, x1, depth)
    if not s.interior.buffer(5).contains(rect):
        return False
    if rect.intersects(box(s.wet["x0"], s.wet["y0"], s.wet["x1"], s.wet["y1"]).buffer(-5)):
        return False
    for w in s.fixed_walls:
        if rect.buffer(-5).intersects(geometry.wall_polygon(w["x1"], w["y1"], w["x2"], w["y2"], w.get("thickness", 100))):
            return False
    from apartment.evaluate import FURNITURE
    for f in s.fixed_furniture:
        spec = FURNITURE.get(f["type"])
        if spec and rect.buffer(-5).intersects(geometry.item_polygon({**spec, **f})):
            return False
    entry = s.shell.get("entry")
    if entry and rect.contains(shapely.Point(entry["x"], entry["y"])):
        return False
    return True


# ---------------------------------------------------------------------------
# Drawing a scheme
# ---------------------------------------------------------------------------


def _door_t(x0: float, x1: float, hint: float, clear: int) -> float:
    length = x1 - x0
    margin = (clear / 2 + 250) / length
    return max(margin, min(1 - margin, hint))


def _reachable(plan: dict, specs: dict, passage: int, door_clear: int) -> bool:
    geo = geometry.analyse(plan, specs, 900, passage, door_clear)
    return not geo.unreachable_rooms


def draw_geometry(brief: Brief, density: Density, placed, side: str, depth: float,
                  s: Site, door_clear: int, passage: int, specs: dict) -> Scheme | None:
    """Walls, doors and seeded furniture for one layout, with the windows as built."""
    for _c, _w, x0, x1 in placed:
        if not _cell_fits(x0, x1, depth, s):
            return None

    walls = [dict(w) for w in s.fixed_walls]
    # A traced bathroom door is what it is (and is reported if too narrow);
    # the bay's wet-core door is drawn to the user group's standard.
    doors = [dict(d, clear_mm=max(850, door_clear) if s.id == DEFAULT_SHELL else d["clear_mm"])
             for d in s.fixed_doors]
    xs = sorted(placed, key=lambda p: p[2])
    boundaries = sorted({x for _c, _w, x0, x1 in xs for x in (x0, x1) if s.left + 1 < x < s.right - 1})
    for n, x in enumerate(boundaries):
        walls.append({"id": f"v{n}", "x1": x, "y1": round(s.facade_y), "x2": x, "y2": round(depth),
                      "thickness": WALL_T, "component": "part.stud.gypsum.95"})

    # The open space, for door hints and the living-room seed point.
    open_space = s.interior
    for _c, _w, x0, x1 in xs:
        open_space = open_space.difference(box(x0, s.facade_y, x1, depth + WALL_T / 2))
    open_space = open_space.difference(box(s.wet["x0"], s.wet["y0"], s.wet["x1"], s.wet["y1"]))
    if open_space.geom_type == "MultiPolygon":
        open_space = max(open_space.geoms, key=lambda g: g.area)
    centre_x = open_space.centroid.x

    cells = []
    for n, (cell, _w, x0, x1) in enumerate(xs):
        wall_id = f"h{n}"
        walls.append({"id": wall_id, "x1": x0, "y1": round(depth), "x2": x1, "y2": round(depth),
                      "thickness": WALL_T, "component": "part.stud.gypsum.95"})
        cells.append({"id": f"c{n}", "kind": cell.kind, "label": cell.label or cell.kind.title(),
                      "x0": x0, "x1": x1, "items": list(cell.items)})
        hint = 0.85 if (x0 + x1) / 2 < centre_x else 0.15
        doors.append({"id": f"d{n}", "wall_id": wall_id, "t": round(_door_t(x0, x1, hint, door_clear), 3),
                      "clear_mm": max(850, door_clear)})

    # Furniture: fixed items as built, cell items at their cell, the rest in the open space.
    furniture = [dict(f) for f in s.fixed_furniture]
    counter = itertools.count(1)
    for cell in cells:
        cx, cy = (cell["x0"] + cell["x1"]) / 2, (s.facade_y + depth) / 2
        for type_id in cell["items"]:
            furniture.append({"id": f"f{next(counter)}", "type": type_id, "x": int(cx), "y": int(cy), "rot": 0})
    seed = open_space.representative_point()
    from apartment.evaluate import FURNITURE
    for type_id in density.living_items:
        # A fitted kitchen already does what a loose one would.
        if FURNITURE.get(type_id, {}).get("category") in s.fitted_categories:
            continue
        furniture.append({"id": f"f{next(counter)}", "type": type_id, "x": int(seed.x), "y": int(seed.y), "rot": 0})
    if s.id == DEFAULT_SHELL:
        for type_id in density.wet_items:
            x, y, rot = _BAY_FIXTURES[type_id]
            furniture.append({"id": f"f{next(counter)}", "type": type_id, "x": x, "y": y, "rot": rot, "fixed": True})

    plan = {"shell": deepcopy(s.shell), "walls": walls, "doors": doors, "furniture": furniture}

    # Every room must be reachable with the walls and fixed items alone. If
    # the preferred door position fails, try the other end and the middle.
    bare = {**plan, "furniture": [f for f in furniture if f.get("fixed")]}
    if not _reachable(bare, specs, passage, door_clear):
        for n in range(len(cells)):
            ok = False
            for hint in (0.15, 0.5, 0.85):
                bare["doors"][len(s.fixed_doors) + n]["t"] = round(
                    _door_t(cells[n]["x0"], cells[n]["x1"], hint, door_clear), 3)
                if _reachable(bare, specs, passage, door_clear):
                    ok = True
                    break
            if ok:
                break
        if not _reachable(bare, specs, passage, door_clear):
            return None
        plan["doors"] = bare["doors"]

    cells_key = "-".join(f"{c['kind'][0]}{c['x0']}" for c in cells) or "open"
    clear_depth = round(depth - s.facade_y)
    scheme_id = f"{brief.id}.{density.occupants}{density.user_group[:4]}.{side}.{clear_depth if cells else 0}.{cells_key}"
    scheme = Scheme(id=scheme_id, use=brief.id, density=density, cells=cells,
                    depth=clear_depth if cells else 0, side=side, window="existing", shell_id=s.id)
    scheme.plan = plan
    return scheme


def with_window(base: Scheme, window: str) -> Scheme:
    """The same layout with a window intervention applied and costed."""
    scheme = Scheme(id=f"{base.id}.{window}", use=base.use, density=base.density, cells=base.cells,
                    depth=base.depth, side=base.side, window=window, shell_id=base.shell_id)
    plan = deepcopy(base.plan)
    built = base.plan["shell"]["windows"]
    spec = WINDOWS[window]
    for w in plan["shell"]["windows"]:
        w["glazing"] = spec["envelope"]
        if spec["sill_mm"] is not None and not w.get("door"):
            w["sill_mm"] = min(w["sill_mm"], spec["sill_mm"])
    plan["works"] = envelope.window_works(built, plan["shell"]["windows"])
    scheme.plan = plan
    return scheme


def window_works(scheme: Scheme) -> list[dict]:
    return scheme.plan.get("works", [])


def generate(brief: Brief, door_clear_for: dict[str, int],
             windows: tuple[str, ...] = tuple(WINDOWS),
             passage_for: dict[str, int] | None = None,
             shell_id: str = DEFAULT_SHELL) -> list[Scheme]:
    """Every valid scheme for a brief on a shell, across densities, layouts and windows."""
    from apartment.server import specs_for

    s = site(shell_id)
    passage_for = passage_for or {}
    out: list[Scheme] = []
    seen: set[str] = set()
    for density in brief.densities:
        # A density the floor area cannot remotely hold is not worth drawing.
        if s.area_m2 / density.occupants < 0.5 * brief.target_area_m2:
            continue
        door_clear = door_clear_for.get(density.user_group, 850)
        passage = passage_for.get(density.user_group, 900)
        specs = specs_for(density.user_group)
        for cells in density.cell_sets:
            depths = [s.facade_y + d for d in CLEAR_DEPTHS] if cells else [s.facade_y]
            for side, placed in _placements(cells, s.left, s.right):
                if not _valid_facade(placed, s):
                    continue
                for depth in depths:
                    base = draw_geometry(brief, density, placed, side, depth, s, door_clear, passage, specs)
                    if base is None or base.id in seen:
                        continue
                    seen.add(base.id)
                    for window in windows:
                        out.append(with_window(base, window))
    return out
