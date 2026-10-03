"""Thermal zones from any plan, drawn or generated.

The analyser already knows the rooms: connected floor between walls. Each
room is cut into rectangles from its raster (plans here are orthogonal, so
a room is a handful of them), rectangles of one room are joined by open air
boundaries in the simulation, and rectangle edges on either side of a
partition are snapped to the wall's centreline so EnergyPlus sees the two
rooms as touching through it.

That makes thermal comfort available for whatever is on the canvas, not
only for layouts the generator drew.
"""

from __future__ import annotations

import numpy as np

from apartment import geometry

SNAP_MM = 170        # edges closer than this across a wall are one surface
MIN_SIDE_MM = 250    # thinner slivers are wall ends, not floor


def _rectangles(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Greedy cover of a boolean mask by rectangles (row0, col0, row1, col1)."""
    mask = mask.copy()
    rects = []
    rows, cols = mask.shape
    for r in range(rows):
        c = 0
        while c < cols:
            if not mask[r, c]:
                c += 1
                continue
            c1 = c
            while c1 < cols and mask[r, c1]:
                c1 += 1
            r1 = r + 1
            while r1 < rows and mask[r1, c:c1].all():
                r1 += 1
            mask[r:r1, c:c1] = False
            rects.append((r, c, r1, c1))
            c = c1
    return rects


def _snap(values: list[float]) -> dict[float, float]:
    out = {}
    ordered = sorted(set(values))
    cluster = [ordered[0]] if ordered else []
    for v in ordered[1:]:
        if v - cluster[-1] <= SNAP_MM:
            cluster.append(v)
        else:
            mean = sum(cluster) / len(cluster)
            out.update({c: mean for c in cluster})
            cluster = [v]
    if cluster:
        mean = sum(cluster) / len(cluster)
        out.update({c: mean for c in cluster})
    return out


def from_plan(plan: dict, specs: dict, occupants: float) -> list[dict]:
    """Zones as rectangles with room ids, kinds and a share of the occupants."""
    geo = geometry.analyse(plan, specs, 1200, 900, 800)
    res = geometry.RES
    kinds = {r.index: r.kind for r in geo.rooms}
    zones = []
    for room in geo.rooms:
        mask = geo.room_map == room.index
        for n, (r0, c0, r1, c1) in enumerate(_rectangles(mask)):
            x0, y0, x1, y1 = c0 * res, r0 * res, c1 * res, r1 * res
            if x1 - x0 < MIN_SIDE_MM or y1 - y0 < MIN_SIDE_MM:
                continue
            zones.append({"id": f"r{room.index}_{n}", "space": f"r{room.index}",
                          "label": f"{kinds[room.index].title()} {room.index}",
                          "kind": kinds[room.index], "room": room.index,
                          "x0": x0, "y0": y0, "x1": x1, "y1": y1})

    # Close the gap a partition leaves between the rooms either side of it.
    xs = _snap([z[k] for z in zones for k in ("x0", "x1")])
    ys = _snap([z[k] for z in zones for k in ("y0", "y1")])
    for z in zones:
        z["x0"], z["x1"] = round(xs[z["x0"]]), round(xs[z["x1"]])
        z["y0"], z["y1"] = round(ys[z["y0"]]), round(ys[z["y1"]])
    zones = [z for z in zones if z["x1"] - z["x0"] >= MIN_SIDE_MM and z["y1"] - z["y0"] >= MIN_SIDE_MM]

    habitable = [z for z in zones if z["kind"] == "habitable"]
    area = sum((z["x1"] - z["x0"]) * (z["y1"] - z["y0"]) for z in habitable) or 1
    for z in zones:
        a = (z["x1"] - z["x0"]) * (z["y1"] - z["y0"])
        z["people"] = round(occupants * a / area, 3) if z["kind"] == "habitable" else 0.0
    return zones
