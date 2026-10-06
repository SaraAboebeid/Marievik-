"""
explorer.daylight - quick daylight factor for every unit of a floor (seconds, no Radiance).

This is the fast, always-available estimate. The validated one is the Radiance daylight factor
run by Honeybee (explorer/sim/full_sim.py) when the Ladybug Tools simulation environment exists.

Method (split-flux, CIE overcast sky), per sensor point 0.8 m above the floor:
  SC   sky component: every window of the unit is cut into patches; each patch that sees sky
       above the obstruction horizon (computed from every site building, including this one,
       at its scenario height) adds L(g) sin(g) dOmega, with the CIE overcast luminance
       L(g) = (1 + 2 sin g) / 3 relative to the zenith.
  ERC  externally reflected component: patches that see an obstruction instead add 10 % of
       that (obstruction luminance ~ 0.1 of the zenith for facades of reflectance ~0.2-0.3).
  IRC  internally reflected component, uniform over the unit (BRE split-flux formula):
       IRC = T W / (A (1 - R)) (C R_fw + 5 R_cw), with C from the window's obstruction angle.
  DF = 100 (SC + ERC) / (7 pi / 9) + IRC, all scaled by the glazing's visible transmittance,
       a maintenance factor of 0.9 and a frame factor of 0.8.
Light only enters a unit through its own windows (partitions are opaque); daylight that
reaches a corridor through glazed doors is ignored. Reveals, balconies and trees are ignored.

Targets reported (EN 17037, Stockholm): DF 2.1 % ~ 300 lx over 50 % of the area,
DF 0.7 % ~ 100 lx over 95 % of the area (median external diffuse illuminance about 14 klx).
"""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Point
from shapely.prepared import prep

from . import model as M

VT = {"existing": 0.75, "new": 0.65}           # visible transmittance: double (1985) / triple glazing
MAINT, FRAME = 0.9, 0.8
R_MEAN, R_FW, R_CW = 0.5, 0.35, 0.7
DF_300, DF_100 = 2.1, 0.7
AZ_STEP = 5
AZ_REL = np.radians(np.arange(-87.5, 90, AZ_STEP))                 # relative to the window normal
C_TABLE = [(0, 39), (10, 35), (20, 31), (30, 25), (40, 20), (50, 14), (60, 10), (70, 7), (80, 5), (90, 5)]


# ---------------------------------------------------------------------------- obstruction
def context_edges(prisms: list[dict]) -> np.ndarray:
    """[x0, y0, x1, y1, height] for every footprint edge of every building."""
    rows = []
    for p in prisms:
        for ring in p["rings"]:
            for i in range(len(ring) - 1):
                rows.append([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], p["height"]])
    return np.asarray(rows, dtype=float)


def horizon(edges: np.ndarray, x: float, y: float, z: float, normal_az: float, min_t: float = 0.4) -> np.ndarray:
    """Obstruction elevation (rad) per relative azimuth in AZ_REL, seen from (x, y, z) looking out along normal_az."""
    az = normal_az + AZ_REL
    dx, dy = np.sin(az), np.cos(az)                                 # azimuth from north, clockwise
    ex0, ey0 = edges[:, 0], edges[:, 1]
    sx, sy = edges[:, 2] - ex0, edges[:, 3] - ey0
    h = edges[:, 4]
    # ray P + t d, segment E0 + u s: solve for t, u
    den = dx[:, None] * sy[None, :] - dy[:, None] * sx[None, :]
    qx, qy = ex0[None, :] - x, ey0[None, :] - y
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (qx * sy[None, :] - qy * sx[None, :]) / den
        u = (qx * dy[:, None] - qy * dx[:, None]) / den
        ok = (np.abs(den) > 1e-9) & (t > min_t) & (u >= 0) & (u <= 1)
        el = np.where(ok, np.arctan2(h[None, :] - z, t), -np.pi / 2)
    return np.maximum(el.max(axis=1), 0.0)


