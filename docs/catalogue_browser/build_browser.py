"""Build the clickable use catalogue: function -> spaces -> dimensions, diagram and sources.

    python docs/catalogue_browser/build_browser.py

Reads data/catalogue/uses/*.json and data/catalogue/cross_cutting.json and writes
docs/catalogue_browser/index.html (self-contained; the data is embedded).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / "data" / "catalogue"
OUT = Path(__file__).resolve().parent / "index.html"
SHEETS = ROOT / "docs" / "standards_sheets"


def main() -> None:
    uses = {}
    for path in sorted((CATALOGUE / "uses").glob("*.json")):
        use = json.loads(path.read_text(encoding="utf-8"))
        uses[use["id"]] = use
    cross = json.loads((CATALOGUE / "cross_cutting.json").read_text(encoding="utf-8"))
    rules = []
    for section, items in cross.items():
        if isinstance(items, list) and items and isinstance(items[0], dict) and "applies_to_uses" in items[0]:
            for item in items:
                rules.append({**item, "section": section})
    sheets = sorted(p.name for p in SHEETS.glob("*.svg") if "_use_" not in p.name)
    data = {"uses": uses, "rules": rules, "sheets": sheets}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    OUT.write_text(TEMPLATE.replace("/*DATA*/null", payload), encoding="utf-8")
    print(f"Wrote {OUT} ({len(uses)} uses, {sum(len(u['spaces']) for u in uses.values())} spaces, {len(rules)} rules)")


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Use Catalogue</title>
<style>
:root{--ink:#1d1d1b;--grey:#7d7d7a;--light:#d9d9d4;--wall:#ecece7;--accent:#cc2f2a;--paper:#fff;--bg:#f4f4f1;
--font:'Montserrat','Helvetica Neue',Arial,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.45}
a{color:var(--accent)}
header{background:var(--paper);border-bottom:1.5px solid var(--ink);padding:18px 28px;display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}
header h1{margin:0;font-size:24px;font-weight:800;color:var(--accent);letter-spacing:.5px;cursor:pointer}
header .crumb{font-weight:700;letter-spacing:1.2px;font-size:12px;color:var(--grey);text-transform:uppercase}
main{max-width:1400px;margin:0 auto;padding:24px 28px 60px}
.kicker{font-size:12px;font-weight:700;letter-spacing:1.6px;color:var(--grey);text-transform:uppercase;margin:28px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.card{background:var(--paper);border:1.5px solid var(--ink);border-radius:12px;padding:16px 16px 14px;cursor:pointer;min-height:118px;display:flex;flex-direction:column;gap:6px;transition:transform .08s}
.card:hover{transform:translateY(-2px);border-color:var(--accent)}
.card h3{margin:0;font-size:17px;font-weight:800;line-height:1.2}
.card .sv{font-style:italic;color:var(--grey);font-size:12px}
.card .meta{margin-top:auto;font-size:12px;color:var(--grey);display:flex;justify-content:space-between}
.card .meta b{color:var(--accent)}
.title{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:flex-end}
.title h2{margin:0;font-size:34px;line-height:1.1;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.5px}
.title .sv{font-style:italic;color:var(--grey)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:18px 0}
.fact{background:var(--paper);border:1px solid var(--light);border-radius:10px;padding:12px 14px;font-size:13px}
.fact b{display:block;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--grey);margin-bottom:3px}
.calc{display:flex;align-items:center;gap:12px;background:var(--paper);border:1.5px solid var(--ink);border-radius:12px;padding:12px 16px;flex-wrap:wrap}
.calc input{font:inherit;font-size:20px;font-weight:800;width:110px;padding:4px 8px;border:1.5px solid var(--accent);border-radius:6px;color:var(--accent)}
.calc .total{margin-left:auto;font-size:13px;color:var(--grey)}
.calc .total b{color:var(--ink);font-size:16px}
.variant{background:#fff5f4;border:1px solid var(--accent);border-radius:10px;padding:10px 14px;margin-top:12px;font-size:13px}
.layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(380px,.85fr);gap:22px;margin-top:20px;align-items:start}
@media (max-width:1000px){.layout{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1.5px solid var(--ink);border-radius:12px;overflow:hidden}
th{text-align:left;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--grey);padding:10px 12px;border-bottom:1.5px solid var(--ink);background:var(--paper)}
td{padding:10px 12px;border-bottom:1px solid var(--light);vertical-align:top;font-size:13px}
tr.space{cursor:pointer}
tr.space:hover td{background:#faf7f6}
tr.space.on td{background:#fff0ee}
tr.tier td{background:var(--bg);font-weight:800;letter-spacing:1.4px;font-size:12px;text-transform:uppercase;padding:14px 12px 8px}
tr.tier td span{font-weight:600;letter-spacing:0;text-transform:none;color:var(--grey);margin-left:8px}
.name{font-weight:800}
.name small{display:block;font-weight:400;font-style:italic;color:var(--grey)}
.ratio{color:var(--ink)}
.ratio .calcd{display:block;color:var(--accent);font-weight:800;margin-top:2px}
.size b{color:var(--accent);font-size:14px}
.none{color:var(--grey);font-style:italic}
.badge{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;border-radius:4px;padding:2px 6px;border:1px solid var(--grey);color:var(--grey);white-space:nowrap}
.badge.law{background:var(--accent);border-color:var(--accent);color:#fff}
.badge.guidance,.badge.programme{border-color:var(--accent);color:var(--accent)}
.panel{position:sticky;top:16px;background:var(--paper);border:1.5px solid var(--ink);border-radius:14px;padding:18px 20px;max-height:calc(100vh - 32px);overflow:auto}
.panel h3{margin:0;font-size:22px;font-weight:800;line-height:1.15}
.panel h4{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--accent);margin:18px 0 6px}
.panel p{margin:4px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{font-size:11.5px;font-weight:700;border:1px solid var(--ink);border-radius:20px;padding:2px 9px}
.src{font-size:12px;color:var(--grey);margin-top:4px;word-break:break-word}
.src a{word-break:break-all}
.link{cursor:pointer;color:var(--accent);text-decoration:underline}
.rule{background:var(--paper);border:1px solid var(--light);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.rule .t{font-weight:800}
.rule .v{font-size:12px;color:var(--ink);margin-top:4px;font-family:Consolas,monospace;white-space:pre-wrap}
.neufert{border:1px dashed var(--grey);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--grey);margin-top:8px}
.sheets{display:flex;flex-wrap:wrap;gap:8px}
.sheets a{font-size:12px;font-weight:700;border:1px solid var(--accent);border-radius:6px;padding:3px 8px;text-decoration:none}
details{margin-top:24px}
summary{cursor:pointer;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;font-size:13px}
svg text{font-family:var(--font)}
</style>
</head>
<body>
<header><h1 onclick="location.hash=''">USE CATALOGUE</h1><span class="crumb" id="crumb">Swedish space requirements · pick a function</span></header>
<main id="app"></main>
<script>
const DATA = /*DATA*/null;
const U = DATA.uses;

// Functions as the design team names them -> catalogue use (+ variant to highlight) and a default size.
const FUNCTIONS = [
  ["Work", "Office — open plan", "office", "office_open_plan", 100],
  ["Work", "Office — cellular", "office", "office_cellular", 60],
  ["Work", "Office — activity based", "office", "office_abw", 100],
  ["Work", "Coworking", "coworking", null, 80],
  ["Care & housing", "Elderly care home", "elderly_care_home", null, 60],
  ["Care & housing", "LSS group home", "lss_group_home", null, 6],
  ["Care & housing", "Senior housing", "senior_housing", null, 40],
  ["Care & housing", "Student housing", "student_housing", null, 120],
  ["Care & housing", "Residential units", "housing_apartment", null, 120],
  ["Care & housing", "Co-living", "co_living", null, 60],
  ["Care & housing", "Hotel", "hotel", null, 80],
  ["Education", "Preschool", "preschool", null, 72],
  ["Education", "School (F–9)", "school_compulsory", null, 630],
  ["Education", "Upper secondary school", "school_upper_secondary", null, 600],
  ["Food & retail", "Restaurant", "restaurant_cafe", "rest_full_kitchen", 80],
  ["Food & retail", "Café", "restaurant_cafe", "rest_cafe_simple", 40],
  ["Food & retail", "Food hall", "food_hall", null, 200],
  ["Food & retail", "Grocery store", "grocery_store", null, 300],
  ["Food & retail", "Retail shop", "retail_shop", null, 100],
  ["Leisure & community", "Gym", "gym_fitness", null, 120],
  ["Leisure & community", "Sports hall", "sports_hall", null, 1],
  ["Leisure & community", "Library", "library", null, 20000],
  ["Leisure & community", "Community hybrid space", "community_hybrid", null, 120],
  ["Leisure & community", "Assembly / event venue", "assembly_event", null, 300],
  ["Leisure & community", "Culture / makerspace", "culture_makerspace", null, 60],
  ["Health", "Primary care clinic", "primary_care_clinic", null, 10000],
  ["Building", "Shared amenities (whole building)", "shared_amenities", null, 1],
];
// Typical group sizes used to turn "per group" figures into a count (from the same sources).
const GROUP_SIZE = {preschool: 18};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n >= 100 ? Math.round(n).toLocaleString("sv-SE") : (Math.round(n * 10) / 10).toLocaleString("sv-SE");
const unitWord = u => String(u || "unit").replace(/_/g, " ");
const TIERS = [["Must exist", "required by law", ["law"]],
               ["Should exist", "guidance or municipal / operator programme", ["guidance", "programme"]],
               ["Usually provided", "practice — not regulated", ["practice", "none"]]];

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = p.get("f");
  if (f !== null && FUNCTIONS[+f]) showUse(+f, p.get("space"), p.get("n"));
  else showHome();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

function showHome() {
  document.getElementById("crumb").textContent = "Swedish space requirements · pick a function";
  let html = `<p style="max-width:820px">Pick a function to see the spaces it needs, how many of each per user,
  the dimensions with their Swedish source, and a diagram of each space. Everything comes from
  <code>data/catalogue/</code>; every figure carries its source and strength.</p>`;
  const groups = [...new Set(FUNCTIONS.map(f => f[0]))];
  for (const g of groups) {
    html += `<div class="kicker">${esc(g)}</div><div class="grid">`;
    FUNCTIONS.forEach(([grp, label, useId], i) => {
      if (grp !== g) return;
      const u = U[useId];
      const law = u.spaces.filter(s => s.required.strength === "law").length;
      const sized = u.spaces.filter(s => s.size && s.size.value_m2 != null).length;
      html += `<div class="card" onclick="location.hash='f=${i}'"><h3>${esc(label)}</h3>
        <div class="sv">${esc(u.label_sv)}</div>
        <div class="meta"><span><b>${u.spaces.length}</b> spaces · ${law} by law</span><span>${sized} sized</span></div></div>`;
    });
    html += `</div>`;
  }
  document.getElementById("app").innerHTML = html;
}

// ---------------------------------------------------------------- calculation

let STAFF = null;   // staff number typed by the user (overrides the per-unit estimate)
function staffFor(u, n) {
  if (STAFF) return STAFF;
  const s = u.occupancy && u.occupancy.staff_per_unit;
  return s && s.value != null ? Math.max(1, Math.round(s.value * n)) : null;
}

// Parse "1 WC per started 15 employees", "1 per 2 barngrupper", "home bases of 90 pupils" etc.
function countFor(sp, u, n) {
  const size = sp.size || {};
  const text = String(size.count || "");
  const staff = staffFor(u, n);
  let m = text.match(/1\s+(?:[A-Za-zÅÄÖåäö]+\s+)?per\s+(?:started\s+|påbörjat\s+)?(\d+)\s+(employees|pupils|children|seats|residents|guests|persons|students|apartments|dwellings)/i);
  if (m) {
    const base = /employee/i.test(m[2]) ? staff : n;
    if (base != null) return {count: Math.ceil(base / +m[1]), text: `1 per ${m[1]} ${m[2]}`, base: /employee/i.test(m[2]) ? `${base} staff` : null};
    return {count: null, needsStaff: true, text: `1 per ${m[1]} ${m[2]}`};
  }
  if (size.rule === "per_group" && GROUP_SIZE[u.id]) {
    const groups = Math.ceil(n / GROUP_SIZE[u.id]);
    const per2 = /per\s+(?:2|two)\s+(?:barngrupper|groups)/i.test(text);
    return {count: per2 ? Math.ceil(groups / 2) : groups, text: per2 ? `1 per 2 groups of ${GROUP_SIZE[u.id]}` : `1 per group of ${GROUP_SIZE[u.id]}`};
  }
  m = text.match(/home bases? of (\d+)/i);
  if (m) return {count: Math.ceil(n / +m[1]), text: `home base per ${m[1]} ${unitWord(u.occupancy.unit)}s`};
  return null;
}

function areaFor(sp, u, n) {
  const size = sp.size || {};
  if (size.value_m2 == null) return null;
  const v = size.value_m2, r = size.range_m2;
  if (size.rule === "per_unit" || size.rule === "per_seat") {
    const c = countFor(sp, u, n);
    if (c && c.needsStaff) return null;
    if (c && c.text.startsWith("1 per") && size.rule === "per_unit" && !/m2|m²/.test(String(size.count || "").split(";")[0]) && c.count)
      return {total: v * c.count, each: v, how: `${c.count} × ${fmt(v)} m²`};
    return {total: v * n, range: r ? [r[0] * n, r[1] * n] : null, how: `${fmt(v)} m² × ${fmt(n)}`};
  }
  if (size.rule === "per_group") {
    const c = countFor(sp, u, n);
    if (c) return {total: v * c.count, each: v, how: `${c.count} × ${fmt(v)} m²`};
    return {total: v, how: "per group"};
  }
  return {total: v, range: r, how: "as sourced"};
}

// ---------------------------------------------------------------- use page

function showUse(fi, spaceId, nParam) {
  const [grp, label, useId, variantId, nDefault] = FUNCTIONS[fi];
  const u = U[useId];
  const n = nParam ? +nParam : nDefault;
  const sp0 = new URLSearchParams(location.hash.slice(1)).get("s");
  STAFF = sp0 ? +sp0 : null;
  const unit = unitWord(u.occupancy && u.occupancy.unit);
  document.getElementById("crumb").textContent = `${grp} · ${label}`;
  const occ = u.occupancy || {};
  const g = occ.gross_m2_per_unit || {};
  const variant = (u.variants || []).find(v => v.id === variantId);
  let rows = "", sum = 0, outdoor = 0;
  const isOutdoor = sp => sp.layer === "site" || /outdoor|friyta|yard|terrace|courtyard/i.test(sp.id + " " + sp.label_en);
  TIERS.forEach(([t, sub, strengths]) => {
    const list = u.spaces.filter(s => strengths.includes(s.required.strength || "none"));
    if (!list.length) return;
    rows += `<tr class="tier"><td colspan="4">${t}<span>${sub}</span></td></tr>`;
    for (const sp of list) {
      const size = sp.size || {};
      const a = areaFor(sp, u, n);
      if (a) { if (isOutdoor(sp)) outdoor += a.total; else sum += a.total; }
      const c = countFor(sp, u, n);
      const ratio = (size.count ? esc(size.count) : `<span class="none">no count rule</span>`) +
        (c && c.needsStaff ? `<span class="calcd">→ enter number of staff above</span>` :
         c ? `<span class="calcd">→ ${c.count} for ${c.base ? esc(c.base) : fmt(n) + " " + unit + "s"}</span>` : "");
      const sizeTxt = size.value_m2 != null
        ? `<b>${fmt(size.value_m2)} m²</b>${size.range_m2 && size.range_m2[0] !== size.range_m2[1] ? ` (${size.range_m2[0]}–${size.range_m2[1]})` : ""} ${esc(perLabel(size, unit))}`
          + (a ? `<span class="calcd" style="display:block;color:var(--accent);font-weight:800">= ${fmt(a.total)} m²</span>` : "")
        : `<span class="none">no sourced size</span>`;
      rows += `<tr class="space${sp.id === spaceId ? " on" : ""}" onclick="pick('${sp.id}')">
        <td class="name">${esc(sp.label_en)}<small>${esc(sp.label_sv || "")}</small></td>
        <td class="ratio">${ratio}</td><td class="size">${sizeTxt}</td>
        <td><span class="badge ${esc(size.strength || "none")}">${esc(size.strength || "none")}</span></td></tr>`;
    }
  });
  const rules = DATA.rules.filter(r => (r.applies_to_uses || []).some(x => x === useId || x === "all"));
  const sheetLinks = DATA.sheets.map(s => `<a href="../standards_sheets/${s}" target="_blank">${esc(s.replace(".svg", "").replace(/_/g, " "))}</a>`).join("");
  document.getElementById("app").innerHTML = `
    <div class="title"><div><div class="kicker" style="margin-top:0">${esc(grp)}${grp.toLowerCase() === u.family ? "" : " · " + esc(u.family)}</div>
      <h2>${esc(label)}</h2><div class="sv">${esc(u.label_sv)} — catalogue use <code>${esc(u.id)}</code></div></div></div>
    ${variant ? `<div class="variant"><b>Variant: ${esc(variant.label)}.</b> ${esc(variant.changes)}</div>` : ""}
    <div class="facts">
      <div class="fact"><b>Fire occupancy class</b>${esc(String(u.regulatory.bbr_verksamhetsklass || "—").split(". ")[0])}</div>
      <div class="fact"><b>Gross area per ${esc(unit)}</b>${g.value != null ? `${fmt(g.value)} m²${g.range ? ` (${g.range[0]}–${g.range[1]})` : ""} <span class="badge ${esc(g.strength)}">${esc(g.strength)}</span>` : `<span class="none">no sourced figure</span>`}<div class="src">${esc(g.source || "")}</div></div>
      <div class="fact"><b>Opening hours profile</b>${esc(String(occ.hours_profile || "—").replace(/_/g, " "))}${hoursSvg(occ.hourly_presence)}</div>
    </div>
    <div class="calc"><label for="n"><b>Number of ${esc(unit)}s</b></label>
      <input id="n" type="number" min="1" value="${n}" onchange="setParam('n', this.value)">
      <label for="st"><b>Staff</b></label>
      <input id="st" type="number" min="0" value="${staffFor(u, n) ?? ""}" placeholder="?" style="width:90px" onchange="setParam('s', this.value)">
      <span style="font-size:12px;color:var(--grey)">${staffFor(u, n) != null && !STAFF ? "staff estimated from the catalogue" : "used for staff WCs, changing, eating rooms"}</span>
      <span class="total">Indoor sized spaces: <b>${fmt(sum)} m²</b>${outdoor ? ` · outdoor / site ${fmt(outdoor)} m²` : ""}${g.value != null ? ` · gross guide ${fmt(g.value * n)} m²` : ""}</span></div>
    <div class="layout">
      <div><table><thead><tr><th>Space</th><th>How many / ratio</th><th>Size (source) → for ${fmt(n)}</th><th>Strength</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <details><summary>Rules that apply to every ${esc(label)} (${rules.length})</summary><div style="margin-top:10px">
        ${rules.map(r => `<div class="rule"><div class="t">${esc(r.topic)} <span class="badge ${esc(r.strength)}">${esc(r.strength)}</span></div>
          <p>${esc(r.rule_plain_english)}</p>${Object.keys(r.values || {}).length ? `<div class="v">${esc(JSON.stringify(r.values))}</div>` : ""}
          <div class="src">${esc(r.source)} · ${esc(r.confidence || "")} · <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></div></div>`).join("")}
      </div></details>
      <details><summary>All sources for this function (${(u.sources || []).length})</summary><ol class="src">
        ${(u.sources || []).map(s => `<li>${esc(s.ref)}${s.url ? ` — <a href="${esc(s.url)}" target="_blank">${esc(s.url)}</a>` : ""} (accessed ${esc(s.accessed || "—")})</li>`).join("")}</ol></details>
      <details><summary>Standards drawings</summary><div class="sheets" style="margin-top:10px">${sheetLinks}</div></details>
      </div>
      <div class="panel" id="panel"></div>
    </div>`;
  renderPanel(u, spaceId || u.spaces[0].id, n, fi);
}

function setParam(k, v) {
  const p = new URLSearchParams(location.hash.slice(1));
  if (v === "" || v == null) p.delete(k); else p.set(k, v);
  location.hash = p.toString();
}

function perLabel(size, unit) {
  if (size.rule === "per_unit" && /^1\s+(?:[A-Za-zÅÄÖåäö]+\s+)?per\s/i.test(String(size.count || ""))) return "each";
  return {per_unit: `per ${unit}`, per_seat: "per seat", per_group: "per group", per_building: "", fixed: "", derived: ""}[size.rule] || "";
}

function pick(id) {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set("space", id);
  history.replaceState(null, "", "#" + p.toString());
  const fi = +p.get("f"), u = U[FUNCTIONS[fi][2]], n = +(p.get("n") || FUNCTIONS[fi][4]);
  document.querySelectorAll("tr.space").forEach(tr => tr.classList.toggle("on", tr.getAttribute("onclick").includes(`'${id}'`)));
  renderPanel(u, id, n, fi);
}

function renderPanel(u, id, n, fi) {
  const sp = u.spaces.find(s => s.id === id) || u.spaces[0];
  const size = sp.size || {}, req = sp.required || {};
  const a = areaFor(sp, u, n), c = countFor(sp, u, n);
  const unit = unitWord(u.occupancy && u.occupancy.unit);
  const tags = constraintTags(sp);
  const deps = (sp.depends_on || []).map(d => {
    const t = u.spaces.find(s => s.id === d);
    return t ? `<span class="link" onclick="pick('${d}')">${esc(t.label_en)}</span>` : esc(d);
  }).join(", ");
  const related = relatedSheets(sp);
  const neufert = size.neufert_ref ? `<div class="neufert"><b>Neufert:</b> ${esc(size.neufert_ref)}</div>` :
    (size.value_m2 == null ? `<div class="neufert"><b>No Swedish size source.</b> Neufert reference not entered yet — add
      <code>"neufert_ref": "Bauentwurfslehre, ed. __, p. __"</code> to this space's <code>size</code> in
      <code>data/catalogue/uses/${esc(u.id)}.json</code> (page reference only; catalogue policy forbids copying Neufert tables).</div>` : "");
  document.getElementById("panel").innerHTML = `
    <div class="kicker" style="margin:0 0 4px">${esc(u.label_sv)} · ${esc(sp.layer || "")}</div>
    <h3>${esc(sp.label_en)}</h3><div class="sv" style="font-style:italic;color:var(--grey)">${esc(sp.label_sv || "")}</div>
    ${spaceSvg(sp, a, n, unit)}
    <h4>Dimensions</h4>
    <p>${size.value_m2 != null ? `<b>${fmt(size.value_m2)} m²</b> ${esc(perLabel(size, unit))}${size.range_m2 ? ` (range ${size.range_m2[0]}–${size.range_m2[1]})` : ""}` : `<span class="none">no sourced size</span>`}
      <span class="badge ${esc(size.strength || "none")}">${esc(size.strength || "none")}</span> ${size.confidence ? `<span class="badge">${esc(size.confidence)}</span>` : ""}</p>
    ${a ? `<p>For ${fmt(n)} ${esc(unit)}s: <b style="color:var(--accent)">${fmt(a.total)} m²</b> (${esc(a.how)})</p>` : ""}
    ${size.count ? `<p><b>How many:</b> ${esc(size.count)}${c && c.count ? ` → <b style="color:var(--accent)">${c.count}</b>${c.base ? " for " + esc(c.base) : ""}` : c && c.needsStaff ? " → enter the number of staff to calculate" : ""}</p>` : ""}
    ${tags.length ? `<div class="chips">${tags.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="src"><b>Size source:</b> ${esc(size.source || "—")}${size.url ? ` — <a href="${esc(size.url)}" target="_blank">${esc(size.url)}</a>` : ""}</div>
    ${sp.constraints_sources ? `<div class="src"><b>Constraint sources:</b> ${esc(sp.constraints_sources)}</div>` : ""}
    ${neufert}
    <h4>Why it is required</h4>
    <p><span class="badge ${esc(req.strength || "none")}">${esc(req.strength || "none")}</span> ${esc(req.basis || "")}</p>
    ${req.url ? `<div class="src"><a href="${esc(req.url)}" target="_blank">${esc(req.url)}</a></div>` : ""}
    ${deps ? `<h4>Must sit next to / depends on</h4><p>${deps}</p>` : ""}
    ${sp.binding_constraint && sp.binding_constraint !== "none" ? `<h4>Fails first in an office conversion</h4><p>${esc(sp.binding_constraint.replace(/_/g, " "))}</p>` : ""}
    ${(sp.shareable_with || []).length ? `<h4>Can be shared with</h4><p>${esc(sp.shareable_with.join(", ").replace(/_/g, " "))}${sp.shareable_note ? ` — ${esc(sp.shareable_note)}` : ""}</p>` : ""}
    ${(sp.mixing_constraints || []).length ? `<h4>Mixing constraints</h4><ul>${sp.mixing_constraints.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    ${sp.notes ? `<h4>Notes</h4><p>${esc(sp.notes)}</p>` : ""}
    ${related.length ? `<h4>Detailed drawings</h4><div class="sheets">${related.map(s => `<a href="../standards_sheets/${s}" target="_blank">${esc(s.replace(".svg", "").replace(/_/g, " "))}</a>`).join("")}</div>` : ""}`;
}

const TAGS = {daylight_required:"daylight", facade_required:"on facade", drainage_required:"drain", floor_drain_required:"floor drain",
  exhaust_ventilation_required:"exhaust", ground_floor_required:"ground floor", ground_floor_preferred:"ground floor preferred",
  direct_link_to_outdoor:"door to outdoors", direct_link_to_building:"next to building", vehicle_access_required:"vehicle access",
  goods_delivery_access_required:"goods access", grease_separator_required:"grease separator", step_free_required:"step-free",
  level_threshold_free:"no thresholds", fenced:"fenced", acoustic_privacy_required:"acoustic privacy", sound_insulation_required:"sound insulation",
  wash_basin_required:"wash basin", hand_wash_basin:"hand basin", water_point_required:"water point", water_supply_required:"water",
  fume_cupboard_required:"fume cupboard", chemical_storage_ventilated:"ventilated chemical store", fire_rated_archive:"fire-rated",
  dust_extraction_required:"dust extraction", heavy_floor_load:"heavy floor load", power_high_load:"high power", central_location:"central",
  daylight_two_directions:"daylight from 2 sides", goods_access:"goods access", stove_guard:"stove guard", ground_level_access:"ground level"};

function constraintTags(sp) {
  const c = sp.constraints || {}, t = [];
  for (const [k, v] of Object.entries(c)) {
    if (v === null || v === false || v === undefined) continue;
    if (k === "min_ceiling_height_mm" || k === "min_clear_height_mm") t.push(`ceiling ≥ ${fmt(v)} mm`);
    else if (k.endsWith("_mm")) t.push(`${k.replace(/_mm$/, "").replace(/_/g, " ")} ${fmt(v)} mm`);
    else if (k === "column_free_span_m") t.push(`column-free ${v} m`);
    else if (k === "min_classroom_m2") t.push(`room ≥ ${v} m²`);
    else if (k === "noise_max_dBA_eq_day") t.push(`≤ ${v} dBA`);
    else if (k === "ceiling_hoist") t.push(`ceiling hoist: ${String(v).replace(/_/g, " ")}`);
    else if (TAGS[k]) t.push(typeof v === "string" ? `${TAGS[k]}: ${v}` : TAGS[k]);
  }
  return t;
}

function relatedSheets(sp) {
  const s = (sp.id + " " + sp.label_en).toLowerCase(), out = [];
  const add = k => DATA.sheets.filter(x => x.includes(k)).forEach(x => out.includes(x) || out.push(x));
  if (/wc|toilet|hygien|bathroom/.test(s)) add("accessible_wc");
  if (/entrance|corridor|circulation|lobby|hall/.test(s)) { add("wheelchair"); add("escape"); add("ramps"); }
  if (/assembly|main room|dining|event|sports hall/.test(s)) add("escape");
  if (/apartment|resident|care/.test(s)) add("care_apartment");
  if (/bicycle|cycle/.test(s)) add("bicycle");
  if (/waste|recycl/.test(s)) { add("waste"); add("refuse"); }
  if (/goods|delivery|loading/.test(s)) add("refuse");
  return out;
}

// ---------------------------------------------------------------- drawings

function hoursSvg(h) {
  if (!h || !h.length) return "";
  const w = 210, hh = 40, bw = w / 24;
  let s = `<svg width="${w}" height="${hh + 14}" style="display:block;margin-top:6px">`;
  h.forEach((v, i) => { const b = Math.max(0, v) * hh; s += `<rect x="${i * bw + .5}" y="${hh - b}" width="${bw - 1}" height="${b}" fill="#cc2f2a"><title>${String(i).padStart(2, "0")}:00 — ${Math.round(v * 100)} %</title></rect>`; });
  s += `<line x1="0" y1="${hh}" x2="${w}" y2="${hh}" stroke="#1d1d1b"/>`;
  [0, 6, 12, 18, 24].forEach(t => s += `<text x="${Math.min(t * bw, w - 8)}" y="${hh + 12}" font-size="9" fill="#7d7d7a">${t}</text>`);
  return s + "</svg>";
}

function tick(x, y) { return `<line x1="${x - 5}" y1="${y + 5}" x2="${x + 5}" y2="${y - 5}" stroke="#1d1d1b" stroke-width="1.5"/>`; }

function spaceSvg(sp, a, n, unit) {
  const W = 460, H = 330, c = sp.constraints || {};
  const id = (sp.id + " " + sp.label_en).toLowerCase();
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin:12px 0 4px;background:#fff">
    <defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#cc2f2a" stroke-width="1" stroke-opacity=".5"/></pattern></defs>`;
  if (!a) {
    s += `<rect x="70" y="60" width="240" height="180" fill="none" stroke="#7d7d7a" stroke-width="1.5" stroke-dasharray="7 5" rx="4"/>
      <text x="190" y="146" text-anchor="middle" font-size="14" font-weight="700" fill="#7d7d7a">no sourced size</text>
      <text x="190" y="166" text-anchor="middle" font-size="11" fill="#7d7d7a">drawn as a placeholder</text>`;
    s += sectionSvg(c, 360);
    return s + `<text x="10" y="${H - 8}" font-size="10" fill="#7d7d7a">Diagram: no area in the catalogue for this space.</text></svg>`;
  }
  const area = a.each || a.total;
  const long = /corridor|circulation|kommunik|passage/.test(id) ? 4 : /hall|sports/.test(id) ? 1.7 : 1.35;
  const wm = Math.sqrt(area * long), dm = area / wm;              // metres, illustrative proportion
  const scale = Math.min(270 / wm, 220 / dm);
  const x0 = 50, y0 = 50, w = wm * scale, d = dm * scale;
  const facade = c.facade_required || c.daylight_required;
  s += `<rect x="${x0}" y="${y0}" width="${w}" height="${d}" fill="url(#h)" stroke="#1d1d1b" stroke-width="2.4"/>`;
  if (facade) {
    s += `<line x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0}" stroke="#1d1d1b" stroke-width="7"/>`;
    for (let i = 0; i < 3; i++) { const wx = x0 + w * (0.12 + i * 0.3); s += `<rect x="${wx}" y="${y0 - 3}" width="${w * 0.18}" height="6" fill="#fff" stroke="#1d1d1b" stroke-width="1"/>`; }
    s += `<text x="${x0 + w / 2}" y="${y0 - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="#cc2f2a">FACADE / DAYLIGHT</text>`;
  }
  const aggregate = !a.each && (sp.size.rule === "per_unit" || sp.size.rule === "per_seat");
  if (/wc|toilet|rwc|accessible|hygien|bathroom/.test(id) && !aggregate && wm >= 1.5 && dm >= 1.5) {
    s += `<circle cx="${x0 + w / 2}" cy="${y0 + d / 2}" r="${0.75 * scale}" fill="none" stroke="#cc2f2a" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${x0 + w / 2}" y="${y0 + d / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#cc2f2a">Ø 1.5</text>`;
  }
  if (c.drainage_required || c.floor_drain_required) {
    s += `<circle cx="${x0 + w - 14}" cy="${y0 + d - 14}" r="6" fill="#fff" stroke="#1d1d1b"/><line x1="${x0 + w - 18}" y1="${y0 + d - 14}" x2="${x0 + w - 10}" y2="${y0 + d - 14}" stroke="#1d1d1b"/>`;
  }
  if (c.direct_link_to_outdoor || c.ground_floor_required) {
    s += `<line x1="${x0 + w * 0.7}" y1="${y0 + d + 4}" x2="${x0 + w * 0.7}" y2="${y0 + d + 26}" stroke="#cc2f2a" stroke-width="2"/><path d="M${x0 + w * 0.7 - 5},${y0 + d + 20} l5,8 l5,-8" fill="#cc2f2a"/>`;
  }
  s += `<rect x="${x0 + w / 2 - 52}" y="${y0 + d / 2 - 30}" width="104" height="${a.each ? 36 : 22}" fill="#fff" opacity=".9"/>
    <text x="${x0 + w / 2}" y="${y0 + d / 2 - 14}" text-anchor="middle" font-size="16" font-weight="800" fill="#cc2f2a">${fmt(area)} m²</text>`;
  if (aggregate) s += `<text x="${x0 + w / 2}" y="${y0 + d / 2 + 2}" text-anchor="middle" font-size="10" fill="#1d1d1b">total for ${fmt(n)} ${esc(unit)}s</text>
    <text x="${x0 + w / 2}" y="${y0 + d / 2 + 15}" text-anchor="middle" font-size="10" fill="#1d1d1b">normally split into several rooms</text>`;
  if (a.each) s += `<text x="${x0 + w / 2}" y="${y0 + d / 2 + 2}" text-anchor="middle" font-size="10" fill="#1d1d1b">each · ${esc(a.how)}</text>`;
  // dimensions
  const by = y0 + d + 30, rx = x0 + w + 22;
  s += `<line x1="${x0}" y1="${by}" x2="${x0 + w}" y2="${by}" stroke="#1d1d1b"/>${tick(x0, by)}${tick(x0 + w, by)}
    <text x="${x0 + w / 2}" y="${by - 6}" text-anchor="middle" font-size="12" font-weight="700">≈ ${wm.toFixed(1)} m</text>
    <line x1="${rx}" y1="${y0}" x2="${rx}" y2="${y0 + d}" stroke="#1d1d1b"/>${tick(rx, y0)}${tick(rx, y0 + d)}
    <text x="${rx + 8}" y="${y0 + d / 2}" font-size="12" font-weight="700" transform="rotate(90 ${rx + 8} ${y0 + d / 2})" text-anchor="middle">≈ ${dm.toFixed(1)} m</text>`;
  s += sectionSvg(c, 360);
  return s + `<text x="10" y="${H - 8}" font-size="10" fill="#7d7d7a">Area from the source; width × depth is an illustrative proportion, not a requirement.</text></svg>`;
}

function sectionSvg(c, x) {
  const h = c.min_ceiling_height_mm || c.min_clear_height_mm;
  if (!h) return "";
  const s = 0.06, base = 270, top = base - h * s;
  return `<text x="${x}" y="40" font-size="10" font-weight="700" fill="#7d7d7a">SECTION</text>
    <rect x="${x}" y="${base}" width="80" height="8" fill="#ecece7" stroke="#1d1d1b"/>
    <rect x="${x}" y="${top - 8}" width="80" height="8" fill="#ecece7" stroke="#1d1d1b"/>
    <line x1="${x + 66}" y1="${base}" x2="${x + 66}" y2="${top}" stroke="#cc2f2a"/>${tick(x + 66, base)}${tick(x + 66, top)}
    <text x="${x + 58}" y="${(base + top) / 2}" font-size="12" font-weight="800" fill="#cc2f2a" text-anchor="middle" transform="rotate(-90 ${x + 58} ${(base + top) / 2})">≥ ${fmt(h)} mm</text>`;
}

route();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
