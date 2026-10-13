#! python3
# Builds MVK_parametric.gh: one MVK Building component per site building (own uses, floors, partitions, overrides),
# shared settings on the left, shared previews and a site summary on the right.
# Run from Rhino's ScriptEditor (Grasshopper must be loaded once: type Grasshopper).
import os
import json
import System
import Rhino
import Grasshopper as gh
from Grasshopper.Kernel import GH_Document, GH_DocumentIO, GH_ParameterSide, GH_ParamAccess, GH_ParamWireDisplay
from Grasshopper.Kernel.Special import GH_NumberSlider, GH_Panel, GH_ValueList, GH_ValueListItem, GH_BooleanToggle, GH_ColourSwatch, GH_Group
from Grasshopper.Kernel.Parameters import Param_Curve
from System.Drawing import PointF, Color

LIB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # <Marievik+>/parametric
MVPLUS = os.path.dirname(LIB)                                        # the Marievik+ repository
SAVE = os.path.join(LIB, "MVK_parametric.gh")
rdoc = Rhino.RhinoDoc.ActiveDoc
D = GH_Document()


def impl(o):
    return getattr(o, "__implementation__", o)


def place(obj, x, y, nick=None):
    obj.CreateAttributes()
    if nick:
        obj.NickName = nick
    obj.Attributes.Pivot = PointF(x, y)
    D.AddObject(obj, False)
    return obj


def comp(name, x, y, nick=None):
    proxy = gh.Instances.ComponentServer.FindObjectByName(name, True, True)
    if proxy is None:
        raise Exception("component not found: " + name)
    return place(impl(proxy.CreateInstance()), x, y, nick)


def slider(nick, lo, hi, val, dec, x, y):
    s = GH_NumberSlider()
    s.Slider.Minimum = System.Decimal(lo)
    s.Slider.Maximum = System.Decimal(hi)
    s.Slider.DecimalPlaces = dec
    s.SetSliderValue(System.Decimal(val))
    s = place(s, x, y, nick)
    return s


def panel(nick, text, x, y, multiline=False, w=None, h=None, color=None):
    p = GH_Panel()
    p.UserText = text
    p.Properties.Multiline = multiline
    p = place(p, x, y, nick)
    if w:
        p.Attributes.Bounds = System.Drawing.RectangleF(x, y, w, h or 100)
    if color:
        p.Properties.Colour = color
    return p


def vlist(nick, items, sel, x, y):
    v = GH_ValueList()
    v.ListItems.Clear()
    for label, key in items:
        v.ListItems.Add(GH_ValueListItem(label, '"%s"' % key))
    v.SelectItem(sel)
    return place(v, x, y, nick)


def toggle(nick, val, x, y):
    t = GH_BooleanToggle()
    t.Value = val
    return place(t, x, y, nick)


def swatch(col, x, y):
    s = GH_ColourSwatch()
    s.SwatchColour = col
    return place(s, x, y)


def wire(src, dst):
    dst.AddSource(src)



def script_component(nick, x, y, inputs, outputs, source):
    sc = comp("Python 3 Script", x, y, nick)
    P = sc.Params
    for prm in list(P.Input):
        P.UnregisterInputParameter(prm)
    for prm in list(P.Output):
        if prm.NickName != "out":
            P.UnregisterOutputParameter(prm)
    for i, (nm, acc) in enumerate(inputs):
        prm = impl(sc.CreateParameter(GH_ParameterSide.Input, i))
        prm.Name = prm.NickName = prm.Description = nm
        prm.Access = acc
        P.RegisterInputParam(prm, i)
    off = P.Output.Count
    for j, nm in enumerate(outputs):
        prm = impl(sc.CreateParameter(GH_ParameterSide.Output, off + j))
        prm.Name = prm.NickName = prm.Description = nm
        P.RegisterOutputParam(prm, off + j)
    P.OnParametersChanged()
    sc.VariableParameterMaintenance()
    sc.SetSource(source)
    return sc


def inp(c, nm):
    return [p for p in c.Params.Input if p.NickName == nm][0]


def outp(c, nm):
    return [p for p in c.Params.Output if p.NickName == nm][0]


def group(nick, objs, col):
    g = GH_Group()
    g.CreateAttributes()
    g.NickName = nick
    g.Colour = col
    for o in objs:
        g.AddObject(o.InstanceGuid)
    D.AddObject(g, False)
    return g


STUB = """#! python3
# r: shapely
# %s: the real code lives in <lib>/gh/%s (edit it there, then recompute).
import os
_LIB = lib if lib else r"%s"
exec(open(os.path.join(_LIB, "gh", "%s"), encoding="utf-8").read())
"""

with open(os.path.join(LIB, "mvk", "use_profiles.json"), encoding="utf-8") as f:
    profs = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
USES = [("Current use (site data)", "site")] + [(v["label"], k) for k, v in profs.items()]
SYSTEMS = [("As in use profile", "as_profile"), ("Conventional stud", "conventional"),
           ("Demountable", "demountable"), ("Glazed", "glass")]
