"""One floor + one layout -> rooms, doors, partitions, furniture, a walking grid, escape routes and figures.

Everything in B01's plan frame (metres). The walking grid is 0.3 m cells; walls and furniture block it,
doors open it; shortest walks are 8-connected Dijkstra (scipy), never cutting a blocked corner.
"""
from __future__ import annotations

import base64
import math

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra as _dijkstra

from .layouts import (ATRIUM, CELL, CORES, ESCAPE_LIMIT, EXITS_GF, EXITS_TYP, GFA_GF, GFA_TYP, H, LAYOUTS, LIFTS, NX, NY,
                      TYPES, W, WC_BLOCKS)

# furniture kind -> (blocks walking, seats)
ITEM = {
    "desk": (1, 0), "chair": (0, 1), "stool": (0, 1), "lchair": (0, 1), "sofa": (1, 3), "mtable": (1, 0), "ctable": (1, 0), "dtable": (1, 0),
    "htable": (1, 0), "coffee": (1, 0), "counter": (1, 0), "cubicle": (1, 0), "acc": (1, 0), "basin": (1, 0), "rack": (1, 0), "shelf": (1, 0),
    "kitchen": (1, 0), "fridge": (1, 0), "bed": (1, 0), "locker": (1, 0), "planter": (1, 0), "stage": (1, 0), "bench": (1, 2), "ahu": (1, 0), "pallet": (1, 0),
}
WORK_ROOMS = ("teamroom", "backoffice", "studio", "cell", "library")
OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}

# cell centres, used by every mask
_IX, _JY = np.meshgrid(np.arange(NX), np.arange(NY))
CX, CY = (_IX + 0.5) * CELL, (_JY + 0.5) * CELL


# ------------------------------------------------------------------ small geometry helpers
def in_rect(x, y, r, m=0.0):
    return (x >= r[0] - m) & (x <= r[2] + m) & (y >= r[1] - m) & (y <= r[3] + m)


def area(r):
    return (r[2] - r[0]) * (r[3] - r[1])


def union(iv):
    out = []
    for a in sorted((s for s in iv if s[1] - s[0] > 1e-6), key=lambda s: s[0]):
        if out and a[0] <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], a[1])
        else:
            out.append([a[0], a[1]])
    return out


def subtract(A, B):
    out = []
    for a in A:
        segs = [[a[0], a[1]]]
        for b in B:
            nxt = []
            for s in segs:
                if b[1] <= s[0] or b[0] >= s[1]:
                    nxt.append(s)
                    continue
                if b[0] > s[0]:
                    nxt.append([s[0], b[0]])
                if b[1] < s[1]:
                    nxt.append([b[1], s[1]])
            segs = nxt
        out += segs
    return [s for s in out if s[1] - s[0] > 0.05]


def length(iv):
    return sum(s[1] - s[0] for s in iv)


def on_facade(o, c):
    return (c < 0.01 or c > H - 0.01) if o == "h" else (c < 0.01 or c > W - 0.01)


def cell_of(x, y):
    return min(NX - 1, max(0, int(math.floor(x / CELL)))), min(NY - 1, max(0, int(math.floor(y / CELL))))


