"""Checks for the floor studio (explorer/studio): B01's furnished layouts, escape routes, costs and capacity.

    python -m tests.test_studio
"""
from __future__ import annotations

import math
import sys

from explorer.studio import capacity as C, engine as E, layouts as Lm, money as Mo, tenancy as T

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


# --- every layout at its default walls: the figures the explorer showed when the engine moved to the server
# (layout: desks, people, guests, legal maximum, longest escape walk m, WCs provided, WCs needed)
GOLDEN = {
    "gf_reception": (8, 87, 79, 673, 32.0, 7, 3), "gf_food": (0, 344, 344, 1310, 24.3, 7, 8), "gf_cowork": (56, 56, 0, 496, 27.7, 7, 4),
    "open": (148, 148, 0, 331, 31.1, 10, 10), "cellular": (54, 54, 0, 374, 45.9, 10, 4), "abw": (89, 127, 0, 421, 31.4, 10, 9),
    "teams": (114, 114, 0, 385, 35.3, 10, 8), "cowork": (116, 116, 263, 673, 31.1, 10, 8), "mixed": (120, 120, 0, 280, 34.6, 10, 8),
    "cafe": (0, 506, 506, 1771, 29.6, 10, 12), "restaurant": (0, 520, 520, 1596, 31.5, 10, 12),
}
models = {}
for lid, (desks, people, guests, load, worst, wcs, need) in GOLDEN.items():
    m = E.build(lid, {}, 0 if lid.startswith("gf") else 1)
    models[lid] = m
    f = m["fig"]
    got = (f["workDesks"], f["people"], f["guests"], f["designLoad"], round(f["worst"]["d"], 1), f["wcs"], f["wcNeed"])
    check(f"{lid}: figures unchanged", got == (desks, people, guests, load, worst, wcs, need), got)
    check(f"{lid}: every seat can be reached", f["unreachable"] == 0, f["unreachable"])
    check(f"{lid}: every room has a door (open rooms excepted)", all(r.get("open") or any(d["room"] == r["id"] for d in m["doors"]) for r in m["rooms"]))
    check(f"{lid}: at least one accessible WC", f["acc"] >= 1)

# --- escape routes are walking routes, never shorter than a straight line to the nearest exit
m = models["open"]
w = m["fig"]["worst"]
x, y = E.cell_xy(w["cell"])
straight = min(math.hypot(x - e["x"], y - e["y"]) for e in m["exits"])
check("longest walk is at least the straight-line distance", w["d"] >= straight - 0.3, (round(w["d"], 1), round(straight, 1)))
path = E.route(m["pred"], w["cell"])
check("the route ends at an exit", m["dist"][path[-1]] == 0 if path else False)
check("the route only crosses walkable cells", all(m["grid"].reshape(-1)[c] for c in path))

# --- the cellular layout as drawn is over the 45 m escape limit; the capacity search must fix it
check("cellular today fails the escape check", not models["cellular"]["fig"]["allOk"])
best = C.maximise("cellular", 2)["model"]
check("capacity search finds cellular walls that pass every check", best["fig"]["allOk"], best["p"])
check("... without losing people", best["fig"]["people"] >= models["cellular"]["fig"]["people"], best["fig"]["people"])
gf = C.maximise("gf_reception", 0)["model"]
check("ground floor: capacity search keeps every check and adds people",
      gf["fig"]["allOk"] and gf["fig"]["people"] >= models["gf_reception"]["fig"]["people"], gf["fig"]["people"])
for lid in ("open", "abw"):
    for h in Lm.LAYOUTS[lid].handles(Lm.LAYOUTS[lid].defaults):
        lo = E.build(lid, {h["key"]: h["min"]}, 1)
        hi = E.build(lid, {h["key"]: h["max"]}, 1)
        check(f"{lid}: wall '{h['key']}' at both its limits still lays out", lo["fig"]["unreachable"] == 0 and hi["fig"]["unreachable"] == 0)

# --- money: a change costs something, nothing changing costs nothing extra, years add up
ch = Mo.change_cost(models["open"], models["cafe"])
check("office -> café costs money and carbon", ch["sek"] > 0 and ch["kg"] > 0, round(ch["sek"]))
same = Mo.change_cost(models["open"], models["open"])
check("no change, no partitions or doors to pay for", sum(r["sek"] for r in same["rows"][:4]) == 0)
yrs = list(range(2026, 2036))
s1 = Mo.series(["open"] * 10, yrs, 1)
s2 = Mo.series(["open"] + ["cafe"] * 9, yrs, 1)
check("cumulative cost adds up", math.isclose(s1[-1]["cumCost"], sum(y["cost"] for y in s1), rel_tol=1e-9))
check("segment 1 has no works", all(y["works"] == 0 for y in s1))
check("segment 2 pays its works in the change year only", s2[1]["works"] > 0 and all(y["works"] == 0 for k, y in enumerate(s2) if k != 1))
check("ten years unchanged as before (11.58 MSEK)", round(s1[-1]["cumCost"] / 1e6, 2) == 11.58, round(s1[-1]["cumCost"] / 1e6, 2))
ov = Mo.series(["open"] * 10, yrs, 1, overrides=[None, None, None, {"opexUse": "school", "people": 300, "works": {"sek": 5e6, "kg": 40e3, "months": 4}}] + [{"opexUse": "school", "people": 300}] * 6)
check("a use without a layout takes the timeline's works and people", ov[3]["works"] == 5e6 and ov[5]["people"] == 300)

# --- tenancy: suites add up, every lease points at a real suite
t3 = T.floor_tenancy("marievik", "B01", 3, 2112)
check("floor 3: rented + vacant = leasable", t3["rented"] + t3["vacant"] == t3["leasable"], t3)
data = T.leases("marievik")
ids = {s["id"] for k in ("ground", "typical") for s in data["buildings"]["B01"]["suites"][k]}
check("every lease points at a suite", all(s in ids for l in data["buildings"]["B01"]["leases"] for s in l["suites"]))
check("other buildings get example occupancy", T.floor_tenancy("marievik", "B02", 2, 3000)["example"])

print(f"\n{fails} failure(s)")
sys.exit(1 if fails else 0)
