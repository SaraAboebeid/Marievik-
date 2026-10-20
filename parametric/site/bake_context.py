#! python3
# Bake the Marievik urban context (site/marievik_context.json, from site/make_context.py) into the open
# Rhino file, under Site::Context::... Re-running replaces the earlier bake. Each layer gets a render
# material, so the Rendered and Arctic views show asphalt, paving, grass, water, timber and trees.
import json
import math
import os
import random

import System
import Rhino
import Rhino.Geometry as rg

# the parametric model lives in Marievik+\parametric (older copy: Desktop\Marievik_parametric)
LIB = next(p for p in (r"C:\Users\saraabo\Desktop\Marievik+\parametric", r"C:\Users\saraabo\Desktop\Marievik_parametric")
           if os.path.exists(os.path.join(p, "site", "marievik_context.json")))
doc = Rhino.RhinoDoc.ActiveDoc
with open(os.path.join(LIB, "site", "marievik_context.json"), encoding="utf-8") as f:
    C = json.load(f)
random.seed(11)

COL = {
    "Ground": (205, 202, 194), "Roads": (78, 80, 84), "Roads::Bridges": (120, 122, 126), "Paths": (196, 190, 178),
    "Paths::Boardwalk": (150, 118, 82), "Paths::Gravel": (214, 200, 166), "Plazas": (210, 204, 192),
    "Greens::Grass": (128, 170, 96), "Greens::Park": (118, 164, 88), "Greens::Wood": (86, 128, 70),
    "Greens::Scrub": (122, 150, 92), "Greens::Other": (150, 170, 120), "Water": (78, 112, 136),
    "Piers": (132, 100, 68), "Rail": (110, 90, 76), "Buildings": (226, 224, 218),
    "Trees::Crowns": (76, 122, 58), "Trees::Trunks": (92, 72, 56), "Lamps": (60, 62, 66), "Benches": (120, 92, 64),
}
GREEN_LAYER = {"grass": "Greens::Grass", "park": "Greens::Park", "wood": "Greens::Wood", "scrub": "Greens::Scrub"}
_mat = {}


def color(c):
    return System.Drawing.Color.FromArgb(*c)


def layer(sub):
    path = "Site::Context::" + sub
    parent, cur, idx = System.Guid.Empty, "", -1
    for name in path.split("::"):
        cur = name if not cur else cur + "::" + name
        idx = doc.Layers.FindByFullPath(cur, -1)
        if idx < 0:
            L = Rhino.DocObjects.Layer()
            L.Name = name
            if parent != System.Guid.Empty:
                L.ParentLayerId = parent
            idx = doc.Layers.Add(L)
        parent = doc.Layers[idx].Id
    c = COL.get(sub)
    if c:
        lay = doc.Layers[idx]
        lay.Color = color(c)
        if sub not in _mat:
            m = Rhino.DocObjects.Material()
            m.Name = "MVK ctx " + sub
            m.DiffuseColor = color(c)
            if sub == "Water":
                m.Reflectivity = 0.4
                m.Shine = 200
            _mat[sub] = doc.Materials.Add(m)
        lay.RenderMaterialIndex = _mat[sub]
    return idx


def clear():
    i = doc.Layers.FindByFullPath("Site::Context", -1)
    if i < 0:
        return
    root = doc.Layers[i]
    ids = [root.Index] + [l.Index for l in doc.Layers if not l.IsDeleted and l.FullPath.startswith("Site::Context::")]
    for li in ids:
        for o in doc.Objects.FindByLayer(doc.Layers[li]) or []:
            doc.Objects.Delete(o, True)


def attrs(li, name="", data=None):
    a = Rhino.DocObjects.ObjectAttributes()
    a.LayerIndex = li
    a.Name = name
    for k, v in (data or {}).items():
        a.SetUserString(k, str(v))
    a.SetUserString("source", C.get("source", "OpenStreetMap"))
    return a


def surfaces(rings_list, z, li, name="", thickness=0.0, data=None):
    n = 0
    for rings in rings_list:
        crvs = [rg.PolylineCurve([rg.Point3d(x, y, z) for x, y in r]) for r in rings if len(r) >= 4]
        if not crvs:
            continue
        for b in rg.Brep.CreatePlanarBreps(crvs, 0.01) or []:
            if thickness:
                e = b.Faces[0].CreateExtrusion(rg.LineCurve(rg.Point3d(0, 0, 0), rg.Point3d(0, 0, thickness)), True)
                b = e or b
            doc.Objects.AddBrep(b, attrs(li, name, data))
            n += 1
    return n