def cell_xy(c):
    i = c % NX
    return (i + 0.5) * CELL, (c // NX + 0.5) * CELL


# ------------------------------------------------------------------ doors and walls
def edges_of(r):
    x0, y0, x1, y1 = r
    return [{"s": "S", "o": "h", "c": y0, "a": x0, "b": x1, "nx": 0, "ny": -1}, {"s": "N", "o": "h", "c": y1, "a": x0, "b": x1, "nx": 0, "ny": 1},
            {"s": "W", "o": "v", "c": x0, "a": y0, "b": y1, "nx": -1, "ny": 0}, {"s": "E", "o": "v", "c": x1, "a": y0, "b": y1, "nx": 1, "ny": 0}]


def _inr(x, y, r):
    return r[0] <= x <= r[2] and r[1] <= y <= r[3]


def blocked_at(x, y, rooms, me, ground):
    if x < 0.25 or y < 0.25 or x > W - 0.25 or y > H - 0.25:
        return True
    if any(_inr(x, y, c["r"]) for c in CORES):
        return True
    if not ground and _inr(x, y, ATRIUM):
        return True
    return any(q is not me and not q.get("open") and _inr(x, y, q["r"]) for q in rooms)


def place_door(r, rooms, ground):
    best = None
    for e in edges_of(r["r"]):
        if on_facade(e["o"], e["c"]):
            continue
        mid, half = (e["a"] + e["b"]) / 2, (e["b"] - e["a"]) / 2 - 0.7
        t, found = 0.0, False
        while t <= half and not found:
            for sgn in ([1] if t == 0 else [1, -1]):
                pos = mid + sgn * t
                if e["o"] == "h":
                    p1, p2 = (pos, e["c"] + e["ny"] * 0.6), (pos, e["c"] + e["ny"] * 1.3)
                else:
                    p1, p2 = (e["c"] + e["nx"] * 0.6, pos), (e["c"] + e["nx"] * 1.3, pos)
                if not blocked_at(*p1, rooms, r, ground) and not blocked_at(*p2, rooms, r, ground):
                    score = t + (-100 if r.get("door") == e["s"] else 0)
                    if best is None or score < best["score"]:
                        best = {"score": score, "o": e["o"], "c": e["c"], "pos": pos, "w": 1.8 if r["t"] == "event" else 1.0, "room": r["id"], "side": e["s"]}
                    found = True
                    break
            t += 0.3
    return best


def walls_of(rooms):
    """Every partition as merged runs on its line; glass where only glass rooms meet it."""
    lines = {}
    for r in rooms:
        if r.get("open"):
            continue
        for e in edges_of(r["r"]):
            if on_facade(e["o"], e["c"]):
                continue
            key = e["o"] + f"{round(e['c'] * 20) / 20:.2f}"
            L = lines.setdefault(key, {"o": e["o"], "c": e["c"], "solid": [], "glass": []})
            L["glass" if TYPES[r["t"]].get("glass") else "solid"].append([e["a"], e["b"]])
    out = {}
    for k, L in lines.items():
        solid = union(L["solid"])
        glass = subtract(union(L["glass"]), solid)
        out[k] = {"o": L["o"], "c": L["c"], "solid": solid, "glass": glass, "all": union(solid + glass)}
    return out


# ------------------------------------------------------------------ furniture
def item(k, x, y, w, h, owner):
    return {"k": k, "x": x, "y": y, "w": w, "h": h, "owner": owner}


def frame(r, side):
    """A local frame along a room side: u along it, v away from it."""
    x0, y0, x1, y1 = r
    L = x1 - x0 if side in ("S", "N") else y1 - y0
    D = y1 - y0 if side in ("S", "N") else x1 - x0

    def at(u, v, du, dv):
        if side == "S":
            return (x0 + u, y0 + v, du, dv)
        if side == "N":
            return (x0 + u, y1 - v - dv, du, dv)
        if side == "W":
            return (x0 + v, y0 + u, dv, du)
        return (x1 - v - dv, y0 + u, dv, du)
    return L, D, at


def facade_side(r):
    if r[1] < 0.01:
        return "S"
    if r[3] > H - 0.01:
        return "N"
    if r[0] < 0.01:
        return "W"
    if r[2] > W - 0.01:
        return "E"
    return None


def long_side(r):
    return "S" if r[2] - r[0] >= r[3] - r[1] else "W"


def away_side(rm, r):
    """The wall facing the door."""
    return OPPOSITE[rm["doorSide"]] if rm.get("doorSide") else long_side(r)


def bench_module(out, x, y, n, owner):
    for i in range(n):
        out += [item("desk", x + i * 1.6, y + 0.75, 1.6, 0.8, owner), item("desk", x + i * 1.6, y + 1.55, 1.6, 0.8, owner),
                item("chair", x + i * 1.6 + 0.5, y + 0.1, 0.6, 0.6, owner), item("chair", x + i * 1.6 + 0.5, y + 2.4, 0.6, 0.6, owner)]


def _cafe2(o, x, y, ow):
    o += [item("ctable", x + 0.55, y + 0.55, 0.7, 0.7, ow), item("chair", x + 0.05, y + 0.65, 0.5, 0.5, ow), item("chair", x + 1.25, y + 0.65, 0.5, 0.5, ow)]


def _dining4(o, x, y, ow):
    o.append(item("dtable", x + 0.6, y + 0.75, 1.2, 0.8, ow))
    for u in (0.65, 1.25):
        o += [item("chair", x + u, y + 0.2, 0.5, 0.5, ow), item("chair", x + u, y + 1.6, 0.5, 0.5, ow)]


def _lounge(o, x, y, ow):
    o += [item("sofa", x + 0.6, y + 0.1, 2.2, 0.85, ow), item("coffee", x + 1.2, y + 1.3, 1.0, 0.6, ow), item("sofa", x + 0.6, y + 2.25, 2.2, 0.85, ow)]


def _collab(o, x, y, ow):
    o.append(item("htable", x + 0.5, y + 0.8, 2.4, 0.9, ow))
    for u in (0.7, 1.5, 2.3):
        o += [item("stool", x + u, y + 0.2, 0.45, 0.45, ow), item("stool", x + u, y + 1.85, 0.45, 0.45, ow)]


MODULES = {   # open-area kits: footprint, pitch and contents
    "bench": {"w": 4.8, "h": 3.1, "px": 6.2, "py": 4.5, "make": lambda o, x, y, ow: bench_module(o, x, y, 3, ow)},
    "bench2": {"w": 3.2, "h": 3.1, "px": 4.6, "py": 4.5, "make": lambda o, x, y, ow: bench_module(o, x, y, 2, ow)},
    "cafe": {"w": 1.8, "h": 1.8, "px": 2.2, "py": 2.2, "make": _cafe2},
    "dining": {"w": 2.4, "h": 2.3, "px": 2.8, "py": 2.8, "make": _dining4},
    "lounge": {"w": 3.4, "h": 3.2, "px": 4.2, "py": 4.0, "make": _lounge},
    "collab": {"w": 3.4, "h": 2.5, "px": 4.2, "py": 3.3, "make": _collab},
    "lockers": {"w": 2.4, "h": 0.5, "px": 2.6, "py": 2.0, "make": lambda o, x, y, ow: o.append(item("locker", x, y, 2.4, 0.5, ow))},
}


def _frange(a, cond, step):
    v = a
    while cond(v):
        yield v
        v += step


def furnish_room(rm):
    o, r, rid, kit = [], (rm["r"][0] + 0.1, rm["r"][1] + 0.1, rm["r"][2] - 0.1, rm["r"][3] - 0.1), rm["id"], TYPES[rm["t"]]["kit"]
    w, h = r[2] - r[0], r[3] - r[1]

    def put(k, q):
        o.append(item(k, q[0], q[1], q[2], q[3], rid))

    if kit == "desks":
        n = 2 if w >= 5 else 1
        mw = n * 1.6
        cols, rows = math.floor((w - 1.2 + 1.3) / (mw + 1.3)), math.floor((h - 1.2 + 1.3) / (3.1 + 1.3))
        if cols > 0 and rows > 0:
            sx, sy = r[0] + (w - (cols * mw + (cols - 1) * 1.3)) / 2, r[1] + (h - (rows * 3.1 + (rows - 1) * 1.3)) / 2
            for c in range(cols):
                for k in range(rows):
                    bench_module(o, sx + c * (mw + 1.3), sy + k * 4.4, n, rid)
        else:
            L, D, at = frame(r, long_side(r))
            for u in _frange(0.4, lambda u: u + 1.6 <= L - 0.4, 1.9):
                put("desk", at(u, 0.1, 1.6, 0.8))
                put("chair", at(u + 0.5, 1.05, 0.6, 0.6))
    elif kit == "cell":
        L, D, at = frame(r, facade_side(rm["r"]) or long_side(r))
        two = L >= 4.2 and w * h >= 13
        for u in ([0.3, L / 2 + 0.1] if two else [(L - 1.6) / 2]):
            put("desk", at(u, 0.4, 1.6, 0.8))
            put("chair", at(u + 0.5, 1.35, 0.6, 0.6))
        if D >= 3.6:
            put("shelf", at(0.3, D - 0.45, min(1.4, L - 0.6), 0.4))
    elif kit == "meeting":
        L, D, at = frame(r, long_side(r))
        tl, tw = max(1.2, min(8, L - 2.4)), (1.2 if D >= 3.4 else 0.8)
        u1, v1 = (L - tl) / 2, (D - tw) / 2
        put("mtable", at(u1, v1, tl, tw))
        per = max(1, math.floor(tl / 0.75))
        for i in range(per):
            uu = u1 + (tl - per * 0.75) / 2 + i * 0.75 + 0.12
            put("chair", at(uu, v1 - 0.55, 0.5, 0.5))
            put("chair", at(uu, v1 + tw + 0.05, 0.5, 0.5))
        if L - tl >= 2.2:
            put("chair", at(u1 - 0.6, v1 + tw / 2 - 0.25, 0.5, 0.5))
            put("chair", at(u1 + tl + 0.1, v1 + tw / 2 - 0.25, 0.5, 0.5))
    elif kit == "booth":
        L, D, at = frame(r, long_side(r))
        put("ctable", at(L / 2 - 0.4, 0.2, 0.8, 0.6))
        put("chair", at(L / 2 - 0.25, 0.9, 0.5, 0.5))
    elif kit == "library":
        L, D, at = frame(r, away_side(rm, r))
        for v in _frange(0.4, lambda v: v + 1.5 <= D - 0.4, 2.2):
            for u in _frange(0.5, lambda u: u + 1.4 <= L - 0.5, 1.7):
                put("desk", at(u, v, 1.4, 0.7))
                put("chair", at(u + 0.45, v + 0.8, 0.5, 0.5))
    elif kit == "pantry":
        L, D, at = frame(r, away_side(rm, r))
        put("counter", at(0.2, 0.05, L - 1.3, 0.65))
        put("fridge", at(L - 0.95, 0.05, 0.75, 0.7))
        for v in _frange(1.9, lambda v: v + 2.0 <= D, 2.7):
            for u in _frange(0.5, lambda u: u + 2.4 <= L - 0.3, 3.0):
                put("htable", at(u + 0.4, v + 0.55, 1.6, 0.8))
                for s in (0.5, 1.2, 1.9):
                    put("stool", at(u + s, v, 0.45, 0.45))
                    put("stool", at(u + s, v + 1.45, 0.45, 0.45))
    elif kit in ("lounge", "cafe"):
        M = MODULES["lounge" if kit == "lounge" else "cafe"]
        L, D, at = frame(r, long_side(r))
        if kit == "cafe":
            put("counter", at(0.3, 0.1, min(6, L - 0.6), 0.7))
        for v in _frange(1.8 if kit == "cafe" else 0.4, lambda v: v + M["h"] <= D - 0.3, M["py"]):
            for u in _frange(0.4, lambda u: u + M["w"] <= L - 0.3, M["px"]):
                a = at(u, v, M["w"], M["h"])
                M["make"](o, a[0], a[1], rid)
    elif kit == "kitchen":
        L, D, at = frame(r, long_side(r))
        for u in _frange(0.3, lambda u: u + 1.6 <= L - 0.3, 1.7):
            put("kitchen", at(u, 0.05, 1.6, 0.8))
            if D >= 4:
                put("kitchen", at(u, D - 0.85, 1.6, 0.8))
        if D >= 6:
            put("kitchen", at(1.5, D / 2 - 0.5, max(1.6, L - 3), 1.0))
    elif kit == "event":
        L, D, at = frame(r, rm.get("doorSide") or long_side(r))   # measured from the door wall, so the stage is at the far end
        put("stage", at(L * 0.25, D - 2.0, L * 0.5, 1.8))
        for v in _frange(0.5, lambda v: v + 0.5 <= D - 2.6, 0.95):
            for u in _frange(1.0, lambda u: u + 0.5 <= L - 1.0, 0.58):
                if abs(u + 0.25 - L / 2) < 0.7:
                    continue
                put("chair", at(u, v, 0.5, 0.5))
    elif kit == "wc":
        L, D, at = frame(r, away_side(rm, r))
        u = 0.1
        if rm.get("acc"):
            put("acc", at(u, 0.05, 2.2, 2.2))
            u += 2.3
        cub_end = L * 0.72 if L > 8 else L - 0.1     # big rooms keep space for basins and urinals
        while u + 1.0 <= cub_end:
            put("cubicle", at(u, 0.05, 1.0, 1.6))
            u += 1.05
        for b in _frange(0.4, lambda b: b + 0.6 <= min(L - 0.3, 4.4), 0.95):
            put("basin", at(b, D - 0.5, 0.6, 0.45))
    elif kit == "store":
        L, D, at = frame(r, long_side(r))
        put("shelf", at(0.2, 0.05, L - 0.4, 0.6))
        if D >= 2.6:
            put("shelf", at(0.2, D - 0.65, L - 0.4, 0.6))
    elif kit == "plant":
        L, D, at = frame(r, long_side(r))
        put("ahu", at(0.6, 0.6, min(4, L - 1.2), 1.8))
        put("ahu", at(0.6, 3.2, 1.4, 1.4))
        put("ahu", at(2.4, 3.2, 1.4, 1.4))
    elif kit == "loading":
        L, D, at = frame(r, long_side(r))
        for u in _frange(0.6, lambda u: u + 1.2 <= L - 0.6, 1.6):
            put("pallet", at(u, D - 1.4, 1.2, 1.0))
    elif kit == "it":
        L, D, at = frame(r, away_side(rm, r))
        for u in _frange(0.5, lambda u: u + 0.6 <= L * 0.65, 0.65):
            put("rack", at(u, D / 2 - 0.6, 0.6, 1.2))
        put("desk", at(L - 2.2, 0.2, 1.6, 0.8))
        put("chair", at(L - 1.7, 1.1, 0.6, 0.6))
    elif kit == "security":
        L, D, at = frame(r, away_side(rm, r))
        put("shelf", at(0.4, 0.05, L - 0.8, 0.4))
        put("desk", at(L / 2 - 1.2, 1.1, 2.4, 0.8))
        put("chair", at(L / 2 - 0.9, 2.1, 0.6, 0.6))
        put("chair", at(L / 2 + 0.3, 2.1, 0.6, 0.6))
    elif kit == "firstaid":
        L, D, at = frame(r, away_side(rm, r))
        put("bed", at(0.4, 0.3, 2.0, 0.9))
        put("desk", at(L - 2.0, 0.2, 1.4, 0.7))
        put("chair", at(L - 1.6, 1.0, 0.5, 0.5))
    elif kit == "garden":
        for yy in _frange(r[1] + 1.5, lambda yy: yy + 1.2 < r[3], 4.5):
            for xx in _frange(r[0] + 1.2, lambda xx: xx + 1.2 < r[2], 4):
                put("planter", (xx, yy, 1.2, 1.2))
        put("bench", (r[0] + 3.2, r[1] + 9.2, 1.8, 0.5))
        put("bench", (r[2] - 5.0, r[1] + 9.2, 1.8, 0.5))
    return o


def _cells(q):
    i0, j0 = math.floor(q[0] / CELL), math.floor(q[1] / CELL)
    i1, j1 = math.ceil(q[2] / CELL), math.ceil(q[3] / CELL)
    return i0, j0, i1, j1


def free_cells(q, mask):
    i0, j0, i1, j1 = _cells(q)
    if i0 < 0 or j0 < 0 or i1 > NX or j1 > NY:
        return False
    return bool(mask[j0:j1, i0:i1].all())


def mark_cells(q, mask, v):
    i0, j0, i1, j1 = _cells(q)
    mask[max(0, j0):min(NY, j1), max(0, i0):min(NX, i1)] = v


def fill_mask(out, mask, region, M, owner):
    best = []
    for a in range(4):
        for b in range(4):
            ox, oy, spots = region[0] + a * M["px"] / 4, region[1] + b * M["py"] / 4, []
            y = oy
            while y + M["h"] <= region[3]:
                x = ox
                while x + M["w"] <= region[2]:
                    if free_cells((x, y, x + M["w"], y + M["h"]), mask):
                        spots.append((x, y))
                    x += M["px"]
                y += M["py"]
            if len(spots) > len(best):
                best = spots
    for x, y in best:
        M["make"](out, x, y, owner)
        mark_cells((x, y, x + M["w"], y + M["h"]), mask, 0)


def furnish_open(L, p, rooms):
    ok = (CX > 0.6) & (CY > 0.6) & (CX < W - 0.6) & (CY < H - 0.6)
    for c in CORES:
        ok &= ~in_rect(CX, CY, c["r"], 1.8)
    ok &= ~in_rect(CX, CY, ATRIUM, 0.6 if L.ground else 1.2)
    for r in rooms:
        ok &= ~in_rect(CX, CY, r["r"], 0.6 if r.get("open") else 1.1)
    mask = ok.astype(np.uint8)
    out = []
    for z in L.zones(p):
        zr = z["r"]
        zm = (mask.astype(bool) & in_rect(CX, CY, zr)).astype(np.uint8)
        if z["k"] == "reception":
            cx, cy = (zr[0] + zr[2]) / 2, (zr[1] + zr[3]) / 2
            out += [item("counter", cx - 3, cy, 6, 0.8, "zone"), item("chair", cx - 1.8, cy + 1.1, 0.6, 0.6, "zone"), item("chair", cx + 1.2, cy + 1.1, 0.6, 0.6, "zone"),
                    item("lchair", zr[0] + 0.3, zr[1] + 0.3, 0.8, 0.8, "zone"), item("lchair", zr[0] + 1.3, zr[1] + 0.3, 0.8, 0.8, "zone"),
                    item("lchair", zr[2] - 2.1, zr[1] + 0.3, 0.8, 0.8, "zone"), item("lchair", zr[2] - 1.1, zr[1] + 0.3, 0.8, 0.8, "zone")]
        elif z["k"] == "bar":
            if zr[3] - zr[1] > zr[2] - zr[0]:
                out.append(item("counter", zr[0], zr[1], 0.8, zr[3] - zr[1], "zone"))
                for sy in _frange(zr[1] + 0.3, lambda sy: sy + 0.45 <= zr[3], 0.75):
                    out.append(item("stool", zr[0] + 1.0, sy, 0.45, 0.45, "zone"))
            else:
                out.append(item("counter", zr[0], zr[1], zr[2] - zr[0], 0.8, "zone"))
                for sx in _frange(zr[0] + 0.3, lambda sx: sx + 0.45 <= zr[2], 0.75):
                    out.append(item("stool", sx, zr[1] + 1.0, 0.45, 0.45, "zone"))
        elif z["k"] in MODULES:
            fill_mask(out, zm, zr, MODULES[z["k"]], "zone")
        mark_cells(zr, mask, 0)
    fill = ("bench2" if L.use == "cowork" else "bench") if L.open_fill == "bench" else L.open_fill
    if fill != "none":
        fill_mask(out, mask, (0, 0, W, H), MODULES[fill], "open")
    return out


# ------------------------------------------------------------------ walking grid and shortest walks
def build_grid(ground, walls, doors, items):
    g = np.ones((NY, NX), dtype=np.uint8)
    for c in CORES:
        g[in_rect(CX, CY, c["r"])] = 0
    if not ground:
        g[in_rect(CX, CY, ATRIUM)] = 0
    for L in walls.values():
        for s in L["all"]:
            t = s[0]
            while t <= s[1] + 1e-6:
                for d in (-0.14, 0.0, 0.14):
                    i, j = cell_of(t, L["c"] + d) if L["o"] == "h" else cell_of(L["c"] + d, t)
                    g[j, i] = 0
                t += CELL / 2
    for dr in doors:
        t = dr["pos"] - dr["w"] / 2 + 0.1
        while t <= dr["pos"] + dr["w"] / 2 - 0.1:
            for d in (-0.3, -0.15, 0.0, 0.15, 0.3):
                i, j = cell_of(t, dr["c"] + d) if dr["o"] == "h" else cell_of(dr["c"] + d, t)
                g[j, i] = 1
            t += CELL / 3
    for it in items:
        if ITEM[it["k"]][0]:
            mark_cells((it["x"] + 0.04, it["y"] + 0.04, it["x"] + it["w"] - 0.04, it["y"] + it["h"] - 0.04), g, 0)
    return g


def nearest_walkable(g, x, y):
    ci, cj = cell_of(x, y)
    for rad in range(10):
        for dj in range(-rad, rad + 1):
            for di in range(-rad, rad + 1):
                if max(abs(di), abs(dj)) != rad:
                    continue
                i, j = ci + di, cj + dj
                if 0 <= i < NX and 0 <= j < NY and g[j, i]:
                    return j * NX + i
    return -1


def graph(g):
    """The walking grid as a sparse graph: 8 neighbours, diagonals only where both straight cells are free."""
    ok = g.astype(bool)
    rows, cols, wts = [], [], []
    idx = np.arange(NX * NY).reshape(NY, NX)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            if not di and not dj:
                continue
            j0, j1 = max(0, -dj), NY - max(0, dj)
            i0, i1 = max(0, -di), NX - max(0, di)
            a = ok[j0:j1, i0:i1] & ok[j0 + dj:j1 + dj, i0 + di:i1 + di]
            if di and dj:
                a &= ok[j0:j1, i0 + di:i1 + di] & ok[j0 + dj:j1 + dj, i0:i1]
            src = idx[j0:j1, i0:i1][a]
            rows.append(src)
            cols.append(src + dj * NX + di)
            wts.append(np.full(src.size, CELL * (math.sqrt(2) if di and dj else 1.0)))
    n = NX * NY
    return csr_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))


