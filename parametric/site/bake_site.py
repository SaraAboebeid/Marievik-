#! python3
# Bake the Marievik site into the open Rhino file:
#   Site::Footprints::<id>   closed footprint curves with user text (id, name, levels, use, osm id)
#   Site::Massing::<id>      one solid per storey (toggle a building's layer to hide it)
#   Site::Streets            street centrelines from OpenStreetMap
# Re-running replaces what an earlier run baked. Coordinates: SWEREF 99 TM minus the origin in the site file.
import json
import os
import System
import Rhino
import Rhino.Geometry as rg

LIB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # <Marievik+>/parametric
doc = Rhino.RhinoDoc.ActiveDoc
with open(os.path.join(LIB, "site", "marievik_site.json"), encoding="utf-8") as f:
    SITE = json.load(f)

USE_COL = {"office": System.Drawing.Color.FromArgb(205, 200, 190), "residential": System.Drawing.Color.FromArgb(222, 206, 178)}
MATS = SITE.get("materials", {})
_mat_idx = {}


def material(key):
    """Render material + display colour for a facade material key (site file "materials")."""
    if key not in MATS:
        return -1, None
    col = System.Drawing.Color.FromArgb(*MATS[key])
    if key not in _mat_idx:
        name = "MVK " + key
        i = doc.Materials.Find(name, True)
        if i < 0:
            m = Rhino.DocObjects.Material()
            m.Name = name
            m.DiffuseColor = col
            i = doc.Materials.Add(m)
        _mat_idx[key] = i
    return _mat_idx[key], col


def floor_material(b, i):
    f = b.get("facade") or {}
    if f.get("base_material") and i < f.get("base_floors", 0):
        return f["base_material"]
    return f.get("material")


def layer(path, color=None, visible=True):
    parent, cur, idx = System.Guid.Empty, "", -1
    for name in path.split("::"):
        cur = name if not cur else cur + "::" + name
        idx = doc.Layers.FindByFullPath(cur, -1)
        if idx < 0:
            L = Rhino.DocObjects.Layer()
            L.Name = name
            if parent != System.Guid.Empty:
                L.ParentLayerId = parent
            if color is not None:
                L.Color = color
            idx = doc.Layers.Add(L)
        parent = doc.Layers[idx].Id
    lay = doc.Layers[idx]
    lay.IsVisible = visible
    return idx


def clear(path):
    idx = doc.Layers.FindByFullPath(path, -1)
    if idx < 0:
        return
    for o in doc.Objects.FindByLayer(doc.Layers[idx]) or []:
        doc.Objects.Delete(o, True)


def attrs(li, name, data):
    a = Rhino.DocObjects.ObjectAttributes()
    a.LayerIndex = li
    a.Name = name
    for k, v in data.items():
        a.SetUserString(k, str(v))
    return a


def heights(b, n):
    res = b["current_use"] == "residential"
    g, f = (3.6, 3.0) if res else (4.5, 3.5)
    if b.get("height_m") and n > 1:
        f = max(2.8, min(4.2, (b["height_m"] - g) / (n - 1)))
    return [g] + [f] * (n - 1)


for b in SITE["buildings"]:
    bid = b["id"]
    for sub in ("Footprints", "Massing"):
        clear("Site::%s::%s" % (sub, bid))
    data = {"building_id": bid, "name": b["name"], "levels": b["levels"], "current_use": b["current_use"],
            "osm_id": b["osm_id"], "role": b["role"], "source": "OpenStreetMap (ODbL)"}
    lf = layer("Site::Footprints::%s" % bid, System.Drawing.Color.FromArgb(200, 40, 40))
    rings = [b["footprint"]] + (b.get("holes") or [])
    crvs = [rg.PolylineCurve([rg.Point3d(x, y, 0) for x, y in r]) for r in rings]
    for i, c in enumerate(crvs):
        doc.Objects.AddCurve(c, attrs(lf, "%s_footprint%s" % (bid, "" if i == 0 else "_hole%d" % i), data))
    lm = layer("Site::Massing::%s" % bid, USE_COL.get(b["current_use"]), visible=(b["role"] != "study"))
    plan = rg.Brep.CreatePlanarBreps(crvs, 0.001)
    if not plan:
        continue
    z = 0.0
    for i, h in enumerate(heights(b, int(b["levels"]))):
        f = plan[0].DuplicateBrep()
        f.Translate(0, 0, z)
        e = f.Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, h - 0.05)), True)
        if e:
            a = attrs(lm, "%s_F%02d" % (bid, i), dict(data, floor=i, z_base=round(z, 2), facade=floor_material(b, i) or ""))
            mi, col = material(floor_material(b, i))
            if col is not None:
                a.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject
                a.ObjectColor = col
                a.MaterialSource = Rhino.DocObjects.ObjectMaterialSource.MaterialFromObject
                a.MaterialIndex = mi
            doc.Objects.AddBrep(e, a)
        z += h

clear("Site::Streets")
ls = layer("Site::Streets", System.Drawing.Color.FromArgb(150, 150, 150))
for r in SITE.get("roads", []):
    doc.Objects.AddCurve(rg.PolylineCurve([rg.Point3d(x, y, 0) for x, y in r["pts"]]),
                         attrs(ls, r.get("name") or r["kind"], {"kind": r["kind"], "name": r.get("name", "")}))

# the hand-traced B01 from the first session is superseded by the OSM footprint
for path in ("Buildings",):
    i = doc.Layers.FindByFullPath(path, -1)
    if i >= 0:
        doc.Layers[i].IsVisible = False
doc.Views.Redraw()
print("Baked %d buildings and %d street lines" % (len(SITE["buildings"]), len(SITE.get("roads", []))))
