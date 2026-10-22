"""The wall positions that fit the most people on a floor while every standards and safety check still passes.

A coordinate search over the layout's movable walls (each within its own limits): try several positions for
one wall at a time, keep the best, repeat. "Best" = fewest failed checks first, then most people, then most
seats. Every candidate is a full build, so escape routes, WCs, exits and the legal maximum are all re-checked.
"""
from __future__ import annotations

from .engine import build
from .layouts import GROUND_LAYOUTS, LAYOUTS, TYPICAL_LAYOUTS
from .money import change_cost


def score(m: dict) -> tuple:
    f = m["fig"]
    return (sum(1 for c in f["checks"] if c["ok"]), f["people"], f["seatsAll"])


def maximise(layout_id: str, floor: int, start: dict | None = None, samples: int = 6, sweeps: int = 2) -> dict:
    L = LAYOUTS[layout_id]
    p = {**L.defaults, **(start or {})}
    best = build(layout_id, p, floor)
    tried = 1
    for _ in range(sweeps):
        improved = False
        for h in L.handles(best["p"]):
            lo, hi = h["min"], h["max"]
            if hi - lo < 0.15:
                continue
            for k in range(samples + 1):
                v = round((lo + (hi - lo) * k / samples) / 0.15) * 0.15
                v = min(hi, max(lo, v))
                if abs(v - best["p"][h["key"]]) < 0.01:
                    continue
                cand = build(layout_id, {**best["p"], h["key"]: round(v, 2)}, floor)
                tried += 1
                if score(cand) > score(best):
                    best, improved = cand, True
        if not improved:
            break
    return {"model": best, "tried": tried}


def compare_layouts(floor: int, today: str, today_params: dict | None = None) -> list[dict]:
    """Every layout this floor can take, each with its walls placed for the most people: what it holds, whether
    it passes, and what the change from today's layout would cost."""
    base = build(today, today_params or {}, floor)
    rows = []
    for lid in (GROUND_LAYOUTS if floor == 0 else TYPICAL_LAYOUTS):
        res = maximise(lid, floor)
        m = res["model"]
        f = m["fig"]
        ch = change_cost(base, m) if (lid != today or m["p"] != base["p"]) else None
        rows.append({"layout": lid, "name": LAYOUTS[lid].name, "use": LAYOUTS[lid].use, "params": m["p"], "people": f["people"], "seats": f["seatsAll"],
                     "designLoad": f["designLoad"], "worst": f["worst"]["d"] if f["worst"] else None, "allOk": f["allOk"],
                     "failed": [c["text"] for c in f["checks"] if not c["ok"]], "changeSek": ch["sek"] if ch else 0, "changeKg": ch["kg"] if ch else 0,
                     "months": ch["months"] if ch else 0, "tried": res["tried"]})
    return sorted(rows, key=lambda r: (not r["allOk"], -r["people"]))
