"""
mvk.layout - rule-based, use-dependent floor layouts for building massing.

Pure Python + shapely (no Rhino dependency) so it runs in Grasshopper (Rhino 8, CPython 3.9)
and in any normal Python for testing / batch runs.

Concepts
--------
footprint   closed polygon in plan (metres), optional holes (courtyards)
use         key in use_profiles.json (office_open, office_cellular, residential, hotel, school, retail)
wall        straight segment with id like "F02-P-014"
            category letters: E exterior, C corridor, S support/atrium edge, K core,
                              P partition, I interior (inside a unit), A added by user
opening     door or window hosted by a wall, position s0..s1 along the wall (m from wall start a)
overrides   dict keyed by "*" (all floors) or "F02"; see README.md
"""
import csv
import json
import math
import os

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, polylabel, unary_union

try:
    from . import pricing
except ImportError:  # loaded outside the package
    import pricing

HERE = os.path.dirname(os.path.abspath(__file__))
CATS = {"E": "exterior", "C": "corridor", "S": "support", "K": "core",
        "P": "partition", "I": "interior", "A": "added"}
TYPE_KEY = {"E": "ext_wall", "C": "corridor", "S": "support", "K": "core",
            "P": "partition", "I": "interior", "A": "interior"}


# --------------------------------------------------------------------------- data
def load_profiles(path=None):
    with open(path or os.path.join(HERE, "use_profiles.json"), encoding="utf-8") as f:
        d = json.load(f)
    return {k: v for k, v in d.items() if not k.startswith("_")}


def load_db(path=None):
    db = {}
    with open(path or os.path.join(HERE, "components_db.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            for k in ("thickness_m", "width_m", "height_m", "cost_sek_per_unit", "gwp_kgco2e_per_unit", "u_value"):
                try:
                    r[k] = float(r[k])
                except (TypeError, ValueError):
                    r[k] = None
            db[r["id"]] = r
    return db


# --------------------------------------------------------------------------- geometry helpers
def _polys(g, min_area=0.5):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g] if g.area >= min_area else []
    out = []
    for x in getattr(g, "geoms", []):
        out += _polys(x, min_area)
    return out


def _lines(g, min_len=0.05):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g] if g.length >= min_len else []
    out = []
    for x in getattr(g, "geoms", []):
        out += _lines(x, min_len)
    return out


def _rings(g):
    out = []
    for p in _polys(g):
        p = orient(p, 1.0)          # interior always on the left
        out.append(list(p.exterior.coords))
        out += [list(r.coords) for r in p.interiors]
    return out


def _segs(ring):
    return [(ring[i], ring[i + 1]) for i in range(len(ring) - 1)
            if math.dist(ring[i], ring[i + 1]) > 1e-6]


def _mbuf(g, d):
    return g.buffer(d, join_style=2, mitre_limit=5.0)


def _unit(a, b):
    L = math.dist(a, b)
    return ((b[0] - a[0]) / L, (b[1] - a[1]) / L), L


def _add(p, v, s=1.0):
    return (p[0] + v[0] * s, p[1] + v[1] * s)


def _main_axis(poly):
    c = list(poly.minimum_rotated_rectangle.exterior.coords)
    e = max(_segs(c), key=lambda s: math.dist(*s))
    (ux, uy), _ = _unit(*e)
    if ux < 0 or (abs(ux) < 1e-9 and uy < 0):
        ux, uy = -ux, -uy
    return (ux, uy)


def _rect(center, u, along, across):
    v = (-u[1], u[0])
    pts = []
    for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pts.append((center[0] + u[0] * sa * along / 2 + v[0] * sb * across / 2,
                    center[1] + u[1] * sa * along / 2 + v[1] * sb * across / 2))
    return Polygon(pts)


def _split_segments(rings, cuts, tol=0.05, min_len=0.3):
    """Split ring edges at cut points lying within tol of an edge."""
    out = []
    for ring in rings:
        for a, b in _segs(ring):
            u, L = _unit(a, b)
            ss = [0.0, L]
            for p in cuts:
                s = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]
                d = abs((p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0])
                if d <= tol and 0.2 < s < L - 0.2:
                    ss.append(s)
            ss = sorted(ss)
            for s0, s1 in zip(ss[:-1], ss[1:]):
                if s1 - s0 >= min_len:
                    out.append((_add(a, u, s0), _add(a, u, s1)))
    return out


def _clip_out(seg, geom):
    if geom is None or geom.is_empty:
        return [seg]
    return [tuple(map(tuple, l.coords))[::len(l.coords) - 1] for l in _lines(LineString(seg).difference(geom), 0.3)]


def _pick_near(g, p, tol=0.05):
    for l in _lines(g):
        if l.distance(Point(p)) < tol:
            return l
    return None