def tree_mesh(x, y, h, needle):
    trunk_h = h * (0.45 if needle else 0.38)
    r = max(0.12, h * 0.018)
    trunk = rg.Mesh.CreateFromCylinder(rg.Cylinder(rg.Circle(rg.Plane(rg.Point3d(x, y, 0), rg.Vector3d.ZAxis), r), trunk_h), 1, 8)
    if needle:
        cone = rg.Cone(rg.Plane(rg.Point3d(x, y, h), -rg.Vector3d.ZAxis), h - trunk_h * 0.6, h * 0.2)
        crown = rg.Mesh.CreateFromCone(cone, 4, 10)
    else:
        cr = h * random.uniform(0.27, 0.34)
        crown = rg.Mesh.CreateFromSphere(rg.Sphere(rg.Point3d(x, y, h - cr), cr), 10, 7)
        crown.Transform(rg.Transform.Scale(rg.Plane(rg.Point3d(x, y, h - cr), rg.Vector3d.ZAxis), 1.0, 1.0, 0.85))
    return trunk, crown


clear()
counts = {}
li = layer("Ground")
x0, y0, x1, y1 = C["clip"]
counts["ground"] = surfaces([[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]], -0.05, li, "ground")
for w in C["water"]:
    counts["water"] = counts.get("water", 0) + surfaces(w["rings"], -0.03, layer("Water"), w.get("name", "water"))
for g in C["greens"]:
    sub = GREEN_LAYER.get(g["kind"], "Greens::Other")
    counts["greens"] = counts.get("greens", 0) + surfaces(g["rings"], 0.02, layer(sub), g.get("name", ""), data={"kind": g["kind"]})
for g in C["plazas"]:
    surfaces(g["rings"], 0.03, layer("Plazas"), "plaza")
for g in C["roads"]:
    sub = "Roads" if not g.get("z") else "Roads::Bridges"
    counts["roads"] = counts.get("roads", 0) + surfaces(g["rings"], 0.04 + g.get("z", 0), layer(sub), g.get("name", ""), 0.0 if not g.get("z") else -0.8)
for g in C["paths"]:
    sub = {"wood": "Paths::Boardwalk", "gravel": "Paths::Gravel"}.get(g.get("surface"), "Paths")
    counts["paths"] = counts.get("paths", 0) + surfaces(g["rings"], 0.06 + g.get("z", 0), layer(sub), g.get("kind", ""))
for g in C["piers"]:
    counts["piers"] = counts.get("piers", 0) + surfaces(g["rings"], 0.0, layer("Piers"), "pier", 0.4)
lr = layer("Rail")
for r in C["rail"]:
    for ln in r["lines"]:
        crv = rg.PolylineCurve([rg.Point3d(x, y, 0.1 + r.get("z", 0)) for x, y in ln])
        doc.Objects.AddCurve(crv, attrs(lr, r["kind"]))
        for off in (-0.72, 0.72):
            o = crv.Offset(rg.Plane.WorldXY, off, 0.01, rg.CurveOffsetCornerStyle.Sharp)
            if o:
                for oc in o:
                    doc.Objects.AddCurve(oc, attrs(lr, "rail"))
lb = layer("Buildings")
for b in C["buildings"]:
    counts["buildings"] = counts.get("buildings", 0) + surfaces(b["rings"], 0.0, lb, b.get("name", ""), b["h"], {"height_m": b["h"]})
lc, lt = layer("Trees::Crowns"), layer("Trees::Trunks")
for t in C["trees"]:
    trunk, crown = tree_mesh(t["p"][0], t["p"][1], t["h"], t.get("leaf") == "needleleaved")
    data = {"height_m": t["h"], "leaf_type": t.get("leaf", ""), "species": t.get("species", ""), "tree_source": t["src"]}
    doc.Objects.AddMesh(trunk, attrs(lt, "trunk", data))
    doc.Objects.AddMesh(crown, attrs(lc, "tree", data))
counts["trees"] = len(C["trees"])
ll = layer("Lamps")
for x, y in C["lamps"]:
    pole = rg.Mesh.CreateFromCylinder(rg.Cylinder(rg.Circle(rg.Plane(rg.Point3d(x, y, 0), rg.Vector3d.ZAxis), 0.07), 5.5), 1, 6)
    head = rg.Mesh.CreateFromBox(rg.Box(rg.Plane(rg.Point3d(x, y, 5.5), rg.Vector3d.ZAxis), rg.Interval(-0.25, 0.25), rg.Interval(-0.15, 0.15), rg.Interval(0, 0.18)), 1, 1, 1)
    pole.Append(head)
    doc.Objects.AddMesh(pole, attrs(ll, "street lamp"))
lbn = layer("Benches")
for x, y in C["benches"]:
    doc.Objects.AddBrep(rg.Box(rg.Plane(rg.Point3d(x, y, 0), rg.Vector3d.ZAxis), rg.Interval(-0.9, 0.9), rg.Interval(-0.25, 0.25), rg.Interval(0, 0.45)).ToBrep(), attrs(lbn, "bench"))

# the older OSM street centrelines stay, but hidden; the surfaces replace them
i = doc.Layers.FindByFullPath("Site::Streets", -1)
if i >= 0:
    doc.Layers[i].IsVisible = False
doc.Views.Redraw()
print("Context baked:", counts)
