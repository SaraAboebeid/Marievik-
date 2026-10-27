"""The explorer's layers - movement, fire escape, capacity, vacancy - for every building and floor of the site.

B01 has drawn plans, so its floors come from the floor studio: planned people and the legal maximum, the
longest escape walk and a hand-calculated evacuation time, and the simulated peak from the occupancy model.
The other buildings have no plans yet: capacity and movement are estimated from floor area with the
district model's densities, and fire escape is left out (shown as "needs plans") rather than guessed.

Each building also gets vacancyToday: today's real vacant share (data/projects/marievik/leases.json and
phasing.json via explorer/studio/tenancy.py) - the "today" picture, independent of the district model's own
simulated vacancy for a chosen future year (explorer/district.py), which the explorer falls back to showing
only once that 10-year model has actually been run.
"""
from __future__ import annotations

from datetime import date

from parametric.mvk import site as S

from . import district
from .studio import engine, evacuation, layouts, occupancy
from .studio import tenancy as studio_tenancy

# legal maximum (persons per m2 of floor) by kind where there is no plan: the floor studio's own densities
LEGAL_DENSITY = {"office": 0.1, "ground": 0.5, "school": 0.5, "residential": 0.04, "hotel": 0.05}
PEAK_SHARE = {"office": 0.7, "ground": 0.6, "school": 0.85, "residential": 0.8, "hotel": 0.7}
TRANSIT_SHARE = 0.6
_cache: dict[str, dict] = {}


def site_layers(site, studio_layouts: dict[int, str] | None = None, studio_params: dict[int, dict] | None = None) -> dict:
    key = repr((sorted((studio_layouts or {}).items()), sorted((k, sorted(v.items())) for k, v in (studio_params or {}).items())))
    if key in _cache:
        return _cache[key]
    mk = district.market()
    out = []
    for b in site.site["buildings"]:
        fp = S.footprint(b)
        kind = district.KIND_OF_USE.get(b["current_use"], "office")
        floors = []
        for f in range(int(b["levels"])):
            if b["id"] in ("B01",) and f < 7:
                lid = (studio_layouts or {}).get(f) or layouts.layout_for(f)
                m = engine.build(lid, (studio_params or {}).get(f) or {}, f)
                fig = m["fig"]
                occ = occupancy.simulate(m, days=8, seed=1)
                # the planned people (as the evacuation places them), shared out over the exits as the seats are
                seats = max(1, sum(x["people"] for x in fig["exitLoad"]))
                n_by_exit = [x["people"] * fig["people"] / seats for x in fig["exitLoad"]]
                floors.append({"floor": f, "source": "plan", "layout": m["L"].name,
                               "planned": fig["people"], "legalMax": fig["designLoad"], "checksOk": fig["allOk"],
                               "failed": [c["text"] for c in fig["checks"] if not c["ok"]],
                               "peak": round(occ["peak"]["mean"]), "personHours": occ["personHours"],
                               "escape_m": fig["worst"]["d"] if fig["worst"] else None, "escapeLimit": layouts.ESCAPE_LIMIT,
                               "evac_s": evacuation.hand_calc(m, n_by_exit, fig["worst"]["d"] if fig["worst"] else 0.0)})
                continue
            fk = "ground" if (f == 0 and kind == "office") else kind
            let = fp.area * mk["lettable_share"]
            planned = round(let / 100 * mk["people_per_100m2"].get(fk, 5))
            floors.append({"floor": f, "source": "estimate", "layout": None,
                           "planned": planned, "legalMax": round(fp.area * LEGAL_DENSITY.get(fk, 0.1)), "checksOk": None, "failed": [],
                           "peak": round(planned * PEAK_SHARE.get(fk, 0.7)), "personHours": None,
                           "escape_m": None, "escapeLimit": layouts.ESCAPE_LIMIT, "evac_s": None})
        peak = sum(x["peak"] for x in floors)
        rented = vacant = 0.0
        for f in range(int(b["levels"])):
            ft = studio_tenancy.floor_tenancy("marievik", b["id"], f, fp.area, today=date.today().year)
            rented += ft["rented"]
            vacant += ft["vacant"]
        vacancy_today = round(vacant / (rented + vacant), 3) if (rented + vacant) else 0.0
        out.append({"id": b["id"], "name": b["name"], "kind": kind, "c": [round(fp.centroid.x, 1), round(fp.centroid.y, 1)],
                    "floors": floors, "peak": peak, "stationTrips": round(peak * 2 * TRANSIT_SHARE),
                    "vacancyToday": vacancy_today})
    res = {"buildings": out, "station": {"name": mk["station"]["name"], "xy": mk["station"]["xy"]},
           "note": "B01 from its drawn (mock-up) plans and the floor studio; other buildings estimated from floor area - fire escape needs their plans. "
                   f"Station trips: 2 a day per person at the peak, {round(TRANSIT_SHARE * 100)} % by public transport (assumed)."}
    if len(_cache) > 20:
        _cache.pop(next(iter(_cache)))
    _cache[key] = res
    return res