with open(os.path.join(LIB, "site", "marievik_site.json"), encoding="utf-8") as f:
    SITE = json.load(f)["buildings"]

# ------------------------------------------------------------------ layout
# Two columns of building rows. Each row = one group: controls | MVK component | summary panel.
# Wires to the shared settings (top) and to the shared previews / site summary (right) are hidden,
# so only the wires inside each building's group are drawn.
ROW_H, COL_W, X0, Y0 = 470, 1320, 40, 330
CTRL_W, COMP_X, SUM_X, VL = 300, 470, 720, 110   # VL: value lists / sliders / toggles hang left of their pivot


def hide(param):
    param.WireDisplay = GH_ParamWireDisplay.hidden


# ------------------------------------------------------------------ shared settings (top band)
libp = panel("lib", LIB, X0, 30, True, 260, 30)
mvp = panel("Marievik+ folder", MVPLUS, X0, 80, True, 260, 30)
shellt = toggle("Existing shell (conversion)", True, X0 + 430, 30)
ids = toggle("Show IDs", False, X0 + 430, 60)
sf = slider("Show floor (-1 = all)", -1, 19, -1, 0, X0 + 430, 90)
exp = toggle("Export to dashboard (each building)", False, X0 + 430, 125)
fac = toggle("Facade, materials & roof detail", True, X0 + 430, 160)
note = panel("README", "\n".join([
    "MVK site model - one group per building. Shared settings are in this top band; their wires are hidden.",
    "In each group: ground / upper use, floors (0 = site data), partition system, Detail (full 3D layout or massing),",
    "overrides JSON, walls to remove (ids), walls to add (lines). The blue panel shows that building's cost and carbon.",
    "Show IDs = true to see wall / door ids. Cost & carbon: Marievik+ catalogue; existing shells are retained.",
    "Previews and the Site summary are on the right. Export = true writes Marievik+\\runs\\grasshopper\\Bxx.json."]),
    X0 + 760, 20, True, 900, 120)
shared = group("Shared settings", [libp, mvp, shellt, ids, sf, exp, fac, note], Color.FromArgb(70, 200, 200, 200))

INPUTS = [("building", GH_ParamAccess.item), ("ground_use", GH_ParamAccess.item), ("use", GH_ParamAccess.item),
          ("floors", GH_ParamAccess.item), ("partition_system", GH_ParamAccess.item), ("detail", GH_ParamAccess.item),
          ("overrides", GH_ParamAccess.item), ("remove_walls", GH_ParamAccess.list), ("add_walls", GH_ParamAccess.list),
          ("existing_shell", GH_ParamAccess.item), ("show_ids", GH_ParamAccess.item), ("show_floor", GH_ParamAccess.item),
          ("export", GH_ParamAccess.item), ("lib", GH_ParamAccess.item), ("mvplus", GH_ParamAccess.item),
          ("facade_on", GH_ParamAccess.item)]
SHARED_INPUTS = ("existing_shell", "show_ids", "show_floor", "export", "lib", "mvplus", "facade_on")
OUTPUTS = ["walls", "windows", "doors", "slabs", "massing", "rooms", "room_pts", "room_txt",
           "id_pts", "id_txt", "ctx_pts", "ctx_txt", "summary", "model",
           "facade", "facade_col", "details", "details_col", "massing_col"]
SRC = STUB % ("MVK Building", "mvk_building.py", LIB, "mvk_building.py")

half = (len(SITE) + 1) // 2
comps = []
for i, b in enumerate(SITE):
    col, row = (0, i) if i < half else (1, i - half)
    bx, by = X0 + col * COL_W, Y0 + row * ROW_H
    res = b["current_use"] == "residential"
    objs = []
    bp = panel("Building", b["id"], bx, by, False, 60, 22); objs.append(bp)
    title = panel("Name", "%s  (%d floors, today %s)" % (b["name"], b["levels"], b["current_use"]),
                  bx + 70, by, False, CTRL_W + 60, 22); objs.append(title)
    gu = vlist("Ground floor use", USES, 0, bx + VL, by + 40); objs.append(gu)
    tu = vlist("Upper floors use", USES, 0, bx + VL, by + 70); objs.append(tu)
    nf = slider("Floors (0 = site: %d)" % b["levels"], 0, 30, 0, 0, bx + VL, by + 105); objs.append(nf)
    ps = vlist("Partition system", SYSTEMS, 0, bx + VL, by + 135); objs.append(ps)
    dt = toggle("Detail (full layout)", b["role"] == "study", bx + VL, by + 170); objs.append(dt)
    ov = panel("Overrides (JSON)", "{}", bx, by + 205, True, CTRL_W, 85, Color.FromArgb(255, 255, 250, 205)); objs.append(ov)
    rm = panel("Remove walls (one id per line)", "", bx, by + 300, False, CTRL_W, 50); objs.append(rm)
    aw = place(Param_Curve(), bx + 20, by + 370, "Add walls (lines)"); objs.append(aw)
    sc = script_component("MVK %s" % b["id"], bx + COMP_X, by + 40, INPUTS, OUTPUTS, SRC); objs.append(sc)
    for src, nm in [(bp, "building"), (gu, "ground_use"), (tu, "use"), (nf, "floors"), (ps, "partition_system"),
                    (dt, "detail"), (ov, "overrides"), (rm, "remove_walls"), (aw, "add_walls"),
                    (shellt, "existing_shell"), (ids, "show_ids"), (sf, "show_floor"), (exp, "export"),
                    (libp, "lib"), (mvp, "mvplus"), (fac, "facade_on")]:
        wire(src, inp(sc, nm))
        if nm in SHARED_INPUTS:
            hide(inp(sc, nm))
    sp = panel("%s summary" % b["id"], "", bx + SUM_X, by + 30, True, 560, 370, Color.FromArgb(255, 220, 240, 255)); objs.append(sp)
    wire(outp(sc, "summary"), sp)
    group("%s  %s" % (b["id"], b["name"]), objs,
          Color.FromArgb(55, 222, 200, 160) if res else Color.FromArgb(55, 150, 180, 210))
    comps.append(sc)

