"""
mvk.ground - a ground floor laid out from a programme of tenancies (mock-up plans).

A programme (Marievik+/data/projects/<project>/ground_floors.json) lists what is on a building's
ground floor - a restaurant, a gym, an event space, the office lobby... - each with a share of the
floor. floor_from_programme() fits it to the real footprint:

  core          stair + lifts at the plate's pole of inaccessibility (as layout.py's open scheme)
  back of house a band around the core (deliveries, waste, plant), on plates big enough for one
  tenancies     the rest, cut across the building's spine into slices of the asked shares, in the
                listed order, the lobby moved to wherever the core is - so every tenancy reaches the
                facade and gets its own street door. The spine is the walking distance from one end of
                the plate, so cuts follow L-shapes, wings and courtyards rather than one straight axis.
  back rooms    a kitchen, stockroom or changing rooms on the side away from the street door

It returns the same Floor object as layout_floor(), so rooms, units, quantities and the 3D view work
unchanged. Wall categories as in layout.py: E facade, K core, S back-of-house edge, P tenancy
separating walls, I walls inside a tenancy.
"""
import heapq
import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, polylabel, unary_union

try:
    from . import layout as L
except ImportError:  # loaded outside the package
    import layout as L

# zone name prefix per kind (the viewer colours units by it) and the back room each kind gets
LABEL = {"supermarket": "Supermarket", "restaurant": "Restaurant", "cafe": "Café", "gym": "Gym",
         "event": "Event space", "shop": "Shop", "lobby": "Lobby", "bike": "Bike & waste"}
BACK = {"supermarket": ("Stockroom", 0.2), "restaurant": ("Kitchen", 0.3), "cafe": ("Kitchen", 0.2),
        "gym": ("Changing rooms", 0.2), "event": ("Storage & bar", 0.15), "shop": ("Stockroom", 0.15)}
BIG_DOOR = ("supermarket", "gym", "event", "lobby")
BOH_MIN_AREA = 900.0      # smaller plates get no back-of-house band: tenancies reach the core directly


def _halfplane(o, d, t, far=1e4):
    """The part of the plane where (p - o) . d <= t."""
    n = (-d[1], d[0])
    c = L._add(o, d, t)
    return Polygon([L._add(c, n, -far), L._add(c, n, far), L._add(L._add(c, n, far), d, -far),
                    L._add(L._add(c, n, -far), d, -far)])


def _cut_at(region, o, d, share, lo, hi):
    """The t at which the part of `region` with (p - o) . d <= t holds `share` of its area."""
    target = share * region.area
    for _ in range(40):
        mid = (lo + hi) / 2
        if region.intersection(_halfplane(o, d, mid)).area < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _extent(poly, o, d):
    s = [(x - o[0]) * d[0] + (y - o[1]) * d[1] for x, y in poly.exterior.coords]
    return min(s), max(s)