# --------------------------------------------------------------------------- floor model
class Floor(object):
    def __init__(self, index, z, height, use, prof, db, footprint):
        self.index, self.z, self.height, self.use, self.prof, self.db = index, z, height, use, prof, db
        self.footprint = footprint
        self.walls, self.openings, self.zones = [], [], []   # zones: (name, polygon)
        self.voids = []                                       # slab holes (atria)
        self.slab_type = prof["types"]["slab"]
        self.slab_t = db[self.slab_type]["thickness_m"] or 0.25
        self._n = {}

    # ids
    def _id(self, cat):
        self._n[cat] = self._n.get(cat, 0) + 1
        return "F%02d-%s-%03d" % (self.index, cat, self._n[cat])

    def wall(self, cat, a, b, axis=None, wtype=None):
        wtype = wtype or self.prof["types"][TYPE_KEY[cat]]
        w = {"id": self._id(cat), "cat": cat, "type": wtype, "a": tuple(a), "b": tuple(b),
             "axis": axis or (tuple(a), tuple(b))}
        self.walls.append(w)
        return w

    def opening(self, kind, wall, s_center, width, z0, z1, otype):
        L = math.dist(wall["a"], wall["b"])
        width = min(width, L - 0.1)
        s0 = max(0.05, min(L - width - 0.05, s_center - width / 2))
        o = {"id": self._id("D" if kind == "door" else "W"), "kind": kind, "wall": wall["id"], "type": otype,
             "s0": round(s0, 3), "s1": round(s0 + width, 3), "z0": z0, "z1": z1}
        self.openings.append(o)
        return o

    def wall_by_id(self, wid):
        for w in self.walls:
            if w["id"] == wid:
                return w
        return None

    def thick(self, w):
        return self.db[w["type"]]["thickness_m"] or 0.1

    @property
    def wall_h(self):
        return self.height - self.slab_t


