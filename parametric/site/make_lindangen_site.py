#! python3
"""
Build site/lindangen_site.json: the 16 Lindängen buildings (Malmö) from OpenStreetMap footprints, matched to
the site sketch Sara supplied (2026-11-02): 680 apartments, 44 532 m2, 16 buildings; Hus 14-16 have 8 storeys,
the rest 3. Street numbers on the sketch: Koralgatan and Kantatgatan.

    python site/make_lindangen_site.py          (needs shapely and pyproj)

Input : site/osm_lindangen.json (OpenStreetMap API map download, 2026-11-02)
Output: site/lindangen_site.json  (same schema as marievik_site.json)

Facades are visual estimates from Google Street View (imagery October 2025) and Google Maps aerials:
Skåne yellow brick lamellas with flat roofs, some re-rendered in pale cream with glazed balconies and
red-brown stair bands (Koralgatan 2-15), and three yellow-brick 8-storey slabs with blind gables and
recessed balconies. Which Hus number is which footprint follows the sketch's property and street numbers;
Hus 3-7 and 8-11 are numbered west to east within their property where the sketch gave no numbers.
"""
import json
import os

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
OE, ON = 375050.0, 6159060.0            # SWEREF 99 TM origin near the middle of the 16 buildings
TR = Transformer.from_crs(4326, 3006, always_xy=True)

# Hus -> (OSM way, property, entrances as the sketch / OSM give them, storeys, facade variant)
HUS = {
    1: (33709976, "Hymnen 1", "Koralgatan 17–33", 3, "renovated"),
    2: (33709975, "Hymnen 1", "Koralgatan 1–15", 3, "renovated"),
    3: (211414240, "Kantaten 1", "Koralgatan 12–20", 3, "brick"),
    4: (33707957, "Kantaten 1", "Koralgatan 2–10, Kantatgatan 1–9", 3, "rendered"),
    5: (211414238, "Kantaten 1", "Koralgatan 30–34", 3, "brick"),
    6: (33707953, "Kantaten 1", "Koralgatan 22–38, Kantatgatan 25–31", 3, "rendered"),
    7: (33707954, "Kantaten 1", "Kantatgatan 15–21", 3, "brick"),
    8: (211418219, "Kantaten 6", "Kantatgatan 2–12", 3, "brick"),
    9: (33707946, "Kantaten 6", "Kantatgatan 14–20", 3, "brick"),
    10: (211418220, "Kantaten 6", "Kantatgatan 22–34", 3, "brick"),
    11: (211418222, "Kantaten 6", "Kantatgatan 36–42", 3, "brick"),
    12: (33707950, "Kantaten 3", "Koralgatan 39–49", 3, "brick"),
    13: (33707948, "Kantaten 3", "Koralgatan 56–66", 3, "brick"),
    14: (33707951, "Kantaten 3", "Koralgatan 48–54", 8, "slab"),
    15: (33707952, "", "Kantatgatan 35–41", 8, "slab"),
    16: (33707941, "Kantaten 2", "Kantatgatan 43–47", 8, "slab"),
}
SRC = "Visual estimate from Google Street View (Oct 2025) and Google Maps aerials, 2026-11-02 - not surveyed"
FACADES = {
    "renovated": {"material": "render_cream", "window": "punched", "module": 2.4, "wwr": 0.34, "sill": 0.8, "head": 2.3,
                  "balconies": True, "accent": "brick_maroon",
                  "notes": "Re-rendered pale cream lamella: red-brown stair bands on the entrance side, full-width glazed "
                           "balconies between white cross-walls on the garden side, yellow-brick gables."},
    "rendered": {"material": "render_cream", "window": "punched", "module": 2.4, "wwr": 0.30, "sill": 0.9, "head": 2.3,
                 "balconies": True, "accent": "brick_maroon",
                 "notes": "Pale cream render with white-framed windows and red-brown stair bands; yellow-brick gables."},
    "brick": {"material": "brick_yellow", "window": "punched", "module": 2.4, "wwr": 0.28, "sill": 0.9, "head": 2.3,
              "balconies": True,
              "notes": "Skåne yellow brick lamella (1960s), white windows, balconies with light panel fronts, flat roof."},
    "slab": {"material": "brick_yellow", "window": "punched", "module": 2.4, "wwr": 0.30, "sill": 0.9, "head": 2.3,
             "balconies": True,
             "notes": "Eight-storey yellow-brick slab: blind brick gables, recessed balconies in rows on the long side, flat roof."},
}
MATERIALS = {"brick_yellow": [206, 178, 116], "brick_maroon": [128, 58, 50], "render_cream": [232, 222, 196],
             "brick_red": [150, 72, 56], "brick_dark": [92, 62, 52], "render_white": [238, 236, 230],
             "render_light": [226, 221, 208], "render_yellow": [228, 204, 138], "stone_light": [214, 207, 190],
             "metal_panel_light": [196, 202, 208], "metal_light": [180, 186, 192], "membrane_dark": [88, 90, 96],
             "membrane_light": [196, 192, 184], "pv": [38, 48, 70], "glass": [140, 175, 200], "green": [110, 150, 90]}