def field(G, sources):
    """Shortest walking distance (m) from the nearest source to every cell, and which source it was."""
    src = [s for s in sources if s >= 0]
    if not src:
        return np.full(NX * NY, np.inf), np.full(NX * NY, -1, dtype=np.int16), np.full(NX * NY, -9999, dtype=np.int32)
    dist, pred, near = _dijkstra(G, directed=True, indices=src, min_only=True, return_predecessors=True)
    org = np.full(NX * NY, -1, dtype=np.int16)
    lookup = {s: k for k, s in enumerate(sources) if s >= 0}
    has = near >= 0
    org[has] = np.vectorize(lookup.get)(near[has]) if has.any() else []
    return dist, org, pred


def route(pred, start):
    """The walking route from a cell back to its source, cell by cell."""
    path, c = [], start
    while c >= 0 and len(path) < 4000:
        path.append(int(c))
        c = pred[c]
    return path


# ------------------------------------------------------------------ one floor, one layout -> everything we show
def build(layout_id: str, params: dict | None, floor: int) -> dict:
    L = LAYOUTS[layout_id]
    p = {**L.defaults, **(params or {})}
    defs = L.rooms(p) + ([] if L.ground else [dict(r) for r in WC_BLOCKS])
    rooms = [{**r, "id": f"R{i}", "area": area(r["r"]), "doorSide": None} for i, r in enumerate(defs)]
    ground = L.ground
    doors = []
    for r in rooms:
        if r.get("open"):
            continue
        d = place_door(r, rooms, ground)
        r["doorSide"] = d["side"] if d else None
        if d:
            doors.append(d)
    walls = walls_of(rooms)
    # keep a clear strip 1.2 m deep inside every door, whatever the kit put there
    by_id = {r["id"]: r for r in rooms}
    clear = []
    for d in doors:
        rm = by_id[d["room"]]
        into = (1 if (rm["r"][1] + rm["r"][3]) / 2 > d["c"] else -1) if d["o"] == "h" else (1 if (rm["r"][0] + rm["r"][2]) / 2 > d["c"] else -1)
        a, b = d["pos"] - d["w"] / 2 - 0.15, d["pos"] + d["w"] / 2 + 0.15
        c0, c1 = min(d["c"], d["c"] + into * 1.2), max(d["c"], d["c"] + into * 1.2)
        clear.append((a, c0, b, c1) if d["o"] == "h" else (c0, a, c1, b))
    room_items = [it for r in rooms for it in furnish_room(r)
                  if not any(it["x"] < c[2] and it["x"] + it["w"] > c[0] and it["y"] < c[3] and it["y"] + it["h"] > c[1] for c in clear)]
    items = room_items + furnish_open(L, p, rooms)
    grid = build_grid(ground, walls, doors, items)
    G = graph(grid)
    exits = EXITS_GF if ground else EXITS_TYP
    dist, org, pred = field(G, [nearest_walkable(grid, e["x"], e["y"]) for e in exits])
    seats = []
    for n_it, it in enumerate(items):
        n = ITEM[it["k"]][1]
        if not n:
            continue
        c = nearest_walkable(grid, it["x"] + it["w"] / 2, it["y"] + it["h"] / 2)
        seats.append({"item": n_it, "n": n, "cell": c, "d": float(dist[c]) if c >= 0 else math.inf, "exit": int(org[c]) if c >= 0 else -1})
    m = {"id": layout_id, "L": L, "p": p, "ground": ground, "floor": floor, "rooms": rooms, "doors": doors, "walls": walls, "items": items,
         "grid": grid, "graph": G, "exits": exits, "dist": dist, "org": org, "pred": pred, "seats": seats}
    m["fig"], m["roomFig"], m["openSeats"] = figures(m)
    return m


