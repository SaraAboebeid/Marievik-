"""
Build the Marievik urban context (streets, footpaths, quay, water, greens, trees, lamps, rail)
from OpenStreetMap, in the same local coordinates as the buildings (SWEREF 99 TM minus origin).

    python site/make_context.py            (needs shapely and pyproj)

Input : site/osm_context_north.json, site/osm_context_south.json  (site/fetch_osm_context.py)
Output: site/marievik_context.json

What comes from where
  OpenStreetMap (ODbL, (c) OpenStreetMap contributors): street centrelines and their class, footways,
  cycleways, steps, piers, water, parks, grass, woodland, scrub, mapped single trees, street lamps,
  benches, railway tracks.
  Estimated here (flagged "estimated"): street widths per road class, trees filling woodland and scrub,
  and the row of large trees along the Sjövik/Marievik quay seen in Google Street View (2026-10-20),
  where OpenStreetMap maps none.

Coverage: everything is clipped to a circle of CIRCLE_R m around the site (the disc the viewer shows), except
"buildings", which keeps the original box CLIP and plain massing so the daylight/comfort obstructions and the
urban summary stay exactly as before. The viewer draws the detailed "massing" list instead:
  massing     every OSM building in the circle, split into its building:parts where mapped, with min height,
              height (height / levels / an estimate by building type, flagged), colour (building:colour or a
              muted tint by use), roof colour, and gabled / hipped roofs on near-rectangular footprints
  barriers    fences, walls, retaining walls, hedges, railings (OSM barrier=*)
  furniture   benches, bins, bicycle stands, bus stops/shelters, picnic tables, artworks, life rings, post
              boxes, recycling, fountains, flagpoles, bollards, traffic signals, grit bins, parcel lockers,
              toilets, drinking water, BBQs, fitness stations (OSM nodes), each turned to face the nearest path
  crossings   zebra stripes where OSM maps a marked crossing on a street
  markings    dashed centre lines on two-way streets of tertiary class and above
  parking     surface car parks;  platforms  rail / bus platforms (raised)
  trees       also OSM tree rows, and sparse trees in parks (estimated, 1 per ~450 m2 of open lawn)
"""
import json
import math
import os
import random

from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = json.load(open(os.path.join(HERE, "marievik_site.json"), encoding="utf-8"))
OE, ON = SITE["origin_E"], SITE["origin_N"]
TR = Transformer.from_crs(4326, 3006, always_xy=True)
CLIP = box(-360, -480, 420, 360)              # the original box: neighbouring buildings for the analyses
CIRCLE_C, CIRCLE_R = (30.0, -60.0), 650.0      # the disc the viewer shows
CIRCLE = Point(*CIRCLE_C).buffer(CIRCLE_R, 128)
random.seed(7)

# carriageway widths (m), estimated from lane counts typical of each class in Stockholm
ROAD_W = {"motorway": 15.0, "trunk": 14.0, "primary": 12.0, "secondary": 12.0, "secondary_link": 6.5,
          "tertiary": 9.0, "tertiary_link": 6.0, "unclassified": 7.0, "residential": 7.0, "living_street": 6.0,
          "service": 4.5, "busway": 7.0, "construction": 6.0}
PATH_W = {"footway": 2.5, "cycleway": 3.0, "pedestrian": 6.0, "path": 1.8, "steps": 2.5, "platform": 3.0,
          "bridleway": 2.0, "elevator": 2.0}
GREEN = {("landuse", "grass"): "grass", ("landuse", "recreation_ground"): "grass", ("landuse", "flowerbed"): "flowerbed",
         ("landuse", "forest"): "wood", ("natural", "wood"): "wood", ("natural", "scrub"): "scrub",
         ("natural", "grassland"): "grass", ("leisure", "park"): "park", ("leisure", "playground"): "playground",
         ("leisure", "dog_park"): "grass", ("leisure", "pitch"): "pitch", ("landuse", "allotments"): "grass",
         ("natural", "bare_rock"): "rock", ("natural", "beach"): "sand", ("natural", "sand"): "sand"}


def _height(t):
    for k in ("height", "building:height"):
        try:
            return round(float(str(t[k]).split()[0]), 1)
        except (KeyError, ValueError):
            pass
    try:
        return round(float(t["building:levels"]) * 3.2 + 1.0, 1)
    except (KeyError, ValueError):
        return 4.0 if t.get("building") in ("shed", "garage", "garages", "kiosk", "service") else 12.0


