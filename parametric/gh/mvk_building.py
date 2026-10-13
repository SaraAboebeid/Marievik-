#! python3
# r: shapely
"""MVK Building - use-dependent floor layouts, walls/doors/windows/slabs + cost & carbon.
Engine: <lib>/mvk/layout.py   Profiles: <lib>/mvk/use_profiles.json   Database: <lib>/mvk/components_db.csv
"""
import os
import sys
import json
import importlib
import System
import Rhino
import Rhino.Geometry as rg

LIB = lib if lib else r"C:\Users\saraabo\Desktop\Marievik+\parametric"
if LIB not in sys.path:
    sys.path.insert(0, LIB)
import mvk.pricing as PR
import mvk.layout as L
import mvk.export as X
import mvk.site as S
import mvk.facade as FA
importlib.reload(S)
importlib.reload(PR)
importlib.reload(L)
importlib.reload(X)
importlib.reload(FA)

for _n in ("footprint", "ground_use", "use", "floors", "ground_h", "floor_h", "show_floor", "show_ids", "export",
           "overrides", "remove_walls", "add_walls", "partition_system", "existing_shell", "building", "mvplus",
           "export_all", "detail", "context_on", "facade_on"):
    globals().setdefault(_n, None)   # inputs not present on a component count as "not set"


def _opt(name, default):
    """Inputs added later may be missing on older copies of the definition."""
    v = globals().get(name)
    return default if v is None or v == "" else v

MVPLUS = _opt("mvplus", PR.MARIEVIK_DEFAULT)
SYSTEM = str(_opt("partition_system", "as_profile"))
MODE = "conversion" if _opt("existing_shell", True) else "new_build"
BUILDING = str(_opt("building", "B01")).strip()
DETAIL = bool(_opt("detail", True))        # False: floor-stack massing only (numbers are still computed)
CTX = bool(_opt("context_on", False))       # False: do not draw the other site buildings (per-building components)
FACADE_ON = bool(_opt("facade_on", True))   # False: plain walls, use-profile windows, flat roof

Z = rg.Vector3d.ZAxis


def _pts(crv):
    ok, pl = crv.TryGetPolyline()
    if not ok:
        pl = crv.ToPolyline(0.01, 0.05, 0.1, 0).ToPolyline()
    return [(p.X, p.Y) for p in pl]


def _box(w, F, s0, s1, z0, z1, y0, y1, base):
    (ux, uy), _ = L._unit(w["a"], w["b"])
    pl = rg.Plane(rg.Point3d(w["a"][0], w["a"][1], base), rg.Vector3d(ux, uy, 0), rg.Vector3d(-uy, ux, 0))
    return rg.Box(pl, rg.Interval(s0, s1), rg.Interval(y0, y1), rg.Interval(z0, z1)).ToBrep()


def _poly_crv(coords, z):
    return rg.PolylineCurve([rg.Point3d(x, y, z) for x, y in coords])


def _col(key):
    r, g_, b = MAT.get(key, (200, 200, 200))
    return System.Drawing.Color.FromArgb(int(r), int(g_), int(b))


def _brep(d):
    """Facade/roof descriptor from mvk.facade -> Brep."""
    k = d[0]
    if k == "prism":
        _, rings_, z0, z1, _c = d
        crv = [_poly_crv(r, z0) for r in rings_]
        pl = rg.Brep.CreatePlanarBreps(crv, 0.001)
        if not pl:
            return None
        return pl[0].Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, z1 - z0)), True) or pl[0]
    if k == "box":
        _, o, u, s0, s1, t0, t1, z0, z1, _c = d
        pl = rg.Plane(rg.Point3d(o[0], o[1], 0), rg.Vector3d(u[0], u[1], 0), rg.Vector3d(-u[1], u[0], 0))
        return rg.Box(pl, rg.Interval(s0, s1), rg.Interval(t0, t1), rg.Interval(z0, z1)).ToBrep()
    if k == "vault":
        _, o, u, length, width, z0, rise, _c = d
        v = (-u[1], u[0])
        p0 = rg.Point3d(o[0] - v[0] * width / 2, o[1] - v[1] * width / 2, z0)
        p1 = rg.Point3d(o[0], o[1], z0 + rise)
        p2 = rg.Point3d(o[0] + v[0] * width / 2, o[1] + v[1] * width / 2, z0)
        prof = rg.PolyCurve()
        prof.Append(rg.ArcCurve(rg.Arc(p0, p1, p2)))
        prof.Append(rg.LineCurve(p2, p0))
        srf = rg.Surface.CreateExtrusion(prof, rg.Vector3d(u[0] * length, u[1] * length, 0))
        b = srf.ToBrep() if srf else None
        return b.CapPlanarHoles(0.001) or b if b else None
    return None


