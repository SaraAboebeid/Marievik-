"""Floor plans for B01's typical floor, generated within the fixed envelope, and a batch run that scores each one.

A variant is a genome (plain JSON) that becomes a Layout the studio builds like any drawn one. The genome:
- policy: own desks, or shared desks at a ratio (activity-based)
- per façade (S, N, W, E): a strip of rooms of depth d (0 = no strip, open plan to the window), cut into a run
  of rooms and gaps; a gap leaves the façade open to the desks behind it
- per core face (S, N): optionally a row of support rooms (meeting, focus, pantry, store) in the dark zone
  between the cores
- an open-area zone north of the atrium (lounge or collab tables), or none
What is left is open plan, furnished with benches by the engine. Corridors are not drawn: they are what the
rooms and their clearances leave, and the engine's own checks (every seat reached, escape distance, exits,
WCs, legal maximum) reject the plans where that does not work. A room without a door is rejected too.

Variant ids are "gen-<seed>": the same seed always gives the same plan, so any variant can be rebuilt (and
opened in the floor studio) from its id alone.

    python -m explorer.studio.generator --n 400 --floor 2 --workers 6
"""
from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np

from .layouts import ATRIUM, CORES, GFA_TYP, TYPES, TYPICAL_LAYOUTS, WC_BLOCKS, H, Layout, R, W

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "runs" / "variants"

CORE_Y0 = CORES[0]["r"][1]                         # south face of the cores
BLOCK_Y1 = WC_BLOCKS[0]["r"][3]                    # north face of the cores + WC blocks
INNER_X = (CORES[0]["r"][2], CORES[1]["r"][0])     # between the two cores
CORRIDOR = 3.4                                     # kept free between two rows of rooms: 1.8 m corridor + door clearances

# room type -> (min width along the strip, max width, least strip depth it needs, deepest it gets)
ROOMS = {
    "cell":     (2.4, 4.2, 3.6, 6.0),
    "teamroom": (6.0, 14.0, 4.8, 9.0),
    "meeting":  (3.6, 8.0, 3.0, 7.0),
    "project":  (6.0, 10.0, 4.2, 8.0),
    "booth":    (2.2, 3.0, 2.2, 3.0),
    "pantry":   (5.0, 10.0, 4.0, 8.0),
    "library":  (8.0, 14.0, 4.8, 8.0),
    "lounge":   (6.0, 10.0, 4.0, 8.0),
    "store":    (2.4, 4.0, 2.2, 3.0),
}
INNER_TYPES = ("meeting", "booth", "pantry", "store", "project")
GAP = (4.8, 12.0)
# Dirichlet concentrations: how much of each room type a floor tends to get (meeting rooms on most floors, libraries on few)
MIX = {"cell": 1.0, "teamroom": 1.0, "meeting": 1.2, "project": 0.5, "booth": 0.8, "pantry": 0.4, "library": 0.3, "lounge": 0.3, "store": 0.3}
ZONE = (16.6, 39.6, 27.4, 46.2)                    # north of the atrium, as in the drawn open plan
# daylight proxy: a desk counts as daylit within this distance of the façade, or of the atrium's glazing
DAYLIT_FACADE, DAYLIT_ATRIUM = 6.0, 4.5


