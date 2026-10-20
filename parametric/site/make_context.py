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
CLIP = box(-360, -480, 420, 360)
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
           "clip": [-360, -480, 420, 360], "roads": [], "paths": [], "greens": [], "water": [], "piers": [],
           "rail": [], "trees": [], "lamps": [], "benches": [], "plazas": [], "buildings": []}
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
            g = g.intersection(CLIP)
            if not g.is_empty:
                (road_polys if z == 0 else []).append(g)
                if z:
                    out["roads"].append({"kind": hw, "z": z, "rings": rings_of(g), "name": t.get("name", "")})
            continue
        if hw in PATH_W:
            if t.get("area") == "yes" and poly_of(pts):
                g = poly_of(pts)
                out["plazas"].append({"kind": "plaza", "surface": t.get("surface", "paving_stones"), "rings": rings_of(g.intersection(CLIP))})
                continue
            g = LineString(pts).buffer(PATH_W[hw] / 2, cap_style=2, join_style=2, mitre_limit=3).intersection(CLIP)
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
            g = g.intersection(CLIP)
            if not g.is_empty:
                out["piers"].append({"rings": rings_of(g), "surface": t.get("surface", "wood")})
            continue
        if t.get("railway") in ("rail", "light_rail", "tram") and not t.get("tunnel"):
            ln = LineString(pts).intersection(CLIP)
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
                    g = p.intersection(CLIP)
                    if not g.is_empty:
                        out["greens"].append({"kind": kind, "rings": rings_of(g), "name": t.get("name", "")})
                break
        if t.get("natural") == "water" and poly_of(pts):
            out["water"].append({"rings": rings_of(poly_of(pts).intersection(CLIP))})

    for r in rels.values():
        t = r.get("tags", {})
        g = None
        for k in ("landuse", "natural", "leisure"):
            kind = GREEN.get((k, t.get(k)))
            if kind:
                g = multipolygon(r, ways, xy)
                if g is not None and not g.intersection(CLIP).is_empty:
                    out["greens"].append({"kind": kind, "rings": rings_of(g.intersection(CLIP)), "name": t.get("name", "")})
                break
        if t.get("man_made") == "pier":
            g = multipolygon(r, ways, xy)
            if g is not None:
                out["piers"].append({"rings": rings_of(g.intersection(CLIP)), "surface": "wood"})

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
        pieces = list(polygonize(unary_union([CLIP.exterior] + [s.intersection(CLIP.buffer(1)) for s in shore])))
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
        if not CLIP.contains(Point(p)):
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
        edge = waters.boundary.intersection(CLIP.buffer(-2))
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

    for k in ("greens", "water", "piers", "plazas", "buildings"):
        out[k] = [g for g in out[k] if g["rings"]]
    path = os.path.join(HERE, "marievik_context.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", path, {k: len(v) for k, v in out.items() if isinstance(v, list)},
          "trees osm/estimated: %d/%d" % (sum(t["src"] == "osm" for t in out["trees"]),
                                          sum(t["src"] != "osm" for t in out["trees"])))


if __name__ == "__main__":
    main()
