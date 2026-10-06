"""Checks for the 3D explorer (explorer/). Needs the Marievik_parametric engine and shapely.

    python -m tests.test_explorer
"""
from __future__ import annotations

import math
import sys

from explorer import climate, comfort, daylight, model as M

S = M.Site()
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""))
    if not ok:
        fails += 1


# --- sun: Stockholm, midsummer, solar noon about 11:48 CET -> due south, ~54 degrees up
alt, az = climate.sun_position(59.31, 18.02, 1.0, 172, 11.8)
check("sun at solar noon is south", abs(az - 180) < 3, (round(alt, 1), round(az, 1)))
check("sun altitude at midsummer noon", abs(alt - 54.1) < 1.0, round(alt, 1))

# --- weather file
wx = climate.load()
check("EPW has 8760 hours", len(wx.dry_bulb) == 8760)

# --- scenario: today's use
base = S.scenario("B01", {})
k = base["kpi"]
check("B01 has its site storeys", k["floors"] == S.buildings["B01"]["levels"], k["floors"])
check("units found on every floor", all(any(u["kind"] == "unit" for u in us) for us in base["units"].values()))
unit_area = sum(u["area"] for us in base["units"].values() for u in us)
gfa = sum(F.footprint.area for F in base["res"]["floors"])
check("units tile the floor plates (within 5 %)", abs(unit_area - gfa) / gfa < 0.05, (round(unit_area), round(gfa)))

# --- added floors: more area, all their elements priced as new, a structural blocker
add = S.scenario("B01", {"added_floors": 2})
ka = add["kpi"]
check("two floors added", ka["floors"] == k["floors"] + 2)
check("added GFA reported", ka["added_gfa_m2"] > 0, ka["added_gfa_m2"])
new_rows = [r for r in add["res"]["rows"] if r.get("added")]
check("nothing on an added floor is retained (except the old roof)",
      all(r["state"] != "retained" or (r["floor"] == k["floors"] and r["category"] == "slab") for r in new_rows))
check("added floors cost money and carbon", ka["added_capex_sek"] > 0 and ka["added_upfront_kgco2e"] > 0)
check("structural blocker raised", any("structural" in b["text"] for b in ka["blockers"]))
check("ledger adds up", math.isclose(sum(r["capex_sek"] for r in add["res"]["rows"]), ka["capex_sek"], rel_tol=1e-6, abs_tol=2))

# --- payloads for the viewer
bp = S.building_payload("B01", {"use": "residential"})
check("windows on the outside face", len(bp["windows"]) > 100, len(bp["windows"]))
fp = S.floor_payload("B01", 2, {"use": "residential"})
check("floor has wall pieces and units", len(fp["pieces"]) > 50 and len(fp["units"]) > 5)

# --- daylight: more glass / fewer obstructions give more light; values physically plausible
dl = daylight.floor_daylight(S, "B01", 3, {"use": "residential"})
vals = [p[2] for u in dl["units"].values() for p in u["points"]]
check("daylight factors in a plausible range", 0 <= min(vals) and max(vals) < 40 and 0.5 < dl["summary"]["mean_df"] < 8,
      dl["summary"])
low = daylight.floor_daylight(S, "B01", 0, {"use": "residential"})
top = daylight.floor_daylight(S, "B01", 6, {"use": "residential"})
check("upper floor brighter than ground floor", top["summary"]["mean_df"] >= low["summary"]["mean_df"],
      (low["summary"]["mean_df"], top["summary"]["mean_df"]))

# --- comfort: new openable triple glazing improves summer comfort in housing
c0 = comfort.floor_comfort(S, "B01", 3, {"use": "residential"})
c1 = comfort.floor_comfort(S, "B01", 3, {"use": "residential", "windows": "triple_timber"})
check("comfort percentages add to 100", abs(sum(c0["summary"][x] for x in ("comfortable_pct", "overheating_pct", "too_cold_pct")) - 100) < 0.5)
check("new windows reduce overheating", c1["summary"]["overheating_pct"] <= c0["summary"]["overheating_pct"],
      (c0["summary"]["overheating_pct"], c1["summary"]["overheating_pct"]))
check("new windows reduce heating", c1["summary"]["heating_kwh_m2"] < c0["summary"]["heating_kwh_m2"],
      (c0["summary"]["heating_kwh_m2"], c1["summary"]["heating_kwh_m2"]))

print("\n%d check(s) failed" % fails if fails else "\nall explorer checks passed")
sys.exit(1 if fails else 0)