ROAD_KINDS = {"primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street",
              "pedestrian", "footway", "cycleway", "path"}


def main():
    d = json.load(open(os.path.join(HERE, "osm_lindangen.json"), encoding="utf-8"))["elements"]
    nodes = {e["id"]: e for e in d if e["type"] == "node"}
    ways = {e["id"]: e for e in d if e["type"] == "way"}

    def xy(nid):
        n = nodes[nid]
        E, N = TR.transform(n["lon"], n["lat"])
        return [round(E - OE, 2), round(N - ON, 2)]

    out = {"name": "Lindängen, Malmö", "crs": "EPSG:3006 SWEREF 99 TM", "origin_E": OE, "origin_N": ON,
           "location": {"name": "Lindängen, Malmö", "lat": 55.5614, "lon": 13.0195, "tz": 1.0,
                        "epw": "SWE_SK_Malmo.026360_TMYx.2011-2025.epw"},
           "note": "Model coordinates = SWEREF 99 TM minus origin (metres). Footprints from OpenStreetMap (ODbL, "
                   "© OpenStreetMap contributors), downloaded 2026-11-02; storeys and Hus numbers from Sara's site "
                   "sketch (680 apartments, 44 532 m2); facades from Google Street View - visual estimates.",
           "summary": {"apartments": 680, "area_m2": 44532, "buildings": 16},
           # the engine's generic flat is 7.2 m wide; Lindängen's 1960s flats are narrower (680 in 44 532 m2):
           # 5.4 m gives about 670 homes over the 16 buildings
           "profile_overrides": {"residential": {"unit_width": 5.4}},
           "buildings": [], "roads": [], "water": [], "materials": MATERIALS}
    for h, (wid, prop, addr, lv, var) in HUS.items():
        w = ways[wid]
        pts = [xy(n) for n in w["nodes"] if n in nodes]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        poly = Polygon(pts)
        if poly.exterior.is_ccw:            # clockwise, like marievik_site.json
            pts = pts[::-1]
        f = dict(FACADES[var])
        f.update({"roof": {"shape": "flat", "membrane": "dark", "parapet": 0.45, "features": []}, "source": SRC})
        height = round(3.6 + (lv - 1) * 2.85, 2)
        out["buildings"].append({
            "id": "H%02d" % h, "name": "%s - Hus %d%s" % (addr, h, ", " + prop if prop else ""),
            "hus": h, "property": prop, "address": addr,
            "osm_id": "way/%d" % wid, "osm_tags": w.get("tags", {}), "levels": lv, "height_m": height,
            "current_use": "residential", "ground_use": "residential", "role": "study",
            "footprint": pts, "holes": [], "area_m2": round(poly.area, 1), "facade": f})
    # street centrelines within ~350 m (for the plan view and the Rhino bake)
    for w in ways.values():
        t = w.get("tags", {})
        if t.get("highway") not in ROAD_KINDS:
            continue
        pts = [xy(n) for n in w["nodes"] if n in nodes]
        if len(pts) < 2 or LineString(pts).distance(Point(0, 0)) > 350:
            continue
        out["roads"].append({"kind": t["highway"], "name": t.get("name", ""), "pts": pts})
    p = os.path.join(HERE, "lindangen_site.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    gfa = sum(b["area_m2"] * b["levels"] for b in out["buildings"])
    print("wrote", p, len(out["buildings"]), "buildings,", len(out["roads"]), "roads, GFA ~%.0f m2" % gfa)


if __name__ == "__main__":
    main()
