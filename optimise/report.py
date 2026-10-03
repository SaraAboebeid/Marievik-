"""Self-contained HTML report of an optimiser run.

One file, no server: the run's results are embedded as JSON and drawn in the
browser, so the report can be opened locally, attached, or published as it
is. Plans are drawn from the same coordinates the engine evaluated, so what
you see is what was scored.
"""

from __future__ import annotations

import json
from pathlib import Path

from apartment import evaluate as apt_evaluate

PREFIX = {"student_housing": "S", "elderly_care": "E", "office_flexible": "O", "family_housing": "F"}


def _payload(results: dict) -> dict:
    data = json.loads(json.dumps(results, default=str))
    data["prefix"] = PREFIX
    data["furniture"] = {
        k: {"w": v["w"], "d": v["d"], "name": v["name"], "category": v["category"]}
        for k, v in apt_evaluate.FURNITURE.items()
    }
    for use in data["uses"].values():
        for o in use.get("options", []):
            plan = o.get("plan", {})
            o["plan"] = {
                "shell": {k: plan["shell"][k] for k in ("width_mm", "depth_mm", "external_wall_thickness_mm", "windows", "entry")},
                "walls": plan.get("walls", []),
                "doors": plan.get("doors", []),
                "furniture": [{k: f[k] for k in ("type", "x", "y", "rot")} for f in plan.get("furniture", [])],
            }
    return data


def write(results: dict, path: Path) -> Path:
    payload = json.dumps(_payload(results)).replace("</", "<\\/")
    html = TEMPLATE.replace("__DATA__", payload)
    path.write_text(html, encoding="utf-8")
    return path


