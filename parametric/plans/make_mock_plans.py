"""Mock-up plan sheets for every Marievik building (cover site plan + ground and typical floor per building).
Run from anywhere:  python plans/make_mock_plans.py  [Marievik+ folder for prices]"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, ".."))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from plot_plans import draw_floor, summary_text
from mvk import layout as L, site as S
from shapely.ops import unary_union

MV = sys.argv[1] if len(sys.argv) > 1 else None
site = S.load(); profs = L.load_profiles()
out = os.path.join(HERE, "Marievik_mock_plans.pdf")
x0, y0, x1, y1 = unary_union([S.footprint(b) for b in site['buildings']]).bounds
with PdfPages(out) as pdf:
    fig, ax = plt.subplots(figsize=(16.5, 11.7))
    for r in site['roads']: ax.plot(*zip(*r['pts']), color='#ccc', lw=0.5)
    for b in site['buildings']:
        P = S.footprint(b)
        ax.fill(*P.exterior.xy, fc='#f3e3c8' if b['current_use'] == 'residential' else '#dcdcd6', ec='#333', lw=0.8)
        for h in P.interiors: ax.fill(*h.xy, fc='white', ec='#333', lw=0.6)
        c = P.representative_point(); ax.text(c.x, c.y, "%s\n%d fl" % (b['id'], b['levels']), ha='center', va='center', fontsize=8)
    ax.set_aspect('equal'); ax.set_xlim(x0 - 15, x1 + 15); ax.set_ylim(y0 - 15, y1 + 15); ax.axis('off')
    ax.set_title("Marievik - site plan with building ids (footprints & storeys: OpenStreetMap; SWEREF 99 TM minus origin E %d N %d)" % (site['origin_E'], site['origin_N']), fontsize=10)
    fig.text(0.02, 0.02, "\n".join("%s  %s  -  %d floors, today %s, %.0f m2 footprint" % (b['id'], b['name'], b['levels'], b['current_use'], b['area_m2']) for b in site['buildings']), fontsize=7, family='monospace', va='bottom')
    pdf.savefig(fig); plt.close(fig)
    for b in site['buildings']:
        g, u = S.profile_uses(b); n = int(b['levels'])
        res = L.build(S.footprint(b), [g, u], n_floors=n, floor_heights=S.floor_heights(b, n), mvplus=MV)
        fig, axs = plt.subplots(1, 2, figsize=(16.5, 11.7))
        draw_floor(axs[0], res['floors'][0], show_ids=True, title="Ground floor (F00) - %s" % profs[g]['label'])
        draw_floor(axs[1], res['floors'][min(2, n - 1)], show_ids=True, title="Typical floor (F%02d) - %s" % (min(2, n - 1), profs[u]['label']))
        fig.suptitle("%s  %s  -  MOCK-UP PLAN (generated, not surveyed)  |  %d floors  |  %s" % (b['id'], b['name'], n, summary_text(res)), fontsize=11)
        plt.tight_layout(rect=(0, 0, 1, 0.95)); pdf.savefig(fig); plt.close(fig)
print(out)