def is_work_desk(m, it, by_id):
    return it["k"] == "desk" and (it["owner"] == "open" or by_id.get(it["owner"], {}).get("t") in WORK_ROOMS)


def is_guest_seat(m, s, by_id):
    L, it = m["L"], m["items"][s["item"]]
    r = by_id.get(it["owner"])
    return ((it["owner"] == "open" and L.open_fill in ("cafe", "dining")) or (r is not None and r["t"] in ("cafe", "event"))
            or (it["owner"] == "zone" and L.use not in ("office", "cowork")))


def figures(m):
    L, rooms, items, seats = m["L"], m["rooms"], m["items"], m["seats"]
    by_id = {r["id"]: r for r in rooms}
    work_desks = sum(1 for it in items if is_work_desk(m, it, by_id))
    seats_all = sum(s["n"] for s in seats)
    office = L.use in ("office", "cowork")
    guests = sum(s["n"] for s in seats if is_guest_seat(m, s, by_id))
    staff = round(work_desks / (L.desk_ratio or 1))
    gfa = GFA_GF if m["ground"] else GFA_TYP
    core_area = sum(area(c["r"]) for c in CORES)
    open_area = max(0, gfa - sum(r["area"] for r in rooms if not r.get("open")) - core_area - (area(ATRIUM) if m["ground"] else 0))
    design_load = round(sum(r["area"] * TYPES[r["t"]]["dens"] for r in rooms) + open_area * L.open_dens)
    wcs = sum(1 for it in items if it["k"] in ("cubicle", "acc"))
    acc = sum(1 for it in items if it["k"] == "acc")
    people = staff if office else guests + staff
    wc_need = math.ceil(max(1, staff) / 15) if office else math.ceil(max(1, guests) / 50) + 1
    reach = [s for s in seats if math.isfinite(s["d"])]
    worst = max(reach, key=lambda s: s["d"]) if reach else None
    exit_load = [{"id": e["id"], "w": e["w"], "people": sum(s["n"] for s in seats if s["exit"] == i), "cap": math.floor(e["w"] / 1.0 * 150)}
                 for i, e in enumerate(m["exits"])]
    checks = [
        {"id": "escape", "ok": bool(worst) and worst["d"] <= ESCAPE_LIMIT,
         "text": f"Escape distance {worst['d']:.1f} m, limit {ESCAPE_LIMIT:.0f} m" if worst else "No seat to check"},
        *[{"id": f"exit:{x['id']}", "ok": x["people"] <= x["cap"], "text": f"{x['id']}: {x['people']} people, room for {x['cap']}"} for x in exit_load],
        {"id": "wc", "ok": wcs >= wc_need, "text": f"WCs: {wcs} provided, {wc_need} needed"},
        {"id": "accessible_wc", "ok": acc >= 1, "text": f"Accessible WC: {acc} on this floor"},
        {"id": "reach", "ok": len(reach) == len(seats), "text": "Every seat can be reached" if len(reach) == len(seats) else f"{len(seats) - len(reach)} seats cannot be reached"},
        {"id": "load", "ok": people <= design_load, "text": f"Planned {people} people within the legal maximum of {design_load}"},
    ]
    fig = {"gfa": gfa, "workDesks": work_desks, "staff": staff, "guests": guests, "seatsAll": seats_all, "otherSeats": seats_all - work_desks,
           "designLoad": design_load, "people": people, "wcs": wcs, "acc": acc, "wcNeed": wc_need,
           "worst": ({"cell": worst["cell"], "d": round(worst["d"], 2), "item": worst["item"]} if worst else None),
           "unreachable": len(seats) - len(reach), "exitLoad": exit_load, "checks": checks, "allOk": all(c["ok"] for c in checks)}
    room_fig = [{"id": r["id"], "seats": sum(s["n"] for s in seats if items[s["item"]]["owner"] == r["id"]), "max": round(r["area"] * TYPES[r["t"]]["dens"])} for r in rooms]
    open_seats = sum(s["n"] for s in seats if items[s["item"]]["owner"] in ("open", "zone"))
    return fig, room_fig, open_seats


