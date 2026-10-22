"""Checks for the 10-year district model (explorer/district.py).

    python -m tests.test_district
"""
from __future__ import annotations

import sys

from explorer import district as D, model as M

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


site = M.Site()
prep = D.prepare(site)
units = D._initial_units(prep)
check("13 buildings", len(prep["buildings"]) == 13)
check("every building has lettable units", {u["b"] for u in units} == {b["id"] for b in prep["buildings"]})
area = sum(u["area"] for u in units)
want = sum(b["fp_m2"] * b["levels"] for b in prep["buildings"]) * prep["market"]["lettable_share"]
check("units add up to the lettable area", abs(area - want) < 1, (round(area), round(want)))
check("location scores are shares", all(0 <= b[k] <= 1 for b in prep["buildings"] for k in ("transit", "water")))
b01 = [u for u in units if u["b"] == "B01" and u["tenant"]]
check("B01's tenants come from the rent roll", b01 and all(u["rent"] > 0 for u in b01), len(b01))

base = D.simulate(site, [], runs=8)
check("ten years", len(base["years"]) == 10 and len(base["district"]["vacancy"]["mean"]) == 10)
v = base["district"]["vacancy"]["mean"]
check("vacancy is a share", all(0 <= x <= 1 for x in v), v)
check("band holds the mean", all(lo - 1e-9 <= m <= hi + 1e-9 for lo, m, hi in zip(base["district"]["noi_msek"]["p10"], base["district"]["noi_msek"]["mean"], base["district"]["noi_msek"]["p90"])))
check("buildings sum to the district (people, final year)",
      abs(sum(b["people"][-1] for b in base["buildings"]) - base["district"]["people"]["mean"][-1]) <= 13, None)
again = D.simulate(site, [], runs=8)
check("same seed gives the same result", again["totals"] == base["totals"])

# each card does what it says, against business as usual
def with_(card):
    return D.simulate(site, [card], runs=8)

g = with_("activate_ground")
check("open ground floors: more evening life", g["totals"]["evening_end"] > base["totals"]["evening_end"], (g["totals"]["evening_end"], base["totals"]["evening_end"]))
check("open ground floors: more shop/café area", g["mix_end_m2"].get("ground", 0) > base["mix_end_m2"].get("ground", 0))
f = with_("flexible_fitout")
check("demountable fit-outs: less embodied carbon", f["totals"]["co2_emb_t"] < base["totals"]["co2_emb_t"], (f["totals"]["co2_emb_t"], base["totals"]["co2_emb_t"]))
c = with_("convert_vacant")
check("convert long-vacant: new uses appear", any(k in c["mix_end_m2"] for k in ("residential", "hotel", "school")) and
      sum(c["mix_end_m2"].get(k, 0) for k in ("residential", "hotel", "school")) > sum(base["mix_end_m2"].get(k, 0) for k in ("residential", "hotel", "school")))
r = with_("rent_flex")
check("flexible rents: lower vacancy", r["totals"]["vacancy_end"] < base["totals"]["vacancy_end"], (r["totals"]["vacancy_end"], base["totals"]["vacancy_end"]))
e = with_("energy_retrofit")
check("energy retrofit: less operational carbon by year 10", e["district"]["co2_op_t"]["mean"][-1] < base["district"]["co2_op_t"]["mean"][-1])
p = with_("public_realm")
check("public realm: buildings more attractive", sum(b["attract"][-1] for b in p["buildings"]) > sum(b["attract"][-1] for b in base["buildings"]))

print(f"\n{fails} failure(s)")
sys.exit(1 if fails else 0)
