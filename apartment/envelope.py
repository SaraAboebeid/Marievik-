"""What a window change costs, measured against the windows as built.

The editor lets you move, widen, lower or add windows, and choose new
glazing for any of them. Each of those is a facade intervention with a
price and a carbon cost, so it is turned into costed quantities here and
added to the plan's works:

    new glazing      the whole window's glass area, replaced
                     (skin.window.triple.openable)
    more glass       glazed area beyond what was built: a lowered sill, a
                     widened opening or a new window, all of which mean
                     cutting the facade (skin.window.lowered.sill)

Moving a window sideways without enlarging it is counted as a new opening
plus a filled old one; the filling is not costed, which flatters moving
windows slightly. Stated rather than hidden.
"""

from __future__ import annotations

TRIPLE = "skin.window.triple.openable"
CUT = "skin.window.lowered.sill"


def _key(w: dict, n: int) -> str:
    return w.get("id") or f"w{n}"


def _glass_m2(w: dict) -> float:
    return max(0.0, (w["x2"] - w["x1"]) * (w["head_mm"] - w["sill_mm"]) / 1e6)


def window_works(built: list[dict], current: list[dict]) -> list[dict]:
    built_by_id = {_key(w, n): w for n, w in enumerate(built)}
    replaced = cut = 0.0
    for n, w in enumerate(current):
        area = _glass_m2(w)
        if w.get("glazing", "existing") != "existing":
            replaced += area
        b = built_by_id.get(_key(w, n))
        if b is None:
            cut += area
            continue
        same_place = abs(b["x1"] - w["x1"]) < 50 and abs(b["x2"] - w["x2"]) < 50
        if same_place:
            cut += max(0.0, area - _glass_m2(b))
        else:
            # Overlap with the old opening is reused; the rest is cut.
            overlap_w = max(0, min(b["x2"], w["x2"]) - max(b["x1"], w["x1"]))
            overlap_h = max(0, min(b["head_mm"], w["head_mm"]) - max(b["sill_mm"], w["sill_mm"]))
            cut += max(0.0, area - overlap_w * overlap_h / 1e6)
    works = []
    if replaced > 0.01:
        works.append({"component": TRIPLE, "quantity": round(replaced, 2), "source": "windows"})
    if cut > 0.01:
        works.append({"component": CUT, "quantity": round(cut, 2), "source": "windows"})
    return works
