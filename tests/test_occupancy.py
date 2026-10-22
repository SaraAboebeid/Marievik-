"""Checks for the occupancy model (explorer/studio/occupancy.py): simulated working days on B01's furnished floors.

    python -m tests.test_occupancy
"""
from __future__ import annotations

import sys

from explorer.studio import engine as E, occupancy as O
from explorer.studio.layouts import LAYOUTS

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


models = {lid: E.build(lid, {}, 0 if L.ground else 2) for lid, L in LAYOUTS.items()}
runs = {lid: O.simulate(m, days=20, seed=1) for lid, m in models.items()}

for lid, o in runs.items():
    m = models[lid]
    check(f"{lid}: 16 hours of people", len(o["people"]["mean"]) == 16 and len(o["people"]["p90"]) == 16)
    check(f"{lid}: never more people than the legal maximum", o["peak"]["max"] <= m["fig"]["designLoad"], o["peak"])
    check(f"{lid}: room use is a share", all(0 <= v <= 1 for vs in o["roomUse"].values() for v in vs))
    check(f"{lid}: nobody in at 6 in the morning", o["people"]["mean"][0] <= 0.06 * max(1, m["fig"]["people"]), o["people"]["mean"][0])
    if o["kind"] == "work":
        staff = m["fig"]["staff"]
        check(f"{lid}: never more staff in than on the books", o["peak"]["max"] <= staff, (o["peak"]["max"], staff))
        # the catalogue peak (0.7 of staff) less the lunch and meeting dips, give or take day-to-day variation
        share = o["peak"]["mean"] / staff
        check(f"{lid}: peak attendance near the catalogue's 70 %", 0.6 <= share <= 0.8, round(share, 2))
        check(f"{lid}: own desks never run short", o["desks"]["shared"] or o["desks"]["withoutDesk"] == 0, o["desks"])
    else:
        g = o["guests"]
        check(f"{lid}: guests never exceed usable seats", max(o["activity"]["guests"]) <= g["usable"] + 1e-6, g)
        check(f"{lid}: guests served", g["coversPerDay"] > 0, g)

# same seed, same day
again = O.simulate(models["abw"], days=20, seed=1)
check("same seed gives the same result", again["people"] == runs["abw"]["people"] and again["desks"] == runs["abw"]["desks"])

# shared desks at 0.7 per person run short on busy days; fewer people in means fewer shortages and fewer refused meetings
abw = runs["abw"]["desks"]
check("activity-based: desks short on some days", abw["shortDays"] > 0.2 and abw["useAtPeak"] > 0.9, abw)
hybrid = O.simulate(models["abw"], days=20, seed=1, attendance=0.45)
check("hybrid attendance: no desk shortage", hybrid["desks"]["withoutDesk"] < 0.5, hybrid["desks"])
check("hybrid attendance: fewer meetings refused", hybrid["meetings"]["deniedShare"] < runs["abw"]["meetings"]["deniedShare"],
      (hybrid["meetings"]["deniedShare"], runs["abw"]["meetings"]["deniedShare"]))

# cellular: plenty of meeting and focus rooms per person, a small pantry
cel = runs["cellular"]
check("cellular: meetings almost always find a room", cel["meetings"]["deniedShare"] < 0.05, cel["meetings"]["deniedShare"])
check("cellular: pantry crowded at lunch", cel["food"]["crowding"] > 1, cel["food"])
check("open plan: no focus rooms to book", runs["open"]["focus"]["rooms"] == 0)

# guests: more demand than seats turns people away
busy = O.simulate(models["cafe"], days=10, seed=1, demand=2.0)
check("café at double demand: guests turned away", busy["guests"]["turnedAwayShare"] > 0.2, busy["guests"])
check("café at double demand: still within the seats", busy["guests"]["peakFill"] <= 1.0, busy["guests"]["peakFill"])

# the ground-floor restaurant's 7 cubicles for 344 seats queue at the peak (its WC check fails too)
check("restaurant ground floor: WC queue at the peak", runs["gf_food"]["wc"]["waitP90"] >= 5, runs["gf_food"]["wc"])
check("office floors: no real WC queue", runs["open"]["wc"]["waitP90"] <= 1, runs["open"]["wc"])

print(f"\n{fails} failure(s)")
sys.exit(1 if fails else 0)