TEMPLATE = r"""<title>Marievik+ Fit-out Options</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: a drawing-office report. Summary strip, then one sheet per use
   (chart + ten plan cards + tables), then the futures analysis and method. */
:root {
  --paper: #f4f6f5;
  --sheet: #ffffff;
  --ink: #1d2a2f;
  --ink-2: #51616a;
  --rule: #d5dcdc;
  --accent: #1d5f7a;
  --accent-soft: #d8e8ef;
  --warm: #b4740f;
  --good: #2f7d4f;
  --bad: #b03a2e;
  --wall: #1d2a2f;
  --furn: #cdd9de;
  --wet: #e6ecee;
  --f-display: "Familjen Grotesk", "Segoe UI", system-ui, sans-serif;
  --f-body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --f-data: "IBM Plex Mono", ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #11181b; --sheet: #182226; --ink: #e3eaec; --ink-2: #9aabb2; --rule: #2c3a40;
  --accent: #6db3d1; --accent-soft: #1f3a47; --warm: #e0a54a; --good: #6cc391; --bad: #e57a6d;
  --wall: #e3eaec; --furn: #34484f; --wet: #22303a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #11181b; --sheet: #182226; --ink: #e3eaec; --ink-2: #9aabb2; --rule: #2c3a40;
  --accent: #6db3d1; --accent-soft: #1f3a47; --warm: #e0a54a; --good: #6cc391; --bad: #e57a6d;
  --wall: #e3eaec; --furn: #34484f; --wet: #22303a; color-scheme: dark; }

* { box-sizing: border-box; }
body { background: var(--paper); color: var(--ink); font: 15px/1.55 var(--f-body); }
.wrap { max-width: 1240px; margin: 0 auto; padding-inline: 20px; padding-block: 28px 64px; display: grid; gap: 28px; }
h1, h2, h3 { font-family: var(--f-display); text-wrap: balance; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: clamp(28px, 4vw, 42px); font-weight: 700; }
h2 { font-size: 24px; font-weight: 600; }
h3 { font-size: 17px; font-weight: 600; }
p { margin: 0; max-width: 68ch; }
.muted { color: var(--ink-2); }
.eyebrow { font: 500 11px/1 var(--f-data); text-transform: uppercase; letter-spacing: 0.09em; color: var(--ink-2); }
.num { font-family: var(--f-data); font-variant-numeric: tabular-nums; }
.sheet { background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px; padding: 22px; display: grid; gap: 18px; min-width: 0; }
header.top { display: grid; gap: 10px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font: 13px var(--f-data); color: var(--ink-2); }
.banner { border-left: 3px solid var(--warm); padding: 8px 12px; background: var(--sheet); font-size: 14px; }

.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.sumcard { background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px; padding: 16px; display: grid; gap: 10px; align-content: start; cursor: pointer; text-align: left; color: inherit; font: inherit; }
.sumcard:hover, .sumcard:focus-visible { border-color: var(--accent); outline: none; }
.sumcard .big { font: 600 15px var(--f-display); }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 13px; }
.kv dt { color: var(--ink-2); } .kv dd { margin: 0; text-align: right; font-family: var(--f-data); font-variant-numeric: tabular-nums; }

nav.tabs { display: flex; flex-wrap: wrap; gap: 6px; position: sticky; top: env(safe-area-inset-top, 0px); background: var(--paper); padding-block: 8px; z-index: 5; }
nav.tabs button { font: 600 14px var(--f-display); padding: 8px 14px; border: 1px solid var(--rule); background: var(--sheet); color: var(--ink); border-radius: 3px; cursor: pointer; }
nav.tabs button[aria-selected="true"] { background: var(--accent); color: var(--sheet); border-color: var(--accent); }
nav.tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.two { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 22px; }
@media (max-width: 860px) { .two { grid-template-columns: minmax(0, 1fr); } }
svg text { fill: var(--ink-2); font: 11px var(--f-data); }
.chart { width: 100%; height: auto; max-width: 100%; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.card { border: 1px solid var(--rule); border-radius: 4px; padding: 12px; display: grid; gap: 8px; background: var(--sheet); cursor: pointer; text-align: left; color: inherit; font: inherit; align-content: start; }
.card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
.card.rec { border: 2px solid var(--accent); padding: 11px; }
.card[aria-pressed="true"] { background: var(--accent-soft); }
.cardhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.tag { font: 600 15px var(--f-display); }
.pill { font: 500 11px var(--f-data); padding: 2px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); white-space: nowrap; }
.pill.warm { background: transparent; border: 1px solid var(--warm); color: var(--warm); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font: 11px var(--f-data); color: var(--ink-2); border: 1px solid var(--rule); padding: 1px 6px; border-radius: 3px; }
.bars { display: grid; gap: 3px; }
.bar { display: grid; grid-template-columns: 74px 1fr 52px; gap: 6px; align-items: center; font-size: 11.5px; }
.bar span:first-child { color: var(--ink-2); }
.bar .track { height: 6px; background: var(--rule); border-radius: 3px; overflow: hidden; }
.bar .fill { height: 100%; background: var(--accent); }
.bar .v { font: 11px var(--f-data); text-align: right; font-variant-numeric: tabular-nums; }
.plan { width: 100%; height: auto; display: block; }

.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--rule); text-align: right; white-space: nowrap; }
th { font: 500 11px var(--f-data); text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-2); vertical-align: bottom; }
td:first-child, th:first-child, td.l, th.l { text-align: left; }
td { font-family: var(--f-data); font-variant-numeric: tabular-nums; }
tr.rec td { font-weight: 500; color: var(--accent); }
tr.clickable { cursor: pointer; } tr.clickable:hover td { background: var(--accent-soft); }
.best { text-decoration: underline; text-decoration-color: var(--good); text-underline-offset: 3px; }

.detail { border-top: 2px solid var(--accent); padding-top: 16px; display: grid; gap: 16px; }
.detailgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
.detailgrid > div { display: grid; gap: 8px; align-content: start; min-width: 0; }
.issues { font-size: 13px; margin: 0; padding-left: 18px; }
.sev-major { color: var(--bad); } .sev-minor { color: var(--ink-2); }
.why { font-size: 14px; }
.callout { background: var(--accent-soft); border-radius: 4px; padding: 14px 16px; display: grid; gap: 6px; }
.method { columns: 2 320px; column-gap: 32px; font-size: 14px; }
.method p, .method div { break-inside: avoid; margin-bottom: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--ink-2); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
@media (prefers-reduced-motion: no-preference) { .card, .sumcard { transition: border-color .15s; } }
</style>

<div class="wrap">
  <header class="top">
    <div class="eyebrow">Marievik+ · Adaptive reuse lab · Option appraisal</div>
    <h1>Fit-out options for one apartment bay</h1>
    <p class="muted">Every option below was generated, furnished and scored by the engine on the same 8.4 × 7.2 m shell: walls and doors placed parametrically, furniture arranged by annealing, thermal comfort simulated in EnergyPlus for Stockholm. Ten options per use span the trade-off; the recommendation is the one with the least regret across five stakeholder views.</p>
    <div class="meta" id="meta"></div>
    <div class="banner"><strong>Dummy data.</strong> Costs, carbon factors and products are placeholders generated for model development. The method and the relative ranking are meaningful; the absolute numbers are not. Replace the catalogue and product files with supplier data to make them so.</div>
  </header>

  <section class="summary" id="summary" aria-label="Recommendation per use"></section>

  <nav class="tabs" id="tabs" role="tablist" aria-label="Uses"></nav>
  <section id="usepane"></section>

  <section class="sheet" id="futures"></section>

  <section class="sheet">
    <h2>How the options were made and judged</h2>
    <div class="method" id="method"></div>
  </section>
</div>

<script type="application/json" id="data">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const USES = Object.keys(D.uses).filter(u => (D.uses[u].options || []).length);
const CRIT = D.criteria;
const CKEYS = Object.keys(CRIT);
const SEK = v => Math.round(v).toLocaleString('sv-SE');
const kSEK = v => (v / 1000).toLocaleString('sv-SE', {maximumFractionDigits: 0}) + 'k';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const label = {};
const byId = {};
for (const u of USES) {
  D.uses[u].options.forEach((o, i) => { label[o.id] = D.prefix[u] + (i + 1); byId[o.id] = o; });
}
const fmtCrit = (k, v) => k === 'lcc' ? kSEK(v) : k === 'carbon' ? (v / 1000).toFixed(1) + ' t' : k === 'comfort' ? v.toFixed(0) + '%' : v.toFixed(0);
const words = { existing: 'Existing glazing', upgraded: 'New openable glazing', lowered: 'New glazing, low sill',
  conventional: 'Stud walls', demountable: 'Demountable walls', demountable_glass: 'Glazed demountable', movable: 'Movable walls',
  standard: 'New products', circular: 'Second-hand', durable: 'Premium durable', mixed: 'Mixed products' };

// ---------- header ----------
const s = D.settings;
const az = s.azimuth;
const dir = ['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round(((az % 360) / 45)) % 8];
document.getElementById('meta').innerHTML = [
  `Run ${esc(D.generated.replace('T', ' '))}`, `Facade faces ${dir} (${az}°)`, `Stockholm TMYx 2011–2025`,
  `Shadow carbon price ${s.carbon_price} SEK/kg`, `${USES.length} uses`, `Search time ${Math.round(D.elapsed_s / 60)} min`
].map(t => `<span>${t}</span>`).join('');

// ---------- plan drawing ----------
function planSVG(o, opts = {}) {
  const p = o.plan, sh = p.shell, W = sh.width_mm, H = sh.depth_mm, t = sh.external_wall_thickness_mm;
  const pad = 300;
  let g = `<svg class="plan" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}" role="img" aria-label="Plan of option ${label[o.id] || ''}">`;
  g += `<rect x="${t}" y="${t}" width="${W - 2 * t}" height="${H - 2 * t}" fill="var(--sheet)"/>`;
  g += `<rect x="5150" y="4050" width="3000" height="2900" fill="var(--wet)"/>`;
  // External walls as poché, windows cut through the facade
  g += `<path d="M0 0H${W}V${H}H0Z M${t} ${t}V${H - t}H${W - t}V${t}Z" fill="var(--wall)" fill-rule="evenodd"/>`;
  for (const w of sh.windows) {
    g += `<rect x="${w.x1}" y="0" width="${w.x2 - w.x1}" height="${t}" fill="var(--sheet)"/>`;
    g += `<line x1="${w.x1}" y1="${t / 2}" x2="${w.x2}" y2="${t / 2}" stroke="var(--accent)" stroke-width="40"/>`;
    if (w.sill_mm < 900) g += `<line x1="${w.x1}" y1="${t - 30}" x2="${w.x2}" y2="${t - 30}" stroke="var(--accent)" stroke-width="20" stroke-dasharray="80 60"/>`;
  }
  // Furniture
  for (const f of p.furniture) {
    const spec = D.furniture[f.type]; if (!spec) continue;
    const clearance = spec.category === 'clearance';
    g += `<rect x="${f.x - spec.w / 2}" y="${f.y - spec.d / 2}" width="${spec.w}" height="${spec.d}" transform="rotate(${f.rot || 0} ${f.x} ${f.y})"
      fill="${clearance ? 'none' : 'var(--furn)'}" stroke="var(--ink-2)" stroke-width="${clearance ? 15 : 12}" ${clearance ? 'stroke-dasharray="60 50"' : ''}><title>${esc(spec.name)}</title></rect>`;
  }
  // Partitions, with door openings cut and swings drawn
  const walls = {};
  for (const w of p.walls) walls[w.id] = w;
  for (const w of p.walls) {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
    const cuts = p.doors.filter(d => d.wall_id === w.id).map(d => [d.t * L - d.clear_mm / 2, d.t * L + d.clear_mm / 2]).sort((a, b) => a[0] - b[0]);
    let a = 0;
    const segs = [];
    for (const [c0, c1] of cuts) { if (c0 > a) segs.push([a, c0]); a = c1; }
    if (a < L) segs.push([a, L]);
    const demount = w.component && w.component.indexOf('demount') >= 0 || (w.component || '').indexOf('movable') >= 0;
    for (const [s0, s1] of segs) {
      g += `<line x1="${w.x1 + ux * s0}" y1="${w.y1 + uy * s0}" x2="${w.x1 + ux * s1}" y2="${w.y1 + uy * s1}" stroke="var(--wall)" stroke-width="${w.thickness || 100}" ${demount ? 'stroke-dasharray="220 50"' : ''}/>`;
    }
  }
  for (const d of p.doors) {
    const w = walls[d.wall_id]; if (!w) continue;
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
    const hx = w.x1 + ux * (d.t * L - d.clear_mm / 2), hy = w.y1 + uy * (d.t * L - d.clear_mm / 2);
    const ex = hx + ux * d.clear_mm, ey = hy + uy * d.clear_mm;
    // Leaf swings towards +normal (into the room below/right of the wall line)
    const nx = -uy, ny = ux, r = d.clear_mm;
    const lx = hx + nx * r, ly = hy + ny * r;
    g += `<line x1="${hx}" y1="${hy}" x2="${lx}" y2="${ly}" stroke="var(--ink)" stroke-width="18"/>`;
    g += `<path d="M${lx} ${ly} A${r} ${r} 0 0 ${ux * ny - uy * nx > 0 ? 0 : 1} ${ex} ${ey}" fill="none" stroke="var(--ink-2)" stroke-width="10"/>`;
  }
  // Entry arrow
  if (sh.entry) g += `<path d="M${sh.entry.x - 160} ${H + 160} L${sh.entry.x} ${H - 40} L${sh.entry.x + 160} ${H + 160}" fill="none" stroke="var(--accent)" stroke-width="40"/>`;
  if (opts.north !== false) g += `<text x="${W / 2}" y="-90" text-anchor="middle" style="font-size:190px">facade</text>`;
  return g + '</svg>';
}

// ---------- summary strip ----------
const summary = document.getElementById('summary');
for (const u of USES) {
  const U = D.uses[u], rec = byId[U.recommended];
  const b = document.createElement('button');
  b.className = 'sumcard'; b.type = 'button';
  b.innerHTML = `<div class="eyebrow">${esc(U.brief.label)}</div>
    <div class="big">${label[rec.id]} · ${esc(rec.description)}</div>
    <dl class="kv">
      <dt>People</dt><dd>${rec.occupants} · ${rec.m2_per_person} m² each</dd>
      <dt>Life cycle cost / person</dt><dd>${SEK(rec.lcc_per_person)} SEK</dd>
      <dt>Carbon / person, 50 yr</dt><dd>${(rec.carbon_per_person / 1000).toFixed(1)} t CO₂e</dd>
      <dt>Thermal comfort</dt><dd>${rec.comfort.toFixed(0)}% of hours</dd>
      <dt>Usability · functionality</dt><dd>${rec.usability.toFixed(0)} · ${rec.functionality.toFixed(0)}</dd>
    </dl>`;
  b.addEventListener('click', () => { selectUse(u); document.getElementById('tabs').scrollIntoView({behavior: 'smooth'}); });
  summary.appendChild(b);
}

// ---------- tabs ----------
const tabs = document.getElementById('tabs');
let current = null, picked = {};
for (const u of USES) {
  const b = document.createElement('button');
  b.type = 'button'; b.role = 'tab'; b.textContent = D.uses[u].brief.label; b.dataset.use = u;
  b.addEventListener('click', () => selectUse(u));
  tabs.appendChild(b);
}

function scatter(U) {
  const all = U.all, ten = new Set(U.options.map(o => o.id));
  const w = 560, h = 330, m = {l: 64, r: 14, t: 14, b: 42};
  const xs = all.map(a => a.lcc), ys = all.map(a => a.carbon);
  const x0 = Math.min(...xs) * 0.95, x1 = Math.max(...xs) * 1.03, y0 = Math.min(...ys) * 0.95, y1 = Math.max(...ys) * 1.03;
  const X = v => m.l + (v - x0) / (x1 - x0) * (w - m.l - m.r), Y = v => h - m.b - (v - y0) / (y1 - y0) * (h - m.t - m.b);
  const comfortColor = c => c >= 85 ? 'var(--good)' : c >= 70 ? 'var(--warm)' : 'var(--bad)';
  let g = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Life cycle cost against carbon per person">`;
  const ticks = (a, b, n) => { const st = (b - a) / n; return Array.from({length: n + 1}, (_, i) => a + i * st); };
  for (const v of ticks(x0, x1, 4)) g += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}" stroke="var(--rule)"/><text x="${X(v)}" y="${h - m.b + 16}" text-anchor="middle">${kSEK(v)}</text>`;
  for (const v of ticks(y0, y1, 4)) g += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--rule)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${(v / 1000).toFixed(1)} t</text>`;
  g += `<text x="${(w + m.l) / 2}" y="${h - 6}" text-anchor="middle">Life cycle cost per person, 50 years (SEK)</text>`;
  g += `<text x="14" y="${(h - m.b) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(h - m.b) / 2})">Carbon per person (t CO₂e)</text>`;
  for (const a of all) if (!ten.has(a.id)) g += `<circle cx="${X(a.lcc)}" cy="${Y(a.carbon)}" r="3.2" fill="${comfortColor(a.comfort)}" opacity="0.35"/>`;
  for (const o of U.options) {
    const c = o.criteria_ = {lcc: o.lcc_per_person, carbon: o.carbon_per_person};
    const rec = o.id === U.recommended;
    g += `<g class="pt" data-id="${o.id}" style="cursor:pointer"><circle cx="${X(c.lcc)}" cy="${Y(c.carbon)}" r="${rec ? 9 : 7}" fill="${comfortColor(o.comfort)}" stroke="var(--ink)" stroke-width="${rec ? 2.5 : 1}"/>
      <text x="${X(c.lcc) + 10}" y="${Y(c.carbon) - 8}" style="fill:var(--ink);font-weight:500">${label[o.id]}</text></g>`;
  }
  return g + '</svg>';
}

function bars(o, U) {
  const n = o.normalised || {};
  return '<div class="bars">' + CKEYS.map(k => {
    const v = k === 'lcc' ? o.lcc_per_person : k === 'carbon' ? o.carbon_per_person : o[k];
    return `<div class="bar"><span>${CRIT[k].label.replace(' per person', '').replace('Life cycle ', '')}</span><span class="track"><span class="fill" style="width:${Math.round((n[k] ?? 0.5) * 100)}%;display:block"></span></span><span class="v">${fmtCrit(k, v)}</span></div>`;
  }).join('') + '</div>';
}

function selectUse(u) {
  current = u;
  for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.use === u ? 'true' : 'false');
  try { localStorage.setItem('mv-use', u); } catch (e) {}
  const U = D.uses[u], rec = byId[U.recommended];
  const st = U.stats;
  const pane = document.getElementById('usepane');
  const fav = U.favourites;
  pane.innerHTML = `<div class="sheet">
    <div style="display:grid;gap:6px">
      <div class="eyebrow">${esc(U.brief.label)} · ${U.brief.densities.map(d => esc(d.label)).join(' · ')}</div>
      <h2>${label[rec.id]} is the option least likely to be regretted</h2>
      <p class="why">${esc(rec.description)}, ${esc(words[rec.window]).toLowerCase()}, ${esc(words[rec.partition]).toLowerCase()}, ${esc(words[rec.products]).toLowerCase()}.
      Its largest shortfall against any stakeholder's favourite is ${(rec.regret.max_regret * 100).toFixed(0)} points (for the ${esc(D.stakeholders[rec.regret.worst_for].label.toLowerCase())} view).
      ${esc(U.brief.notes)}</p>
      <p class="muted" style="font-size:13px">${st.schemes} layouts generated → ${st.geometries_furnished} furnished → ${st.evaluated} specified and scored → ${st.feasible} feasible → ${st.scored_with_thermal} simulated with every window choice → 10 shown.</p>
    </div>
    <div class="two">
      <div style="display:grid;gap:8px;min-width:0">
        <h3>Cost against carbon, every simulated option</h3>
        ${scatter(U)}
        <div class="legend"><span><i style="background:var(--good)"></i>comfort ≥ 85%</span><span><i style="background:var(--warm)"></i>70–85%</span><span><i style="background:var(--bad)"></i>below 70%</span><span>large ring = recommended</span></div>
      </div>
      <div style="display:grid;gap:8px;min-width:0;align-content:start">
        <h3>Who would pick what</h3>
        <div class="tablewrap"><table><thead><tr><th class="l">Stakeholder view</th><th>Favourite</th><th>Recommended falls short by</th></tr></thead><tbody>
        ${Object.entries(D.stakeholders).map(([k, v]) => `<tr><td class="l">${esc(v.label)}</td><td>${label[fav[k]]}</td><td>${(rec.regret.regret[k] * 100).toFixed(0)} pts</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted" style="font-size:13px">Each view weights the five criteria differently. A point is one percent of the full range between the best and worst of these ten options under that view.</p>
      </div>
    </div>
    <h3>The ten options</h3>
    <div class="cards" id="cards"></div>
    <div id="detail"></div>
    <h3>Side by side</h3>
    <div class="tablewrap">${compareTable(U)}</div>
    <h3>Regret by stakeholder view</h3>
    <div class="tablewrap">${regretTable(U)}</div>
  </div>`;
  const cards = document.getElementById('cards');
  for (const o of U.options) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card' + (o.id === U.recommended ? ' rec' : ''); b.dataset.id = o.id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<div class="cardhead"><span class="tag">${label[o.id]}</span>${o.id === U.recommended ? '<span class="pill">recommended</span>' : `<span class="pill warm">front ${o.front}</span>`}</div>
      ${planSVG(o)}
      <div style="font-size:13px">${esc(o.description)}</div>
      <div class="chips"><span class="chip">${o.occupants} ppl · ${o.m2_per_person} m²/p</span><span class="chip">${esc(words[o.window])}</span><span class="chip">${esc(words[o.partition])}</span><span class="chip">${esc(words[o.products])}</span></div>
      ${bars(o, U)}`;
    b.addEventListener('click', () => showDetail(o.id));
    cards.appendChild(b);
  }
  pane.querySelectorAll('.pt').forEach(p => p.addEventListener('click', () => showDetail(p.dataset.id)));
  pane.querySelectorAll('tr.clickable').forEach(r => r.addEventListener('click', () => showDetail(r.dataset.id)));
  showDetail(picked[u] || U.recommended, false);
}

function compareTable(U) {
  const cols = [
    ['People', o => o.occupants], ['m²/person', o => o.m2_per_person],
    ['LCC/person SEK', o => SEK(o.lcc_per_person), o => o.lcc_per_person, -1],
    ['Capex SEK', o => SEK(o.capex), o => o.capex, -1],
    ['CO₂e/person kg', o => SEK(o.carbon_per_person), o => o.carbon_per_person, -1],
    ['Upfront CO₂e kg', o => SEK(o.carbon_upfront), o => o.carbon_upfront, -1],
    ['Comfort %', o => o.comfort.toFixed(0), o => o.comfort, 1],
    ['Hours > 26 °C', o => o.thermal.worst_hours_over_26, o => -o.thermal.worst_hours_over_26, 1],
    ['Heating kWh/m²', o => o.thermal.heating_kwh_m2, o => -o.thermal.heating_kwh_m2, 1],
    ['Usability', o => o.usability.toFixed(0), o => o.usability, 1],
    ['Function', o => o.functionality.toFixed(0), o => o.functionality, 1],
    ['Max regret', o => (o.regret.max_regret * 100).toFixed(0), o => -o.regret.max_regret, 1],
  ];
  const best = cols.map(c => c[2] ? U.options.reduce((b, o) => (c[3] > 0 ? c[2](o) > c[2](b) : c[2](o) < c[2](b)) ? o : b) : null);
  return `<table><thead><tr><th class="l">Option</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${
    U.options.map(o => `<tr class="clickable ${o.id === U.recommended ? 'rec' : ''}" data-id="${o.id}"><td>${label[o.id]}</td>${cols.map((c, i) => `<td class="${best[i] === o ? 'best' : ''}">${c[1](o)}</td>`).join('')}</tr>`).join('')
  }</tbody></table><p class="muted" style="font-size:12px;margin-top:6px">Underlined: best of the ten. Hours above 26 °C are for the warmest room, over occupied hours.</p>`;
}

function regretTable(U) {
  const keys = Object.keys(D.stakeholders);
  const max = Math.max(...U.options.flatMap(o => keys.map(k => o.regret.regret[k]))) || 1;
  return `<table><thead><tr><th class="l">Option</th>${keys.map(k => `<th>${esc(D.stakeholders[k].label)}</th>`).join('')}<th>Maximum</th></tr></thead><tbody>${
    U.options.map(o => `<tr class="clickable ${o.id === U.recommended ? 'rec' : ''}" data-id="${o.id}"><td>${label[o.id]}</td>${
      keys.map(k => { const r = o.regret.regret[k]; return `<td style="background:color-mix(in srgb, var(--bad) ${Math.round(r / max * 45)}%, transparent)">${(r * 100).toFixed(0)}</td>`; }).join('')
    }<td><strong>${(o.regret.max_regret * 100).toFixed(0)}</strong></td></tr>`).join('')
  }</tbody></table>`;
}

function showDetail(id, scroll = true) {
  const o = byId[id]; if (!o) return;
  picked[current] = id;
  document.querySelectorAll('.card').forEach(c => c.setAttribute('aria-pressed', c.dataset.id === id ? 'true' : 'false'));
  const c = o.carbon, m = o.money, t = o.thermal;
  const lcaRows = [['A1–A3 product', c.a1a3], ['A4 transport', c.a4], ['A5 installation', c.a5], ['B4 replacement', c.b4], ['B6 operational energy', c.b6], ['C1–C4 end of life', c.c1c4]];
  const lcaMax = Math.max(...lcaRows.map(r => r[1]), 1);
  const el = document.getElementById('detail');
  el.innerHTML = `<div class="detail">
    <div style="display:grid;gap:4px"><div class="eyebrow">Option ${label[id]}${id === D.uses[current].recommended ? ' · recommended' : ''}</div>
    <h3>${esc(o.description)}</h3>
    <p class="muted" style="font-size:13px">${esc(D.windows[o.window].note)} ${esc(o.user_group.replace(/_/g, ' '))} user group.</p></div>
    <div class="detailgrid">
      <div style="min-width:0">${planSVG(o)}
        <p class="muted" style="font-size:12px">Facade at top. Dashed partitions are demountable. Dashed window line marks a lowered sill. Arrow is the entry.</p></div>
      <div><h3>Life cycle carbon, 50 years</h3>
        ${lcaRows.map(([k, v]) => `<div class="bar" style="grid-template-columns:132px 1fr 64px"><span>${k}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(v / lcaMax * 100)}%"></span></span><span class="v">${SEK(v)}</span></div>`).join('')}
        <dl class="kv"><dt>Total, kg CO₂e</dt><dd>${SEK(c.total)}</dd><dt>Module D, reported not netted</dt><dd>${SEK(c.d)}</dd></dl>
        <h3>Life cycle cost, SEK (NPV)</h3>
        <dl class="kv"><dt>Investment</dt><dd>${SEK(m.capex)}</dd><dt>Running costs</dt><dd>${SEK(m.opex_npv)}</dd><dt>Replacements</dt><dd>${SEK(m.replacement_npv)}</dd><dt>Residual value</dt><dd>−${SEK(m.residual_npv)}</dd><dt><strong>LCC</strong></dt><dd><strong>${SEK(m.lcc)}</strong></dd></dl>
      </div>
      <div><h3>Thermal comfort (EN 16798-1, cat. II)</h3>
        <dl class="kv"><dt>Comfortable hours</dt><dd>${t.comfort_pct}%</dd><dt>Too warm</dt><dd>${t.hot_pct}%</dd><dt>Too cool</dt><dd>${t.cold_pct}%</dd>
        <dt>Warmest room</dt><dd>${esc(t.worst_room)}, ${t.worst_hours_over_26} h > 26 °C</dd><dt>Peak operative temp.</dt><dd>${t.worst_max_c} °C</dd>
        <dt>Space heating</dt><dd>${t.heating_kwh_m2} kWh/m²·yr</dd>${t.cooling_kwh_m2 ? `<dt>Cooling</dt><dd>${t.cooling_kwh_m2} kWh/m²·yr</dd>` : ''}</dl>
        <h3>Usability</h3>
        <dl class="kv">${Object.entries(o.social).map(([k, v]) => `<dt title="${esc(o.social_detail[k] || '')}">${esc(k)}</dt><dd>${v.toFixed(0)}</dd>`).join('')}</dl>
        <h3>Functionality</h3>
        <dl class="kv">${Object.entries(o.functionality_detail).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>
      <div><h3>What the analysis flagged</h3>
        <ul class="issues">${o.issues.filter(i => i.severity !== 'minor').map(i => `<li class="sev-${i.severity}">${esc(i.title)}</li>`).join('') || '<li class="sev-minor">No major issues.</li>'}
        ${o.issues.filter(i => i.severity === 'minor').length ? `<li class="sev-minor">${o.issues.filter(i => i.severity === 'minor').length} minor clearance issues</li>` : ''}</ul>
        <h3>Usability detail</h3>
        <ul class="issues">${Object.entries(o.social_detail).map(([k, v]) => `<li class="sev-minor"><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('')}</ul>
      </div>
    </div></div>`;
  if (scroll) el.scrollIntoView({behavior: 'smooth', block: 'start'});
}

// ---------- futures ----------
function futures() {
  const F = D.adaptability, el = document.getElementById('futures');
  if (!F) { el.innerHTML = '<h2>Change of use</h2><p class="muted">Run with more than one use to compare futures.</p>'; return; }
  const cand = F.candidates;
  const name = (u, id) => {
    const c = cand[u][id];
    const base = Object.keys(label).find(k => k.startsWith(c.base + '.') && byId[k].window === c.window && byId[k].products === c.products);
    return (label[id] || (base ? label[base] + ' with ' + words[c.partition].toLowerCase() : id));
  };
  let html = `<h2>If the use changes: which option today do you regret least?</h2>
    <p>Each option was also tried with every partition system, then followed through 50 years: it stays as it is, or the apartment is converted to each other use in year ${F.years.join(' or year ')}. A conversion takes the cheapest acceptable option of the new use, reusing whatever walls, doors and furniture survive. Money and carbon are added at ${F.carbon_price_sek_per_kg} SEK per kg CO₂e. Only options with at least ${F.floor.comfort}% comfort, usability ${F.floor.usability} and functionality ${F.floor.functionality} compete, so the cheapest uninhabitable option cannot win.</p>`;
  for (const [u, A] of Object.entries(F.by_start_use)) {
    const rows = Object.entries(A.table).sort((a, b) => a[1].max_regret - b[1].max_regret).slice(0, 8);
    const robust = cand[u][A.robust];
    const wallPicks = {};
    for (const w of Object.values(A.wall_choice)) wallPicks[w.partition] = (wallPicks[w.partition] || 0) + 1;
    const nLayouts = Object.values(A.wall_choice).length;
    html += `<div style="display:grid;gap:10px">
      <h3>Starting as ${esc(D.uses[u].brief.label.toLowerCase())}</h3>
      <div class="callout"><div><strong>${esc(name(u, A.robust))}</strong>: ${esc(robust.description)}, ${esc(words[robust.window]).toLowerCase()}, ${esc(words[robust.partition]).toLowerCase()}.</div>
      <div class="muted" style="font-size:13px">${F.floor_met[u] ? '' : 'No option met the quality floor; all options competed. '}Across ${nLayouts} layouts, the least-regret wall system was ${Object.entries(wallPicks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${words[k].toLowerCase()} for ${v}`).join(', ')}.</div></div>
      <div class="tablewrap"><table><thead><tr><th class="l">Option</th><th class="l">Walls</th>${A.scenarios.map(s => `<th title="${esc(s.label)}">${esc(s.to ? D.prefix[s.to] + ' yr ' + s.year : 'Stays')}</th>`).join('')}<th>Max regret SEK</th><th>Avg. change cost</th><th>Avg. change CO₂e</th></tr></thead><tbody>
      ${rows.map(([id, r]) => `<tr class="${id === A.robust ? 'rec' : ''}"><td>${esc(name(u, id))}</td><td class="l">${esc(words[cand[u][id].partition])}</td>${A.scenarios.map(s => `<td>${kSEK(r.regret[s.id])}</td>`).join('')}<td><strong>${SEK(r.max_regret)}</strong></td><td>${SEK(r.mean_change_cost)}</td><td>${SEK(r.mean_change_carbon)} kg</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:12px">Columns are future scenarios (letter = new use, then the year it changes). Cells are regret: how much worse the option does in that future than the best starting option would have, in SEK including carbon. Best eight of ${Object.keys(A.table).length} shown.</p>
    </div>`;
  }
  el.innerHTML = html;
}

// ---------- method ----------
document.getElementById('method').innerHTML = `
  <p><strong>Generation.</strong> The shell, the wet core over the drainage stack and the entry are fixed. For each use the generator places the brief's enclosed rooms along the facade (left, right or split; ${D.settings.max_geometries} layouts per use furnished), at band depths of 3.0–3.9 m, with doors placed where the living space is. Rooms without a window and doors onto passages narrower than the user group's passage width are rejected.</p>
  <p><strong>Furnishing.</strong> Each room's furniture is placed by greedy search then simulated annealing (apartment/anneal.py), with clearances from the standards engine for the specific user group.</p>
  <p><strong>Specification.</strong> Every layout is costed with four partition systems, four product strategies (new, second-hand, premium, mixed) and three window choices. Products come from data/products/furniture_products.json.</p>
  <p><strong>LCA and LCC.</strong> EN 15978 modules A1–A5, B4, B6, C1–C4; module D reported, never netted. LCC over 50 years at the real discount rate in data/factors/operational.json, with residual value. Space heating comes from the simulation, plus a hot-water allowance per use.</p>
  <p><strong>Thermal comfort.</strong> EnergyPlus 25.1 via Honeybee, one zone per room, Stockholm TMYx 2011–2025. Mid-floor unit: only the facade is exposed. 1985 envelope (wall U 0.45, glazing U 2.8, fixed) or upgraded triple glazing (U 0.9, openable, purge ventilation above 24 °C). Interior blinds under strong sun, heating off mid-May to mid-September. Comfort is the share of occupied hours inside the EN 16798-1 adaptive category II band, area-weighted over habitable rooms.</p>
  <p><strong>Usability</strong> is the mean of accessible circulation, daylight, acoustic privacy (dwellings), furniture usability and space per person. <strong>Functionality</strong> checks places to sleep, eat and work against the head count, whether sleeping is separated from living, an enclosed meeting room for larger offices, storage, a seated view for senior use, and product quality.</p>
  <p><strong>Choosing ten.</strong> Options are sorted into non-dominated fronts on the five criteria. The ten are drawn from the best fronts by farthest-point sampling, seeded with the best option on each criterion, so they span the trade-off instead of clustering.</p>
  <p><strong>Regret within a use.</strong> Five stakeholder views weight the criteria differently. For each view, an option's regret is its shortfall against that view's favourite on a 0–100 scale. The recommendation minimises the largest regret.</p>
  <p><strong>Regret across futures.</strong> Conversions are costed component by component: kept walls are free, removed walls pay demounting and send their recoverable share to a reuse stock, new walls draw on that stock first. Furniture is kept when the new use wants it. Window upgrades already made are kept.</p>`;

let first = USES[0];
try { const s = localStorage.getItem('mv-use'); if (s && USES.includes(s)) first = s; } catch (e) {}
selectUse(first);
futures();
</script>
"""