def poi_cells(m, kind):
    """Where people go during the day: lifts, the way in, food, WCs, meetings (walking-grid cells)."""
    g = m["grid"]
    if kind == "lift":
        return [nearest_walkable(g, x, y) for x, y in LIFTS]
    if kind == "entry":
        return [nearest_walkable(g, m["exits"][0]["x"], m["exits"][0]["y"])] if m["ground"] else [nearest_walkable(g, x, y) for x, y in LIFTS]
    types = {"food": ("pantry", "cafe", "kitchen"), "wc": ("wc",), "meet": ("meeting", "project", "event")}[kind]
    src = [nearest_walkable(g, (r["r"][0] + r["r"][2]) / 2, (r["r"][1] + r["r"][3]) / 2) for r in m["rooms"] if r["t"] in types]
    if kind == "food":
        src += [nearest_walkable(g, it["x"] + it["w"] / 2, it["y"] - 0.6) for it in m["items"] if it["k"] == "counter" and it["owner"] == "zone"]
    src = [c for c in src if c >= 0]
    return src or [nearest_walkable(g, x, y) for x, y in LIFTS]


# ------------------------------------------------------------------ the floor as JSON for the explorer
def _b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode("ascii")


def payload(m, extra: dict | None = None) -> dict:
    """Everything the explorer draws and checks. Grids travel as base64: walk (uint8 0/1) and escape distance
    in centimetres (uint16, 65535 = cannot be reached), row by row from the street side."""
    L = m["L"]
    esc = np.where(np.isfinite(m["dist"]), np.minimum(np.round(m["dist"] * 100), 65534), 65535).astype("<u2")
    worst_route = route(m["pred"], m["fig"]["worst"]["cell"]) if m["fig"]["worst"] else []
    return {
        "layout": {"id": L.id, "name": L.name, "short": L.short, "use": L.use, "ground": L.ground, "deskRatio": L.desk_ratio,
                   "defaults": L.defaults, "handles": L.handles(m["p"])},
        "params": m["p"], "floor": m["floor"], "ground": m["ground"],
        "rooms": [{"id": r["id"], "name": r["name"], "t": r["t"], "r": list(r["r"]), "area": round(r["area"], 2), "open": bool(r.get("open")),
                   "doorSide": r.get("doorSide"), "label": TYPES[r["t"]]["label"]} for r in m["rooms"]],
        "doors": [{k: d[k] for k in ("o", "c", "pos", "w", "room", "side")} for d in m["doors"]],
        "walls": m["walls"],
        "items": [[it["k"], round(it["x"], 3), round(it["y"], 3), round(it["w"], 3), round(it["h"], 3), it["owner"]] for it in m["items"]],
        "seats": [[s["item"], s["n"], s["cell"], round(s["d"], 2) if math.isfinite(s["d"]) else -1, s["exit"]] for s in m["seats"]],
        "exits": m["exits"], "grid": {"nx": NX, "ny": NY, "cell": CELL, "walk": _b64(m["grid"]), "escape_cm": _b64(esc)},
        "worstRoute": worst_route, "fig": m["fig"], "roomFig": m["roomFig"], "openSeats": m["openSeats"],
        **(extra or {}),
    }
