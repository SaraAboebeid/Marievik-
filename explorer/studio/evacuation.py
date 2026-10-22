"""Evacuation of one furnished floor with JuPedSim (Forschungszentrum Jülich, collision-free speed model).

The walkable area is the floor studio's own walking grid (walls, cores, atrium and furniture blocked, doors
open), turned into a polygon. Everyone starts in a seat, waits a pre-movement time, then walks to the exit
nearest to them by real walking distance (the stairs on upper floors; on the ground floor the street doors
too). The result is the time until the last person is through an exit, how each exit was used, the
positions every half second for playback, and where it got crowded.

Assumptions (stated, not calibrated): pre-movement 30-90 s uniform (awake, familiar, alarm sounding);
walking speed N(1.34, 0.26) m/s, 5 % at 0.5 m/s (reduced mobility); body radius 0.2 m. A hand calculation
in the usual form (pre-movement + longest walk at 1.2 m/s + queue at 1.3 people per metre of door per
second) is given beside it as a cross-check. Upper floors end at the stair door: the stair itself is a
protected escape route and is not simulated.
"""
from __future__ import annotations

import base64
import math
import time

import numpy as np
import shapely
from shapely.geometry import Point, box
from shapely.ops import unary_union

from .layouts import CELL, CORES, H, NX, NY, W

A = {"pre_min": 30.0, "pre_max": 90.0, "speed_mean": 1.34, "speed_sd": 0.26, "slow_share": 0.05, "slow_speed": 0.5,
     "radius": 0.2, "hand_speed": 1.2, "door_flow": 1.3, "max_time": 900.0}
FRAME_DT = 0.5
HEAT_CELL = 1.0
_cache: dict[str, dict] = {}


def walkable_polygon(grid: np.ndarray):
    """Walking grid -> one polygon per connected piece, slivers narrower than a person removed."""
    boxes = []
    for j in range(NY):
        row = grid[j]
        i = 0
        while i < NX:
            if row[i]:
                k = i
                while k < NX and row[k]:
                    k += 1
                boxes.append(box(i * CELL, j * CELL, k * CELL, (j + 1) * CELL))
                i = k
            else:
                i += 1
    # an opening of 0.21 m removes every passage under 0.42 m: a 0.2 m body cannot use it
    poly = unary_union(boxes).buffer(-0.21, join_style="mitre").buffer(0.21, join_style="mitre")
    return [p for p in getattr(poly, "geoms", [poly]) if p.area > 1.0]


def landing(e, depth: float = 1.6):
    """A door of the exit's real width with a short landing behind it, into the stair core or out of the
    facade. Returns (landing area to add to the walkable area, the exit area at its far end)."""
    x, y, w = e["x"], e["y"], e["w"]
    for c in CORES:
        x0, y0, x1, y1 = c["r"]
        if y0 <= y <= y1 and abs(x - x0) < 0.7:
            return box(x - 0.4, y - w / 2, x0 + depth, y + w / 2), box(x0 + depth - 0.5, y - w / 2, x0 + depth, y + w / 2)
        if y0 <= y <= y1 and abs(x - x1) < 0.7:
            return box(x1 - depth, y - w / 2, x + 0.4, y + w / 2), box(x1 - depth, y - w / 2, x1 - depth + 0.5, y + w / 2)
    if y < 1:
        return box(x - w / 2, -depth, x + w / 2, y + 0.4), box(x - w / 2, -depth, x + w / 2, -depth + 0.5)
    if y > H - 1:
        return box(x - w / 2, y - 0.4, x + w / 2, H + depth), box(x - w / 2, H + depth - 0.5, x + w / 2, H + depth)
    if x < 1:
        return box(-depth, y - w / 2, x + 0.4, y + w / 2), box(-depth, y - w / 2, -depth + 0.5, y + w / 2)
    if x > W - 1:
        return box(x - 0.4, y - w / 2, W + depth, y + w / 2), box(W + depth - 0.5, y - w / 2, W + depth, y + w / 2)
    return None, None


def _exit_box(e, piece):
    """A small exit area at a door point, inside the walkable piece."""
    for half in (0.6, 0.9, 1.3):
        b = box(e["x"] - half, e["y"] - half, e["x"] + half, e["y"] + half).intersection(piece)
        if b.is_empty or b.area <= 0.2:
            continue
        b = max(getattr(b, "geoms", [b]), key=lambda g: g.area)
        hull = b.convex_hull                      # JuPedSim wants convex exit areas, inside the walkable area
        if piece.buffer(1e-6).contains(hull):
            return hull
        # otherwise the largest axis-aligned box inside it
        x0, y0, x1, y1 = b.bounds
        for s in (0.9, 0.7, 0.5, 0.3):
            for cx, cy in ((e["x"], e["y"]), b.representative_point().coords[0]):
                r = box(max(x0, cx - half * s), max(y0, cy - half * s), min(x1, cx + half * s), min(y1, cy + half * s))
                if r.area > 0.1 and piece.buffer(1e-6).contains(r):
                    return r
    return None


