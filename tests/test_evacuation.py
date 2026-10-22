"""Checks for the JuPedSim evacuation of B01's furnished floors (explorer/studio/evacuation.py).

    python -m tests.test_evacuation
"""
from __future__ import annotations

import base64
import sys

import numpy as np

from explorer.studio import engine as E, evacuation as V

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


for lid, floor in (("open", 2), ("cellular", 2), ("gf_reception", 0)):
    m = E.build(lid, {}, floor)
    o = V.simulate(m)
    tag = f"{lid}:"
    check(f"{tag} everyone placed and out", o["people"] == m["fig"]["people"] and o["stuck"] == 0, (o["people"], o["stuck"], o["errors"]))
    check(f"{tag} everyone accounted for at an exit", sum(e["people"] for e in o["exits"]) == o["people"])
    # the hand calculation assumes everyone waits the longest pre-movement and walks the longest route, so it
    # should be on the safe side of the simulation, though not wildly so
    check(f"{tag} simulation within the hand calculation", 0.6 * o["hand"] <= o["total"] <= 1.05 * o["hand"], (o["total"], o["hand"]))
    check(f"{tag} last person out after the slowest pre-movement", o["total"] >= V.A["pre_min"], o["total"])
    flows = [e["flow"] for e in o["exits"] if e["flow"]]
    check(f"{tag} door flows realistic (under 2 people per m per s)", all(f <= 2.0 for f in flows), flows)
    F = np.frombuffer(base64.b64decode(o["frames"]["xy_dm"]), "<i2").reshape(o["frames"]["n"], o["frames"]["agents"], 2)
    check(f"{tag} playback frames: everyone in the first, nobody in the last",
          (F[0, :, 0] != -32768).all() and (F[-1, :, 0] == -32768).all())
    check(f"{tag} crowd density recorded", o["heat"]["max"] > 0, o["heat"]["max"])

# every exit is a door of its real width onto a landing
m = E.build("open", {}, 2)
for e in m["exits"]:
    land, stage = V.landing(e)
    check(f"{e['id']}: landing as wide as the door", land is not None and abs((land.bounds[3] - land.bounds[1]) - e["w"]) < 1e-6, land and land.bounds)

# same seed, same run; fewer people, quicker
a = V.simulate(E.build("open", {}, 2), seed=3)
V._cache.clear()
b = V.simulate(E.build("open", {}, 2), seed=3)
check("same seed gives the same evacuation", a["total"] == b["total"] and a["frames"]["xy_dm"] == b["frames"]["xy_dm"])
few = V.simulate(E.build("open", {}, 2), n_people=40, seed=3)
check("40 people leave no later than 148", few["total"] <= a["total"] + 1, (few["total"], a["total"]))

print(f"\n{fails} failure(s)")
sys.exit(1 if fails else 0)