def _add_details(descs):
    for d in descs:
        try:
            b = _brep(d)
        except Exception:
            b = None
        if b is not None:
            details.append(b)
            details_col.append(_col(d[-1]))


def _curves(name, fallback):
    """Read curves straight from the input parameter's data (robust for referenced Rhino curves)."""
    out = []
    try:
        prm = [q for q in ghenv.Component.Params.Input if q.NickName == name][0]
        for goo in prm.VolatileData.AllData(True):
            v = getattr(goo, "Value", None)
            if not isinstance(v, rg.Curve):
                try:
                    v = goo.ScriptVariable()
                except Exception:
                    v = None
            if isinstance(v, rg.Curve):
                out.append(v)
    except Exception:
        pass
    if not out:
        out = [x for x in (fallback or []) if isinstance(x, rg.Curve)]
    return out


# ---------------------------------------------------------------- inputs
walls, wall_ids, windows, doors, slabs = [], [], [], [], []
rooms, room_pts, room_txt, id_pts, id_txt, table = [], [], [], [], [], []
context, ctx_pts, ctx_txt, site_lines, massing = [], [], [], [], []
facade, facade_col, details, details_col, massing_col = [], [], [], [], []
cost = gwp = 0.0
summary = ""
model = None

SITE = {}
try:
    SITE_DATA = S.load(os.path.join(LIB, "site", "marievik_site.json"))
    SITE = {b["id"]: b for b in SITE_DATA["buildings"]}
except Exception as e:
    SITE_DATA = {}
    summary += "Site file not found (%s) - using footprint curves.\n" % e
SB = SITE.get(BUILDING)
MAT = (SITE_DATA or {}).get("materials", {})
FAC = (SB or {}).get("facade") if FACADE_ON else None

fp = None
if SB is not None:
    fp = S.footprint(SB)
else:
    curves = [c for c in _curves("footprint", footprint) if c.IsClosed]
    if curves:
        rings = sorted([_pts(c) for c in curves], key=lambda r: -abs(L.Polygon(r).area))
        outer = L.Polygon(rings[0])
        holes = [r for r in rings[1:] if outer.contains(L.Polygon(r))]
        fp = L.Polygon(rings[0], holes)

# context: every other site building as a stack of floor slabs + its id label, plus streets
for bid, b in (SITE.items() if CTX else []):
    if bid == BUILDING:
        continue
    nb = int(b["levels"])
    hb = S.floor_heights(b, nb)
    crv = [_poly_crv(r, 0) for r in L._rings(S.footprint(b))]
    plan = rg.Brep.CreatePlanarBreps(crv, 0.001)
    if not plan:
        continue
    z = 0.0
    for h in hb:
        f = plan[0].DuplicateBrep()
        f.Translate(0, 0, z)
        e = f.Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, h - 0.05)), True)
        if e:
            context.append(e)
        z += h
    c = S.footprint(b).representative_point()
    ctx_pts.append(rg.Point3d(c.x, c.y, z + 3))
    ctx_txt.append("%s  %s\n%d fl  %s" % (bid, b["name"], nb, b["current_use"]))
for r in ((SITE_DATA.get("roads") or []) if CTX else []):
    site_lines.append(rg.PolylineCurve([rg.Point3d(x, y, 0) for x, y in r["pts"]]))

if fp is None:
    summary += "Pick a building, or set Building = custom and connect closed footprint curve(s)."