# ------------------------------------------------------------------ genome
def _run(rng, a, b, depth, types, weights, gap, open_start=0.0, open_end=0.0):
    """Cut [a, b] into rooms and gaps: [[type, width], ...] summing to b - a. open_start / open_end keep a corner
    open where a strip on the next façade meets this one, so the rooms on both keep a door onto the floor."""
    allowed = [t for t in types if ROOMS[t][2] <= depth]
    segs = [["gap", open_start]] if open_start else []
    u, end = a + open_start, b - open_end
    p = np.array([weights[t] for t in allowed]) + 1e-6 if allowed else None
    while allowed and end - u > 0.05:
        left = end - u
        t = "gap" if rng.random() < gap else str(rng.choice(allowed, p=p / p.sum()))
        lo, hi = GAP if t == "gap" else ROOMS[t][:2]
        w = rng.uniform(lo, hi)
        if left < lo:                              # the rest does not fit this type: leave it open
            break
        if left - w < 2.4 and left <= hi * 1.25:   # a sliver would be left over: stretch this one to the end
            w = left
        segs.append([t, w])
        u += w
    segs.append(["gap", b - sum(w for _, w in segs)])
    # round the cut positions, not the widths, so the run still ends exactly at b
    cuts = np.round(a + np.cumsum([w for _, w in segs]), 2)
    cuts[-1] = b
    widths = np.diff(np.concatenate([[a], cuts]))
    out = []
    for (t, _), w in zip(segs, widths):
        if w < 0.05:
            continue
        if out and t == "gap" and out[-1][0] == "gap":
            out[-1][1] += float(w)
        else:
            out.append([t, float(w)])
    return [[t, round(w, 2)] for t, w in out]


def genome(seed: int) -> dict:
    """One random plan for the typical floor, as data."""
    rng = np.random.default_rng(seed)
    mix = dict(zip(MIX, rng.dirichlet(list(MIX.values()))))
    gap = rng.uniform(0.05, 0.5)                   # how open the façades stay
    depth = {s: (0.0 if rng.random() < 0.2 else round(rng.uniform(3.6, 7.5), 1)) for s in "SNWE"}
    sides = {}
    for s in "SN":
        if depth[s]:
            sides[s] = {"d": depth[s], "segs": _run(rng, 0, W, depth[s], list(ROOMS), mix, gap,
                                                    open_start=depth["W"] + 1.8 if depth["W"] else 0,
                                                    open_end=depth["E"] + 1.8 if depth["E"] else 0)}
    y0, y1 = depth["S"], H - depth["N"]
    for s in "WE":
        if depth[s]:
            sides[s] = {"d": depth[s], "segs": _run(rng, y0, y1, depth[s], list(ROOMS), mix, gap)}
    inner = {}
    room_s = CORE_Y0 - depth["S"] - CORRIDOR
    room_n = H - depth["N"] - CORRIDOR - BLOCK_Y1
    for s, room in (("S", room_s), ("N", room_n)):
        if room >= 2.4 and rng.random() < 0.5:
            d = round(rng.uniform(2.4, min(4.8, room)), 1)
            inner[s] = {"d": d, "segs": _run(rng, *INNER_X, d, INNER_TYPES, mix, gap / 2)}
    g = {"seed": seed, "policy": [None, None, 0.8, 0.7][int(rng.integers(4))], "sides": sides, "inner": inner,
         "zone": None if "N" in inner else str(rng.choice(["none", "lounge", "collab"]))}
    _ensure(rng, g, "pantry", ("pantry", "lounge"), 4.0)
    _ensure(rng, g, "meeting", ("meeting", "project"), 3.0)
    return g


def _ensure(rng, g, t, any_of, need_depth):
    """At least one room of a kind: turn another room that is big enough into one if the dice gave none."""
    runs = list(g["sides"].values()) + list(g["inner"].values())
    if any(seg[0] in any_of for r in runs for seg in r["segs"]):
        return
    lo = ROOMS[t][0]
    cands = [seg for r in runs if r["d"] >= need_depth for seg in r["segs"] if seg[0] != "gap" and seg[1] >= lo]
    if cands:
        cands[int(rng.integers(len(cands)))][0] = t


