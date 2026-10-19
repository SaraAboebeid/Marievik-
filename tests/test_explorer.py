"""Checks for the 3D explorer (explorer/). Needs the parametric/ engine and shapely.

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

# --- walls against the use's sound and fire requirements; requirement-based supplier system (Smartax)
L = M.L
no_sup = {k: v for k, v in S.catalogue.items() if not k.startswith("part.smartax")}
check("smartax is not offered without its supplier file", not L.system_available("smartax", S.db, no_sup))
conv = S.scenario("B01", {"use": "residential", "partition_system": "conventional"})["kpi"]["walls"]
check("requirement check covers the new walls", conv["checked_m2"] > 0 and conv["unknown_m2"] == 0, conv["checked_m2"])
check("44 dB stud walls fall short between dwellings (52 dB)",
      any(s["category"] == "partition" and not s["sound_ok"] for s in conv["shortfalls"]))
if "smartax" in S.systems:
    sx = S.scenario("B01", {"use": "residential", "partition_system": "smartax"})
    w = sx["kpi"]["walls"]
    check("smartax meets every residential wall requirement", w["sound_below_m2"] == 0 and w["fire_below_m2"] == 0, w)
    types = {x["type"] for F in sx["res"]["floors"] for x in F.walls if x["cat"] in "PCIAS"}
    check("smartax walls only, several builds", types <= set(L.PARTITION_FAMILIES["smartax"]) and len(types) > 1, types)
    check("4.2 m ground floor flagged against 3.5 m studs", any(0 in t["floors"] for t in w["too_tall"]), w["too_tall"])
    check("smartax caveat among the blockers", any(b["kind"] == "process" for b in sx["kpi"]["blockers"]))
    check("supplier rows priced from the catalogue",
          all(r["priced_by"] == "catalogue" for r in sx["res"]["rows"] if r["type"].startswith("IW_SMARTAX")))
    sp = S.site_payload()
    check("smartax is a supplier card, not a generic system", "smartax" not in sp["systems"]
          and any(x["system"] == "smartax" for x in sp["suppliers"]))
    cmp = S.supplier_compare("smartax", "B01", {"use": "residential"})
    areas = {r["system"]: r["wall_area_m2"] for r in cmp["systems"]}
    check("supplier comparison: same wall area three ways", len(set(areas.values())) == 1, areas)
    check("strip-out never recovers more than was built",
          all(r["recovered_m2"] <= r["wall_area_m2"] for r in cmp["systems"]))
else:
    print("SKIP smartax checks (no data/components/suppliers/smartax.json)")

# --- parametric view: plan, KPIs and bill of one floor; one chart cell
pp = S.parametric_payload("B01", {"use": "residential"}, 1)
check("parametric plan has walls, rooms and a footprint", len(pp["plan"]["walls"]) > 20 and pp["plan"]["rooms"] and pp["plan"]["footprint"])
priced = sum(r["capex_sek"] for r in S.scenario("B01", {"use": "residential"})["res"]["rows"] if r["priced_by"] == "catalogue")
check("parametric bill matches the building's priced new elements (quantities rounded to 0.01)",
      math.isclose(sum(r["capex_sek"] for r in pp["bill"]), priced, rel_tol=1e-4), (sum(r["capex_sek"] for r in pp["bill"]), round(priced)))
check("parametric floor index is clamped", S.parametric_payload("B01", {}, 99)["floor"] == len(pp["floors"]) - 1)
cell = S.parametric_cell("B01", {"use": "school", "partition_system": "glass"})
check("chart cell has carbon and cost", cell["upfront_kgco2e_per_m2"] > 0 and cell["capex_sek_per_m2"] > 0, cell)

# --- roofs: no two roof parts share a volume (coincident faces flicker in the viewer), nothing sinks below the roof
from shapely.geometry import Polygon  # noqa: E402
import mvk.facade as FA  # noqa: E402


def _part(d):
    if d[0] == "prism":
        return Polygon(d[1][0], d[1][1:]).buffer(0), d[2], d[3]
    _, o, u, length, width, z0, rise, _m = d
    v = (-u[1], u[0])
    return Polygon([(o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b)
                    for a, b in ((0, -width / 2), (length, -width / 2), (length, width / 2), (0, width / 2))]), z0, z0 + rise


clashes, sunk = [], []
for bid in S.buildings:
    res = S.scenario(bid, {})["res"]
    top_fp = res.get("top_footprint") or res["footprint"]
    parts = [_part(d) for d in FA.roof_parts(top_fp, res["height"], res.get("facade"))]
    sunk += [bid for p in parts if p[1] < res["height"] - 1e-6]
    for i, a in enumerate(parts):
        for c in parts[i + 1:]:
            if min(a[2], c[2]) - max(a[1], c[1]) > 1e-6 and a[0].intersection(c[0]).area > 0.01:
                clashes.append(bid)
check("roof parts never overlap", not clashes, sorted(set(clashes)))
check("no roof part sinks into the top floor", not sunk, sorted(set(sunk)))

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
