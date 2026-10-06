"""
explorer.model - the Marievik site as nested levels: site > building > floor > unit.

Geometry, layouts, quantities, cost and carbon all come from the Marievik_parametric engine
(mvk.layout, the same code the Grasshopper component runs), priced from this repository's
catalogue (data/components/catalogue.json). Nothing is re-implemented here; this module only
  - runs a scenario for one building (uses, partition system, windows, added floors),
  - groups the generated rooms into units (an apartment, an office, a hotel room, a classroom),
  - turns the result into plain JSON for the 3D explorer, and
  - computes the scenario KPIs.

Added floors (vertical extension) are laid out like the floors below, then re-priced as NEW
build in a light timber system (CLT walls and slabs), because nothing on them exists yet.
The old roof slab becomes a floor and stays retained; the new roof is new.
Whether the existing frame can carry them is NOT checked: every scenario with added floors
carries a "structural verification" blocker until a structural assessment is in the data.

Where the parametric model lives: env MVK_PARAMETRIC, else ~/Desktop/Marievik_parametric.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]                     # the Marievik+ repository
MVK = Path(os.environ.get("MVK_PARAMETRIC") or (Path.home() / "Desktop" / "Marievik_parametric"))
if str(MVK) not in sys.path:
    sys.path.insert(0, str(MVK))

from shapely.geometry import Point, Polygon                      # noqa: E402
from shapely.ops import polygonize, unary_union                  # noqa: E402
from shapely.geometry import LineString                          # noqa: E402

import mvk.layout as L                                           # noqa: E402
import mvk.site as S                                             # noqa: E402
import mvk.pricing as PR                                         # noqa: E402
import mvk.facade as FA                                          # noqa: E402
from mvk import export as MX                                     # noqa: E402

USES = ["site", "office_cellular", "office_open", "residential", "hotel", "school", "retail"]
SYSTEMS = ["as_profile", "conventional", "demountable", "glass"]
WINDOWS = {"existing": None, "triple_timber": "W_TRIPLE_TIMBER", "triple_alu_wood": "W_TRIPLE_ALU_WOOD"}
ADDED_TYPES = {"wall_exterior": "EW_TIMBER_CLT_380", "wall_core": "IW_CLT_100", "slab": "SL_CLT_240",
               "window": "W_TRIPLE_TIMBER"}
ADDED_FLOOR_H = 3.2
MAX_ADDED = 8

DEFAULTS = {"ground_use": "site", "use": "site", "partition_system": "as_profile", "windows": "existing",
            "added_floors": 0, "added_use": "same", "facade": True}

# zones that are not a lettable / usable unit
COMMON = ("Corridor", "Core", "Atrium (void)", "Support / WC", "Support / meeting", "Support")
SUBZONES = ("Bathroom", "Bedroom")


def settings_key(bid: str, s: dict) -> str:
    return bid + ":" + hashlib.sha1(json.dumps(s, sort_keys=True).encode()).hexdigest()[:12]


def clean_settings(raw: dict | None) -> dict:
    s = dict(DEFAULTS)
    for k, v in (raw or {}).items():
        if k in s and v is not None:
            s[k] = v
    s["added_floors"] = max(0, min(MAX_ADDED, int(s["added_floors"] or 0)))
    if s["use"] not in USES:
        s["use"] = "site"
    if s["ground_use"] not in USES:
        s["ground_use"] = "site"
    if s["partition_system"] not in SYSTEMS:
        s["partition_system"] = "as_profile"
    if s["windows"] not in WINDOWS:
        s["windows"] = "existing"
    if s["added_use"] not in USES + ["same"]:
        s["added_use"] = "same"
    s["facade"] = bool(s["facade"])
    return s


class Site:
    """Loads the site once; runs and caches building scenarios."""

    def __init__(self, site_file: Path | None = None):
        self.site = S.load(str(site_file) if site_file else None)
        self.buildings = {b["id"]: b for b in self.site["buildings"]}
        self.profiles = L.load_profiles()
        self.db = L.load_db()
        self.catalogue = PR.load_catalogue(str(ROOT))
        self.materials = dict(self.site.get("materials", {}))
        self.materials.setdefault("timber", [176, 136, 96])
        self._cache: dict[str, dict] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ public
    def site_payload(self) -> dict:
        return {
            "origin": {"E": self.site.get("origin_E", 672400), "N": self.site.get("origin_N", 6578480),
                       "crs": "SWEREF 99 TM (EPSG:3006), local = minus origin"},
            "location": {"name": "Marievik, Liljeholmen, Stockholm", "lat": 59.3105, "lon": 18.0235,
                         "tz": 1.0, "epw": "SWE_ST_Stockholm.024850_TMYx.2011-2025.epw"},
            "materials": self.materials,
            "roads": self.site.get("roads", []),
            "uses": {k: self.profiles[k]["label"] for k in self.profiles if not k.startswith("_")},
            "systems": SYSTEMS, "windows": list(WINDOWS), "max_added": MAX_ADDED, "defaults": DEFAULTS,
            "buildings": [{"id": b["id"], "name": b["name"], "levels": b["levels"], "current_use": b["current_use"],
                           "ground_use": b.get("ground_use"), "role": b.get("role"),
                           "footprint": b["footprint"], "holes": b.get("holes") or [],
                           "facade": b.get("facade"), "height_m": b.get("height_m")}
                          for b in self.site["buildings"]],
            "provenance": "Footprints/storeys: OpenStreetMap (ODbL). Uses, facades: visual estimates. "
                          "Layouts: Marievik_parametric engine (mock plans until real plans arrive).",
        }

    def scenario(self, bid: str, raw: dict | None = None) -> dict:
        s = clean_settings(raw)
        key = settings_key(bid, s)
        with self._lock:
            hit = self._cache.get(key)
        if hit:
            return hit
        out = self._run(bid, s)
        out["key"] = key
        with self._lock:
            self._cache[key] = out
        return out

    # ------------------------------------------------------------------ engine run
    def _run(self, bid: str, s: dict) -> dict:
        b = self.buildings[bid]
        fp = S.footprint(b)
        levels = int(b["levels"])
        add = s["added_floors"]
        g_use, u_use = S.profile_uses(b, s["use"], s["ground_use"])
        a_use = u_use if s["added_use"] in ("same", "site") else s["added_use"]
        uses = [g_use] + [u_use] * (levels - 1) + [a_use] * add
        hs = S.floor_heights(b, levels) + [ADDED_FLOOR_H] * add
        ov = {}
        if WINDOWS[s["windows"]]:
            ov = {"*": {"windows": [{"wall": "all", "type": WINDOWS[s["windows"]]}]}}
        facade = b.get("facade") if s["facade"] else None
        res = L.build(fp, uses, floor_heights=hs, overrides=ov, n_floors=levels + add, mode="conversion",
                      partition_system=None if s["partition_system"] == "as_profile" else s["partition_system"],
                      catalogue=self.catalogue, facade=facade)
        if add:
            self._reprice_added(res, levels)
        units = {F.index: units_of(F) for F in res["floors"]}
        return {"building": bid, "settings": s, "res": res, "levels": levels, "units": units,
                "uses": uses, "heights": hs, "kpi": self._kpi(b, s, res, units, levels)}

    def _reprice_added(self, res, levels):
        rows = []
        for r in res["rows"]:
            f = r["floor"]
            new_floor = f >= levels and not (f == levels and r["category"] == "slab")
            if new_floor and r["state"] == "retained":
                t = ADDED_TYPES.get(r["category"], r["type"])
                p = PR.price(r["qty"], t, self.db, self.catalogue, "new")
                r = dict(r, type=t, state="new", added=True, **p)
                r["cost_sek"], r["gwp_kgco2e"] = r["capex_sek"], r["upfront_kgco2e"]
            elif f >= levels:
                r = dict(r, added=True)
            rows.append(r)
        res["rows"] = rows
        res["summary"] = L.summarise(rows)

    def _kpi(self, b, s, res, units, levels) -> dict:
        k = MX.kpis(res, self.profiles)
        floors = res["floors"]
        gfa = sum(F.footprint.area for F in floors)
        added = [F for F in floors if F.index >= levels]
        rows = res["rows"]
        unit_list = [u for us in units.values() for u in us if u["kind"] == "unit"]
        k.update({
            "gfa_m2": round(gfa), "floors": len(floors), "existing_floors": levels, "added_floors": len(added),
            "added_gfa_m2": round(sum(F.footprint.area for F in added)),
            "units": len(unit_list),
            "unit_types": _count(u["name"] for u in unit_list),
            "unit_area_mean_m2": round(sum(u["area"] for u in unit_list) / len(unit_list), 1) if unit_list else 0,
            "height_m": round(res["height"], 1),
            "added_capex_sek": round(sum(r["capex_sek"] for r in rows if r.get("added"))),
            "added_upfront_kgco2e": round(sum(r["upfront_kgco2e"] for r in rows if r.get("added"))),
            "retained_share": _retained_share(rows),
            "upfront_kgco2e_per_m2": round(res["summary"]["total"]["gwp_kgco2e"] / gfa, 1) if gfa else 0,
            "capex_sek_per_m2": round(res["summary"]["total"]["cost_sek"] / gfa) if gfa else 0,
            "window_floor_ratio": _wfr(res),
        })
        k["blockers"] = blockers(b, s, len(floors), levels)
        return k

    # ------------------------------------------------------------------ JSON for the viewer
    def building_payload(self, bid: str, raw: dict | None = None) -> dict:
        sc = self.scenario(bid, raw)
        res, b = sc["res"], self.buildings[bid]
        fac = res.get("facade")
        floors, windows, details = [], [], []
        for F in res["floors"]:
            floors.append({"index": F.index, "z": round(F.z, 3), "height": round(F.height, 3),
                           "slab_t": round(F.slab_t, 3), "use": F.use, "use_label": self.profiles[F.use]["label"],
                           "added": F.index >= sc["levels"], "rings": _rings(F.footprint),
                           "material": "timber" if F.index >= sc["levels"] else FA.wall_colour(fac, F.index),
                           "units": len([u for u in sc["units"][F.index] if u["kind"] == "unit"])})
            base = F.z + F.slab_t
            walls = {w["id"]: w for w in F.walls if w["cat"] == "E"}
            for o in F.openings:
                w = walls.get(o["wall"])
                if w is None:
                    continue
                t = F.thick(w)
                (ux, uy), _ = L._unit(w["a"], w["b"])
                nx, ny = uy, -ux                                        # right of the wall = outside
                off = t / 2 + 0.02
                a = (w["a"][0] + ux * o["s0"] + nx * off, w["a"][1] + uy * o["s0"] + ny * off)
                c = (w["a"][0] + ux * o["s1"] + nx * off, w["a"][1] + uy * o["s1"] + ny * off)
                windows.append([_r(a[0]), _r(a[1]), _r(c[0]), _r(c[1]), _r(base + o["z0"]), _r(base + o["z1"]),
                                1 if o["kind"] == "door" else 0, 1 if o.get("new") else 0])
            if fac:
                details += FA.balconies(F, fac, F.wall_h)
        top_fp = res.get("top_footprint") or res["footprint"]
        if fac:
            details += FA.roof_parts(top_fp, res["height"], fac)
            if len(res["floors"]) > 1:
                details += FA.terrace_parts(res["footprint"], top_fp, res["floors"][-1].z, fac)
        return {"id": bid, "name": b["name"], "key": sc["key"], "settings": sc["settings"],
                "floors": floors, "windows": windows, "details": [_desc(d) for d in details],
                "height": round(res["height"], 2), "kpi": sc["kpi"]}

    def floor_payload(self, bid: str, index: int, raw: dict | None = None) -> dict:
        sc = self.scenario(bid, raw)
        F = sc["res"]["floors"][index]
        base = F.z + F.slab_t
        walls, pieces = [], []
        cats = "ECSKPIA"
        for w in F.walls:
            t = F.thick(w)
            (ux, uy), _ = L._unit(w["a"], w["b"])
            walls.append({"id": w["id"], "cat": w["cat"], "type": w["type"], "t": _r(t),
                          "a": [_r(w["a"][0]), _r(w["a"][1])], "b": [_r(w["b"][0]), _r(w["b"][1])]})
            for s0, s1, z0, z1 in L.wall_pieces(F, w):
                pieces.append([_r(w["a"][0]), _r(w["a"][1]), round(ux, 5), round(uy, 5), _r(s0), _r(s1),
                               _r(base + z0), _r(base + z1), _r(t), cats.index(w["cat"])])
        openings = []
        wd = {w["id"]: w for w in F.walls}
        for o in F.openings:
            w = wd[o["wall"]]
            (ux, uy), _ = L._unit(w["a"], w["b"])
            openings.append({"id": o["id"], "wall": o["wall"], "kind": o["kind"], "type": o.get("type"),
                             "new": bool(o.get("new")), "a": [_r(w["a"][0] + ux * o["s0"]), _r(w["a"][1] + uy * o["s0"])],
                             "b": [_r(w["a"][0] + ux * o["s1"]), _r(w["a"][1] + uy * o["s1"])],
                             "z0": _r(base + o["z0"]), "z1": _r(base + o["z1"]), "t": _r(F.thick(w))})
        rows = [r for r in sc["res"]["rows"] if r["floor"] == index]
        return {"building": bid, "index": index, "z": _r(F.z), "base": _r(base), "height": _r(F.height),
                "wall_h": _r(F.wall_h), "use": F.use, "use_label": self.profiles[F.use]["label"],
                "added": index >= sc["levels"], "rings": _rings(F.footprint),
                "voids": [_rings(v) for v in F.voids], "walls": walls, "pieces": pieces, "openings": openings,
                "rooms": [{"id": r["id"], "name": _room_name(r["name"]), "area": r["area"],
                           "poly": [[_r(x), _r(y)] for x, y in r["poly"]],
                           "label": [_r(r["label_pt"][0]), _r(r["label_pt"][1])]} for r in F.rooms],
                "units": sc["units"][index],
                "kpi": floor_kpi(F, rows, sc["units"][index])}

    def context_prisms(self, raw_by_building: dict | None = None) -> list[dict]:
        """Every building as (rings, top height) for daylight obstruction, with its current scenario height."""
        out = []
        for bid, b in self.buildings.items():
            h = None
            raw = (raw_by_building or {}).get(bid)
            if raw is not None:
                try:
                    h = self.scenario(bid, raw)["res"]["height"]
                except Exception:
                    h = None
            if h is None:
                h = sum(S.floor_heights(b, int(b["levels"])))
            out.append({"id": bid, "rings": [b["footprint"]] + (b.get("holes") or []), "height": h})
        return out


# ---------------------------------------------------------------------------- units
def units_of(F) -> list[dict]:
    """Group a floor's rooms into units: polygonize without the walls inside a unit (cat I)."""
    lines = [LineString(r) for r in L._rings(F.footprint)]
    lines += [LineString(w["axis"]) for w in F.walls if w["cat"] not in ("E", "I")]
    lines += [v.boundary for v in F.voids]
    lines += [z.boundary for name, z in F.zones if name == "Corridor"]
    zones = [(n, z) for n, z in F.zones if n not in SUBZONES]
    ext = [w for w in F.walls if w["cat"] == "E"]
    wins = [o for o in F.openings if o["kind"] == "window"]
    wall_of = {w["id"]: w for w in F.walls}
    out = []
    polys = sorted(polygonize(unary_union(lines)), key=lambda p: (-p.centroid.y, p.centroid.x))
    for p in polys:
        if p.area < 1.0 or not F.footprint.contains(p.representative_point()):
            continue
        hits = sorted(((p.intersection(z).area, n) for n, z in zones), reverse=True)
        name = hits[0][1] if hits and hits[0][0] > 0.2 * p.area else "Room"
        kind = "common" if name.startswith(COMMON) else "unit"
        if kind == "unit" and F.use == "residential" and name.startswith("Apartment"):
            name = "Apartment %s" % ("1 RoK" if p.area < 40 else "2 RoK" if p.area < 60 else "3 RoK" if p.area < 80 else "4 RoK")
        rooms = [r["id"] for r in F.rooms if p.buffer(0.05).contains(Point(r["label_pt"]))]
        # windows: openings on a facade wall that touches this unit
        uw, glazing, normals = [], 0.0, []
        edge = p.buffer(0.6)
        for o in wins:
            w = wall_of[o["wall"]]
            if w["cat"] != "E":
                continue
            (ux, uy), _ = L._unit(w["a"], w["b"])
            sm = (o["s0"] + o["s1"]) / 2
            mp = Point(w["a"][0] + ux * sm, w["a"][1] + uy * sm)
            if edge.contains(mp):
                uw.append(o["id"])
                area = (o["s1"] - o["s0"]) * (o["z1"] - o["z0"])
                glazing += area
                normals.append((uy * area, -ux * area))
        facade_len = sum(LineString([w["a"], w["b"]]).intersection(p.buffer(0.6)).length for w in ext)
        orient = None
        if normals:
            nx, ny = sum(n[0] for n in normals), sum(n[1] for n in normals)
            orient = _compass(math.degrees(math.atan2(nx, ny)) % 360)
        uid = "F%02d-U-%03d" % (F.index, len(out) + 1)
        out.append({"id": uid, "name": name, "kind": kind, "area": round(p.area, 1),
                    "poly": [[_r(x), _r(y)] for x, y in L._rings(p)[0]],
                    "holes": [[[_r(x), _r(y)] for x, y in r] for r in L._rings(p)[1:]],
                    "label": [_r(c) for c in p.representative_point().coords[0]],
                    "rooms": rooms, "windows": uw, "glazing_m2": round(glazing, 1),
                    "wfr": round(glazing / p.area, 3) if p.area else 0.0,
                    "facade_m": round(facade_len, 1), "orientation": orient})
    return out