# ------------------------------------------------------------------ genome -> rooms
def rooms_of(g: dict) -> list:
    out = []
    for s, run in g["sides"].items():
        u = 0.0 if s in "SN" else (g["sides"]["S"]["d"] if "S" in g["sides"] else 0.0)
        for t, w in run["segs"]:
            if t != "gap":
                d = min(run["d"], ROOMS[t][3])
                a, b = u, u + w
                r = {"S": (a, 0, b, d), "N": (a, H - d, b, H), "W": (0, a, d, b), "E": (W - d, a, W, b)}[s]
                out.append(R(TYPES[t]["label"], t, *(round(v, 2) for v in r)))
            u += w
    for s, run in g["inner"].items():
        u, d = INNER_X[0], run["d"]
        for t, w in run["segs"]:
            if t != "gap":
                r = (u, CORE_Y0 - d, u + w, CORE_Y0) if s == "S" else (u, BLOCK_Y1, u + w, BLOCK_Y1 + d)
                out.append(R(TYPES[t]["label"], t, *(round(v, 2) for v in r), door=s))
            u += w
    return out


def zones_of(g: dict) -> list:
    if g["zone"] in (None, "none"):
        return []
    top = min(ZONE[3], H - g["sides"].get("N", {"d": 0})["d"] - 1.2)
    return [{"k": g["zone"], "r": (ZONE[0], ZONE[1], ZONE[2], top)}] if top - ZONE[1] >= 3.3 else []


def layout(g: dict) -> Layout:
    n = g["seed"]
    return Layout(f"gen-{n}", f"Generated plan {n}", f"Gen {n}", "office", "bench", 0.1, defaults={},
                  rooms=lambda p: rooms_of(g), zones=lambda p: zones_of(g), desk_ratio=g["policy"])


@lru_cache(maxsize=512)
def from_id(lid: str) -> Layout | None:
    """'gen-<seed>' -> its Layout; None for anything else."""
    if not lid.startswith("gen-") or not lid[4:].isdigit():
        return None
    return layout(genome(int(lid[4:])))


# ------------------------------------------------------------------ scoring
def _daylit(m) -> float:
    from .engine import is_work_desk
    by_id = {r["id"]: r for r in m["rooms"]}
    desks = [it for it in m["items"] if is_work_desk(m, it, by_id)]
    if not desks:
        return 0.0
    ok = 0
    for it in desks:
        x, y = it["x"] + it["w"] / 2, it["y"] + it["h"] / 2
        to_facade = min(x, W - x, y, H - y)
        dx, dy = max(ATRIUM[0] - x, 0, x - ATRIUM[2]), max(ATRIUM[1] - y, 0, y - ATRIUM[3])
        ok += to_facade <= DAYLIT_FACADE or math.hypot(dx, dy) <= DAYLIT_ATRIUM
    return ok / len(desks)


def evaluate(lid: str, floor: int = 2, days: int = 20, seed: int = 1) -> dict:
    """Build one layout, check it, and if it passes run the occupancy model on it."""
    from .engine import build
    from .occupancy import simulate
    m = build(lid, None, floor)
    f = m["fig"]
    doorless = [r["name"] for r in m["rooms"] if not r.get("open") and not r["doorSide"]]
    failed = [c["text"] for c in f["checks"] if not c["ok"]] + ([f"No door: {', '.join(doorless)}"] if doorless else [])
    why = [c["id"].split(":")[0] for c in f["checks"] if not c["ok"]] + (["door"] if doorless else [])
    if not f["staff"]:
        failed.append("No desks")
        why.append("desks")
    types = {}
    for r in m["rooms"]:
        if r["t"] != "wc":
            types[r["t"]] = types.get(r["t"], 0) + 1
    meet_seats = sum(x["seats"] for x in m["roomFig"] if m["rooms"][int(x["id"][1:])]["t"] in ("meeting", "project"))
    row = {"id": lid, "generated": lid.startswith("gen-"), "name": m["L"].name, "valid": not failed, "failed": failed, "why": sorted(set(why)),
           "genome": genome(int(lid[4:])) if from_id(lid) else None, "rooms": types,
           "kpi": {"staff": f["staff"], "desks": f["workDesks"], "deskRatio": m["L"].desk_ratio, "legalMax": f["designLoad"],
                   "m2PerDesk": round(GFA_TYP / max(1, f["workDesks"]), 1), "daylitDesks": round(_daylit(m), 2),
                   "meetSeatsPer10": round(10 * meet_seats / max(1, f["staff"]), 1), "focusRooms": types.get("booth", 0),
                   "escapeWorst": f["worst"]["d"] if f["worst"] else None}}
    if failed:
        return row
    o = simulate(m, days=days, seed=seed)
    row["kpi"].update({
        "peakPeople": o["peak"]["mean"], "deskUseAtPeak": o["desks"]["useAtPeak"], "shortDays": o["desks"]["shortDays"],
        "withoutDesk": o["desks"]["withoutDesk"], "meetDenied": o["meetings"]["deniedShare"], "meetTooBig": o["meetings"]["tooBigShare"],
        "focusDenied": o["focus"]["deniedShare"], "lunchCrowding": o["food"]["crowding"], "wcWaitP90": o["wc"]["waitP90"],
        "walkPerDay": o["walk"]["perPersonDay"], "m2PerPersonHour": o["m2PerPersonHour"]})
    return row


