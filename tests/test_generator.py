"""Checks for the floor-plan generator (explorer/studio/generator.py): B01 typical-floor variants within the envelope.

    python -m tests.test_generator
"""
from __future__ import annotations

import sys

from explorer.studio import engine as E, generator as G, layouts as Lm

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


def overlap(a, b):
    return min(a[2], b[2]) - max(a[0], b[0]) > 0.01 and min(a[3], b[3]) - max(a[1], b[1]) > 0.01


check("same seed, same plan", G.genome(7) == G.genome(7))
check("different seeds, different plans", G.genome(7) != G.genome(8))
check("variant ids resolve like drawn layouts", Lm.get("gen-7").id == "gen-7" and Lm.get("open").id == "open")
try:
    Lm.get("gen-x")
    check("a malformed variant id is refused", False)
except KeyError:
    check("a malformed variant id is refused", True)

fixed = [c["r"] for c in Lm.CORES] + [Lm.ATRIUM] + [r["r"] for r in Lm.WC_BLOCKS]
outside = overlapping = on_fixed = 0
for s in range(1, 101):
    rs = [r["r"] for r in G.rooms_of(G.genome(s))]
    outside += sum(1 for r in rs if r[0] < -1e-6 or r[1] < -1e-6 or r[2] > Lm.W + 1e-6 or r[3] > Lm.H + 1e-6)
    overlapping += sum(1 for i, a in enumerate(rs) for b in rs[i + 1:] if overlap(a, b))
    on_fixed += sum(1 for a in rs for b in fixed if overlap(a, b))
check("100 plans: every room inside the plate", outside == 0, outside)
check("100 plans: no two rooms overlap", overlapping == 0, overlapping)
check("100 plans: no room on a core, the atrium or a WC block", on_fixed == 0, on_fixed)

res = G.batch(60, floor=2, days=5, workers=1)
gen = [r for r in res["rows"] if r["generated"]]
valid = [r for r in gen if r["valid"]]
check("most plans pass every check", len(valid) >= 0.4 * len(gen), f"{len(valid)}/{len(gen)}")
check("valid plans have desks and occupancy results", all(r["kpi"]["staff"] > 0 and "meetDenied" in r["kpi"] for r in valid))
check("rejected plans say why", all(r["failed"] for r in gen if not r["valid"]))
check("genome travels with each variant", all(r["genome"]["seed"] == int(r["id"][4:]) for r in gen))
check("the drawn open plan is scored unchanged", next(r for r in res["rows"] if r["id"] == "open")["kpi"]["staff"] == 148)

front = [r for r in res["rows"] if r.get("pareto")]
key = [(k, s) for k, s in G.OBJECTIVES]
dominated = [a["id"] for a in front for b in res["rows"] if b["valid"] and b is not a
             and all(s * b["kpi"][k] >= s * a["kpi"][k] for k, s in key) and any(s * b["kpi"][k] > s * a["kpi"][k] for k, s in key)]
check("nothing on the trade-off front is beaten on every objective", front and not dominated, dominated[:5])

m = E.build("gen-7", None, 2)
check("a variant builds into a full floor payload", E.payload(m)["layout"]["id"] == "gen-7")

print(f"\n{fails} failure(s)")
sys.exit(1 if fails else 0)