def floor_kpi(F, rows, units) -> dict:
    us = [u for u in units if u["kind"] == "unit"]
    return {"gfa_m2": round(F.footprint.area), "units": len(us),
            "unit_types": _count(u["name"] for u in us),
            "usable_m2": round(sum(u["area"] for u in us)),
            "efficiency": round(sum(u["area"] for u in us) / F.footprint.area, 3) if F.footprint.area else 0,
            "capex_sek": round(sum(r["capex_sek"] for r in rows)),
            "upfront_kgco2e": round(sum(r["upfront_kgco2e"] for r in rows)),
            "no_window_units": sum(1 for u in us if not u["windows"]),
            "low_wfr_units": sum(1 for u in us if u["wfr"] < 0.10)}


def blockers(b, s, n_floors, levels) -> list[dict]:
    out = []
    if n_floors > levels:
        out.append({"kind": "technical", "text": "Added floors: structural capacity of the existing frame and "
                    "foundations is not verified (no structural data yet).", "severity": "high"})
        if n_floors >= 9:
            out.append({"kind": "regulatory", "text": "%d storeys: Br0 fire class, a second stair or an evacuation "
                        "lift is likely required (BBR 5)." % n_floors, "severity": "high"})
        out.append({"kind": "regulatory", "text": "Added height needs a new detailed development plan "
                    "(detaljplan) or a deviation; check daylight to neighbours.", "severity": "medium"})
    if s["use"] in ("residential", "hotel") and b["current_use"] == "office":
        out.append({"kind": "technical", "text": "Office to housing: plan depth limits daylight in the inner "
                    "part of the plan; check units without windows.", "severity": "medium"})
    return out