def load():
    nodes, ways, rels = {}, {}, {}
    for part in ("north", "south"):
        d = json.load(open(os.path.join(HERE, "osm_context_%s.json" % part), encoding="utf-8"))
        for e in d["elements"]:
            {"node": nodes, "way": ways, "relation": rels}[e["type"]][e["id"]] = e
    xy = {}
    for nid, n in nodes.items():
        x, y = TR.transform(n["lon"], n["lat"])
        xy[nid] = (x - OE, y - ON)
    return nodes, ways, rels, xy


def way_pts(w, xy):
    return [xy[n] for n in w.get("nodes", []) if n in xy]


def rings_of(g):
    out = []
    for p in (g.geoms if hasattr(g, "geoms") else [g]):
        if p.geom_type != "Polygon" or p.area < 1.0:
            continue
        out.append([[[round(x, 2), round(y, 2)] for x, y in p.exterior.coords]] +
                   [[[round(x, 2), round(y, 2)] for x, y in r.coords] for r in p.interiors])
    return out


def poly_of(pts):
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    p = Polygon(pts).buffer(0)
    return p if p.area > 1.0 else None


def multipolygon(rel, ways, xy):
    outer, inner = [], []
    for m in rel.get("members", []):
        if m["type"] != "way" or m["ref"] not in ways:
            continue
        ln = way_pts(ways[m["ref"]], xy)
        if len(ln) >= 2:
            (inner if m.get("role") == "inner" else outer).append(LineString(ln))
    if not outer:
        return None
    polys = list(polygonize(linemerge(outer)))
    holes = list(polygonize(linemerge(inner))) if inner else []
    if not polys:
        return None
    g = unary_union(polys)
    if holes:
        g = g.difference(unary_union(holes))
    return g


