"""Render floor plans from mvk.layout with matplotlib (for checking / mock-up plans)."""
import math
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly, Arc

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), ".."))
from mvk import layout as L

MPX = 0.38
B01 = [(x * MPX, -y * MPX) for x, y in [(240, 185), (365, 250), (300, 355), (178, 280)]]

COL = {"E": "#222", "C": "#555", "S": "#777", "K": "#000", "P": "#666", "I": "#888", "A": "#c03"}
ZCOL = {"Corridor": "#eee8d8", "Core": "#bbb", "Atrium (void)": "#d6ecf7", "Bathroom": "#e3f0e3",
        "Support / WC": "#e8e8e8", "Support / meeting": "#e8e8e8", "Bedroom": "#f6eee6"}


def draw_floor(ax, F, show_ids=False, title=None):
    for r in F.rooms:
        base = r["name"].split(" (")[0]
        col = ZCOL.get(base, "#fbf7ef" if not base.startswith("Apartment") else "#fdf3e1")
        ax.add_patch(MPoly(r["poly"], closed=True, fc=col, ec="none", zorder=0))
        if r["area"] > 6 and base not in ("Corridor",):
            ax.text(*r["label_pt"], "%s\n%.0f m²" % (r["name"], r["area"]), ha="center", va="center", fontsize=4.2, zorder=5)
    for w in F.walls:
        t = F.thick(w)
        (ux, uy), Lw = L._unit(w["a"], w["b"])
        nx, ny = -uy * t / 2, ux * t / 2
        for s0, s1, z0, z1 in L.wall_pieces(F, w):
            if z0 > 0.05 and z1 < F.wall_h - 0.01:
                continue
            if z0 > 1.0:
                continue
            a = (w["a"][0] + ux * s0, w["a"][1] + uy * s0)
            b = (w["a"][0] + ux * s1, w["a"][1] + uy * s1)
            ax.add_patch(MPoly([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)],
                               closed=True, fc=COL[w["cat"]], ec="none", zorder=3))
        if show_ids:
            m = ((w["a"][0] + w["b"][0]) / 2, (w["a"][1] + w["b"][1]) / 2)
            ax.text(m[0], m[1], w["id"][4:], fontsize=2.6, color="#c03", ha="center", va="center", zorder=6)
    walls = {w["id"]: w for w in F.walls}
    for o in F.openings:
        w = walls[o["wall"]]
        (ux, uy), _ = L._unit(w["a"], w["b"])
        a = (w["a"][0] + ux * o["s0"], w["a"][1] + uy * o["s0"])
        b = (w["a"][0] + ux * o["s1"], w["a"][1] + uy * o["s1"])
        if o["kind"] == "window":
            ax.plot([a[0], b[0]], [a[1], b[1]], color="#1f77b4", lw=1.6, zorder=4, solid_capstyle="butt")
        else:
            wd = o["s1"] - o["s0"]
            ang = math.degrees(math.atan2(uy, ux))
            ax.add_patch(Arc(a, 2 * wd, 2 * wd, angle=ang, theta1=0, theta2=90, lw=0.4, color="#a0522d", zorder=4))
            ax.plot([a[0], a[0] - uy * wd], [a[1], a[1] + ux * wd], color="#a0522d", lw=0.5, zorder=4)
    ax.set_aspect("equal")
    ax.axis("off")
    if title:
        ax.set_title(title, fontsize=7)


def summary_text(res):
    s = res["summary"]
    return "Cost %.1f MSEK   |   Embodied carbon (A1-A3) %.0f t CO2e" % (s["total"]["cost_sek"] / 1e6, s["total"]["gwp_kgco2e"] / 1000)


if __name__ == "__main__":
    profs = L.load_profiles()
    uses = ["office_open", "office_cellular", "residential", "hotel", "school"]
    fig, axs = plt.subplots(2, 3, figsize=(16, 11), dpi=200)
    for ax, use in zip(axs.flat, uses):
        res = L.build(B01, ["retail", use], n_floors=8, floor_heights=[4.5, 3.5])
        F = res["floors"][2]
        draw_floor(ax, F, title="%s  (typical floor)\n%s" % (profs[use]["label"], summary_text(res)))
    res = L.build(B01, ["retail", "office_open"], n_floors=8, floor_heights=[4.5, 3.5])
    draw_floor(axs.flat[5], res["floors"][0], title="Ground floor: %s" % profs["retail"]["label"])
    fig.suptitle("B01 Årstaängsvägen - generated mock plans per use (8 floors, ground floor retail)", fontsize=11)
    plt.tight_layout()
    fig.savefig(sys.argv[1] if len(sys.argv) > 1 else "B01_mock_plans_by_use.png")
    print("ok")