# what "better" means for the trade-off front: (KPI, +1 more is better / -1 less is better)
OBJECTIVES = [("staff", 1), ("daylitDesks", 1), ("meetDenied", -1), ("focusDenied", -1), ("walkPerDay", -1)]


def pareto(rows: list, objectives=OBJECTIVES) -> None:
    """Mark the valid rows no other valid row beats on every objective."""
    ok = [r for r in rows if r["valid"]]
    v = np.array([[s * r["kpi"][k] for k, s in objectives] for r in ok], dtype=float)
    for i, r in enumerate(ok):
        r["pareto"] = not any(np.all(v[j] >= v[i]) and np.any(v[j] > v[i]) for j in range(len(ok)) if j != i)


def batch(n: int, floor: int = 2, start: int = 1, days: int = 20, workers: int = 1, drawn: bool = True) -> dict:
    """n generated variants (seeds start..start+n-1), plus the drawn office layouts as reference rows."""
    ids = [f"gen-{s}" for s in range(start, start + n)]
    if drawn:
        ids = [lid for lid in TYPICAL_LAYOUTS if lid not in ("cafe", "restaurant")] + ids
    t0 = time.time()
    if workers > 1:
        with ProcessPoolExecutor(workers) as ex:
            rows = list(ex.map(evaluate, ids, [floor] * len(ids), [days] * len(ids), chunksize=8))
    else:
        rows = [evaluate(lid, floor, days) for lid in ids]
    pareto(rows)
    gen = [r for r in rows if r["generated"]]
    return {"meta": {"building": "B01", "floor": floor, "n": n, "seeds": [start, start + n - 1], "days": days,
                     "seconds": round(time.time() - t0, 1), "valid": sum(r["valid"] for r in gen),
                     "front": sum(bool(r.get("pareto")) for r in gen),
                     "rejected": dict(Counter(w for r in gen for w in r["why"]).most_common()),
                     "objectives": OBJECTIVES, "daylit": {"facade_m": DAYLIT_FACADE, "atrium_m": DAYLIT_ATRIUM},
                     "note": "Uncalibrated: occupancy rates are assumptions (explorer/studio/occupancy.py) until there is sensor and booking data."},
            "rows": rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--floor", type=int, default=2)
    ap.add_argument("--start", type=int, default=1, help="first seed")
    ap.add_argument("--days", type=int, default=20)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    if a.floor < 1:
        ap.error("the generator lays out typical floors (1 and up); the ground floor is not generated yet")
    res = batch(a.n, a.floor, a.start, a.days, a.workers)
    out = a.out or OUT_DIR / f"b01_floor{a.floor}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"{a.n} variants in {res['meta']['seconds']} s: {res['meta']['valid']} pass every check, "
          f"{res['meta']['front']} on the trade-off front -> {out}")


if __name__ == "__main__":
    main()