# --------------------------------------------------------------------------- generator
def layout_floor(footprint, use, profiles, db, index=0, z=0.0, height=3.5, ground=False):
    prof = profiles[use]
    T = prof["types"]
    P0 = orient(footprint, 1.0)
    F = Floor(index, z, height, use, prof, db, P0)
    u = _main_axis(P0)
    t_ext = db[T["ext_wall"]]["thickness_m"]
    t_cor = db[T["corridor"]]["thickness_m"]
    t_par = db[T["partition"]]["thickness_m"]
    pole = polylabel(P0, 0.2)
    depth = 2 * P0.boundary.distance(pole)
    scheme = prof["scheme"]
    corridor = inner = core = support = None
    rd = prof.get("room_depth", 0)
    c = prof.get("corridor", 0)

    # ---- zoning
    if scheme == "corridor":
        # Room depth: as in the profile, reduced until every wing of the footprint still reaches
        # the corridor (handles slabs, L- and U-shapes, notches). Corridor = footprint offset by rd;
        # wherever that offset is wider than a corridor, the excess becomes the inner zone.
        rd_try = rd
        P1 = None
        while rd_try >= 2.8:
            cand = _mbuf(P0, -rd_try)
            if not cand.is_empty and _mbuf(cand, -c / 2.0 + 0.05).area > 0 and \
                    _mbuf(cand, rd_try + 0.05).intersection(P0).area >= 0.9 * P0.area:
                P1 = cand
                break
            rd_try -= 0.25
        if P1 is None:
            scheme = "open"
        else:
            rd = rd_try
            P2 = _mbuf(P1, -c)
            P2 = unary_union([q for q in _polys(P2, 30.0) if _mbuf(q, -1.5).area > 0]) if not P2.is_empty else P2
            if P2.is_empty:
                corridor, inner = P1, None
            else:
                corridor, inner = P1.difference(P2), P2
            if inner is not None:
                big = max(_polys(inner), key=lambda q: q.area)
                ctr = polylabel(big, 0.2)
                core = _rect((ctr.x, ctr.y), u, prof["core"]["length"], prof["core"]["width"]).intersection(_mbuf(big, -0.5))
            else:
                # core on the room side of the corridor, next to its middle
                q = polylabel(_polys(P1)[0] if P1.geom_type != "Polygon" else P1, 0.2)
                ring_zone = P0.difference(P1)
                near = ring_zone.boundary.interpolate(ring_zone.boundary.project(q))
                core = _rect((near.x, near.y), u, prof["core"]["length"], prof["core"]["width"]).intersection(ring_zone)
                pieces = _polys(core, 5.0)
                core = max(pieces, key=lambda p: p.area) if pieces else None
    if scheme == "open":
        core = _rect((pole.x, pole.y), u, prof["core"]["length"], prof["core"]["width"]).intersection(_mbuf(P0, -4.0))
        sd = prof.get("support_depth", 3.0)
        support = _mbuf(core, sd).intersection(_mbuf(P0, -5.0)).difference(core)
    core = _polys(core)[0] if _polys(core) else None

    # ---- room zone & partitions
    if scheme == "corridor":
        Rz = P0.difference(corridor.union(inner) if inner is not None else corridor)
    else:
        Rz = P0.difference(support) if support is not None else P0
    if core is not None:
        Rz = Rz.difference(core)

    parts, fac_pts, end_pts = [], [], []
    if scheme == "corridor":
        w = prof["unit_width"]
        for ring in _rings(P0):
            for a, b in _segs(ring):
                d, L = _unit(a, b)
                n = (-d[1], d[0])
                usable = L - 2 * rd
                k = int(usable // w) if usable > 0 else 0
                rem = usable - k * w
                while k >= 1 and rem / 2 < 1.3:
                    k -= 1
                    rem += w
                if k < 1:
                    continue
                for j in range(k + 1):
                    p = _add(a, d, rd + rem / 2 + j * w)
                    line = LineString([_add(p, n, -0.01), _add(p, n, rd + 0.6)])
                    seg = _pick_near(line.intersection(Rz), p)
                    if seg is None or seg.length < 1.5:
                        continue
                    q = tuple(seg.coords[-1])
                    parts.append((p, q, n))
                    fac_pts.append(p)
                    end_pts.append(q)

    # ---- zones (for room naming)
    room_name = prof["room_name"]
    room_polys = [r for r in polygonize(unary_union([Rz.boundary] + [LineString([_add(p, n, -0.05), _add(q, n, 0.05)]) for p, q, n in parts]))
                  if Rz.contains(r.representative_point())]
    for r in room_polys:
        F.zones.append((room_name, r))
    if corridor is not None:
        for p in _polys(corridor.difference(core) if core is not None else corridor):
            F.zones.append(("Corridor", p))
    if core is not None:
        F.zones.append(("Core", core))
    if inner is not None:
        inner_rest = inner.difference(core) if core is not None else inner
        if prof.get("inner_zone") == "atrium":
            gallery = _mbuf(core, c) if core is not None else None
            atria = _polys(inner_rest.difference(gallery) if gallery is not None else inner_rest, 20.0)
            for a_ in atria:
                F.zones.append(("Atrium (void)", a_))
                F.voids.append(a_)
            if gallery is not None:
                for g_ in _polys(inner_rest.intersection(gallery)):
                    F.zones.append(("Corridor", g_))
        else:
            for s_ in _polys(inner_rest):
                F.zones.append(("Support / WC", s_))
    if support is not None:
        for s_ in _polys(support):
            F.zones.append(("Support / meeting", s_))

    # ---- walls
    for a, b in _split_segments(_rings(_mbuf(P0, -t_ext / 2)), fac_pts, tol=t_ext / 2 + 0.05):
        F.wall("E", a, b)
    if corridor is not None:
        for a, b in _split_segments(_rings(_mbuf(P0, -rd)), end_pts):
            for s in _clip_out((a, b), core):
                F.wall("C", s[0], s[1])
    edge_geoms = []
    if inner is not None:
        edge_geoms = F.voids if prof.get("inner_zone") == "atrium" else _polys(inner.difference(core) if core is not None else inner)
    if support is not None:
        edge_geoms = _polys(support)
    for g in edge_geoms:
        for a, b in _split_segments(_rings(g), []):
            for s in _clip_out((a, b), core):
                F.wall("S", s[0], s[1])
    if core is not None:
        t_core = db[T["core"]]["thickness_m"]
        for (a, b), (ax, bx) in zip(_split_segments(_rings(_mbuf(core, -t_core / 2)), []), _split_segments(_rings(core), [])):
            F.wall("K", a, b, axis=(ax, bx))
    for p, q, n in parts:
        a = _add(p, n, t_ext)
        b = _add(q, n, -t_cor / 2)
        F.wall("P", a, b, axis=(_add(p, n, -0.05), _add(q, n, 0.05)))

    # ---- doors
    dw = lambda k: db[T[k]]["width_m"] or 0.9
    dh = lambda k: db[T[k]]["height_m"] or 2.1
    host_cats = ("C",) if scheme == "corridor" else ()
    for r in room_polys:
        best, best_ov = None, 0.0
        for w in F.walls:
            if w["cat"] not in host_cats:
                continue
            ov = LineString([w["a"], w["b"]]).intersection(r.buffer(0.05)).length
            if ov > best_ov:
                best, best_ov = w, ov
        if best is None or best_ov < dw("room_door") + 0.3:
            continue
        uu, L = _unit(best["a"], best["b"])
        seg_in = LineString([best["a"], best["b"]]).intersection(r.buffer(0.05))
        ss = sorted((x[0] - best["a"][0]) * uu[0] + (x[1] - best["a"][1]) * uu[1] for l in _lines(seg_in) for x in l.coords)
        s0, s1 = ss[0], ss[-1]
        sc = s0 + t_par / 2 + 0.15 + dw("room_door") / 2
        F.opening("door", best, sc, dw("room_door"), 0.0, dh("room_door"), T["room_door"])
        _interiors(F, r, best, s0, s1, sc, prof, db)
    if core is not None:
        ref = corridor if corridor is not None else (support if support is not None else Rz)
        ks = [w for w in F.walls if w["cat"] == "K"]
        if ks:
            k = min(ks, key=lambda w: LineString(w["axis"]).centroid.distance(ref) - 0.01 * math.dist(w["a"], w["b"]))
            F.opening("door", k, math.dist(k["a"], k["b"]) / 2, dw("core_door"), 0.0, dh("core_door"), T["core_door"])
    if support is not None or (inner is not None and prof.get("inner_zone") != "atrium"):
        ss_ = sorted([w for w in F.walls if w["cat"] == "S"], key=lambda w: -math.dist(w["a"], w["b"]))
        for w in ss_[:2 if support is not None else 1]:
            F.opening("door", w, math.dist(w["a"], w["b"]) / 2, dw("interior_door"), 0.0, dh("interior_door"), T["interior_door"])
    if ground:
        es = sorted([w for w in F.walls if w["cat"] == "E"], key=lambda w: -math.dist(w["a"], w["b"]))
        if es:
            F.opening("door", es[0], math.dist(es[0]["a"], es[0]["b"]) / 2, dw("entrance"), 0.0, dh("entrance"), T["entrance"])

    # ---- windows
    for w in F.walls:
        if w["cat"] == "E":
            place_windows(F, w)
    return F


def _interiors(F, room, host, s0, s1, s_door, prof, db):
    """Unit interiors: apartment split wall + bathroom (residential), bathroom pod (hotel)."""
    bath = prof.get("bathroom") or (prof.get("subdivide") or {}).get("bath")
    if not bath:
        return
    T = prof["types"]
    u, L = _unit(host["a"], host["b"])
    n = (-u[1], u[0])
    mid = _add(host["a"], u, (s0 + s1) / 2)
    if not room.contains(Point(_add(mid, n, 0.5))):
        n = (-n[0], -n[1])
    if s1 - s0 < bath + 1.6:
        return
    # bathroom at the far end of the room frontage (door is near s0)
    e = _add(host["a"], u, s1)
    c0 = _add(host["a"], u, s1 - bath)
    w1 = F.wall("I", c0, _add(c0, n, bath), wtype=T["interior"])
    F.wall("I", _add(c0, n, bath), _add(e, n, bath), wtype=T["interior"],
           axis=(_add(c0, n, bath), _add(_add(e, n, bath), u, 0.3)))
    F.opening("door", w1, bath / 2 + 0.1, db[T["interior_door"]]["width_m"] or 0.8, 0.0, 2.1, T["interior_door"])
    F.zones.append(("Bathroom", Polygon([c0, e, _add(e, n, bath), _add(c0, n, bath)])))
    sub = prof.get("subdivide")
    if sub:
        # bedroom wall perpendicular to the facade, 'bed_width' from the room's facade corner
        far = [w for w in F.walls if w["cat"] == "E" and LineString([w["a"], w["b"]]).intersection(room.buffer(0.6)).length > 1.0]
        if not far:
            return
        fw = max(far, key=lambda w: LineString([w["a"], w["b"]]).intersection(room.buffer(0.6)).length)
        fu, _ = _unit(fw["a"], fw["b"])
        fn = (-fu[1], fu[0])
        span = LineString([fw["a"], fw["b"]]).intersection(room.buffer(0.6))
        ss = sorted((x[0] - fw["a"][0]) * fu[0] + (x[1] - fw["a"][1]) * fu[1] for l in _lines(span) for x in l.coords)
        bw = sub.get("bed_width", 3.0)
        if ss[-1] - ss[0] < bw + 2.5:
            return
        p = _add(fw["a"], fu, ss[0] + bw)
        seg = _pick_near(LineString([p, _add(p, fn, sub["depth"])]).intersection(room), p, tol=0.6)
        if seg is None:
            return
        a, b = tuple(seg.coords[0]), tuple(seg.coords[-1])
        iw = F.wall("I", a, b, wtype=T["interior"], axis=(_add(a, fn, -0.3), b))
        L = math.dist(a, b)
        F.opening("door", iw, L - 0.7, db[T["interior_door"]]["width_m"] or 0.9, 0.0, 2.1, T["interior_door"])
        c0 = _add(fw["a"], fu, ss[0])
        F.zones.append(("Bedroom", Polygon([c0, p, _add(p, fn, sub["depth"]), _add(c0, fn, sub["depth"])])))


def place_windows(F, w, wwr=None, module=None, wtype=None, sill=None, head=None, new=False):
    prof = F.prof
    wwr = prof["wwr"] if wwr is None else wwr
    module = module or prof["window_module"]
    sill = prof["sill"] if sill is None else sill
    head = min(prof["head"] if head is None else head, F.wall_h - 0.05)
    wtype = wtype or prof["types"]["window"]
    F.openings = [o for o in F.openings if not (o["wall"] == w["id"] and o["kind"] == "window")]
    L = math.dist(w["a"], w["b"])
    wh = head - sill
    if wwr <= 0 or wh <= 0.3:
        return
    ww = min(module - 0.25, wwr * module * F.height / wh)
    if prof.get("window_kind") == "ribbon":      # continuous band: only the mullions remain
        ww = module - 0.08
    n = int((L - 0.3) // module)
    doors = [(o["s0"] - 0.2, o["s1"] + 0.2) for o in F.openings if o["wall"] == w["id"] and o["kind"] == "door"]
    start = (L - n * module) / 2
    for i in range(n):
        sc = start + module * (i + 0.5)
        a0, a1 = sc - ww / 2, sc + ww / 2
        if any(a0 < d1 and a1 > d0 for d0, d1 in doors):
            continue
        o = F.opening("window", w, sc, ww, sill, head, wtype)
        o["new"] = new


# --------------------------------------------------------------------------- overrides
def _ov_for(overrides, index):
    ov = {}
    for key in ("*", "F%02d" % index, str(index)):
        for k, v in (overrides or {}).get(key, {}).items():
            if isinstance(v, list):
                ov[k] = ov.get(k, []) + v
            elif isinstance(v, dict):
                ov.setdefault(k, {}).update(v)
            else:
                ov[k] = v
    return ov


def apply_overrides(F, overrides, added_lines=None):
    ov = _ov_for(overrides, F.index)
    T = F.prof["types"]
    # 1 wall types: key = wall id, category letter (E,C,S,K,P,I,A) or 'all'
    for key, t in ov.get("wall_types", {}).items():
        if t not in F.db:
            continue
        for w in F.walls:
            if key in (w["id"], w["cat"], CATS.get(w["cat"]), "all"):
                w["type"] = t
    # 2 remove walls
    rm = set(ov.get("remove_walls", []))
    F.walls = [w for w in F.walls if w["id"] not in rm]
    F.openings = [o for o in F.openings if o["wall"] not in rm]
    # 3 added walls: {"a":[x,y],"b":[x,y],"type":..} plus lines drawn in Rhino
    for aw in list(ov.get("add_walls", [])) + [{"a": a, "b": b} for a, b in (added_lines or [])]:
        a, b = tuple(aw["a"][:2]), tuple(aw["b"][:2])
        uu, L = _unit(a, b)
        F.wall("A", a, b, axis=(_add(a, uu, -0.3), _add(b, uu, 0.3)), wtype=aw.get("type", T["interior"]))
    # 4 doors
    for d in ov.get("doors", []):
        w = F.wall_by_id(d.get("wall", ""))
        if w is None:
            continue
        existing = [o for o in F.openings if o["wall"] == w["id"] and o["kind"] == "door"]
        if d.get("remove"):
            F.openings = [o for o in F.openings if o not in existing]
            continue
        dtype = d.get("type", existing[0]["type"] if existing else T["interior_door"])
        width = d.get("width", F.db[dtype]["width_m"] or 0.9)
        L = math.dist(w["a"], w["b"])
        sc = d["at"] if "at" in d else d.get("pos", 0.5) * L
        if existing and not d.get("add"):
            F.openings.remove(existing[0])
        F.opening("door", w, sc, width, 0.0, F.db[dtype]["height_m"] or 2.1, dtype)
        F.openings = [o for o in F.openings if not (o["wall"] == w["id"] and o["kind"] == "window"
                      and o["s0"] < sc + width / 2 + 0.1 and o["s1"] > sc - width / 2 - 0.1)]
    # 5 windows: {"wall": id | "all", "wwr":.., "type":.., "module":.., "sill":.., "head":.., "remove": true}
    for wd in ov.get("windows", []):
        targets = [w for w in F.walls if w["cat"] == "E"] if wd.get("wall") in ("all", "*") else \
                  [w for w in [F.wall_by_id(wd.get("wall", ""))] if w is not None]
        for w in targets:
            if wd.get("remove"):
                F.openings = [o for o in F.openings if not (o["wall"] == w["id"] and o["kind"] == "window")]
            else:
                place_windows(F, w, wd.get("wwr"), wd.get("module"), wd.get("type"), wd.get("sill"), wd.get("head"), new=True)


# --------------------------------------------------------------------------- rooms, pieces, quantities
def rooms(F):
    lines = [LineString(r) for r in _rings(F.footprint)]
    lines += [LineString(w["axis"]) for w in F.walls if w["cat"] != "E"]
    lines += [v.boundary for v in F.voids]
    # corridor outlines close small gaps left where corridor walls meet the core or a short wing
    lines += [z.boundary for name, z in F.zones if name == "Corridor"]
    out = []
    for i, p in enumerate(sorted(polygonize(unary_union(lines)), key=lambda p: (-p.centroid.y, p.centroid.x))):
        if not F.footprint.contains(p.representative_point()) or p.area < 0.5:
            continue
        hits = sorted(((p.intersection(zp).area, name) for name, zp in F.zones), reverse=True)
        name = hits[0][1] if hits and hits[0][0] > 0.2 * p.area else "Room"
        big = [h for h in hits if h[0] > 4.0 and h[1] == name]
        if len(big) > 1 and name not in ("Corridor", "Atrium (void)"):
            name += " (merged)"
        if F.use == "residential" and name.startswith("Apartment"):
            name = "Apartment %s" % ("1 RoK" if p.area < 40 else "2 RoK" if p.area < 60 else "3 RoK" if p.area < 80 else "4 RoK")
        out.append({"id": "F%02d-R-%03d" % (F.index, len(out) + 1), "name": name, "area": round(p.area, 1),
                    "poly": [tuple(c) for c in orient(p, 1.0).exterior.coords],
                    "label_pt": tuple(p.representative_point().coords[0])})
    return out


def wall_pieces(F, w):
    """Solid boxes (s0, s1, z0, z1) in wall-local coords, openings left out."""
    H = F.wall_h
    L = math.dist(w["a"], w["b"])
    ops = sorted([o for o in F.openings if o["wall"] == w["id"]], key=lambda o: o["s0"])
    out, s = [], 0.0
    for o in ops:
        if o["s0"] > s + 1e-3:
            out.append((s, o["s0"], 0.0, H))
        if o["z0"] > 1e-3:
            out.append((o["s0"], o["s1"], 0.0, o["z0"]))
        if o["z1"] < H - 1e-3:
            out.append((o["s0"], o["s1"], o["z1"], H))
        s = max(s, o["s1"])
    if s < L - 1e-3:
        out.append((s, L, 0.0, H))
    return out


RETAINED_CATS = ("E", "K")        # existing facade and core, in conversion mode
PARTITION_SYSTEMS = {               # one switch for every new wall that is not structure or facade
    "conventional": "IW_GYPSUM_STEEL_100",
    "demountable": "IW_DEMOUNT_SOLID_100",
    "glass": "IW_GLASS_PARTITION",
}
# Requirement-based systems: a family of builds from one supplier. Each new wall (P, C, I, A, and the
# support walls S, which carry requirements too) gets the cheapest build that meets its use profile's
# wall_requirements, or the best one when none does.
# Offered only when the catalogue has every build (supplier files are local, see pricing.load_catalogue).
PARTITION_FAMILIES = {
    "smartax": ["IW_SMARTAX_95_EI30", "IW_SMARTAX_95_EI60", "IW_SMARTAX_120_DBL", "IW_SMARTAX_120_DBL_WOOL",
                "IW_SMARTAX_185_TWIN"],
}
SYSTEM_CATS = ("P", "C", "I", "A")
FIRE_RANK = {"NONE": 0, "EI30": 1, "EI60": 2, "EI90": 3, "EI120": 4}


def performance(t, db, catalogue):
    """Catalogue performance of a components_db type, or None when it has no catalogue entry."""
    cid = (db.get(t) or {}).get("catalogue_id")
    c = (catalogue or {}).get(cid) if cid else None
    return c.get("performance", {}) if c else None


def _fire(f):
    return FIRE_RANK.get(str(f or "none").upper(), 0)


def _meets(perf, req):
    """(sound ok, fire ok) of a performance dict against a requirement {Rw_dB, fire}."""
    return ((perf.get("Rw_dB") or 0) >= (req.get("Rw_dB") or 0),
            _fire(perf.get("fire_class")) >= _fire(req.get("fire")))


def system_available(system, db, catalogue):
    if system in PARTITION_FAMILIES:
        return all((db.get(t) or {}).get("catalogue_id") in (catalogue or {}) for t in PARTITION_FAMILIES[system])
    return system in PARTITION_SYSTEMS


def pick_build(system, req, db, catalogue):
    """Cheapest build of a family that meets req (capex per m2), else the best-performing one."""
    builds = []
    for t in PARTITION_FAMILIES[system]:
        c = catalogue[db[t]["catalogue_id"]]
        perf = c.get("performance", {})
        builds.append((t, perf, c["cost_sek"]["material"] + c["cost_sek"]["labour_install"]))
    ok = [b for b in builds if all(_meets(b[1], req))]
    if ok:
        return min(ok, key=lambda b: b[2])[0]
    return max(builds, key=lambda b: ((b[1].get("Rw_dB") or 0), _fire(b[1].get("fire_class")), -b[2]))[0]


def check_requirements(floors, db, catalogue):
    """New walls against the use profiles' wall_requirements (indicative sound and fire), and stud heights."""
    out = {"checked_m2": 0.0, "unknown_m2": 0.0, "sound_below_m2": 0.0, "fire_below_m2": 0.0,
           "shortfalls": {}, "too_tall": {}}
    for F in floors:
        reqs = F.prof.get("wall_requirements") or {}
        for w in F.walls:
            if w["cat"] not in reqs:
                continue                                    # retained shell (E, K) or no requirement
            area = max(0.0, math.dist(w["a"], w["b"]) * F.wall_h - sum(
                (o["s1"] - o["s0"]) * (o["z1"] - o["z0"]) for o in F.openings if o["wall"] == w["id"]))
            perf = performance(w["type"], db, catalogue)
            if perf is None:
                out["unknown_m2"] += area
                continue
            out["checked_m2"] += area
            req = reqs[w["cat"]]
            sound, fire = _meets(perf, req)
            out["sound_below_m2"] += 0.0 if sound else area
            out["fire_below_m2"] += 0.0 if fire else area
            if not (sound and fire):
                k = "%s|%s|%s" % (F.use, w["cat"], w["type"])
                s = out["shortfalls"].setdefault(k, {
                    "use": F.use, "category": CATS[w["cat"]], "type": w["type"], "area_m2": 0.0,
                    "sound_ok": sound, "fire_ok": fire,
                    "required": "%s dB%s" % (req.get("Rw_dB") or 0, (" " + req["fire"]) if req.get("fire") else ""),
                    "has": "%s dB %s" % (perf.get("Rw_dB", "?"), perf.get("fire_class", "?"))})
                s["area_m2"] += area
            mh = perf.get("max_height_m")
            if mh and F.wall_h > mh + 1e-6:
                t = out["too_tall"].setdefault(w["type"], {"type": w["type"], "max_height_m": mh, "wall_h": 0.0,
                                                          "floors": []})
                t["wall_h"] = max(t["wall_h"], round(F.wall_h, 2))
                if F.index not in t["floors"]:
                    t["floors"].append(F.index)
    for k in ("checked_m2", "unknown_m2", "sound_below_m2", "fire_below_m2"):
        out[k] = round(out[k], 1)
    out["shortfalls"] = sorted(({**s, "area_m2": round(s["area_m2"], 1)} for s in out["shortfalls"].values()),
                               key=lambda s: -s["area_m2"])
    out["too_tall"] = list(out["too_tall"].values())
    return out


def quantities(F, catalogue=None, mode="conversion"):
    """One row per element, priced from the Marievik+ catalogue (see pricing.py)."""
    db, H, rows = F.db, F.wall_h, []
    catalogue = catalogue or {}
    conv = mode == "conversion"

    def row(eid, cat, t, qty, state):
        r = db.get(t, {})
        p = pricing.price(qty, t, db, catalogue, state)
        d = {"floor": F.index, "element": eid, "category": cat, "type": t, "state": state,
             "unit": r.get("unit", "m2"), "qty": round(qty, 2)}
        d.update({k: (round(v, 1) if isinstance(v, float) else v) for k, v in p.items()})
        d["cost_sek"], d["gwp_kgco2e"] = d["capex_sek"], d["upfront_kgco2e"]   # used by Grasshopper panels
        rows.append(d)

    for w in F.walls:
        gross = math.dist(w["a"], w["b"]) * H
        holes = sum((o["s1"] - o["s0"]) * (o["z1"] - o["z0"]) for o in F.openings if o["wall"] == w["id"])
        state = "retained" if conv and w["cat"] in RETAINED_CATS else "new"
        row(w["id"], "wall_" + CATS[w["cat"]], w["type"], max(0.0, gross - holes), state)
    for o in F.openings:
        q = 1 if db[o["type"]]["unit"] in ("pcs", "each") else (o["s1"] - o["s0"]) * (o["z1"] - o["z0"])
        state = "retained" if conv and o["kind"] == "window" and not o.get("new") else "new"
        row(o["id"], o["kind"], o["type"], q, state)
    void = sum(v.area for v in F.voids)
    row("F%02d-SLAB" % F.index, "slab", F.slab_type, F.footprint.area - void, "retained" if conv else "new")
    if void > 0 and conv:
        row("F%02d-SLAB-OPENING" % F.index, "slab_opening", F.slab_type, void, "unpriced")
    fin = F.prof.get("finishes") or {}
    fin_area = sum(r["area"] for r in F.rooms if not r["name"].startswith(("Core", "Atrium")))
    for kind in ("floor", "ceiling"):
        if fin.get(kind):
            row("F%02d-%s" % (F.index, kind.upper()), "finish_" + kind, fin[kind], fin_area, "new")
    return rows


# --------------------------------------------------------------------------- building
def build(footprint, uses, floor_heights=3.5, overrides=None, added_lines=None,
          profiles=None, db=None, n_floors=None, mode="conversion", partition_system=None,
          catalogue=None, mvplus=None, facade=None, plan=None, ground=None):
    """footprint: shapely Polygon or list of (x,y); uses: str or list (one per floor, last repeats).
    plan: a drawn plan (mvk/plan.py). A floor whose use is the use drawn for it is built from the plan;
            any other use is generated here.
    ground: a ground-floor programme (mvk/ground.py): floor 0, at the programme's use and with no drawn
            plan for it, is laid out as those tenancies (restaurant, gym, lobby ...) instead.
    mode: "conversion" (existing shell retained, fit-out priced) or "new_build" (everything priced).
    partition_system: None (as in the use profile) | "conventional" | "demountable" | "glass", or a
            requirement-based family ("smartax"): the cheapest build that meets each wall's requirement.
    facade: facade spec from the site file. The existing facade then sets windows and the exterior wall
            type, and a "setback" roof recesses the top floor.
    """
    import copy
    try:
        from . import plan as PLAN       # here, not at the top: plan.py imports this module
    except ImportError:
        import plan as PLAN
    profiles = profiles or load_profiles()
    db = db or load_db()
    if catalogue is None:
        catalogue = pricing.load_catalogue(mvplus)
    if not isinstance(footprint, Polygon):
        footprint = Polygon(footprint)
    footprint = footprint.buffer(0)
    uses = [uses] if isinstance(uses, str) else list(uses)
    n = n_floors or len(uses)
    hs = floor_heights if isinstance(floor_heights, (list, tuple)) else [floor_heights]
    ov = copy.deepcopy(overrides or {})
    if partition_system in PARTITION_SYSTEMS:
        t = PARTITION_SYSTEMS[partition_system]
        star = ov.setdefault("*", {})
        star["wall_types"] = dict({c: t for c in SYSTEM_CATS}, **star.get("wall_types", {}))
    elif partition_system in PARTITION_FAMILIES and system_available(partition_system, db, catalogue):
        fixed = ov.get("*", {}).get("wall_types", {})
        for i in range(n):
            reqs = profiles[uses[min(i, len(uses) - 1)]].get("wall_requirements") or {}
            fo = ov.setdefault("F%02d" % i, {})
            picks = {c: pick_build(partition_system, reqs.get(c, {}), db, catalogue)
                     for c in SYSTEM_CATS + ("S",) if c not in fixed}
            fo["wall_types"] = dict(picks, **fo.get("wall_types", {}))
    if facade:
        try:
            from . import facade as FAC
        except ImportError:
            import facade as FAC
        profiles = {k: FAC.profile_with_facade(v, facade) for k, v in profiles.items()}
    roof = (facade or {}).get("roof", {})
    top_fp = footprint
    if roof.get("shape") == "setback" and n > 2:
        t = _polys(_mbuf(footprint, -roof.get("setback", 2.0)), 20.0)
        if t:
            top_fp = max(t, key=lambda p: p.area)
    floors, rows, z = [], [], 0.0
    for i in range(n):
        use = uses[min(i, len(uses) - 1)]
        h = hs[min(i, len(hs) - 1)]
        fp_i = top_fp if i == n - 1 else footprint
        drawn = PLAN.floor_for(plan, i) if plan else None
        try:
            if drawn and drawn["use"] == use:
                F = PLAN.floor_from_plan(plan, drawn, footprint, use, profiles, db, index=i, z=z, height=h)
            elif i == 0 and ground and ground.get("use") == use:
                try:
                    from . import ground as GROUND
                except ImportError:
                    import ground as GROUND
                F = GROUND.floor_from_programme(ground, footprint, use, profiles, db, index=i, z=z, height=h)
            else:
                F = layout_floor(fp_i, use, profiles, db, index=i, z=z, height=h, ground=(i == 0))
        except Exception:
            if fp_i is footprint:
                raise
            top_fp = fp_i = footprint
            F = layout_floor(fp_i, use, profiles, db, index=i, z=z, height=h, ground=(i == 0))
        apply_overrides(F, ov, (added_lines or {}).get(i))
        F.rooms = rooms(F)
        rows += quantities(F, catalogue, mode)
        floors.append(F)
        z += h
    roof_t = floors[-1].slab_type
    p = pricing.price(footprint.area, roof_t, db, catalogue, "retained" if mode == "conversion" else "new")
    roof = {"floor": n, "element": "ROOF-SLAB", "category": "slab", "type": roof_t,
            "state": "retained" if mode == "conversion" else "new", "unit": "m2", "qty": round(footprint.area, 2)}
    roof.update(p)
    roof["cost_sek"], roof["gwp_kgco2e"] = roof["capex_sek"], roof["upfront_kgco2e"]
    rows.append(roof)
    return {"floors": floors, "rows": rows, "summary": summarise(rows), "height": z, "footprint": footprint,
            "top_footprint": top_fp, "facade": facade,
            "requirements": check_requirements(floors, db, catalogue),
            "mode": mode, "partition_system": partition_system or "as_profile",
            "catalogue_path": catalogue.get("__path__") if catalogue else None}


def summarise(rows):
    s, layers, bill, unpriced = {}, {}, {}, {}
    for r in rows:
        k = r["category"]
        d = s.setdefault(k, {"qty": 0.0, "qty_new": 0.0, "unit": r["unit"], "cost_sek": 0.0, "gwp_kgco2e": 0.0,
                             "c1c4": 0.0, "d": 0.0})
        d["qty"] += r["qty"]
        if r["state"] == "new":
            d["qty_new"] += r["qty"]
        d["cost_sek"] += r["capex_sek"]
        d["gwp_kgco2e"] += r["upfront_kgco2e"]
        d["c1c4"] += r["c1c4"]
        d["d"] += r["d"]
        if r["state"] == "new":
            lk = r.get("layer") or "other"
            L = layers.setdefault(lk, {"cost_sek": 0.0, "gwp_kgco2e": 0.0})
            L["cost_sek"] += r["capex_sek"]
            L["gwp_kgco2e"] += r["upfront_kgco2e"]
            if r["priced_by"] == "catalogue":
                bill[r["component"]] = bill.get(r["component"], 0.0) + r["qty"]
        if r["state"] == "unpriced":
            unpriced[k] = unpriced.get(k, 0.0) + r["qty"]
    priced = [r for r in rows if r["state"] == "new"]
    tot = {"cost_sek": sum(d["cost_sek"] for d in s.values()),
           "gwp_kgco2e": sum(d["gwp_kgco2e"] for d in s.values()),
           "c1c4": sum(d["c1c4"] for d in s.values()),
           "d_credit": sum(d["d"] for d in s.values()),
           "mock_priced_rows": sum(1 for r in priced if r["priced_by"] == "mock_csv"),
           "placeholder_share": (sum(1 for r in priced if r.get("placeholder")) / len(priced)) if priced else 0.0}
    return {"by_category": s, "by_layer": layers, "bill": {k: round(v, 2) for k, v in bill.items()},
            "unpriced": unpriced, "total": tot}


def floor_to_dict(F):
    return {"index": F.index, "z": F.z, "height": F.height, "use": F.use,
            "walls": [{k: v for k, v in w.items() if k != "axis"} for w in F.walls],
            "openings": F.openings, "rooms": F.rooms}


def export_csv(result, path):
    keys = ["floor", "element", "category", "state", "type", "component", "layer", "priced_by", "unit", "qty",
            "capex_sek", "a1a3", "a4", "a5", "upfront_kgco2e", "c1c4", "d", "placeholder"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        wr.writeheader()
        wr.writerows(result["rows"])