def _c_factor(angle_deg: float) -> float:
    for (a0, c0), (a1, c1) in zip(C_TABLE, C_TABLE[1:]):
        if angle_deg <= a1:
            return c0 + (c1 - c0) * (angle_deg - a0) / (a1 - a0)
    return 5.0


# ---------------------------------------------------------------------------- windows
def floor_windows(F, edges, added: bool = False) -> dict:
    """Every facade window of the floor with its geometry and its obstruction horizon."""
    base = F.z + F.slab_t
    wall_of = {w["id"]: w for w in F.walls}
    out = {}
    for o in F.openings:
        if o["kind"] != "window":
            continue
        w = wall_of[o["wall"]]
        if w["cat"] != "E":
            continue
        t = F.thick(w)
        (ux, uy), _ = M.L._unit(w["a"], w["b"])
        nx, ny = uy, -ux                                             # outward
        sm = (o["s0"] + o["s1"]) / 2
        cx = w["a"][0] + ux * sm
        cy = w["a"][1] + uy * sm
        z0, z1 = base + o["z0"], base + o["z1"]
        n_az = math.atan2(nx, ny)
        hz = horizon(edges, cx + nx * (t / 2 + 0.05), cy + ny * (t / 2 + 0.05), (z0 + z1) / 2, n_az)
        out[o["id"]] = {"a": (w["a"][0] + ux * o["s0"] + nx * t / 2, w["a"][1] + uy * o["s0"] + ny * t / 2),
                        "u": (ux, uy), "n": (nx, ny), "width": o["s1"] - o["s0"], "z0": z0, "z1": z1,
                        "n_az": n_az, "horizon": hz, "new": bool(o.get("new")) or added}
        out[o["id"]]["vt"] = VT["new"] if out[o["id"]]["new"] else VT["existing"]
    return out


# ---------------------------------------------------------------------------- analysis
def sensor_grid(poly_xy, holes, spacing):
    from shapely.geometry import Polygon
    p = Polygon(poly_xy, holes or []).buffer(-0.3, join_style=2)
    if p.is_empty:
        return np.zeros((0, 2))
    x0, y0, x1, y1 = p.bounds
    xs = np.arange(x0 + spacing / 2, x1, spacing)
    ys = np.arange(y0 + spacing / 2, y1, spacing)
    pp = prep(p)
    pts = [(x, y) for x in xs for y in ys if pp.contains(Point(x, y))]
    if not pts:
        c = p.representative_point()
        pts = [(c.x, c.y)]
    return np.asarray(pts)