class _Spine(object):
    """Walking distance across the plate on a fine grid, from one end (the far end of its longest walk).
    u given (compact plates): plain distance along that axis instead, so the cuts run straight across."""

    def __init__(self, P0, cell=0.5, u=None):
        x0, y0, x1, y1 = P0.bounds
        self.cell, self.x0, self.y0 = cell, x0, y0
        nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
        gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * cell, y0 + (np.arange(ny) + 0.5) * cell)
        inside = shapely.contains_xy(P0, gx, gy)
        self.nx, self.ny, self.inside = nx, ny, inside
        self.xs, self.ys = gx[inside], gy[inside]
        self.idx = -np.ones((ny, nx), dtype=int)
        self.idx[inside] = np.arange(inside.sum())
        self.ij = np.argwhere(inside)
        self.u = u
        # the plate's main wall directions (angle mod 180), from edges of 6 m or more
        self.dirs = sorted({round(math.atan2(b[1] - a[1], b[0] - a[0]) % math.pi, 2)
                            for ring in L._rings(P0) for a, b in L._segs(ring) if math.dist(a, b) >= 6.0})
        if u is not None:
            self.d = self.xs * u[0] + self.ys * u[1]
            return
        start = self._nearest(polylabel(P0, 0.2))
        far = int(np.argmax(self._walk(start)))
        self.d = self._walk(far)

    def _nearest(self, p):
        return int(np.argmin((self.xs - p.x) ** 2 + (self.ys - p.y) ** 2))

    def _walk(self, k0):
        dist = np.full(len(self.xs), np.inf)
        dist[k0] = 0.0
        q = [(0.0, k0)]
        steps = [(di, dj, self.cell * math.hypot(di, dj)) for di in (-1, 0, 1) for dj in (-1, 0, 1) if di or dj]
        while q:
            dk, k = heapq.heappop(q)
            if dk > dist[k]:
                continue
            i, j = self.ij[k]
            for di, dj, w in steps:
                a, b = i + di, j + dj
                if 0 <= a < self.ny and 0 <= b < self.nx:
                    n = self.idx[a, b]
                    if n >= 0 and dk + w < dist[n]:
                        dist[n] = dk + w
                        heapq.heappush(q, (dk + w, n))
        return np.where(np.isfinite(dist), dist, 0.0)

    def at(self, g):
        """Walking distance at the cells inside geometry g (for its median)."""
        m = shapely.contains_xy(g, self.xs, self.ys)
        return self.d[m]

    def cuts(self, t, P0):
        """Straight walls across the plate where the walking distance is t: one per wing the level crosses."""
        if self.u is not None:
            k = int(np.argmin(np.abs(self.d - t)))
            c, e = (float(self.xs[k]), float(self.ys[k])), (-self.u[1], self.u[0])
            c = L._add(c, self.u, t - float(self.d[k]))
            return L._lines(LineString([L._add(c, e, -1e3), L._add(c, e, 1e3)]).intersection(P0), 1.0)
        band = np.abs(self.d - t) < self.cell * 0.75
        k = np.flatnonzero(band)
        if len(k) < 3:
            return []
        # group the band's cells into connected runs (one per wing), then fit a line to each
        lab = {int(x): None for x in k}
        out, cur = [], 0
        for s in lab:
            if lab[s] is not None:
                continue
            lab[s], stack, grp = cur, [s], []
            while stack:
                c = stack.pop()
                grp.append(c)
                i, j = self.ij[c]
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        a, b = i + di, j + dj
                        if 0 <= a < self.ny and 0 <= b < self.nx:
                            n = int(self.idx[a, b])
                            if n in lab and lab[n] is None:
                                lab[n] = cur
                                stack.append(n)
            cur += 1
            if len(grp) < 3:
                continue
            px, py = self.xs[grp], self.ys[grp]
            m = int(np.argmin((px - px.mean()) ** 2 + (py - py.mean()) ** 2))   # a band cell, inside the plate
            c = (float(px[m]), float(py[m]))
            # the shortest cut through here square to one of the plate's own wall directions: across the
            # wing, never along it, even at a corner where the walking distance turns
            best = None
            for a in self.dirs or [0.0, math.pi / 2]:
                e = (math.cos(a), math.sin(a))
                pieces = L._lines(LineString([L._add(c, e, -1e3), L._add(c, e, 1e3)]).intersection(P0), 1.0)
                if pieces:
                    l = min(pieces, key=lambda l: l.distance(Point(c)))
                    if l.distance(Point(c)) < 1.0 and (best is None or l.length < best.length):
                        best = l
            if best is not None:
                out.append(best)
        return out


def _cross_walls(region, o, d, t):
    """The pieces of the line (p - o) . d = t that lie inside `region`, as (a, b) segments."""
    n = (-d[1], d[0])
    c = L._add(o, d, t)
    line = LineString([L._add(c, n, -1e4), L._add(c, n, 1e4)])
    return [(tuple(l.coords[0]), tuple(l.coords[-1])) for l in L._lines(line.intersection(region), 1.0)]


