"""Life on the site, Urban scale: AMF's events and activities timeline for Marievik (permanent and temporary, 2024-2030)
and the amenities around it (restaurants, cafés, bars, hotel, spa, parks...), placed in the model's coordinates.

Data: data/projects/<project>/urban_life.json, kept in WGS84 lat/lon as found (OpenStreetMap, addresses, AMF's pages);
converted here to SWEREF 99 TM (EPSG:3006) minus the site origin, the frame every footprint in the model uses.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# GRS80 ellipsoid, SWEREF 99 TM projection (Lantmäteriet's Gauss-Krüger formulas)
_A, _F = 6378137.0, 1 / 298.257222101
_LON0, _K0, _FE = math.radians(15.0), 0.9996, 500000.0


def sweref99tm(lat: float, lon: float) -> tuple[float, float]:
    """WGS84 (practically = SWEREF 99) lat/lon in degrees -> (E, N) metres in SWEREF 99 TM."""
    e2 = _F * (2 - _F)
    n = _F / (2 - _F)
    a_hat = _A / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    A, B = e2, (5 * e2 ** 2 - e2 ** 3) / 6
    C, D = (104 * e2 ** 3 - 45 * e2 ** 4) / 120, 1237 * e2 ** 4 / 1260
    phi, lam = math.radians(lat), math.radians(lon)
    s = math.sin(phi)
    phi_s = phi - s * math.cos(phi) * (A + B * s ** 2 + C * s ** 4 + D * s ** 6)
    dl = lam - _LON0
    xi = math.atan(math.tan(phi_s) / math.cos(dl))
    eta = math.atanh(math.cos(phi_s) * math.sin(dl))
    b = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180,
         13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
         61 * n ** 3 / 240 - 103 * n ** 4 / 140,
         49561 * n ** 4 / 161280]
    N = _K0 * a_hat * (xi + sum(bi * math.sin(2 * (i + 1) * xi) * math.cosh(2 * (i + 1) * eta) for i, bi in enumerate(b)))
    E = _K0 * a_hat * (eta + sum(bi * math.cos(2 * (i + 1) * xi) * math.sinh(2 * (i + 1) * eta) for i, bi in enumerate(b))) + _FE
    return E, N


def site_life(site, project: str = "marievik") -> dict:
    """The timeline and the amenities with local x, y (metres, the site's own origin)."""
    p = ROOT / "data" / "projects" / project / "urban_life.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    oe, on = site.site.get("origin_E", 672400.0), site.site.get("origin_N", 6578480.0)

    def place(item):
        if item.get("lat") is None:
            b = site.buildings.get(item.get("building") or "")
            if b:   # placed by description only ("next to Varuhuset"): at that building
                from shapely.geometry import Polygon
                c = Polygon(b["footprint"]).centroid
                return dict(item, x=round(c.x, 1), y=round(c.y, 1))
            return dict(item, x=None, y=None)
        E, N = sweref99tm(item["lat"], item["lon"])
        return dict(item, x=round(E - oe, 1), y=round(N - on, 1))

    return {"_meta": data["_meta"], "categories": data["categories"],
            "timeline": [place(t) for t in data["timeline"]], "amenities": [place(a) for a in data["amenities"]]}