def main():
    nodes, ways, rels, xy = load()
    out = {"source": "OpenStreetMap (ODbL, (c) OpenStreetMap contributors), downloaded 2026-10-20; widths and some trees estimated",
           "clip": [round(CIRCLE_C[0] - CIRCLE_R), round(CIRCLE_C[1] - CIRCLE_R), round(CIRCLE_C[0] + CIRCLE_R), round(CIRCLE_C[1] + CIRCLE_R)],
           "circle": [CIRCLE_C[0], CIRCLE_C[1], CIRCLE_R], "roads": [], "paths": [], "greens": [], "water": [], "piers": [],
           "rail": [], "trees": [], "lamps": [], "benches": [], "plazas": [], "buildings": [],
           "massing": [], "barriers": [], "furniture": {}, "crossings": [], "markings": [], "parking": [], "platforms": []}
    road_polys, path_polys = [], []
    buildings = unary_union([Polygon(b["footprint"], b.get("holes") or []) for b in SITE["buildings"]])
    osm_buildings = []

    for w in ways.values():
        t = w.get("tags", {})
        pts = way_pts(w, xy)
        if len(pts) < 2:
            continue
        if "building" in t:
            p = poly_of(pts)
            if p is not None:
                osm_buildings.append(p)
                c = p.intersection(CLIP)
                # neighbouring buildings (not the 13 study buildings) as plain massing
                if not c.is_empty and p.intersection(buildings).area < 0.3 * p.area and t.get("building") not in ("roof", "carport"):
                    h = _height(t)
                    out["buildings"].append({"rings": rings_of(c), "h": h, "name": t.get("name", ""),
                                             "colour": t.get("building:colour", ""), "levels": t.get("building:levels", "")})
            continue
        if t.get("tunnel") in ("yes", "building_passage") or str(t.get("layer", "0")).startswith("-"):
            continue
        layer = 0
        try:
            layer = max(0, int(t.get("layer", "0")))
        except ValueError:
            pass
        z = 5.5 * layer if t.get("bridge") else 0.0
        hw = t.get("highway")
        if hw in ROAD_W:
            ln = LineString(pts)
            if t.get("area") == "yes" and poly_of(pts):
                g = poly_of(pts)
            else:
                g = ln.buffer(ROAD_W[hw] / 2, cap_style=2, join_style=2, mitre_limit=3)
            g = g.intersection(CIRCLE)
            if not g.is_empty:
                (road_polys if z == 0 else []).append(g)
                if z:
                    out["roads"].append({"kind": hw, "z": z, "rings": rings_of(g), "name": t.get("name", "")})
            continue
        if hw in PATH_W:
            if t.get("area") == "yes" and poly_of(pts):
                g = poly_of(pts)
                out["plazas"].append({"kind": "plaza", "surface": t.get("surface", "paving_stones"), "rings": rings_of(g.intersection(CIRCLE))})
                continue
            g = LineString(pts).buffer(PATH_W[hw] / 2, cap_style=2, join_style=2, mitre_limit=3).intersection(CIRCLE)
            if g.is_empty:
                continue
            wood = t.get("surface") == "wood" or t.get("bridge") == "boardwalk"
            if z:
                out["paths"].append({"kind": hw, "surface": "wood" if wood else t.get("surface", "paved"), "z": z, "rings": rings_of(g)})
            else:
                path_polys.append((g, "wood" if wood else ("gravel" if t.get("surface") in ("gravel", "fine_gravel", "dirt", "compacted") else "paved")))
            continue
        if t.get("man_made") == "pier":
            g = poly_of(pts) or LineString(pts).buffer(1.5, cap_style=2)
            g = g.intersection(CIRCLE)
            if not g.is_empty:
                out["piers"].append({"rings": rings_of(g), "surface": t.get("surface", "wood")})
            continue
        if t.get("railway") in ("rail", "light_rail", "tram") and not t.get("tunnel"):
            ln = LineString(pts).intersection(CIRCLE)
            if not ln.is_empty:
                out["rail"].append({"kind": t["railway"], "z": z,
                                    "lines": [[[round(x, 2), round(y, 2)] for x, y in l.coords]
                                              for l in (ln.geoms if hasattr(ln, "geoms") else [ln]) if l.geom_type == "LineString"]})
            continue
        for k in ("landuse", "natural", "leisure"):
            kind = GREEN.get((k, t.get(k)))
            if kind:
                p = poly_of(pts)
                if p is not None:
                    g = p.intersection(CIRCLE)
                    if not g.is_empty:
                        out["greens"].append({"kind": kind, "rings": rings_of(g), "name": t.get("name", "")})
                break
        if t.get("natural") == "water" and poly_of(pts):
            out["water"].append({"rings": rings_of(poly_of(pts).intersection(CIRCLE))})

    for r in rels.values():
        t = r.get("tags", {})
        g = None
        for k in ("landuse", "natural", "leisure"):
            kind = GREEN.get((k, t.get(k)))
            if kind:
                g = multipolygon(r, ways, xy)
                if g is not None and not g.intersection(CIRCLE).is_empty:
                    out["greens"].append({"kind": kind, "rings": rings_of(g.intersection(CIRCLE)), "name": t.get("name", "")})
                break
        if t.get("man_made") == "pier":
            g = multipolygon(r, ways, xy)
            if g is not None:
                out["piers"].append({"rings": rings_of(g.intersection(CIRCLE)), "surface": "wood"})

    # water: the lake/bay outlines are only partly inside the download, so split the clip box by every
    # water-relation outline and keep the pieces that hold no building, road or land use
    shore = []
    for r in rels.values():
        t = r.get("tags", {})
        if t.get("natural") in ("water", "bay") or t.get("water"):
            for m in r.get("members", []):
                if m["type"] == "way" and m["ref"] in ways:
                    ln = way_pts(ways[m["ref"]], xy)
                    if len(ln) >= 2:
                        shore.append(LineString(ln))
    for w in ways.values():
        if w.get("tags", {}).get("natural") == "coastline":
            shore.append(LineString(way_pts(w, xy)))
    land_marks = unary_union(osm_buildings + road_polys + [buildings])
    if shore:
        pieces = list(polygonize(unary_union([CIRCLE.exterior] + [s.intersection(CIRCLE.buffer(1)) for s in shore])))
        water = [p for p in pieces if p.area > 500 and p.intersection(land_marks).area < 0.02 * p.area]
        if water:
            out["water"].append({"rings": rings_of(unary_union(water)), "name": "Årstaviken"})
    waters = unary_union([Polygon(r[0], r[1:]) for w in out["water"] for r in w["rings"]]) if out["water"] else Polygon()

    # roads and paths as clean, non-overlapping surfaces
    roads = unary_union(road_polys).difference(waters) if road_polys else Polygon()
    out["roads"].insert(0, {"kind": "carriageway", "z": 0.0, "rings": rings_of(roads)})
    for surf in ("wood", "gravel", "paved"):
        gs = [g for g, s in path_polys if s == surf]
        if gs:
            g = unary_union(gs).difference(roads)
            if surf != "wood":
                g = g.difference(waters)
            out["paths"].append({"kind": "footway", "surface": surf, "z": 0.0, "rings": rings_of(g)})

    # trees mapped in OpenStreetMap
    for nid, n in nodes.items():
        t = n.get("tags", {})
        p = xy[nid]
        if not CIRCLE.contains(Point(p)):
            continue
        if t.get("natural") == "tree":
            h = float(str(t.get("height", "0")).split()[0] or 0) if t.get("height") else 0.0
            out["trees"].append({"p": [round(p[0], 2), round(p[1], 2)], "h": h or round(random.uniform(8, 13), 1),
                                 "leaf": t.get("leaf_type", "broadleaved"), "src": "osm",
                                 "species": t.get("species") or t.get("genus") or ""})
        elif t.get("highway") == "street_lamp":
            out["lamps"].append([round(p[0], 2), round(p[1], 2)])
        elif t.get("amenity") == "bench":
            out["benches"].append([round(p[0], 2), round(p[1], 2)])

    occupied = unary_union([buildings, roads] + osm_buildings).buffer(2.0)
    have = [Point(t["p"]) for t in out["trees"]]

    def free(p, d):
        return not occupied.contains(p) and not waters.contains(p) and all(p.distance(q) > d for q in have)

    # woodland and scrub filled with trees (estimated)
    for gr in out["greens"]:
        if gr["kind"] not in ("wood", "scrub"):
            continue
        for rings in gr["rings"]:
            poly = Polygon(rings[0], rings[1:])
            n = int(poly.area / (55 if gr["kind"] == "wood" else 140))
            x0, y0, x1, y1 = poly.bounds
            tries = 0
            while n > 0 and tries < n * 12:
                tries += 1
                p = Point(random.uniform(x0, x1), random.uniform(y0, y1))
                if poly.contains(p) and free(p, 3.5):
                    have.append(p)
                    out["trees"].append({"p": [round(p.x, 2), round(p.y, 2)],
                                         "h": round(random.uniform(9, 17) if gr["kind"] == "wood" else random.uniform(3, 6), 1),
                                         "leaf": random.choice(["broadleaved", "broadleaved", "needleleaved"]) if gr["kind"] == "wood" else "broadleaved",
                                         "src": "estimated"})
                    n -= 1

    # the quay: a row of large willows/limes along the water's edge (Street View), ~11 m apart,
    # where OpenStreetMap maps none
    if not waters.is_empty:
        edge = waters.boundary.intersection(CLIP.buffer(-2))   # the Marievik quay only
        for ln in (edge.geoms if hasattr(edge, "geoms") else [edge]):
            if ln.geom_type != "LineString" or ln.length < 30:
                continue
            for k in range(int(ln.length // 11)):
                q = ln.interpolate(k * 11 + 5)
                # step inland 6 m: the trees stand behind the boardwalk edge
                best = None
                for dist in (6, 8, 10):
                    for ang in range(0, 360, 20):
                        c = Point(q.x + dist * math.cos(math.radians(ang)), q.y + dist * math.sin(math.radians(ang)))
                        if not waters.contains(c) and waters.distance(c) > dist - 1.5 and free(c, 6.0) and c.distance(buildings) > 5:
                            best = c
                            break
                    if best is not None:
                        break
                if best is not None:
                    have.append(best)
                    out["trees"].append({"p": [round(best.x, 2), round(best.y, 2)], "h": round(random.uniform(10, 15), 1),
                                         "leaf": "broadleaved", "src": "estimated (Street View, quay)", "species": "Salix"})

    detail(out, nodes, ways, rels, xy, buildings, roads, waters, path_polys, have, free)

    for k in ("greens", "water", "piers", "plazas", "buildings", "massing", "parking", "platforms"):
        out[k] = [g for g in out[k] if g["rings"]]
    path = os.path.join(HERE, "marievik_context.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", path, {k: len(v) for k, v in out.items() if isinstance(v, list)},
          "furniture:", {k: len(v) for k, v in out["furniture"].items()},
          "trees osm/estimated: %d/%d" % (sum(t["src"] == "osm" for t in out["trees"]),
                                          sum(t["src"] != "osm" for t in out["trees"])))


# ---------------------------------------------------------------------------- detail for the viewer
# CSS colour names used in OSM building:colour / roof:colour around Liljeholmen
CSS = {"white": "#f4f2ec", "ghostwhite": "#f4f2ec", "ghostwrite": "#f4f2ec", "beige": "#e8dcc0", "lightyellow": "#f1e9bd",
       "yellow": "#e7cf73", "goldenrod": "#cfa64a", "orange": "#d9934e", "salmon": "#de8f78", "lightsalmon": "#e6a48a",
       "darksalmon": "#d39a84", "pink": "#e4b9b6", "red": "#b65046", "indianred": "#be6a62", "firebrick": "#9e4136",
       "brown": "#8a5c44", "maroon": "#6f3a32", "green": "#6f8c62", "lightgreen": "#9fbf8a", "paleturquoise": "#b8d8d6",
       "lightgrey": "#cfcdc8", "lightgray": "#cfcdc8", "grey": "#9a9894", "gray": "#9a9894", "dimgray": "#6c6a67",
       "darkgrey": "#86847f", "black": "#3b3b3d", "blue": "#4b6aa8"}
WALL = {"apartments": "#ece6da", "residential": "#ece6da", "house": "#efe3cf", "detached": "#efe3cf",
        "allotment_house": "#e4cfa8", "commercial": "#dfe2e3", "office": "#dde1e4", "retail": "#e2e0dc",
        "industrial": "#e0d8c8", "warehouse": "#e0d8c8", "school": "#ecdcd2", "kindergarten": "#efdccf",
        "university": "#ecdcd2", "college": "#ecdcd2", "church": "#efe7dc", "civic": "#ecdcd2", "public": "#ecdcd2",
        "shed": "#d9cbb2", "garage": "#d6d2c8", "garages": "#d6d2c8", "service": "#d6d2c8", "parking": "#d3d1cc",
        "toilets": "#dcd6cc", "kiosk": "#e6d9c2"}
DEFAULT_H = {"apartments": 18.0, "residential": 15.0, "house": 6.5, "detached": 6.5, "allotment_house": 3.2,
             "shed": 2.8, "garage": 3.0, "garages": 3.0, "service": 3.5, "kiosk": 3.2, "toilets": 3.2, "roof": 4.0,
             "commercial": 14.0, "office": 18.0, "retail": 8.0, "industrial": 9.0, "warehouse": 9.0,
             "school": 10.0, "kindergarten": 5.0, "church": 14.0, "parking": 9.0, "storage_tank": 10.0}
PITCHED = {"gabled": "gabled", "half-hipped": "hipped", "hipped": "hipped", "gambrel": "gabled", "mansard": "hipped",
           "pyramidal": "hipped", "saltbox": "gabled"}
BARRIER = {"fence": 1.2, "wall": 1.4, "retaining_wall": 1.0, "hedge": 1.3, "handrail": 1.0, "guard_rail": 0.8,
           "jersey_barrier": 0.8, "city_wall": 2.5, "railing": 1.0}
FURNITURE = [  # (tag, value) -> kind
    (("amenity", "bench"), "bench"), (("leisure", "picnic_table"), "picnic"), (("amenity", "waste_basket"), "bin"),
    (("amenity", "waste_disposal"), "bin"), (("amenity", "bicycle_parking"), "bike"), (("highway", "bus_stop"), "bus_stop"),
    (("amenity", "shelter"), "shelter"), (("tourism", "artwork"), "artwork"), (("emergency", "life_ring"), "life_ring"),
    (("amenity", "post_box"), "post_box"), (("amenity", "recycling"), "recycling"), (("amenity", "fountain"), "fountain"),
    (("man_made", "flagpole"), "flagpole"), (("barrier", "bollard"), "bollard"), (("highway", "traffic_signals"), "signal"),
    (("amenity", "grit_bin"), "grit_bin"), (("amenity", "parcel_locker"), "locker"), (("amenity", "vending_machine"), "locker"),
    (("amenity", "toilets"), "toilets"), (("amenity", "drinking_water"), "tap"), (("man_made", "water_tap"), "tap"),
    (("amenity", "bbq"), "bbq"), (("leisure", "firepit"), "bbq"), (("leisure", "fitness_station"), "fitness"),
    (("tourism", "information"), "info"), (("amenity", "lounger"), "lounger"), (("highway", "street_lamp"), "lamp"),
    (("amenity", "charging_station"), "charger"), (("amenity", "ticket_validator"), "info")]


def _hex(v, fallback):
    v = (v or "").strip().lower()
    if v.startswith("#") and len(v) in (4, 7):
        return v if len(v) == 7 else "#" + "".join(c * 2 for c in v[1:])
    return CSS.get(v.replace(" ", "").replace("_", ""), fallback)


def _mix(a, b, t):
    """a toward b by t (0..1): mapped colours are softened toward the model's light massing."""
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(pa, pb))


def _num(v):
    try:
        return float(str(v).replace(",", ".").split()[0])
    except (TypeError, ValueError, IndexError):
        return None


def _heights(t, kind):
    """(bottom, top, estimated?) of a building or building:part, metres above ground."""
    z0 = _num(t.get("min_height"))
    if z0 is None and _num(t.get("building:min_level")) is not None:
        z0 = _num(t.get("building:min_level")) * 3.1
    h = _num(t.get("height")) or _num(t.get("building:height"))
    est = False
    if h is None:
        lv = _num(t.get("building:levels"))
        if lv is not None:
            h = lv * 3.1 + (_num(t.get("roof:levels")) or 0) * 2.2 + (0.6 if lv else 0)
        else:
            h, est = DEFAULT_H.get(kind, 12.0), True
    return round(z0 or 0.0, 1), round(max(h, (z0 or 0) + 1.0), 1), est


def _roof(t, poly, top, explicit):
    """A gabled or hipped roof on a near-rectangular footprint: rect corners (long side first), roof height, and
    the wall top under it. None when the shape is flat, unmapped, or the footprint isn't close to a rectangle."""
    shape = PITCHED.get(t.get("roof:shape", ""))
    if not shape or poly.geom_type != "Polygon" or poly.area > 4000:
        return None
    rect = poly.minimum_rotated_rectangle
    if rect.area <= 0 or poly.area / rect.area < 0.8:
        return None
    c = list(rect.exterior.coords)[:4]
    l01 = math.dist(c[0], c[1])
    l12 = math.dist(c[1], c[2])
    if l12 > l01:                                   # put the long side first
        c = c[1:] + c[:1]
        l01, l12 = l12, l01
    rh = _num(t.get("roof:height")) or min(max(0.42 * l12, 1.2), 5.5)
    if explicit:                                    # a mapped height is the ridge: the walls stop below it
        walls = max(top - rh, 2.2)
        rh = top - walls
    else:
        walls = top
    return {"shape": shape, "rect": [[round(x, 2), round(y, 2)] for x, y in c], "rh": round(rh, 2)}, round(walls, 1)


def detail(out, nodes, ways, rels, xy, study, roads, waters, path_polys, have, free):
    from shapely.strtree import STRtree

    # ---- buildings, split into building:parts where mapped
    def element_polys():
        for w in ways.values():
            t = w.get("tags", {})
            if "building" in t or "building:part" in t:
                p = poly_of(way_pts(w, xy))
                if p is not None:
                    yield t, p
        for r in rels.values():
            t = r.get("tags", {})
            if ("building" in t or "building:part" in t) and t.get("type") == "multipolygon":
                g = multipolygon(r, ways, xy)
                if g is not None and not g.is_empty:
                    yield t, g.buffer(0)

    blds, parts = [], []
    for t, p in element_polys():
        if not p.intersects(CIRCLE):
            continue
        if "building:part" in t and "building" not in t:
            parts.append((t, p))
        elif t.get("building") not in ("no", "construction", "proposed", "demolished"):
            blds.append((t, p))
    part_tree = STRtree([p for _, p in parts]) if parts else None
    used = set()

    def emit(t, poly, kind, base_t=None):
        if poly.is_empty or poly.area < 2.0:
            return
        if poly.intersection(study).area > 0.3 * poly.area:      # the 13 study buildings are drawn by the explorer
            return
        z0, top, est = _heights(t, kind)
        if base_t is not None and est:                           # a part without heights takes the building's
            z0, top, est = _heights(base_t, kind)[0], _heights(base_t, kind)[1], _heights(base_t, kind)[2]
        if kind == "roof":                                        # a canopy: a thin slab on posts left out
            z0 = max(z0, top - 0.4)
        explicit = (_num(t.get("height")) or _num(t.get("building:height"))) is not None
        wall = _hex(t.get("building:colour"), None)
        wall = _mix(wall, "#e8e4dc", 0.45) if wall else WALL.get(kind, "#e4e1da")
        roof = None
        clipped = poly.intersection(CIRCLE)
        rr = _roof(t, poly, top, explicit) if clipped.area > 0.98 * poly.area and z0 < 0.5 else None
        if rr:
            roof, top = rr
        rc = _hex(t.get("roof:colour"), None)
        rc = _mix(rc, "#d8d4ca", 0.2) if rc else ("#7a5e50" if roof and kind in ("house", "detached", "allotment_house", "shed")
                                                    else "#6f7275" if roof else _mix(wall, "#8f8c86", 0.22))
        e = {"rings": rings_of(clipped), "z0": z0, "h": top, "c": wall, "rc": rc, "kind": kind}
        if roof:
            e["roof"] = roof
        if est:
            e["est"] = 1
        out["massing"].append(e)

    for t, p in blds:
        kind = t.get("building", "yes")
        if kind == "yes":
            kind = t.get("building:use", "yes")
        mine = []
        if part_tree is not None:
            for i in part_tree.query(p):
                q = parts[int(i)][1]
                if p.buffer(0.5).contains(q.representative_point()):
                    mine.append(int(i))
        if mine:
            u = unary_union([parts[i][1] for i in mine])
            for i in mine:
                used.add(i)
                pt, pp = parts[i]
                pk = pt.get("building:part", "yes")
                emit(pt, pp, kind if pk in ("yes", "") else pk, base_t=t)
            rest = p.difference(u)
            if rest.area > 0.1 * p.area:
                emit(t, rest.buffer(-0.05).buffer(0.05), kind)
        else:
            emit(t, p, kind)
    for i, (t, p) in enumerate(parts):          # parts mapped without an outline around them
        if i not in used:
            emit(t, p, t.get("building:part", "yes"))

    # ---- lines: barriers, centre markings; areas: parking, platforms
    lines_of = lambda g: [[[round(x, 2), round(y, 2)] for x, y in l.coords]
                          for l in (g.geoms if hasattr(g, "geoms") else [g]) if l.geom_type == "LineString" and len(l.coords) > 1]
    barriers = {}
    centre = {}
    road_lines = []
    for w in ways.values():
        t = w.get("tags", {})
        pts = way_pts(w, xy)
        if len(pts) < 2:
            continue
        b = t.get("barrier")
        if b in BARRIER:
            ln = LineString(pts).intersection(CIRCLE)
            if not ln.is_empty:
                h = round(_num(t.get("height")) or BARRIER[b], 1)
                barriers.setdefault((b, h), []).extend(lines_of(ln))
            continue
        tunnel = t.get("tunnel") in ("yes", "building_passage") or str(t.get("layer", "0")).startswith("-")
        hw = t.get("highway")
        if hw in ROAD_W and not tunnel and t.get("area") != "yes":
            layer = max(0, int(_num(t.get("layer")) or 0))
            z = 5.5 * layer if t.get("bridge") else 0.0
            road_lines.append((LineString(pts), hw, z, w))
            lanes = _num(t.get("lanes"))
            if hw in ("primary", "secondary", "tertiary", "trunk") and t.get("oneway") not in ("yes", "-1") \
                    and (lanes is None or lanes >= 2) and t.get("junction") != "roundabout":
                ln = LineString(pts).intersection(CIRCLE)
                if not ln.is_empty:
                    centre.setdefault(z, []).extend(lines_of(ln))
        if t.get("amenity") == "parking" and t.get("parking", "surface") in ("surface", "lane") and poly_of(pts):
            g = poly_of(pts).intersection(CIRCLE).difference(study)
            out["parking"].append({"rings": rings_of(g)})
        if (t.get("railway") == "platform" or t.get("public_transport") == "platform") and not tunnel:
            g = poly_of(pts) or LineString(pts).buffer(1.6, cap_style=2)
            layer = max(0, int(_num(t.get("layer")) or 0))
            out["platforms"].append({"rings": rings_of(g.intersection(CIRCLE)), "z": 5.5 * layer if t.get("bridge") else 0.0})
        if t.get("natural") == "tree_row":
            ln = LineString(pts)
            for k in range(int(ln.length // 8) + 1):
                q = ln.interpolate(min(k * 8 + 2, ln.length))
                if CIRCLE.contains(q) and free(q, 4.0):
                    have.append(q)
                    out["trees"].append({"p": [round(q.x, 2), round(q.y, 2)], "h": round(random.uniform(9, 14), 1),
                                         "leaf": t.get("leaf_type", "broadleaved"), "src": "osm tree_row",
                                         "species": t.get("species") or t.get("genus") or ""})
    out["barriers"] = [{"kind": k, "h": h, "lines": ls} for (k, h), ls in sorted(barriers.items())]
    out["markings"] = [{"kind": "centre", "z": z, "lines": ls} for z, ls in centre.items()]

    # ---- point furniture, each turned to the nearest path or street
    guide = [LineString(pts) for w in ways.values()
             if w.get("tags", {}).get("highway") and len(pts := way_pts(w, xy)) >= 2
             and not w["tags"].get("tunnel")]
    gtree = STRtree(guide)

    def facing(p):
        i = gtree.nearest(p)
        ln = guide[int(i)]
        if ln.distance(p) > 25:
            return 0.0
        d = ln.project(p)
        a, b = ln.interpolate(max(d - 1, 0)), ln.interpolate(min(d + 1, ln.length))
        return round(math.degrees(math.atan2(b.y - a.y, b.x - a.x)), 1)

    furn = {}
    for nid, n in nodes.items():
        t = n.get("tags")
        if not t:
            continue
        p = Point(xy[nid])
        if not CIRCLE.contains(p) or study.contains(p):
            continue
        for (k, v), kind in FURNITURE:
            if t.get(k) == v:
                if kind == "bus_stop" and t.get("shelter") == "yes":
                    kind = "shelter"
                furn.setdefault(kind, []).append([round(p.x, 2), round(p.y, 2), facing(p)])
                break
    out["furniture"] = furn

    # ---- zebra crossings on the street they cross
    rtree = STRtree([r[0] for r in road_lines]) if road_lines else None
    for nid, n in nodes.items():
        t = n.get("tags", {})
        if t.get("highway") != "crossing" and t.get("railway") != "crossing":
            pass
        if t.get("highway") != "crossing":
            continue
        marked = t.get("crossing") in ("zebra", "marked", "uncontrolled", "traffic_signals") or \
            t.get("crossing_ref") == "zebra" or t.get("crossing:markings") not in (None, "no")
        p = Point(xy[nid])
        if not marked or not CIRCLE.contains(p) or rtree is None:
            continue
        i = int(rtree.nearest(p))
        ln, hw, z, w = road_lines[i]
        if ln.distance(p) > 1.0:
            continue
        d = ln.project(p)
        a, b = ln.interpolate(max(d - 1, 0)), ln.interpolate(min(d + 1, ln.length))
        out["crossings"].append([round(p.x, 2), round(p.y, 2), round(math.degrees(math.atan2(b.y - a.y, b.x - a.x)), 1),
                                 ROAD_W[hw], z])

    # ---- sparse trees on open park lawns (estimated)
    path_u = unary_union([g for g, _ in path_polys]) if path_polys else Polygon()
    blocked = unary_union([path_u] + [Polygon(r[0], r[1:]) for g in out["greens"] if g["kind"] in ("playground", "pitch")
                                      for r in g["rings"]] + [Polygon(r[0], r[1:]) for g in out["plazas"] for r in g["rings"]])
    for gr in out["greens"]:
        if gr["kind"] != "park":
            continue
        for rings in gr["rings"]:
            poly = Polygon(rings[0], rings[1:]).difference(blocked)
            n = int(poly.area / 450)
            x0, y0, x1, y1 = poly.bounds
            tries = 0
            while n > 0 and tries < n * 15:
                tries += 1
                p = Point(random.uniform(x0, x1), random.uniform(y0, y1))
                if poly.contains(p) and free(p, 7.0) and blocked.distance(p) > 2.5:
                    have.append(p)
                    out["trees"].append({"p": [round(p.x, 2), round(p.y, 2)], "h": round(random.uniform(8, 15), 1),
                                         "leaf": "broadleaved", "src": "estimated (park)"})
                    n -= 1


if __name__ == "__main__":
    main()