def floor_from_programme(prog, footprint, use, profiles, db, index=0, z=0.0, height=4.5):
    prof = profiles[use]
    T = prof["types"]
    P0 = orient(footprint, 1.0)
    F = L.Floor(index, z, height, use, prof, db, P0)
    u = L._main_axis(P0)
    t_ext = db[T["ext_wall"]]["thickness_m"]
    door = lambda t: (db[t]["width_m"] or 0.9, db[t]["height_m"] or 2.1)

    def inner(cat, a, b, wtype=None):
        """An interior wall whose room-boundary axis overshoots both ends a little, so rooms close."""
        (ux, uy), _ = L._unit(a, b)
        return F.wall(cat, a, b, wtype=wtype, axis=(L._add(a, (ux, uy), -0.3), L._add(b, (ux, uy), 0.3)))

    # ---- core, sized down on small plates
    pole = polylabel(P0, 0.2)
    ck = prof["core"]
    cl, cw = (ck["length"], ck["width"]) if P0.area >= 1500 else (9.0, 6.0)
    core = L._rect((pole.x, pole.y), u, cl, cw).intersection(L._mbuf(P0, -3.0))
    core = max(L._polys(core), key=lambda p: p.area) if L._polys(core) else None

    # ---- back of house: a band round the core, kept off the facade so the tenancies keep their frontage
    boh = None
    if core is not None and P0.area >= BOH_MIN_AREA:
        band = L._mbuf(core, 3.0).intersection(L._mbuf(P0, -6.0)).difference(core)
        boh = max(L._polys(band, 5.0), key=lambda p: p.area) if L._polys(band, 5.0) else None
    taken = unary_union([g for g in (core, boh) if g is not None])
    Rz = P0.difference(taken) if not taken.is_empty else P0

    # ---- tenancies: slices across the spine, in programme order with the lobby where the core is
    compact = P0.area / P0.minimum_rotated_rectangle.area > 0.85 and not P0.interiors
    sp = _Spine(P0, u=u if compact else None)
    dz = np.sort(sp.at(Rz))
    spaces = [s for s in prog["spaces"] if s.get("share", 0) > 0]
    lobby = next((s for s in spaces if s.get("kind") == "lobby"), None)
    if lobby is not None and core is not None and len(dz):
        others = [s for s in spaces if s is not lobby]
        tot = sum(s["share"] for s in spaces)
        pc = np.searchsorted(dz, float(np.median(sp.at(core)))) / len(dz)
        k = min(range(len(others) + 1), key=lambda k: abs((sum(s["share"] for s in others[:k]) + lobby["share"] / 2) / tot - pc))
        spaces = others[:k] + [lobby] + others[k:]
    tot = sum(s["share"] for s in spaces)
    ts, acc = [], 0.0
    for s in spaces[:-1]:
        acc += s["share"] / tot
        ts.append(float(dz[min(len(dz) - 1, int(acc * len(dz)))]))
    seps = []
    for t in ts:
        for line in sp.cuts(t, P0):
            seps += [(tuple(l.coords[0]), tuple(l.coords[-1])) for l in L._lines(line.intersection(Rz), 1.0)]
    # the pieces the walls cut the plate into, each given to the slice its walking distance falls in
    cutlines = [LineString([L._add(a, L._unit(a, b)[0], -0.3), L._add(b, L._unit(a, b)[0], 0.3)]) for a, b in seps]
    pieces = [p for p in polygonize(unary_union([Rz.boundary] + cutlines)) if Rz.contains(p.representative_point())]
    owner = []
    for p in pieces:
        dd = sp.at(p)
        g = float(np.median(dd)) if len(dd) else float(sp.d[sp._nearest(p.representative_point())])
        owner.append(int(np.searchsorted(ts, g)))
    # a stray piece cut off from the rest of its tenancy (round a courtyard, past a corner) joins the
    # neighbour it shares most wall with, so every tenancy is one piece
    mains = {}
    for j, q in enumerate(pieces):
        if owner[j] not in mains or q.area > pieces[mains[owner[j]]].area:
            mains[owner[j]] = j
    for _ in range(3):
        for i, p in enumerate(pieces):
            if mains.get(owner[i]) == i:
                continue
            mine = [q for j, q in enumerate(pieces) if owner[j] == owner[i]]
            if spaces[owner[i]] is lobby and not taken.is_empty:
                mine.append(taken)          # the lobby wraps the core: pieces either side of it still connect
            main = pieces[mains[owner[i]]]
            if any(c.intersects(main) and c.intersects(p) for c in L._polys(unary_union(mine).buffer(0.05))):
                continue
            share = {}
            for j, q in enumerate(pieces):
                if owner[j] != owner[i]:
                    share[owner[j]] = share.get(owner[j], 0.0) + p.buffer(0.05).intersection(q.buffer(0.05)).area
            if share and max(share.values()) > 0:
                owner[i] = max(share, key=share.get)
    groups = [[p for p, o in zip(pieces, owner) if o == i] for i in range(len(spaces))]
    slices = [(s, unary_union(groups[i]) if groups[i] else Polygon()) for i, s in enumerate(spaces)]

    # keep only the stretches of the cuts that really separate two tenancies
    def tenant_at(x, y):
        pt = Point(x, y)
        return next((o for p, o in zip(pieces, owner) if p.contains(pt)), None)
    walls_kept = []
    for a, b in seps:
        (ux, uy), Ls = L._unit(a, b)
        n_ = max(1, int(Ls // 1.0))
        runs, run = [], None
        for k in range(n_):
            s_a, s_b = Ls * k / n_, Ls * (k + 1) / n_
            m = L._add(a, (ux, uy), (s_a + s_b) / 2)
            l_, r_ = tenant_at(*L._add(m, (-uy, ux), 0.3)), tenant_at(*L._add(m, (uy, -ux), 0.3))
            if l_ is not None and r_ is not None and l_ != r_:
                run = (run[0], s_b) if run else (s_a, s_b)
            elif run:
                runs.append(run)
                run = None
        if run:
            runs.append(run)
        walls_kept += [(L._add(a, (ux, uy), r0), L._add(a, (ux, uy), r1)) for r0, r1 in runs if r1 - r0 >= 1.0]
    seps = walls_kept

    # ---- facade walls, split where a tenancy wall meets the facade
    ends = [p for a, b in seps for p in (a, b)]
    for a, b in L._split_segments(L._rings(L._mbuf(P0, -t_ext / 2)), ends, tol=t_ext / 2 + 0.3):
        F.wall("E", a, b)
    ext = [w for w in F.walls if w["cat"] == "E"]

    # ---- core walls, back-of-house edge, tenancy separating walls
    if core is not None:
        t_core = db[T["core"]]["thickness_m"]
        for (a, b), (ax, bx) in zip(L._split_segments(L._rings(L._mbuf(core, -t_core / 2)), []),
                                    L._split_segments(L._rings(core), [])):
            F.wall("K", a, b, axis=(ax, bx))
        F.zones.append(("Core", core))
    if boh is not None:
        F.zones.append(("Support / back of house", boh))
        for a, b in L._split_segments(L._rings(boh), []):
            for sa, sb in L._clip_out((a, b), L._mbuf(core, 0.05) if core is not None else None):
                inner("S", sa, sb)
    for a, b in seps:
        inner("P", a, b)

    # ---- each tenancy: street door, back room, door through to the back of house / core
    front = []
    for s, poly in slices:
        if poly.is_empty:
            continue
        kind = s.get("kind", "shop")
        name = "%s · %s" % (LABEL.get(kind, kind.title()), s["name"]) if s.get("name") else LABEL.get(kind, kind.title())
        # street door: on the facade wall this tenancy has most of
        reach = poly.buffer(0.6)
        best = max(ext, key=lambda w: LineString([w["a"], w["b"]]).intersection(reach).length)
        seg = LineString([best["a"], best["b"]]).intersection(reach)
        ov = seg.length
        zone = poly
        if ov >= 2.5:
            uu, _ = L._unit(best["a"], best["b"])
            mid = seg.interpolate(0.5, normalized=True)
            sc = (mid.x - best["a"][0]) * uu[0] + (mid.y - best["a"][1]) * uu[1]
            dt = "D_EXT_DOUBLE_1800" if kind in BIG_DOOR else "D_FIRE_EI60_1000"
            dw, dh = door(dt)
            F.opening("door", best, sc, dw, 0.0, dh, dt)
            # back room: the part of the tenancy farthest from that door, behind an interior wall
            back = BACK.get(kind)
            if back and poly.area >= 40:
                nrm = (uu[1] * -1, uu[0])                     # facade walls run anticlockwise: inward = left
                if not P0.contains(Point(L._add((mid.x, mid.y), nrm, 1.0))):
                    nrm = (-nrm[0], -nrm[1])
                b0, b1 = _extent(poly if poly.geom_type == "Polygon" else poly.convex_hull, (mid.x, mid.y), nrm)
                t = _cut_at(poly, (mid.x, mid.y), nrm, 1 - back[1], b0, b1)
                rear = poly.difference(_halfplane((mid.x, mid.y), nrm, t))
                walls = _cross_walls(poly, (mid.x, mid.y), nrm, t)
                if rear.area >= 8 and walls:
                    F.zones.append(("%s (%s)" % (back[0], s["name"] or LABEL.get(kind)), rear))
                    zone = poly.difference(rear)
                    for a, b in walls:
                        w = inner("I", a, b)
                        if math.dist(a, b) >= 2.0:
                            F.opening("door", w, math.dist(a, b) / 2, 0.9, 0.0, 2.1, T["interior_door"])
        F.zones.append((name, zone))
        front.append((kind, poly))

    # ---- doors through to the back of house (service) and from the lobbies into the core
    inside = [w for w in F.walls if w["cat"] == "S"]
    cores = [w for w in F.walls if w["cat"] == "K"]
    for kind, poly in front:
        pool = cores if kind == "lobby" else inside
        if not pool:
            continue
        reach = poly.buffer(0.4)
        w = max(pool, key=lambda w: LineString(w["axis"]).intersection(reach).length)
        ln = LineString(w["axis"]).intersection(reach)
        if ln.length < 1.6:
            continue
        uu, _ = L._unit(w["a"], w["b"])
        mid = ln.interpolate(0.5, normalized=True)
        sc = (mid.x - w["a"][0]) * uu[0] + (mid.y - w["a"][1]) * uu[1]
        dt = T["core_door"] if kind == "lobby" else T["interior_door"]
        dw, dh = door(dt)
        F.opening("door", w, sc, dw, 0.0, dh, dt)

    # ---- shopfront glazing round the rest of the facade
    for w in ext:
        L.place_windows(F, w)
    return F