# ------------------------------------------------------------------ shared previews + site summary (right of the rows)
PX = X0 + 2 * COL_W + 60
prev = []
for k, (nm, col) in enumerate([("walls", Color.FromArgb(255, 205, 200, 190)), ("windows", Color.FromArgb(235, 62, 84, 104)),
                               ("doors", Color.FromArgb(255, 160, 90, 45)), ("slabs", Color.FromArgb(255, 235, 235, 235)),
                               ("rooms", Color.FromArgb(255, 200, 60, 60))]):
    cp = comp("Custom Preview", PX + 170, Y0 + 70 * k, "Preview " + nm)
    for c in comps:
        wire(outp(c, nm), cp.Params.Input[0])
    hide(cp.Params.Input[0])
    sw = swatch(col, PX, Y0 + 20 + 70 * k)
    wire(sw, cp.Params.Input[1])
    prev += [cp, sw]
# coloured by the facade material of each building / floor (site file "materials")
for k, (nm, cn) in enumerate([("facade", "facade_col"), ("details", "details_col"), ("massing", "massing_col")]):
    cp = comp("Custom Preview", PX + 170, Y0 + 70 * (5 + k), "Preview " + nm)
    for c in comps:
        wire(outp(c, nm), cp.Params.Input[0])
        wire(outp(c, cn), cp.Params.Input[1])
    hide(cp.Params.Input[0]); hide(cp.Params.Input[1])
    prev.append(cp)
for k, (pts, txt, size, nick) in enumerate([("room_pts", "room_txt", 0.6, "Room labels"), ("id_pts", "id_txt", 0.25, "ID labels"),
                                            ("ctx_pts", "ctx_txt", 2.0, "Building labels")]):
    tt = comp("Text Tag 3D", PX + 170, Y0 + 610 + 90 * k, nick)
    for c in comps:
        wire(outp(c, pts), tt.Params.Input[0])
        wire(outp(c, txt), tt.Params.Input[1])
    hide(tt.Params.Input[0]); hide(tt.Params.Input[1])
    sl = slider(nick + " size", 0.1, 5.0, size, 2, PX - 60, Y0 + 650 + 90 * k)
    wire(sl, tt.Params.Input[2])
    prev += [tt, sl]
group("Previews (all buildings)", prev, Color.FromArgb(55, 200, 200, 200))
ss = script_component("MVK Site summary", PX, Y0 + 960, [("models", GH_ParamAccess.list), ("lib", GH_ParamAccess.item)],
                      ["summary", "table"], STUB % ("MVK Site summary", "mvk_site_summary.py", LIB, "mvk_site_summary.py"))
for c in comps:
    wire(outp(c, "model"), inp(ss, "models"))
wire(libp, inp(ss, "lib"))
hide(inp(ss, "models")); hide(inp(ss, "lib"))
ssp = panel("Site summary", "", PX + 220, Y0 + 940, True, 860, 380, Color.FromArgb(255, 220, 240, 255))
wire(outp(ss, "summary"), ssp)
group("Site summary", [ss, ssp], Color.FromArgb(55, 150, 200, 150))

D.NewSolution(True)
print("saved" if GH_DocumentIO(D).SaveQuiet(SAVE) else "save failed", SAVE)
for path in ("Buildings",):
    i = rdoc.Layers.FindByFullPath(path, -1)
    if i >= 0:
        rdoc.Layers[i].IsVisible = False
gh.Instances.DocumentServer.AddDocument(D)
gh.Instances.ActiveCanvas.Document = D
gh.Instances.DocumentEditor.Show()
rdoc.Views.Redraw()