def _starts(m, n_people, rng, inner):
    """Seat positions for n people (sofas and benches spread along their length), kept apart and inside."""
    items, slots = m["items"], []
    for s in m["seats"]:
        it = items[s["item"]]
        cx, cy = it["x"] + it["w"] / 2, it["y"] + it["h"] / 2
        for k in range(s["n"]):
            off = (k - (s["n"] - 1) / 2) * 0.6
            slots.append((cx + off, cy) if it["w"] >= it["h"] else (cx, cy + off))
    if not slots:
        return np.zeros((0, 2))
    pick = rng.choice(len(slots), size=min(n_people, len(slots)), replace=False)
    placed = []
    for idx in pick:
        x0, y0 = slots[idx]
        for rad in np.arange(0, 2.5, 0.15):
            ok = None
            for ang in np.linspace(0, 2 * math.pi, max(1, int(rad * 20)), endpoint=False):
                x, y = x0 + rad * math.cos(ang), y0 + rad * math.sin(ang)
                if inner.contains(Point(x, y)) and all((x - a) ** 2 + (y - b) ** 2 >= (2.2 * A["radius"]) ** 2 for a, b in placed[-400:]):
                    ok = (x, y)
                    break
            if ok:
                placed.append(ok)
                break
    return np.array(placed)


def hand_calc(m, n_by_exit, worst_d):
    """Pre-movement + longest walk + the queue at the busiest exit door: the usual hand check."""
    queue = max((n / (A["door_flow"] * e["w"]) for e, n in zip(m["exits"], n_by_exit) if n), default=0.0)
    return round(A["pre_max"] + worst_d / A["hand_speed"] + queue, 1)