else:
    if SB is not None:
        n = int(floors) if floors and int(floors) > 0 else int(SB["levels"])
        g_use, u_use = S.profile_uses(SB, use, ground_use)
        hs = S.floor_heights(SB, n, float(ground_h) if ground_h else None, float(floor_h) if floor_h else None)
    else:
        n = int(floors) if floors and int(floors) > 0 else 6
        g_use = ground_use if ground_use not in (None, "", "site") else "retail"
        u_use = use if use not in (None, "", "site") else "office_cellular"
        hs = [float(ground_h or 4.5)] + [float(floor_h or 3.5)] * (n - 1)
    uses = [g_use] + [u_use] * (n - 1)
    zs = [sum(hs[:i]) for i in range(n)]

    ov = {}
    if overrides:
        try:
            ov = json.loads(overrides)
        except Exception as e:
            summary = "Overrides JSON error: %s\n" % e
    for wid in (remove_walls or []):
        wid = str(wid).strip()
        if wid:
            ov.setdefault(wid[:3], {}).setdefault("remove_walls", []).append(wid)
    added = {}
    for c in _curves("add_walls", add_walls):
        a, b = c.PointAtStart, c.PointAtEnd
        fi = max([i for i in range(n) if zs[i] <= a.Z + 0.01] or [0])
        added.setdefault(fi, []).append(((a.X, a.Y), (b.X, b.Y)))

    catalogue = PR.load_catalogue(MVPLUS)
    res = L.build(fp, uses, floor_heights=hs, overrides=ov, added_lines=added, n_floors=n, mode=MODE,
                  partition_system=None if SYSTEM == "as_profile" else SYSTEM, catalogue=catalogue,
                  facade=FAC)
    top_fp = res.get("top_footprint") or fp
    gfa = fp.area * n
    model = {"id": BUILDING, "name": SB["name"] if SB else BUILDING, "floors": n, "use": u_use, "ground_use": g_use,
             "partition_system": res["partition_system"], "mode": MODE, "gfa_m2": gfa, "summary": res["summary"]}
    model = json.dumps(model)   # plain text passes between Grasshopper components reliably
    sf = int(show_floor) if show_floor is not None else -1
    lp = fp.representative_point()
    ctx_pts.append(rg.Point3d(lp.x, lp.y, res["height"] + 3)) if not CTX else None
    ctx_txt.append("%s  %s\n%d fl  %s / %s" % (BUILDING, SB["name"] if SB else "", n, u_use, g_use)) if not CTX else None

    if not DETAIL:
        for F in res["floors"]:
            plan0 = rg.Brep.CreatePlanarBreps([_poly_crv(r, F.z) for r in L._rings(F.footprint)], 0.001) or []
            if not plan0:
                continue
            e0 = plan0[0].Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, F.height - 0.05)), True)
            if e0:
                massing.append(e0)
                massing_col.append(_col(FA.wall_colour(FAC, F.index)))
            if not FAC or sf not in (-1, F.index):
                continue
            # facade openings on the block's outer face, so the massing still shows the window pattern
            base = F.z + F.slab_t
            wd = {w["id"]: w for w in F.walls if w["cat"] == "E"}
            for o in F.openings:
                w = wd.get(o["wall"])
                if w is None:
                    continue
                t = F.thick(w)
                bx = _box(w, F, o["s0"], o["s1"], o["z0"], o["z1"], -t / 2 - 0.04, -t / 2 + 0.02, base)
                (windows if o["kind"] == "window" else doors).append(bx)
            _add_details(FA.balconies(F, FAC, F.wall_h))

    for F in (res["floors"] if DETAIL else []):
        base = F.z + F.slab_t
        # slab (bottom of each floor) with atrium voids
        rows_ = [r for r in res["rows"] if r["element"] == "F%02d-SLAB" % F.index]
        if sf in (-1, F.index):
            crvs = [_poly_crv(r, F.z) for r in L._rings(F.footprint)] + [_poly_crv(r, F.z) for v in F.voids for r in L._rings(v)]
            for b in rg.Brep.CreatePlanarBreps(crvs, 0.001) or []:
                ext = b.Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, F.z), rg.Point3d(0, 0, base)), True)
                slabs.append(ext or b)
        if sf not in (-1, F.index):
            continue
        for w in F.walls:
            t = F.thick(w)
            for s0, s1, z0, z1 in L.wall_pieces(F, w):
                bx = _box(w, F, s0, s1, z0, z1, -t / 2, t / 2, base)
                if w["cat"] == "E" and FAC:
                    facade.append(bx)
                    facade_col.append(_col(FA.wall_colour(FAC, F.index)))
                else:
                    walls.append(bx)
                    wall_ids.append(w["id"])
            if show_ids:
                id_pts.append(rg.Point3d((w["a"][0] + w["b"][0]) / 2, (w["a"][1] + w["b"][1]) / 2, base + 1.2))
                id_txt.append("%s\n%s" % (w["id"], w["type"]))
        wd = {w["id"]: w for w in F.walls}
        for o in F.openings:
            w = wd[o["wall"]]
            if o["kind"] == "window":
                windows.append(_box(w, F, o["s0"], o["s1"], o["z0"], o["z1"], -0.02, 0.02, base))
            else:
                doors.append(_box(w, F, o["s0"], o["s1"], o["z0"], o["z1"], -0.025, 0.025, base))
                if show_ids:
                    (ux, uy), _ = L._unit(w["a"], w["b"])
                    sm = (o["s0"] + o["s1"]) / 2
                    id_pts.append(rg.Point3d(w["a"][0] + ux * sm, w["a"][1] + uy * sm, base + 2.3))
                    id_txt.append(o["id"])
        if FAC:
            _add_details(FA.balconies(F, FAC, F.wall_h))
        for r in F.rooms:
            rooms.append(_poly_crv(r["poly"], base + 0.02))
            room_pts.append(rg.Point3d(r["label_pt"][0], r["label_pt"][1], base + 0.05))
            room_txt.append("%s\n%.0f m2" % (r["name"], r["area"]))

    roof = [_poly_crv(r, res["height"]) for r in L._rings(top_fp)]
    if sf == -1 and DETAIL:
        for b in rg.Brep.CreatePlanarBreps(roof, 0.001) or []:
            slabs.append(b.Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, 0.3)), True) or b)
    if sf == -1 and FAC:
        top = res["height"] + (0.3 if DETAIL else 0.0)
        _add_details(FA.roof_parts(top_fp, top, FAC))
        if len(res["floors"]) > 1:
            _add_details(FA.terrace_parts(fp, top_fp, res["floors"][-1].z + (0.0 if not DETAIL else res["floors"][-1].slab_t), FAC))

    t = res["summary"]["total"]
    cost, gwp = t["cost_sek"], t["gwp_kgco2e"]
    lines = ["%s%s  |  %d floors  |  %s over %s" % (BUILDING, ("  " + SB["name"]) if SB else "", n, u_use, g_use),
             "%s  |  partitions: %s" % ("existing shell retained" if MODE == "conversion" else "new build", res["partition_system"]),
             "prices: %s" % (res["catalogue_path"] or "LOCAL MOCK LIST - Marievik+ catalogue not found"),
             "",
             "%-16s %9s %9s %6s %8s %9s" % ("category", "qty", "new", "unit", "MSEK", "t A1-A5")]
    for k, d in sorted(res["summary"]["by_category"].items()):
        lines.append("%-16s %9.0f %9.0f %6s %8.2f %9.1f" % (k, d["qty"], d["qty_new"], d["unit"], d["cost_sek"] / 1e6, d["gwp_kgco2e"] / 1e3))
    if FAC:
        rf = FAC.get("roof", {})
        lines.append("facade: %s%s, %s windows (module %.2f m, wwr %.2f)%s  |  roof: %s%s" % (
            FAC.get("material", "?"), (" over %s base" % FAC["base_material"]) if FAC.get("base_material") else "",
            FAC.get("window", "punched"), FAC.get("module", 0), FAC.get("wwr", 0), ", balconies" if FAC.get("balconies") else "",
            rf.get("shape", "flat"), "".join(", " + f["kind"] for f in rf.get("features", []))))
        lines.append("  (visual estimate from aerial views - not surveyed)")
    lines.append("")
    lines.append("NEW FIT-OUT  %.1f MSEK   %.0f t CO2e A1-A5  (%.1f kg/m2 GFA %.0f m2)" % (cost / 1e6, gwp / 1e3, gwp / gfa, gfa))
    lines.append("C1-C4 %.0f t   |   D %.0f t (reported, not netted)" % (t["c1c4"] / 1e3, t["d_credit"] / 1e3))
    for k, v in res["summary"]["unpriced"].items():
        lines.append("NOT PRICED: %.0f m2 %s (no catalogue entry yet)" % (v, k))
    if t["mock_priced_rows"]:
        lines.append("%d element(s) priced from the local mock list (no catalogue link)" % t["mock_priced_rows"])
    summary += "\n".join(lines)
    table = ["%s,%s,%s,%s,%s,%s,%s,%s,%s" % (r["floor"], r["element"], r["category"], r["state"], r["component"] or r["type"],
                                             r["unit"], r["qty"], r["capex_sek"], r["upfront_kgco2e"]) for r in res["rows"]]
    if export:
        os.makedirs(os.path.join(LIB, "outputs"), exist_ok=True)
        L.export_csv(res, os.path.join(LIB, "outputs", "quantities_%s.csv" % BUILDING))
        try:
            path = X.export(fp, BUILDING, SB["name"] if SB else BUILDING, n, uses[0], (hs[0], hs[-1]), overrides=ov,
                            mvplus=MVPLUS, mode=MODE, site_building=SB,
                            current={"use": uses[-1], "ground_use": uses[0], "partition_system": SYSTEM})
            summary += "\nExported: %s\nRe-price with:  python -m engine.grasshopper   (in Marievik+)" % path
        except Exception as e:
            summary += "\nDashboard export failed: %s" % e

if _opt("export_all", False) and SITE:
    done = []
    for bid, b in SITE.items():
        try:
            nb = int(b["levels"])
            g_, u_ = S.profile_uses(b)
            X.export(S.footprint(b), bid, b["name"], nb, g_, tuple(S.floor_heights(b, nb)[:1] + S.floor_heights(b, nb)[-1:]),
                     mvplus=MVPLUS, mode=MODE, site_building=b, current={"use": u_, "ground_use": g_, "partition_system": "conventional"})
            done.append(bid)
        except Exception as e:
            summary += "\n%s export failed: %s" % (bid, e)
    summary += "\nSite exported (%d buildings): %s" % (len(done), ", ".join(done))
