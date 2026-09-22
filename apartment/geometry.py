"""Raster geometry for the apartment model.

Everything here works on a millimetre grid rasterised at RES. That choice
matters: it lets the hard questions be answered by image operations rather
than by fragile polygon algebra.

    Which rooms exist?        -> connected components of free space
    Can a wheelchair turn?    -> distance transform, thresholded
    Can it get there at all?  -> flood fill through space wide enough to pass
    Does the furniture work?  -> clearance zones tested against obstructions

The last three are the ones that make social value measurable instead of
asserted. A plan can meet every area standard in the brief and still fail
all three, and that failure is invisible on a drawing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely import affinity

RES = 50  # mm per raster cell

# The width below which nobody gets through at all, used for the permissive
# reachability pass. Roughly a shoulder-width squeeze, well under any standard.
BASIC_PASSAGE_MM = 600


# ---------------------------------------------------------------------------
# Geometry construction
# ---------------------------------------------------------------------------


def wall_polygon(x1, y1, x2, y2, thickness) -> Polygon:
    """A wall segment as a rectangle, square-capped so corners close."""
    line = shapely.LineString([(x1, y1), (x2, y2)])
    return line.buffer(thickness / 2.0, cap_style="square", join_style="mitre")


def door_opening_line(wall: dict, clear_mm: float, t: float):
    """The clear opening as a line across the wall at parameter t."""
    x1, y1, x2, y2 = wall["x1"], wall["y1"], wall["x2"], wall["y2"]
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return None
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    cx, cy = x1 + ux * length * t, y1 + uy * length * t
    half = clear_mm / 2.0
    return shapely.LineString([
        (cx - ux * half, cy - uy * half),
        (cx + ux * half, cy + uy * half),
    ])


def door_polygon(wall: dict, clear_mm: float, t: float, reach_mm: float | None = None) -> Polygon:
    """The opening, buffered perpendicular to the wall.

    Two different reaches are needed and conflating them is a bug worth
    naming, because it makes every compliant plan look broken:

      carving  a little more than the wall thickness, just enough to cut
               the opening through
      passing  far enough into the rooms on both sides to reach where a
               full turning/passage circle actually fits. A doorway is
               narrower than a corridor by design, so the set of valid
               circle centres has a gap at the opening. Without this
               bridge the room beyond every door reads as unreachable.
    """
    opening = door_opening_line(wall, clear_mm, t)
    if opening is None:
        return Polygon()
    reach = reach_mm if reach_mm is not None else wall.get("thickness", 100) * 1.5
    # Flat caps: buffer perpendicular to the wall only, never past the jambs.
    return opening.buffer(reach, cap_style="flat", join_style="mitre")


def item_polygon(item: dict) -> Polygon:
    """Footprint of a furniture item, rotated about its own centre."""
    w, d = item["w"], item["d"]
    x, y, rot = item["x"], item["y"], item.get("rot", 0)
    rect = box(x - w / 2.0, y - d / 2.0, x + w / 2.0, y + d / 2.0)
    return affinity.rotate(rect, rot, origin=(x, y)) if rot else rect


def clearance_polygons(item: dict, spec: dict) -> list[Polygon]:
    """The zones that must stay free for this item to be usable.

    Front zone is required. Where a side zone is specified it is required
    on at least one side, so both candidates are returned and the caller
    keeps whichever is less obstructed — which is how a real plan works:
    you need transfer space on one side of the WC, not both, unless the
    user group is an assisted care resident.
    """
    w, d = item["w"], item["d"]
    x, y, rot = item["x"], item["y"], item.get("rot", 0)
    zones: list[Polygon] = []

    front = spec.get("clearance_front_mm", 0)
    if front > 0:
        rect = box(x - w / 2.0, y + d / 2.0, x + w / 2.0, y + d / 2.0 + front)
        zones.append(affinity.rotate(rect, rot, origin=(x, y)) if rot else rect)

    side = spec.get("clearance_side_mm", 0)
    if side > 0:
        left = box(x - w / 2.0 - side, y - d / 2.0, x - w / 2.0, y + d / 2.0)
        right = box(x + w / 2.0, y - d / 2.0, x + w / 2.0 + side, y + d / 2.0)
        if rot:
            left = affinity.rotate(left, rot, origin=(x, y))
            right = affinity.rotate(right, rot, origin=(x, y))
        zones.extend([left, right])

    return zones


# ---------------------------------------------------------------------------
# Rasterisation
# ---------------------------------------------------------------------------


class Raster:
    """A millimetre grid over the apartment footprint."""

    def __init__(self, width_mm: int, depth_mm: int):
        self.width_mm = width_mm
        self.depth_mm = depth_mm
        self.ncols = int(math.ceil(width_mm / RES))
        self.nrows = int(math.ceil(depth_mm / RES))
        # Cell centres.
        xs = (np.arange(self.ncols) + 0.5) * RES
        ys = (np.arange(self.nrows) + 0.5) * RES
        self.gx, self.gy = np.meshgrid(xs, ys)
        self.flat_x = self.gx.ravel()
        self.flat_y = self.gy.ravel()

    def blank(self) -> np.ndarray:
        return np.zeros((self.nrows, self.ncols), dtype=bool)

    def fill(self, geom) -> np.ndarray:
        """Boolean mask of cells whose centre falls inside geom."""
        if geom is None or geom.is_empty:
            return self.blank()
        inside = shapely.contains_xy(geom, self.flat_x, self.flat_y)
        return inside.reshape(self.nrows, self.ncols)

    def area_m2(self, mask: np.ndarray) -> float:
        return float(mask.sum()) * (RES / 1000.0) ** 2


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


@dataclass
class Room:
    index: int
    area_m2: float
    has_daylight: bool
    daylight_depth_mm: float
    max_turn_mm: float
    reachable: bool
    centroid: tuple[float, float]
    reachable_basic: bool = True
    label: str = ""
    window_length_mm: float = 0.0
    kind: str = "habitable"  # habitable | wet | circulation

    @property
    def access_state(self) -> str:
        """Three outcomes, not two.

        'blocked' and 'tight' are very different problems: one needs a
        door or a moved sofa, the other needs a bigger apartment. Merging
        them into "unreachable" loses the distinction that decides whether
        a plan is fixable.
        """
        if not self.reachable_basic:
            return "blocked"
        if not self.reachable:
            return "tight"
        return "ok"

    @property
    def needs_daylight(self) -> bool:
        """Wet rooms and small circulation spaces do not need a window.

        Counting them as daylight failures would penalise every plan with
        a bathroom, which tells you nothing about the plan.
        """
        return self.kind == "habitable" and self.area_m2 >= 6.0

    @property
    def daylight_ratio(self) -> float:
        """Window length per m² of floor — the usable daylight measure."""
        return self.window_length_mm / 1000.0 / self.area_m2 if self.area_m2 else 0.0


@dataclass
class GeometryResult:
    rooms: list[Room] = field(default_factory=list)
    total_floor_m2: float = 0.0
    free_floor_m2: float = 0.0
    furnished_m2: float = 0.0
    circulation_m2: float = 0.0
    max_turn_mm: float = 0.0
    turn_coverage: float = 0.0
    unreachable_rooms: list[int] = field(default_factory=list)
    tight_rooms: list[int] = field(default_factory=list)
    blocked_items: list[dict] = field(default_factory=list)
    wall_length_m: float = 0.0
    raster: Raster | None = None
    room_map: np.ndarray | None = None
    clearance_map: np.ndarray | None = None


def find_placement(plan: dict, specs: dict, type_id: str,
                   anchor: tuple[float, float] | None = None) -> dict | None:
    """Find somewhere a new item actually fits.

    Dropping every new item at the apartment's centre piles them on top of
    each other and on top of the circulation route. The engine already knows
    where the free floor is, so placement belongs here rather than in the UI.

    Candidates are scored to behave the way furniture behaves: backs to
    walls, out of the middle of the room, near where you asked for it.
    """
    spec = specs.get(type_id)
    if not spec:
        return None

    shell = plan["shell"]
    raster = Raster(shell["width_mm"], shell["depth_mm"])
    ext = shell.get("external_wall_thickness_mm", 250)
    interior = raster.fill(box(0, 0, shell["width_mm"], shell["depth_mm"]).buffer(-ext))

    geoms = []
    for wall in plan.get("walls", []) + shell.get("structural_walls", []):
        geoms.append(wall_polygon(wall["x1"], wall["y1"], wall["x2"], wall["y2"],
                                  wall.get("thickness", 100)))
    for item in plan.get("furniture", []):
        other = specs.get(item["type"])
        if not other:
            continue
        merged = {**other, **item, "w": other["w"], "d": other["d"]}
        geoms.append(item_polygon(merged))
        # Keep out of other items' clearance too, or the new item lands in
        # the space that makes its neighbour usable.
        for zone in clearance_polygons(merged, other):
            geoms.append(zone)

    blocked = ~interior
    if geoms:
        blocked = blocked | raster.fill(shapely.union_all(geoms))

    # Summed-area table so each candidate rectangle is O(1) to test.
    integral = np.cumsum(np.cumsum(blocked.astype(np.int32), axis=0), axis=1)

    def occupied(x0: float, y0: float, x1: float, y1: float) -> int:
        c0 = max(0, int(x0 // RES)); r0 = max(0, int(y0 // RES))
        c1 = min(raster.ncols - 1, int(x1 // RES)); r1 = min(raster.nrows - 1, int(y1 // RES))
        if c1 < c0 or r1 < r0:
            return 10 ** 6
        total = integral[r1, c1]
        if r0 > 0:
            total -= integral[r0 - 1, c1]
        if c0 > 0:
            total -= integral[r1, c0 - 1]
        if r0 > 0 and c0 > 0:
            total += integral[r0 - 1, c0 - 1]
        return int(total)

    w, d = spec["w"], spec["d"]
    anchor = anchor or (shell["width_mm"] / 2, shell["depth_mm"] / 2)
    step = 100

    best = None
    for rot in (0, 90, 180, 270):
        # Footprint is axis-aligned at 90 degree steps, as are the clearance
        # zones, so a bounding box IS the zone and the integral image applies.
        fw, fd = (w, d) if rot % 180 == 0 else (d, w)
        for cy in range(int(ext + fd / 2), int(shell["depth_mm"] - ext - fd / 2) + 1, step):
            for cx in range(int(ext + fw / 2), int(shell["width_mm"] - ext - fw / 2) + 1, step):
                x0, y0 = cx - fw / 2, cy - fd / 2
                if occupied(x0, y0, x0 + fw, y0 + fd):
                    continue

                # Build the clearance zones with the SAME function the
                # analyser uses. Hand-rolling them here produced placements
                # the analyser then flagged as blocked, because the two
                # disagreed about which way "front" points after rotation.
                candidate = {**spec, "x": cx, "y": cy, "rot": rot,
                             "w": spec["w"], "d": spec["d"]}
                zones = clearance_polygons(candidate, spec)
                front_zone = zones[0] if spec.get("clearance_front_mm", 0) else None
                side_zones = zones[1:] if spec.get("clearance_side_mm", 0) else []

                if front_zone is not None and occupied(*front_zone.bounds):
                    continue
                if side_zones and all(occupied(*z.bounds) for z in side_zones):
                    continue  # a side zone is needed on at least one side

                # Prefer backs against something solid, and near the anchor.
                back = {
                    0: (x0, y0 - 120, x0 + fw, y0),
                    180: (x0, y0 + fd, x0 + fw, y0 + fd + 120),
                    90: (x0 + fw, y0, x0 + fw + 120, y0 + fd),
                    270: (x0 - 120, y0, x0, y0 + fd),
                }[rot]
                backing = min(occupied(*back), 40)
                dist = math.hypot(cx - anchor[0], cy - anchor[1])
                # Backing dominates: furniture goes against walls. Distance to
                # the anchor only breaks ties between equally backed spots.
                score = -backing * 1.0 + dist / 3000.0

                if best is None or score < best[0]:
                    best = (score, cx, cy, rot)

    if best is None:
        return None
    _score, cx, cy, rot = best
    return {"x": int(round(cx / 50) * 50), "y": int(round(cy / 50) * 50), "rot": rot}


def analyse(plan: dict, specs: dict, turning_circle_mm: float,
            passage_width_mm: float, door_clear_mm: float = 800) -> GeometryResult:
    """Full geometric analysis of a plan for one user group."""
    shell = plan["shell"]
    raster = Raster(shell["width_mm"], shell["depth_mm"])
    result = GeometryResult(raster=raster)

    # --- interior envelope -------------------------------------------------
    outer = box(0, 0, shell["width_mm"], shell["depth_mm"])
    ext_t = shell.get("external_wall_thickness_mm", 250)
    interior_poly = outer.buffer(-ext_t)
    interior = raster.fill(interior_poly)
    result.total_floor_m2 = raster.area_m2(interior)

    # --- walls -------------------------------------------------------------
    wall_geoms = []
    for wall in plan.get("walls", []):
        t = wall.get("thickness", 100)
        wall_geoms.append(wall_polygon(wall["x1"], wall["y1"], wall["x2"], wall["y2"], t))
        result.wall_length_m += math.hypot(
            wall["x2"] - wall["x1"], wall["y2"] - wall["y1"]
        ) / 1000.0
    for wall in shell.get("structural_walls", []):
        t = wall.get("thickness", 200)
        wall_geoms.append(wall_polygon(wall["x1"], wall["y1"], wall["x2"], wall["y2"], t))

    walls_union = shapely.union_all(wall_geoms) if wall_geoms else Polygon()
    walls_mask = raster.fill(walls_union) & interior

    # --- rooms: walls are solid, doors do NOT merge rooms ------------------
    room_free = interior & ~walls_mask
    room_map, n_rooms = ndimage.label(room_free)
    result.room_map = room_map

    # --- navigation: doors open, furniture blocks --------------------------
    door_geoms = []
    compliant_door_geoms = []
    walls_by_id = {w["id"]: w for w in plan.get("walls", [])}
    for door in plan.get("doors", []):
        wall = walls_by_id.get(door.get("wall_id"))
        if not wall:
            continue
        clear = door.get("clear_mm", 850)
        t = door.get("t", 0.5)
        door_geoms.append(door_polygon(wall, clear, t))
        # A door is a momentary constriction, judged against the door
        # standard, not the corridor standard. The passing reach extends a
        # full passage width into the rooms on both sides so the route
        # bridges the gap between the opening and where a passage circle fits.
        if clear >= door_clear_mm:
            compliant_door_geoms.append(
                door_polygon(wall, clear, t,
                             reach_mm=wall.get("thickness", 100) / 2.0 + passage_width_mm)
            )

    doors_union = shapely.union_all(door_geoms) if door_geoms else Polygon()
    doors_mask = raster.fill(doors_union)
    compliant_doors_mask = (
        raster.fill(shapely.union_all(compliant_door_geoms))
        if compliant_door_geoms else raster.blank()
    )

    item_geoms = []
    for item in plan.get("furniture", []):
        spec = specs.get(item["type"])
        if not spec:
            continue
        merged = dict(spec)
        merged.update(item)
        merged["w"], merged["d"] = spec["w"], spec["d"]
        item_geoms.append((item, spec, item_polygon(merged)))

    furniture_union = (
        shapely.union_all([g for _i, _s, g in item_geoms]) if item_geoms else Polygon()
    )
    furniture_mask = raster.fill(furniture_union) & interior
    result.furnished_m2 = raster.area_m2(furniture_mask)

    nav_free = interior & ~(walls_mask & ~doors_mask) & ~furniture_mask
    result.free_floor_m2 = raster.area_m2(nav_free)

    # --- clearance: how big a circle fits at each free point ---------------
    # distance_transform_edt gives distance to the nearest blocked cell, so
    # 2x that distance is the diameter of the largest circle centred there.
    dist_cells = ndimage.distance_transform_edt(nav_free)
    clearance = dist_cells * RES * 2.0
    result.clearance_map = clearance
    result.max_turn_mm = float(clearance.max()) if clearance.size else 0.0

    turnable = clearance >= turning_circle_mm
    result.turn_coverage = (
        float(turnable.sum()) / float(nav_free.sum()) if nav_free.sum() else 0.0
    )

    # --- reachability from the entry, through passable width only ----------
    # Corridors must meet the passage width; doorways only the door width,
    # so a compliant door opening is added back as passable even though a
    # full passage circle will not fit inside it.
    passable = (clearance >= passage_width_mm) | (compliant_doors_mask & nav_free)
    entry = shell.get("entry", {})
    entry_row = int(min(raster.nrows - 1, max(0, entry.get("y", 0) // RES)))
    entry_col = int(min(raster.ncols - 1, max(0, entry.get("x", 0) // RES)))

    def reach_from_entry(mask: np.ndarray) -> np.ndarray:
        labels, _count = ndimage.label(mask)
        label = labels[entry_row, entry_col]
        if label == 0 and mask.any():
            # The entry sits in the dead band along the wall, where no
            # circle centre fits. Start from the nearest cell that works.
            rows, cols = np.nonzero(mask)
            d2 = (rows - entry_row) ** 2 + (cols - entry_col) ** 2
            nearest = int(np.argmin(d2))
            label = labels[rows[nearest], cols[nearest]]
        return (labels == label) if label else np.zeros_like(mask)

    reachable_mask = reach_from_entry(passable)

    # A second, permissive pass: can a person get there at all, at any
    # width someone could squeeze through? The difference between this and
    # the group's own standard is what separates "there is no way in" from
    # "the way in is too narrow for this user", which are different problems
    # with different fixes.
    basic = (clearance >= BASIC_PASSAGE_MM) | (doors_mask & nav_free)
    reachable_basic_mask = reach_from_entry(basic)

    # --- windows -----------------------------------------------------------
    window_zone = raster.blank()
    window_len_by_room: dict[int, float] = {}
    for win in shell.get("windows", []):
        line = shapely.LineString([(win["x1"], win["y1"]), (win["x2"], win["y2"])])
        # A band just inside the glazing line.
        band = line.buffer(ext_t * 1.6, cap_style="flat")
        band_mask = raster.fill(band) & interior
        window_zone |= band_mask
        length = line.length
        for room_index in np.unique(room_map[band_mask]):
            if room_index == 0:
                continue
            window_len_by_room[int(room_index)] = (
                window_len_by_room.get(int(room_index), 0.0) + length
            )

    # --- classify rooms by what is in them ---------------------------------
    # A room with sanitary fixtures is a wet room and is not judged on
    # daylight; counting bathrooms as daylight failures would penalise every
    # plan that has one, which says nothing about the plan.
    categories_by_room: dict[int, set[str]] = {}
    for item, spec, geom in item_geoms:
        centre = geom.centroid
        col = int(min(raster.ncols - 1, max(0, centre.x // RES)))
        row = int(min(raster.nrows - 1, max(0, centre.y // RES)))
        room_index = int(room_map[row, col])
        if room_index:
            categories_by_room.setdefault(room_index, set()).add(spec["category"])

    # --- per-room metrics ---------------------------------------------------
    for index in range(1, n_rooms + 1):
        mask = room_map == index
        area = raster.area_m2(mask)
        if area < 0.8:  # ignore slivers between wall ends
            continue

        room_window = window_zone & mask
        has_light = bool(room_window.any())

        depth = 0.0
        if has_light:
            seeds = ~room_window
            room_dist = ndimage.distance_transform_edt(seeds)
            depth = float(room_dist[mask].max()) * RES

        rows, cols = np.nonzero(mask)
        centroid = (float(cols.mean() * RES), float(rows.mean() * RES))

        cats = categories_by_room.get(index, set())
        if "sanitary" in cats:
            kind = "wet"
        elif area < 4.0 and not cats:
            kind = "circulation"
        else:
            kind = "habitable"

        result.rooms.append(Room(
            index=index,
            area_m2=round(area, 2),
            has_daylight=has_light,
            daylight_depth_mm=round(depth),
            max_turn_mm=round(float(clearance[mask].max()) if mask.any() else 0.0),
            reachable=bool((reachable_mask & mask).any()),
            reachable_basic=bool((reachable_basic_mask & mask).any()),
            centroid=centroid,
            window_length_mm=round(window_len_by_room.get(index, 0.0)),
            kind=kind,
        ))

    result.unreachable_rooms = [r.index for r in result.rooms if r.access_state == "blocked"]
    result.tight_rooms = [r.index for r in result.rooms if r.access_state == "tight"]
    result.circulation_m2 = max(0.0, result.free_floor_m2)

    # --- furniture clearance violations ------------------------------------
    obstruction = walls_mask & ~doors_mask
    for item, spec, geom in item_geoms:
        others = [
            g for i2, s2, g in item_geoms
            if i2 is not item and not s2.get("shares_clearance")
        ]
        others_union = shapely.union_all(others) if others else Polygon()
        blocking = raster.fill(others_union) | obstruction

        zones = clearance_polygons({**spec, **item, "w": spec["w"], "d": spec["d"]}, spec)
        if not zones:
            continue

        front_zone = zones[0] if spec.get("clearance_front_mm", 0) > 0 else None
        side_zones = zones[1:] if spec.get("clearance_side_mm", 0) > 0 else []

        worst = 0.0
        detail = []

        if front_zone is not None:
            zmask = raster.fill(front_zone)
            total = zmask.sum()
            if total:
                blocked = float((zmask & blocking).sum()) / float(total)
                # Outside the interior counts as blocked too.
                outside = float((zmask & ~interior).sum()) / float(total)
                blocked = max(blocked, outside)
                if blocked > 0.02:
                    worst = max(worst, blocked)
                    detail.append(f"front approach {blocked:.0%} obstructed")

        if side_zones:
            fractions = []
            for zone in side_zones:
                zmask = raster.fill(zone)
                total = zmask.sum()
                if not total:
                    fractions.append(1.0)
                    continue
                blocked = float((zmask & blocking).sum()) / float(total)
                outside = float((zmask & ~interior).sum()) / float(total)
                fractions.append(max(blocked, outside))
            best = min(fractions)  # only one side is required
            if best > 0.02:
                worst = max(worst, best)
                detail.append(f"transfer space {best:.0%} obstructed on both sides")

        if worst > 0.02:
            result.blocked_items.append({
                "id": item.get("id"),
                "type": item["type"],
                "name": spec["name"],
                "severity": "major" if worst > 0.35 else "minor",
                "blocked_fraction": round(worst, 2),
                "detail": "; ".join(detail),
            })

    return result