# ---------------------------------------------------------------------------- helpers
def _r(v):
    return round(float(v), 3)


def _rings(g):
    return [[[_r(x), _r(y)] for x, y in r] for r in L._rings(g)]


def _desc(d):
    k = d[0]
    if k == "prism":
        return {"k": "prism", "rings": [[[_r(x), _r(y)] for x, y in r] for r in d[1]], "z0": _r(d[2]),
                "z1": _r(d[3]), "m": d[4]}
    if k == "box":
        return {"k": "box", "o": [_r(d[1][0]), _r(d[1][1])], "u": [round(d[2][0], 5), round(d[2][1], 5)],
                "s": [_r(d[3]), _r(d[4])], "t": [_r(d[5]), _r(d[6])], "z": [_r(d[7]), _r(d[8])], "m": d[9]}
    if k == "vault":
        return {"k": "vault", "o": [_r(d[1][0]), _r(d[1][1])], "u": [round(d[2][0], 5), round(d[2][1], 5)],
                "length": _r(d[3]), "width": _r(d[4]), "z0": _r(d[5]), "rise": _r(d[6]), "m": d[7]}
    return {"k": k}


def _room_name(n):
    """Inside a unit, the main space of an apartment is the living space, not the apartment."""
    return "Living / kitchen" if n.startswith("Apartment") else n


def _count(names):
    out = {}
    for n in names:
        out[n] = out.get(n, 0) + 1
    return out


def _retained_share(rows):
    tot = sum(r["qty"] for r in rows if r["unit"] == "m2" and r["category"].startswith(("wall", "slab")))
    ret = sum(r["qty"] for r in rows if r["unit"] == "m2" and r["category"].startswith(("wall", "slab"))
              and r["state"] == "retained")
    return round(ret / tot, 3) if tot else 0.0


def _wfr(res):
    glaz = sum(r["qty"] for r in res["rows"] if r["category"] == "window")
    area = sum(F.footprint.area for F in res["floors"])
    return round(glaz / area, 3) if area else 0.0


def _compass(deg):
    names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return names[int(((deg + 22.5) % 360) // 45)]
