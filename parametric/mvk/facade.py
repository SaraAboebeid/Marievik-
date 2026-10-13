"""
mvk.facade - facade, roof and balcony detailing from a building's facade spec (site file).

Pure Python + shapely. Returns simple geometry descriptors that the Grasshopper component turns
into Breps, so the same detailing can later be exported to other tools (IFC, CityGML, EnergyPlus):

  ("prism", rings, z0, z1, colour_key)   rings = [outer, hole, ...] (x, y) lists
  ("box", origin, u, s0, s1, t0, t1, z0, z1, colour_key)
        origin (x, y), u unit vector in plan, s along u, t along the left normal, z absolute
  ("vault", origin, u, length, width, z0, rise, colour_key)
        half-cylinder-like arch of `width` spanning across u, extruded `length` along u from origin

The facade spec (see site/marievik_site.json):
  material, base_material, base_floors, window (punched | ribbon | curtain), module, wwr, sill, head,
  balconies, roof {shape, membrane, parapet, setback, features[...]}
Every value there is a visual estimate until a survey replaces it.
"""
import math

from shapely.geometry import Polygon, box as sbox
from shapely import affinity
from shapely.ops import polylabel

try:
    from . import layout as L
except ImportError:
    import layout as L

EXT_WALL_FOR = {"brick_red": "EW_BRICK_450", "brick_dark": "EW_BRICK_450", "metal_panel_light": "EW_CURTAIN_GLASS",
                "stone_light": "EW_CONC_INSUL_400"}
WATER_DIR = (0.6, -0.8)   # Marievik: Årstaviken lies to the south-east of the blocks


def profile_with_facade(prof, facade):
    """The existing facade decides the windows (a conversion keeps them); the use profile does not."""
    if not facade:
        return prof
    p = dict(prof)
    p["types"] = dict(prof["types"])
    for src, dst in (("wwr", "wwr"), ("module", "window_module"), ("sill", "sill"), ("head", "head")):
        if src in facade:
            p[dst] = facade[src]
    p["window_kind"] = facade.get("window", "punched")
    p["types"]["ext_wall"] = EXT_WALL_FOR.get(facade.get("material"), "EW_CONC_INSUL_400")
    return p


def wall_colour(facade, floor_index):
    if not facade:
        return "render_light"
    if facade.get("base_material") and floor_index < facade.get("base_floors", 0):
        return facade["base_material"]
    return facade.get("material", "render_light")


def _frame(fp):
    u = L._main_axis(fp)
    c = polylabel(fp, 0.3)
    v = (-u[1], u[0])
    pts = list(fp.exterior.coords)
    su = [(p[0] - c.x) * u[0] + (p[1] - c.y) * u[1] for p in pts]
    sv = [(p[0] - c.x) * v[0] + (p[1] - c.y) * v[1] for p in pts]
    return (c.x, c.y), u, v, max(su) - min(su), max(sv) - min(sv)