def unit_daylight(unit, wins: dict, base_z: float, wall_h: float, spacing: float, vt_factor: float) -> dict:
    pts = sensor_grid(unit["poly"], unit.get("holes"), spacing)
    z = base_z + 0.8
    uw = [wins[i] for i in unit["windows"] if i in wins]
    n = len(pts)
    if n == 0:
        return {"points": [], "mean": 0.0}
    sc = np.zeros(n)
    nu, nv = 6, 4
    for w in uw:
        T = w["vt"] * MAINT * FRAME * vt_factor
        du = w["width"] / nu
        dv = (w["z1"] - w["z0"]) / nv
        s = (np.arange(nu) + 0.5) * du
        v = w["z0"] + (np.arange(nv) + 0.5) * dv
        qx = w["a"][0] + w["u"][0] * s                               # (nu,)
        qy = w["a"][1] + w["u"][1] * s
        QX, QZ = np.meshgrid(qx, v, indexing="ij")
        QY, _ = np.meshgrid(qy, v, indexing="ij")
        QX, QY, QZ = QX.ravel(), QY.ravel(), QZ.ravel()              # (k,)
        vx = QX[None, :] - pts[:, 0:1]
        vy = QY[None, :] - pts[:, 1:2]
        vz = QZ[None, :] - z
        d2 = vx * vx + vy * vy + vz * vz
        d = np.sqrt(d2)
        cos_n = (vx * w["n"][0] + vy * w["n"][1]) / d                # angle to the window normal
        sin_g = vz / d                                               # altitude of the ray
        az = np.arctan2(vx, vy)
        rel = (az - w["n_az"] + np.pi) % (2 * np.pi) - np.pi
        idx = np.clip(((rel - AZ_REL[0]) / math.radians(AZ_STEP)).round().astype(int), 0, len(AZ_REL) - 1)
        hor = w["horizon"][idx]
        g = np.arcsin(np.clip(sin_g, -1, 1))
        domega = du * dv * np.clip(cos_n, 0, None) / d2
        sky = g > hor
        lum = np.where(sky, (1 + 2 * np.clip(sin_g, 0, None)) / 3, 0.1)
        contrib = T * lum * np.clip(sin_g, 0, None) * domega
        sc += contrib.sum(axis=1)
    df_direct = 100 * sc / (7 * math.pi / 9)
    # internally reflected component (uniform)
    A_f = unit["area"]
    perim = sum(math.dist(unit["poly"][i], unit["poly"][i + 1]) for i in range(len(unit["poly"]) - 1))
    A_tot = 2 * A_f + perim * wall_h
    W = sum(w["width"] * (w["z1"] - w["z0"]) for w in uw)
    if W > 0:
        ang = float(np.degrees(np.mean([np.mean(w["horizon"][len(AZ_REL) // 2 - 6: len(AZ_REL) // 2 + 6]) for w in uw])))
        T = np.mean([w["vt"] for w in uw]) * MAINT * FRAME * vt_factor
        irc = T * W / (A_tot * (1 - R_MEAN)) * (_c_factor(ang) * R_FW + 5 * R_CW)
    else:
        irc, ang = 0.0, 90.0
    df = df_direct + irc
    return {"points": [[round(float(x), 2), round(float(y), 2), round(float(v), 2)] for (x, y), v in zip(pts, df)],
            "mean": round(float(df.mean()), 2), "median": round(float(np.median(df)), 2),
            "min": round(float(df.min()), 2), "max": round(float(df.max()), 2),
            "area_300": round(float((df >= DF_300).mean()), 3), "area_100": round(float((df >= DF_100).mean()), 3),
            "pass_en17037": bool((df >= DF_300).mean() >= 0.5 and (df >= DF_100).mean() >= 0.95),
            "irc": round(float(irc), 2), "obstruction_deg": round(ang, 1), "glazing_m2": round(W, 1)}


def floor_daylight(site: "M.Site", bid: str, index: int, raw: dict | None, context_settings: dict | None = None,
                   spacing: float = 0.75) -> dict:
    sc = site.scenario(bid, raw)
    F = sc["res"]["floors"][index]
    prisms = site.context_prisms(dict(context_settings or {}, **{bid: raw or {}}))
    edges = context_edges(prisms)
    wins = floor_windows(F, edges, added=index >= sc["levels"])
    base = F.z + F.slab_t
    units = {}
    for u in sc["units"][index]:
        if u["kind"] != "unit" and not u["windows"]:
            continue
        units[u["id"]] = unit_daylight(u, wins, base, F.wall_h, spacing, 1.0)
        units[u["id"]].update(name=u["name"], area=u["area"])
    vals = [p[2] for d in units.values() for p in d["points"]]
    arr = np.asarray(vals) if vals else np.zeros(1)
    lettable = [d for d in units.values() if d["points"]]
    return {"building": bid, "floor": index, "method": "quick", "spacing": spacing,
            "units": units, "summary": {
                "mean_df": round(float(arr.mean()), 2), "median_df": round(float(np.median(arr)), 2),
                "area_300": round(float((arr >= DF_300).mean()), 3),
                "area_100": round(float((arr >= DF_100).mean()), 3),
                "units_pass": sum(1 for d in lettable if d["pass_en17037"]), "units": len(lettable),
                "sensors": int(arr.size)},
            "note": "Quick split-flux estimate under a CIE overcast sky with site obstructions. "
                    "Use the Radiance run (Ladybug Tools) for a validated daylight factor."}
