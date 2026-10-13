"""
mvk.pricing - cost and carbon from the Marievik+ component catalogue.

The Marievik+ catalogue (data/components/catalogue.json) is the single source of truth for
cost and carbon. components_db.csv only carries geometry (thickness, door size) plus a
`catalogue_id` link. Pricing follows Marievik+ engine/evaluate.py exactly:

  capex           = (material + labour_install) * qty
  upfront carbon  = (A1A3 + A4 + A5) * qty                 <- the headline, as in the dashboard
  C1C4            reported, end of life
  D               reported separately, never netted (EN 15978)

States (conversion of an existing shell):
  retained   existing shell element (facade, core, slabs, existing windows): no new carbon or cost
  new        new fit-out element: priced from the catalogue
  unpriced   an intervention with no catalogue entry yet (e.g. cutting an atrium into a slab):
             quantity is reported, never silently set to zero cost
Elements whose type has no catalogue link are priced from the CSV and flagged `mock_csv`.
"""
import json
import os

# mvk lives in <Marievik+>/parametric/mvk, so the repository root is two levels up
MARIEVIK_DEFAULT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_catalogue(root=None):
    """Return {component_id: component} from <Marievik+>/data/components/catalogue.json, or {}."""
    for base in [root, os.environ.get("MARIEVIK_PLUS"), MARIEVIK_DEFAULT]:
        if not base:
            continue
        p = os.path.join(base, "data", "components", "catalogue.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                raw = json.load(f)
            cat = {c["id"]: c for c in raw["components"]}
            cat["__path__"] = p
            return cat
    return {}


def _is_placeholder(block):
    return str((block or {}).get("provenance", "")).upper() == "PLACEHOLDER"


def price(qty, type_id, db, catalogue, state="new"):
    """Return a dict of pricing fields for qty of a components_db type."""
    out = {"component": None, "layer": None, "priced_by": state, "capex_sek": 0.0, "a1a3": 0.0, "a4": 0.0,
           "a5": 0.0, "c1c4": 0.0, "d": 0.0, "upfront_kgco2e": 0.0, "placeholder": None}
    row = db.get(type_id) or {}
    cid = row.get("catalogue_id") or None
    out["component"] = cid
    if state in ("retained", "unpriced"):
        if cid and cid in catalogue:
            out["layer"] = catalogue[cid]["layer"]
        return out
    if cid and cid in catalogue:
        c = catalogue[cid]
        cost, carb = c["cost_sek"], c["carbon_kgco2e"]
        out.update(layer=c["layer"], priced_by="catalogue",
                   capex_sek=qty * (cost["material"] + cost["labour_install"]),
                   a1a3=qty * carb["A1A3"], a4=qty * carb.get("A4", 0.0), a5=qty * carb.get("A5", 0.0),
                   c1c4=qty * carb.get("C1C4", 0.0), d=qty * carb.get("D", 0.0),
                   placeholder=_is_placeholder(cost) or _is_placeholder(carb))
        out["upfront_kgco2e"] = out["a1a3"] + out["a4"] + out["a5"]
    else:
        g = row.get("gwp_kgco2e_per_unit") or 0.0
        out.update(priced_by="mock_csv", layer={"ext_wall": "skin", "slab": "structure", "window": "skin"}.get(row.get("category"), "space_plan"),
                   capex_sek=qty * (row.get("cost_sek_per_unit") or 0.0), a1a3=qty * g, upfront_kgco2e=qty * g, placeholder=True)
    return out