def _rect(c, u, along, across, shift=0.0):
    v = (-u[1], u[0])
    cx, cy = c[0] + u[0] * shift, c[1] + u[1] * shift
    return Polygon([(cx + u[0] * a * along / 2 + v[0] * b * across / 2, cy + u[1] * a * along / 2 + v[1] * b * across / 2)
                    for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def _rings(g):
    return [[tuple(p) for p in r] for r in L._rings(g)]


def roof_parts(fp, top, facade):
    """Parapet, membrane and roof features on a footprint whose roof slab top is at z = top."""
    out = []
    if not facade:
        return out
    roof = facade.get("roof", {})
    memb = "membrane_" + roof.get("membrane", "light")
    out.append(("prism", _rings(fp), top, top + 0.06, memb))
    par = roof.get("parapet", 0.8)
    ring = fp.difference(L._mbuf(fp, -0.3))
    for p in L._polys(ring, 0.1):
        out.append(("prism", _rings(p), top, top + par, facade.get("material", "render_light")))
    c, u, v, Lu, Lv = _frame(fp)
    inner = L._mbuf(fp, -2.0)
    for f in roof.get("features", []):
        k = f["kind"]
        if k == "barrel_vault":
            length, width = f.get("along", 0.5) * Lu, f.get("across", 0.3) * Lv
            o = (c[0] - u[0] * length / 2, c[1] - u[1] * length / 2)
            out.append(("vault", o, u, length, width, top, f.get("rise", 2.5), f.get("material", "metal_light")))
        elif k == "plant":
            r = _rect(c, u, f.get("along", 0.25) * Lu, f.get("across", 0.2) * Lv, f.get("offset", 0.0) * Lu).intersection(inner)
            for p in L._polys(r, 1.0):
                out.append(("prism", _rings(p), top, top + f.get("h", 2.5), "metal_light"))
        elif k == "plant_u":
            outer = _rect(c, u, f.get("along", 0.6) * Lu, f.get("across", 0.5) * Lv)
            hole = _rect(c, u, f.get("along", 0.6) * Lu - 2 * f.get("width", 4.0), f.get("across", 0.5) * Lv - 2 * f.get("width", 4.0),
                         f.get("width", 4.0))
            for p in L._polys(outer.difference(hole).intersection(inner), 1.0):
                out.append(("prism", _rings(p), top, top + f.get("h", 2.8), "metal_light"))
        elif k == "skylight":
            r = _rect(c, u, f.get("along", 0.3) * Lu, f.get("across", 0.3) * Lv).intersection(inner)
            for p in L._polys(r, 1.0):
                out.append(("prism", _rings(p), top, top + f.get("h", 1.0), "glass"))
        elif k == "roof_garden":
            r = _rect(c, u, f.get("along", 0.2) * Lu, f.get("across", 0.2) * Lv).intersection(inner)
            for p in L._polys(r, 1.0):
                out.append(("prism", _rings(p), top, top + 0.35, "green"))
        elif k == "pv":
            out += _pv(fp, inner, c, u, v, Lu, Lv, top, f.get("share", 0.3))
        elif k == "glass_roof":
            d = WATER_DIR
            proj = [p[0] * d[0] + p[1] * d[1] for p in fp.exterior.coords]
            cut = max(proj) - f.get("depth", 0.35) * (max(proj) - min(proj))
            nrm = (-d[1], d[0])
            half = sbox(-1000, 0, 1000, 1000)
            ang = math.degrees(math.atan2(d[1], d[0])) - 90
            half = affinity.rotate(half, ang, origin=(0, 0))
            half = affinity.translate(half, d[0] * cut, d[1] * cut)
            for p in L._polys(fp.intersection(half), 5.0):
                out.append(("prism", _rings(p), top - 3.0, top + f.get("rise", 5.0), "glass"))
    return out


def terrace_parts(fp, top_fp, z, facade):
    """Roof terrace left where a setback top floor is recessed from the floor below (slab top at z)."""
    out = []
    if not facade or top_fp is None or top_fp.equals(fp):
        return out
    roof = facade.get("roof", {})
    for p in L._polys(fp.difference(top_fp), 1.0):
        out.append(("prism", _rings(p), z, z + 0.06, "membrane_" + roof.get("membrane", "light")))
    for p in L._polys(fp.difference(L._mbuf(fp, -0.3)), 0.1):
        out.append(("prism", _rings(p), z, z + 1.1, "glass"))       # glazed railing along the terrace edge
    return out


def _pv(fp, inner, c, u, v, Lu, Lv, top, share):
    """Rows of panels over roughly `share` of the roof, centred, away from the parapet."""
    out = []
    target = share * fp.area
    zone = inner
    d = 0.0
    while zone.area > target and d < 30:
        d += 0.5
        zone = L._mbuf(inner, -d)
    if zone.is_empty:
        return out
    n = int(Lv // 2.2) + 2
    for i in range(-n, n + 1):
        strip = _rect(c, u, Lu * 2, 1.1, 0).buffer(0)
        strip = affinity.translate(strip, v[0] * i * 2.2, v[1] * i * 2.2)
        for p in L._polys(zone.intersection(strip), 1.0):
            out.append(("prism", _rings(p), top + 0.3, top + 0.38, "pv"))
    return out


def balconies(F, facade, wall_h):
    """Balcony slabs + glass balustrades on facade walls of residential floors above the ground floor."""
    out = []
    if not facade or not facade.get("balconies") or F.index == 0:
        return out
    walls = {w["id"]: w for w in F.walls if w["cat"] == "E"}
    base = F.z + F.slab_t
    n = 0
    for o in F.openings:
        if o["kind"] != "window" or o["wall"] not in walls:
            continue
        n += 1
        if n % 2:
            continue
        w = walls[o["wall"]]
        (ux, uy), _ = L._unit(w["a"], w["b"])
        sc = (o["s0"] + o["s1"]) / 2
        t_out = -(0.25 + 0.0)          # right side of the wall = outside
        out.append(("box", tuple(w["a"]), (ux, uy), sc - 1.6, sc + 1.6, t_out - 1.6, t_out, base - 0.18, base, "render_white"))
        out.append(("box", tuple(w["a"]), (ux, uy), sc - 1.6, sc + 1.6, t_out - 1.6, t_out - 1.55, base, base + 1.1, "glass"))
    return out
