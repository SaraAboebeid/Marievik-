"""Per-room furnishing annealer — propose arrangements, don't just validate them.

Until now the model could tell you whether an arrangement worked. It could
not produce a good one: `find_placement` is greedy and one-directional, and
the "variants" in the search were the same packing with the placement order
shuffled. This module actually searches.

Method: greedy seed, then simulated annealing over moves — nudge an item,
rotate it, teleport it, swap two. Worse arrangements are accepted often at
the start and rarely at the end, which is how the search climbs out of the
local optimum that greedy placement always lands in.

THE HOT LOOP MUST BE SHAPELY-FREE. Annealing needs ~10^4 evaluations and
`geometry.analyse` costs ~100 ms, so scoring here works on a coarse numpy
grid with axis-aligned rectangles written by array slicing. At 90-degree
rotations every footprint and clearance zone IS axis-aligned, so this is
exact rather than an approximation — the same zones the analyser checks,
computed a thousand times faster.

The objective function is the part that carries architectural judgement, and
it is deliberately exposed as weights rather than buried. You cannot specify
what makes a good arrangement in the abstract; you tune it by looking at
output and rejecting what is wrong.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, replace

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import box

from . import geometry

# Same 50 mm grid the analyser uses. A coarser grid was tempting for speed,
# but it manufactured false collisions: a 900 mm item quantised to 100 mm
# cells claims 1000 mm, so two legitimately adjacent items appeared to
# overlap and the annealer spent its effort fixing a problem that did not
# exist. Matching the analyser's resolution and its cell-centre convention
# means a score here means the same thing a score there does.
GRID = 50


# ---------------------------------------------------------------------------
# What the objective rewards. These are the design opinions, in one place.
# ---------------------------------------------------------------------------


@dataclass
class Weights:
    overlap: float = 400.0        # items colliding, or sitting in a wall
    clearance: float = 120.0      # the space an item needs to be usable
    door_swing: float = 90.0      # blocking a door
    wall_backing: float = -28.0   # negative = reward. Furniture backs to walls.
    free_circle: float = -22.0    # reward a room you can move around in
    daylight: float = -18.0       # put the desk at the window, the wardrobe not
    cohesion: float = -14.0       # a kitchen should read as a kitchen
    spread: float = 6.0           # penalise scattering items across the floor

    def as_dict(self) -> dict:
        return dict(self.__dict__)


# How much each category wants to be near a window. Negative means it would
# rather not be: a wardrobe blocks light, and a bed at the window is a
# preference rather than a rule — which is exactly why this is tunable.
DAYLIGHT_AFFINITY = {
    "work": 1.0,
    "living": 0.6,
    "kitchen": 0.35,
    "bedroom": -0.15,
    "storage": -0.5,
    "sanitary": 0.0,
    "clearance": 0.0,
}

# Categories whose items want to be near each other, and how strongly.
COHESION = {"kitchen": 1.0, "living": 0.7, "sanitary": 0.8, "work": 0.4}


# ---------------------------------------------------------------------------
# Rectangles — exact at 90 degree rotations
# ---------------------------------------------------------------------------


def _rotate_local(rect: tuple, rot: int) -> tuple:
    """Rotate a rectangle given in local coordinates about the origin.

    Exact for multiples of 90 degrees, and it must match
    geometry.clearance_polygons or the annealer will happily produce
    arrangements the analyser then rejects.
    """
    x0, y0, x1, y1 = rect
    if rot == 0:
        return (x0, y0, x1, y1)
    if rot == 90:            # (x, y) -> (-y, x)
        return (-y1, x0, -y0, x1)
    if rot == 180:           # (x, y) -> (-x, -y)
        return (-x1, -y1, -x0, -y0)
    return (y0, -x1, y1, -x0)  # 270: (x, y) -> (y, -x)


def item_rects(spec: dict, x: float, y: float, rot: int) -> dict:
    """Footprint, front clearance and both side clearances, in world mm."""
    w, d = spec["w"], spec["d"]
    front = spec.get("clearance_front_mm", 0) or 0
    side = spec.get("clearance_side_mm", 0) or 0

    local = {"foot": (-w / 2, -d / 2, w / 2, d / 2)}
    if front:
        local["front"] = (-w / 2, d / 2, w / 2, d / 2 + front)
    if side:
        local["side_a"] = (-w / 2 - side, -d / 2, -w / 2, d / 2)
        local["side_b"] = (w / 2, -d / 2, w / 2 + side, d / 2)

    out = {}
    for key, rect in local.items():
        rx0, ry0, rx1, ry1 = _rotate_local(rect, rot)
        out[key] = (rx0 + x, ry0 + y, rx1 + x, ry1 + y)
    return out


# ---------------------------------------------------------------------------
# Scene: everything that does not move, rasterised once
# ---------------------------------------------------------------------------


class Scene:
    """Static context for annealing: walls, windows, doors, room map."""

    def __init__(self, plan: dict, specs: dict):
        shell = plan["shell"]
        self.specs = specs
        self.width = shell["width_mm"]
        self.depth = shell["depth_mm"]
        self.ncols = int(math.ceil(self.width / GRID))
        self.nrows = int(math.ceil(self.depth / GRID))

        xs = (np.arange(self.ncols) + 0.5) * GRID
        ys = (np.arange(self.nrows) + 0.5) * GRID
        gx, gy = np.meshgrid(xs, ys)
        fx, fy = gx.ravel(), gy.ravel()

        def fill(geom) -> np.ndarray:
            if geom is None or geom.is_empty:
                return np.zeros((self.nrows, self.ncols), dtype=bool)
            return shapely.contains_xy(geom, fx, fy).reshape(self.nrows, self.ncols)

        ext = shell.get("external_wall_thickness_mm", 250)
        self.interior = fill(box(0, 0, self.width, self.depth).buffer(-ext))

        walls = [
            geometry.wall_polygon(w["x1"], w["y1"], w["x2"], w["y2"], w.get("thickness", 100))
            for w in plan.get("walls", []) + shell.get("structural_walls", [])
        ]
        wall_union = shapely.union_all(walls) if walls else None
        self.walls = fill(wall_union) & self.interior

        # Rooms are bounded by walls; doors do not merge them.
        self.room_map, self.n_rooms = ndimage.label(self.interior & ~self.walls)

        # Door swings must stay clear.
        walls_by_id = {w["id"]: w for w in plan.get("walls", [])}
        swings = []
        for door in plan.get("doors", []):
            wall = walls_by_id.get(door.get("wall_id"))
            if not wall:
                continue
            line = geometry.door_opening_line(wall, door.get("clear_mm", 900), door.get("t", 0.5))
            if line is not None:
                swings.append(line.buffer(door.get("clear_mm", 900) * 0.9, cap_style="flat"))
        swing_union = shapely.union_all(swings) if swings else None
        self.door_swing = fill(swing_union) & self.interior & ~self.walls

        # Distance to daylight, for the daylight-affinity term.
        window_band = []
        for win in shell.get("windows", []):
            line = shapely.LineString([(win["x1"], win["y1"]), (win["x2"], win["y2"])])
            window_band.append(line.buffer(ext * 2.0, cap_style="flat"))
        band_union = shapely.union_all(window_band) if window_band else None
        band = fill(band_union) & self.interior
        if band.any():
            self.window_distance = ndimage.distance_transform_edt(~band) * GRID
        else:
            self.window_distance = np.full((self.nrows, self.ncols), 10_000.0)

        # Anything an item may never occupy.
        self.blocked = ~self.interior | self.walls

    # -- helpers ----------------------------------------------------------

    def idx(self, rect: tuple) -> tuple[int, int, int, int]:
        """Cells whose CENTRE falls inside the rectangle.

        The same convention `shapely.contains_xy` gives the analyser. Using
        floor/ceil instead inflates every rectangle by up to a cell on each
        side, which turns adjacency into overlap.
        """
        x0, y0, x1, y1 = rect
        c0 = max(0, int(math.ceil(x0 / GRID - 0.5)))
        r0 = max(0, int(math.ceil(y0 / GRID - 0.5)))
        c1 = min(self.ncols, int(math.floor(x1 / GRID - 0.5)) + 1)
        r1 = min(self.nrows, int(math.floor(y1 / GRID - 0.5)) + 1)
        return r0, c0, max(r0, r1), max(c0, c1)

    def room_mask(self, room_index: int) -> np.ndarray:
        return self.room_map == room_index

    def room_of(self, x: float, y: float) -> int:
        c = min(self.ncols - 1, max(0, int(x // GRID)))
        r = min(self.nrows - 1, max(0, int(y // GRID)))
        return int(self.room_map[r, c])


# ---------------------------------------------------------------------------
# Arrangement and scoring
# ---------------------------------------------------------------------------


@dataclass
class Placement:
    item_id: str
    type: str
    x: float
    y: float
    rot: int
    room: int


@dataclass
class ScoreBreakdown:
    total: float = 0.0
    terms: dict = field(default_factory=dict)

    def __str__(self) -> str:
        parts = " ".join(f"{k}={v:.0f}" for k, v in sorted(self.terms.items()) if abs(v) > 0.5)
        return f"{self.total:.0f}  [{parts}]"


def score(
    scene: Scene,
    placements: list[Placement],
    weights: Weights,
    room_filter: int | None = None,
) -> ScoreBreakdown:
    """Score an arrangement. Pure numpy and arithmetic — no shapely."""
    terms = {k: 0.0 for k in weights.as_dict()}

    occupancy = np.zeros((scene.nrows, scene.ncols), dtype=np.int16)
    rects: list[tuple[Placement, dict]] = []
    for p in placements:
        spec = scene.specs.get(p.type)
        if not spec:
            continue
        r = item_rects(spec, p.x, p.y, p.rot)
        rects.append((p, r))
        r0, c0, r1, c1 = scene.idx(r["foot"])
        occupancy[r0:r1, c0:c1] += 1

    # --- overlap: items on each other, or in a wall / outside -----------
    terms["overlap"] += float(np.count_nonzero(occupancy > 1)) * (GRID / 1000.0) ** 2 * 100
    terms["overlap"] += float(np.count_nonzero((occupancy > 0) & scene.blocked)) * (GRID / 1000.0) ** 2 * 100

    solid = (occupancy > 0) | scene.blocked

    for p, r in rects:
        spec = scene.specs[p.type]
        cx, cy = p.x, p.y

        # --- clearance: is the space this item needs actually free? -----
        if "front" in r:
            r0, c0, r1, c1 = scene.idx(r["front"])
            zone = solid[r0:r1, c0:c1]
            own = np.zeros_like(zone)
            fr0, fc0, fr1, fc1 = scene.idx(r["foot"])
            # The item's own footprint never blocks its own approach.
            oy0, ox0 = max(r0, fr0) - r0, max(c0, fc0) - c0
            oy1, ox1 = min(r1, fr1) - r0, min(c1, fc1) - c0
            if oy1 > oy0 and ox1 > ox0:
                own[oy0:oy1, ox0:ox1] = True
            total = zone.size
            if total:
                blocked = np.count_nonzero(zone & ~own) / total
                terms["clearance"] += blocked

        side_keys = [k for k in ("side_a", "side_b") if k in r]
        if side_keys:
            fractions = []
            for key in side_keys:
                r0, c0, r1, c1 = scene.idx(r[key])
                zone = solid[r0:r1, c0:c1]
                fractions.append(np.count_nonzero(zone) / zone.size if zone.size else 1.0)
            terms["clearance"] += min(fractions)  # one good side is enough

        # --- door swing --------------------------------------------------
        r0, c0, r1, c1 = scene.idx(r["foot"])
        terms["door_swing"] += float(np.count_nonzero(scene.door_swing[r0:r1, c0:c1])) * 0.01

        # --- wall backing: reward a back against something solid ---------
        back = _back_strip(r["foot"], p.rot, 150)
        r0, c0, r1, c1 = scene.idx(back)
        strip = scene.blocked[r0:r1, c0:c1]
        if strip.size:
            terms["wall_backing"] += float(np.count_nonzero(strip)) / strip.size

        # --- daylight affinity -------------------------------------------
        affinity = DAYLIGHT_AFFINITY.get(spec.get("category", ""), 0.0)
        if affinity:
            gc = min(scene.ncols - 1, max(0, int(cx // GRID)))
            gr = min(scene.nrows - 1, max(0, int(cy // GRID)))
            # 0 at the window, 1 at 6 m away.
            nearness = 1.0 - min(1.0, scene.window_distance[gr, gc] / 6000.0)
            terms["daylight"] += affinity * nearness

    # --- cohesion and spread, per category ------------------------------
    by_cat: dict[str, list[Placement]] = {}
    for p, _r in rects:
        cat = scene.specs[p.type].get("category", "")
        by_cat.setdefault(cat, []).append(p)
    for cat, group in by_cat.items():
        strength = COHESION.get(cat, 0.0)
        if len(group) < 2:
            continue
        mx = sum(p.x for p in group) / len(group)
        my = sum(p.y for p in group) / len(group)
        spread = sum(math.hypot(p.x - mx, p.y - my) for p in group) / len(group) / 1000.0
        if strength:
            terms["cohesion"] += strength * max(0.0, 4.0 - spread) / 4.0
        terms["spread"] += max(0.0, spread - 4.0) * 0.5

    # --- free circle: can you move around in here? -----------------------
    free = scene.interior & ~solid
    if room_filter is not None:
        free = free & scene.room_mask(room_filter)
    if free.any():
        largest = float(ndimage.distance_transform_edt(free).max()) * GRID * 2.0
        terms["free_circle"] += min(largest, 2400.0) / 1000.0

    w = weights.as_dict()
    total = sum(w[k] * v for k, v in terms.items())
    return ScoreBreakdown(total=total, terms={k: w[k] * v for k, v in terms.items()})


def _back_strip(foot: tuple, rot: int, depth: float) -> tuple:
    """The strip immediately behind an item, in the direction it faces away from."""
    x0, y0, x1, y1 = foot
    if rot == 0:
        return (x0, y0 - depth, x1, y0)
    if rot == 180:
        return (x0, y1, x1, y1 + depth)
    if rot == 90:
        return (x1, y0, x1 + depth, y1)
    return (x0 - depth, y0, x0, y1)


# ---------------------------------------------------------------------------
# The annealer
# ---------------------------------------------------------------------------


def anneal(
    scene: Scene,
    placements: list[Placement],
    weights: Weights | None = None,
    iterations: int = 6000,
    seed: int = 0,
    start_temp: float = 40.0,
    room_bounds: dict[int, tuple] | None = None,
) -> tuple[list[Placement], ScoreBreakdown, dict]:
    """Improve an arrangement by simulated annealing.

    Items stay in the room they started in — which room a thing belongs to
    is a programme decision, and a packing heuristic has no business
    overruling it.
    """
    weights = weights or Weights()
    rng = random.Random(seed)
    movable = [i for i, p in enumerate(placements) if p.room > 0]
    if not movable:
        return placements, score(scene, placements, weights), {"accepted": 0}

    room_bounds = room_bounds or _room_bounds(scene, placements)

    current = list(placements)
    current_score = score(scene, current, weights).total
    best, best_score = list(current), current_score
    accepted = improved = 0

    for step in range(iterations):
        temperature = max(0.05, start_temp * (1.0 - step / iterations) ** 2)
        candidate = list(current)
        index = rng.choice(movable)
        p = candidate[index]

        move = rng.random()
        if move < 0.45:                                  # nudge
            step_mm = (-300, -200, -100, 100, 200, 300)
            candidate[index] = replace(
                p,
                x=_snap(p.x + rng.choice(step_mm)),
                y=_snap(p.y + rng.choice(step_mm)),
            )
        elif move < 0.65:                                # rotate
            candidate[index] = replace(p, rot=(p.rot + rng.choice((90, 180, 270))) % 360)
        elif move < 0.9:                                 # teleport within the room
            bounds = room_bounds.get(p.room)
            if not bounds:
                continue
            x0, y0, x1, y1 = bounds
            candidate[index] = replace(
                p,
                x=_snap(rng.uniform(x0, x1)),
                y=_snap(rng.uniform(y0, y1)),
                rot=rng.choice((0, 90, 180, 270)),
            )
        else:                                            # swap two in the same room
            peers = [j for j in movable if candidate[j].room == p.room and j != index]
            if not peers:
                continue
            j = rng.choice(peers)
            q = candidate[j]
            candidate[index] = replace(p, x=q.x, y=q.y)
            candidate[j] = replace(q, x=p.x, y=p.y)

        candidate_score = score(scene, candidate, weights).total
        delta = candidate_score - current_score
        if delta < 0 or rng.random() < math.exp(-delta / temperature):
            current, current_score = candidate, candidate_score
            accepted += 1
            if candidate_score < best_score:
                best, best_score = list(candidate), candidate_score
                improved += 1

    return best, score(scene, best, weights), {
        "accepted": accepted, "improved": improved, "iterations": iterations,
    }


def _snap(v: float) -> float:
    return round(v / 50.0) * 50.0


def _room_bounds(scene: Scene, placements: list[Placement]) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    for room in {p.room for p in placements if p.room > 0}:
        rows, cols = np.nonzero(scene.room_mask(room))
        if rows.size:
            out[room] = (
                float(cols.min() * GRID), float(rows.min() * GRID),
                float(cols.max() * GRID), float(rows.max() * GRID),
            )
    return out


# ---------------------------------------------------------------------------
# Entry point used by the search and the API
# ---------------------------------------------------------------------------


def arrange(
    plan: dict,
    specs: dict,
    weights: Weights | None = None,
    variants: int = 6,
    iterations: int = 6000,
    seed: int = 0,
) -> list[dict]:
    """Produce several annealed arrangements of a plan's furniture."""
    scene = Scene(plan, specs)
    placements = []
    for item in plan.get("furniture", []):
        if item["type"] not in specs:
            continue
        placements.append(Placement(
            item_id=item.get("id", ""), type=item["type"],
            x=item["x"], y=item["y"], rot=item.get("rot", 0),
            room=scene.room_of(item["x"], item["y"]),
        ))

    # Sanitary fixtures are tied to drainage and do not move.
    frozen = {p.item_id for p in placements
              if specs[p.type].get("category") == "sanitary"}
    for p in placements:
        if p.item_id in frozen:
            p.room = 0

    bounds = _room_bounds(scene, placements)
    out: list[dict] = []
    for v in range(variants):
        best, breakdown, stats = anneal(
            scene, placements, weights, iterations=iterations,
            seed=seed + v * 17, room_bounds=bounds,
        )
        furniture = [
            {"id": p.item_id, "type": p.type, "x": int(p.x), "y": int(p.y), "rot": p.rot}
            for p in best
        ]
        out.append({
            "variant": v,
            "score": round(breakdown.total, 1),
            "terms": {k: round(val, 1) for k, val in breakdown.terms.items()},
            "stats": stats,
            "plan": {**plan, "furniture": furniture},
        })

    out.sort(key=lambda r: r["score"])
    return out
