"""
mvk.site - the Marievik site: building footprints, storeys and assumed uses.

site/marievik_site.json (next to this package) holds every building as
  id, name, osm_id, levels, height_m, current_use (office | residential), ground_use,
  footprint [[x, y], ...], holes [[[x, y], ...]], role (study | context)
Coordinates are SWEREF 99 TM minus (origin_E, origin_N), in metres, so the Rhino model
lines up with any Swedish GIS data (Lantmateriet, Stockholms stad) after adding the origin.
Footprints and storey counts come from OpenStreetMap; names and uses are assumptions
from aerial images until real plans replace them.
"""
import json
import os

from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_FILE = os.path.join(os.path.dirname(HERE), "site", "marievik_site.json")

# current use in the site file -> use profile in use_profiles.json
USE_FOR = {"office": "office_cellular", "residential": "residential", "retail": "retail",
           "hotel": "hotel", "school": "school"}


def load(path=None):
    with open(path or SITE_FILE, encoding="utf-8") as f:
        return json.load(f)


def buildings(site=None):
    site = site or load()
    return {b["id"]: b for b in site["buildings"]}


def footprint(b):
    return Polygon(b["footprint"], b.get("holes") or [])


def profile_uses(b, use="site", ground_use="site"):
    """Resolve 'site' to the building's own current use."""
    up = USE_FOR.get(b["current_use"], "office_cellular") if use in (None, "", "site") else use
    gr = b.get("ground_use", "retail") if ground_use in (None, "", "site") else ground_use
    return gr, up


def floor_heights(b, n, ground_h=None, floor_h=None):
    res = b["current_use"] == "residential"
    g = ground_h or (3.6 if res else 4.5)
    f = floor_h or (3.0 if res else 3.5)
    if b.get("height_m") and not (ground_h or floor_h) and n > 1:
        f = max(2.8, min(4.2, (b["height_m"] - g) / (n - 1)))
    return [g] + [f] * (n - 1)