def simulate(m, n_people: int | None = None, seed: int = 1) -> dict:
    """Evacuate a built floor (engine.build). n_people defaults to the floor's planned people."""
    import jupedsim as jps

    key = f"{m['id']}|{m['floor']}|{sorted(m['p'].items())}|{n_people}|{seed}"
    if key in _cache:
        return _cache[key]
    t_wall = time.time()
    rng = np.random.default_rng(seed)
    n_people = int(n_people if n_people is not None else m["fig"]["people"])
    pieces = walkable_polygon(m["grid"])
    exits = m["exits"]
    # the piece that reaches the most exits (then the biggest) is the floor people can leave
    def score(p):
        return (sum(1 for e in exits if _exit_box(e, p) is not None), p.area)
    piece = max(pieces, key=score)
    # each exit is a door of its real width onto a landing: the door, not open floor, sets the flow
    exit_polys = []
    for e in exits:
        land, stage = landing(e)
        joined = unary_union([piece, land]) if land is not None and land.intersects(piece) else None
        if joined is not None and joined.geom_type == "Polygon":
            piece = joined
            exit_polys.append(stage)
        else:
            exit_polys.append(_exit_box(e, piece))
    usable = [k for k, p in enumerate(exit_polys) if p is not None]
    inner = piece.buffer(-A["radius"] - 0.02)
    pos = _starts(m, n_people, rng, inner)
    n = len(pos)

    sim = jps.Simulation(model=jps.CollisionFreeSpeedModel(), geometry=piece)
    stages, journeys = {}, {}
    for k in usable:
        stages[k] = sim.add_exit_stage(exit_polys[k])
        journeys[k] = sim.add_journey(jps.JourneyDescription([stages[k]]))
    # each person heads for the exit nearest by walking (the floor's own escape field)
    from .engine import nearest_walkable
    target = np.zeros(n, int)
    for a in range(n):
        c = nearest_walkable(m["grid"], pos[a, 0], pos[a, 1])
        k = int(m["org"][c]) if c >= 0 and m["org"][c] >= 0 else usable[0]
        target[a] = k if k in stages else usable[0]
    pre = rng.uniform(A["pre_min"], A["pre_max"], n)
    speed = np.clip(rng.normal(A["speed_mean"], A["speed_sd"], n), 0.6, 2.0)
    speed[rng.random(n) < A["slow_share"]] = A["slow_speed"]

    order = np.argsort(pre)
    started = 0
    jid = {}                     # jupedsim agent id -> our index
    out_time = np.full(n, np.nan)
    frames = []
    dt = sim.delta_time()
    every = max(1, int(round(FRAME_DT / dt)))
    hx, hy = int(math.ceil(W / HEAT_CELL)), int(math.ceil(H / HEAT_CELL))
    heat = np.zeros((hy, hx))
    alive_prev: set[int] = set()
    errors: list[str] = []
    due: list[int] = []
    while sim.elapsed_time() < A["max_time"]:
        t = sim.elapsed_time()
        while started < n and pre[order[started]] <= t:
            due.append(order[started])
            started += 1
        # someone walking past a seat blocks the person getting up: they wait and try again next step
        still = []
        for a in due:
            try:
                i = sim.add_agent(jps.CollisionFreeSpeedModelAgentParameters(
                    journey_id=journeys[target[a]], stage_id=stages[target[a]], position=tuple(pos[a]),
                    desired_speed=float(speed[a]), radius=A["radius"]))
                jid[i] = a
            except Exception as exc:
                if "too close" not in str(exc):
                    out_time[a] = -1        # cannot be placed at all: counted as stuck
                    errors.append(str(exc)[:120])
                else:
                    still.append(a)
        due = still
        if sim.iteration_count() % every == 0:
            fr = np.full((n, 2), np.nan)        # gone (or not placed) stays NaN
            waiting = list(order[started:]) + due
            fr[waiting] = pos[waiting]          # still in their seat
            alive = set()
            for ag in sim.agents():
                a = jid[ag.id]
                fr[a] = ag.position
                alive.add(a)
            for a in alive_prev - alive:
                if np.isnan(out_time[a]):
                    out_time[a] = t
            alive_prev = alive
            moving = fr[list(alive)] if alive else np.zeros((0, 2))
            if len(moving):
                ci = np.clip((moving[:, 0] / HEAT_CELL).astype(int), 0, hx - 1)
                cj = np.clip((moving[:, 1] / HEAT_CELL).astype(int), 0, hy - 1)
                cnt = np.zeros((hy, hx))
                np.add.at(cnt, (cj, ci), 1)
                heat = np.maximum(heat, cnt / HEAT_CELL ** 2)
            frames.append(fr)
            if started == n and not alive and not due:
                break
        sim.iterate()
    stuck = int(np.sum(np.isnan(out_time) | (out_time < 0)))
    done = out_time[np.isfinite(out_time) & (out_time >= 0)]
    n_by_exit = [int(np.sum(target == k)) for k in range(len(exits))]
    per_exit = []
    for k, e in enumerate(exits):
        tk = out_time[(target == k) & np.isfinite(out_time) & (out_time >= 0)]
        per_exit.append({"id": e["id"], "w": e["w"], "people": n_by_exit[k], "first": round(float(tk.min()), 1) if tk.size else None,
                         "last": round(float(tk.max()), 1) if tk.size else None,
                         "flow": round(float(tk.size / max(1e-6, tk.max() - tk.min()) / e["w"]), 2) if tk.size > 5 else None})
    F = np.array(frames) if frames else np.zeros((0, n, 2))
    enc = np.where(np.isfinite(F), np.round(F * 10), -32768).astype("<i2")
    worst = m["fig"]["worst"]["d"] if m["fig"]["worst"] else 0.0
    out = {
        "people": n, "requested": n_people, "stuck": stuck, "errors": sorted(set(errors))[:3],
        "total": round(float(done.max()), 1) if done.size else None,
        "p50": round(float(np.percentile(done, 50)), 1) if done.size else None,
        "p90": round(float(np.percentile(done, 90)), 1) if done.size else None,
        "walkOnly": round(float(np.max(done - pre[np.isfinite(out_time) & (out_time >= 0)])), 1) if done.size else None,
        "hand": hand_calc(m, n_by_exit, worst),
        "exits": per_exit,
        "frames": {"dt": FRAME_DT, "n": len(frames), "agents": n, "xy_dm": base64.b64encode(enc.tobytes()).decode("ascii")},
        "heat": {"cell": HEAT_CELL, "nx": hx, "ny": hy, "max": round(float(heat.max()), 2),
                 "density_x10": base64.b64encode(np.clip(np.round(heat * 10), 0, 255).astype(np.uint8).tobytes()).decode("ascii")},
        "assumptions": A, "engine": f"JuPedSim {jps.__version__}, collision-free speed model",
        "seconds": round(time.time() - t_wall, 2),
        "note": "JuPedSim on the mock-up plan; pre-movement and speeds are assumptions. Upper floors end at the stair door.",
    }
    if len(_cache) > 40:
        _cache.pop(next(iter(_cache)))
    _cache[key] = out
    return out


def main(case_file: str, out_file: str) -> None:
    """Run one evacuation in its own process: case {layout, params, floor, people, seed} -> result JSON."""
    import json
    from pathlib import Path

    from .engine import build
    case = json.loads(Path(case_file).read_text(encoding="utf-8"))
    m = build(case["layout"], case.get("params") or {}, int(case["floor"]))
    res = simulate(m, case.get("people"), int(case.get("seed", 1)))
    Path(out_file).write_text(json.dumps({"layout": case["layout"], "floor": case["floor"], **res}), encoding="utf-8")


if __name__ == "__main__":
    import sys
    main(sys.argv[1], sys.argv[2])
