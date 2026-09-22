/* Marievik+ Apartment Lab — plan editor.
 *
 * The browser owns interaction and drawing. Every number comes from the
 * Python engine, so there is one implementation of the costing and nothing
 * to keep in sync. Each edit posts the whole plan and redraws from the reply.
 */

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP = 50;          // mm
const $ = s => document.querySelector(s);

let BOOT = null;          // catalogues, shell, configurations
let plan = null;          // the live plan being edited
let result = null;        // latest evaluation
let baseline = null;      // snapshot for comparison
let tool = 'select';
let selected = null;      // {kind:'furniture'|'wall', id}
let wallType = 'part.demount.solid.100';
let drawStart = null;
let seq = 0;

const CAT_COLOR = {
  bedroom: 'var(--c1)', living: 'var(--c3)', kitchen: 'var(--c2)',
  sanitary: 'var(--c4)', storage: 'var(--c6)', work: 'var(--c5)',
  clearance: 'var(--muted)',
};

const fmt = n => Math.round(n).toLocaleString('en-US');
const fmt1 = n => n.toLocaleString('en-US', {maximumFractionDigits: 1});
const sek = n => Math.abs(n) >= 1e6 ? fmt1(n / 1e6) + ' M' : fmt(n);
const kg = n => Math.abs(n) >= 1000 ? fmt1(n / 1000) + ' t' : fmt(n) + ' kg';

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  BOOT = await (await fetch('/api/bootstrap')).json();
  $('#provenance').textContent =
    BOOT.provenance + '  ·  all costs and carbon are placeholders for model development';

  const cfgSel = $('#config');
  Object.entries(BOOT.configurations).forEach(([id, c]) => {
    cfgSel.append(new Option(c.label, id));
  });
  BOOT.uses.forEach(u => $('#use').append(new Option(u.label, u.id)));
  BOOT.user_groups.forEach(g => $('#group').append(new Option(g.label, g.id)));

  buildWallPalette();
  buildFurniturePalette();
  wireControls();
  loadConfig(cfgSel.value);
}

function buildWallPalette() {
  const host = $('#wall-types');
  BOOT.wall_types.forEach(w => {
    const b = document.createElement('button');
    b.dataset.id = w.id;
    b.innerHTML = `<span>${w.short}</span><em>Rw${w.rw} · ${fmt(w.cost_m2)}/m²</em>`;
    b.title = `${w.name}\nReversibility ${w.reversibility} · recovery ${w.recovery_rate}\n` +
              `${fmt(w.carbon_m2)} kgCO2e/m² · demount ${fmt(w.demount_m2)} SEK/m²\n\n${w.notes}`;
    b.setAttribute('aria-pressed', String(w.id === wallType));
    b.onclick = () => {
      wallType = w.id;
      [...host.children].forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === wallType)));
      if (selected && selected.kind === 'wall') {
        const wall = plan.walls.find(x => x.id === selected.id);
        if (wall) { wall.component = wallType; evaluate(); }
      }
    };
    host.append(b);
  });
}

function buildFurniturePalette() {
  const host = $('#furniture-palette');
  const groups = {};
  BOOT.furniture.forEach(f => (groups[f.category] ??= []).push(f));
  Object.entries(groups).forEach(([cat, items]) => {
    const g = document.createElement('div');
    g.className = 'pgroup';
    const h = document.createElement('div');
    h.textContent = cat;
    g.append(h);
    items.forEach(f => {
      const b = document.createElement('button');
      b.innerHTML = `<span>${f.name.replace(/ \d+×\d+$/, '')}</span><em>${f.w}×${f.d}</em>`;
      b.title = `${f.name}\n${fmt(f.cost_sek)} SEK · ${fmt(f.carbon_kgco2e)} kgCO2e\n` +
                `Needs ${f.clearance_front_mm} mm in front` +
                (f.clearance_side_mm ? `, ${f.clearance_side_mm} mm to one side` : '') +
                (f.notes ? `\n\n${f.notes}` : '');
      b.onclick = () => addFurniture(f.id);
      g.append(b);
    });
    host.append(g);
  });
}

function wireControls() {
  $('#config').onchange = e => loadConfig(e.target.value);
  ['use', 'group', 'occupants', 'years'].forEach(id => {
    $('#' + id).onchange = () => evaluate();
  });

  $('#tools').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    tool = b.dataset.tool;
    [...$('#tools').children].forEach(c =>
      c.setAttribute('aria-pressed', String(c.dataset.tool === tool)));
    drawStart = null;
    select(null);
    setHint();
  };

  ['t-clearance', 't-turn', 't-rooms', 't-grid'].forEach(id => {
    $('#' + id).onchange = () => draw();
  });

  $('#set-baseline').onclick = () => {
    baseline = JSON.parse(JSON.stringify(result));
    baseline._label = $('#config').selectedOptions[0].textContent;
    $('#clear-baseline').disabled = false;
    $('#baseline-note').textContent =
      `Comparing against "${baseline._label}" as it was when you set it.`;
    render();
  };
  $('#clear-baseline').onclick = () => {
    baseline = null;
    $('#clear-baseline').disabled = true;
    $('#baseline-note').textContent =
      'Set a baseline, then change the plan: every figure shows the difference.';
    render();
  };

  $('#reset').onclick = () => loadConfig($('#config').value);
  $('#export').onclick = async () => {
    await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
    setStatus('plan JSON copied', 1400);
  };

  // Bound once. Binding these inside draw() would stack a new listener on
  // every redraw, so one click would eventually draw a dozen walls.
  const svg = $('#plan');
  svg.addEventListener('pointerdown', onCanvasDown);
  svg.addEventListener('pointermove', onCanvasMove);

  addEventListener('keydown', e => {
    if (e.target.matches('input,select')) return;
    if (e.key === 'Escape') { drawStart = null; select(null); draw(); }
    if (!selected) return;
    if (e.key === 'r' || e.key === 'R') {
      if (selected.kind === 'furniture') {
        const f = plan.furniture.find(x => x.id === selected.id);
        f.rot = ((f.rot || 0) + 90) % 360;
        evaluate();
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(selected);
    }
  });
}

function setHint(text) {
  const hints = {
    select: '<b>Select</b> — click to select, drag to move. <b>R</b> rotates, ' +
            '<b>Delete</b> removes, <b>Esc</b> deselects. Snaps to 50 mm.',
    wall: '<b>Wall</b> — click one end, then the other. The chosen wall type on ' +
          'the left decides its cost, carbon, sound rating and whether you can ever take it out again.',
    door: '<b>Door</b> — click anywhere on a wall to put a door there. Click an ' +
          'existing door to remove it.',
  };
  $('#hint').innerHTML = text || hints[tool];
}

/* ------------------------------------------------------------------ */
/* plan state                                                          */
/* ------------------------------------------------------------------ */

function loadConfig(id) {
  const cfg = BOOT.configurations[id];
  plan = {
    shell: BOOT.shell,
    walls: JSON.parse(JSON.stringify(cfg.walls)),
    doors: JSON.parse(JSON.stringify(cfg.doors)),
    furniture: JSON.parse(JSON.stringify(cfg.furniture)),
  };
  $('#use').value = cfg.use;
  $('#group').value = cfg.user_group;
  $('#occupants').value = cfg.occupants;
  select(null);
  setHint(`<b>${cfg.label}</b> — ${cfg.description}`);
  evaluate();
}

function nextId(prefix) { return prefix + (++seq) + '_' + Date.now().toString(36).slice(-3); }

function addFurniture(typeId) {
  const spec = BOOT.furniture.find(f => f.id === typeId);
  // Drop it into open floor near the middle, then let the user place it.
  const item = {
    id: nextId('f'), type: typeId, rot: 0,
    x: Math.round(plan.shell.width_mm / 2 / SNAP) * SNAP,
    y: Math.round(plan.shell.depth_mm / 2 / SNAP) * SNAP,
  };
  plan.furniture.push(item);
  select({kind: 'furniture', id: item.id});
  setHint(`Added <b>${spec.name}</b> — drag it into place. It needs ` +
          `${spec.clearance_front_mm} mm clear in front to be usable.`);
  evaluate();
}

function remove(sel) {
  if (sel.kind === 'furniture') {
    plan.furniture = plan.furniture.filter(f => f.id !== sel.id);
  } else if (sel.kind === 'wall') {
    plan.walls = plan.walls.filter(w => w.id !== sel.id);
    plan.doors = plan.doors.filter(d => d.wall_id !== sel.id);
  } else if (sel.kind === 'door') {
    plan.doors = plan.doors.filter(d => d.id !== sel.id);
  }
  select(null);
  evaluate();
}

function select(sel) {
  selected = sel;
  if (sel && sel.kind === 'wall') {
    const w = plan.walls.find(x => x.id === sel.id);
    if (w) {
      wallType = w.component;
      [...$('#wall-types').children].forEach(c =>
        c.setAttribute('aria-pressed', String(c.dataset.id === wallType)));
    }
  }
  draw();
}

/* ------------------------------------------------------------------ */
/* evaluate                                                            */
/* ------------------------------------------------------------------ */

let pending = false;
let queued = false;

function setStatus(text, clearAfter) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('busy', text === 'computing…');
  if (clearAfter) setTimeout(() => { el.textContent = 'ready'; el.classList.remove('busy'); }, clearAfter);
}

async function evaluate() {
  if (pending) { queued = true; return; }
  pending = true;
  setStatus('computing…');
  const t0 = performance.now();
  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        plan,
        settings: {
          use: $('#use').value,
          user_group: $('#group').value,
          occupants: +$('#occupants').value,
          years: +$('#years').value,
        },
      }),
    });
    result = await res.json();
    setStatus(`${Math.round(performance.now() - t0)} ms`, 2000);
    render();
  } catch (err) {
    setStatus('engine error — is the server running?');
    console.error(err);
  } finally {
    pending = false;
    if (queued) { queued = false; evaluate(); }
  }
}

function render() { draw(); renderPanel(); }

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.append(n);
  return n;
}

function draw() {
  const svg = $('#plan');
  const W = plan.shell.width_mm, D = plan.shell.depth_mm;
  svg.setAttribute('viewBox', `-120 -120 ${W + 240} ${D + 240}`);
  svg.setAttribute('width', Math.min(880, W / 1.05));
  svg.innerHTML = '';

  const ext = plan.shell.external_wall_thickness_mm;

  // -- turning-circle wash -------------------------------------------
  if ($('#t-turn').checked && result && result.clearance_grid) {
    const g = result.clearance_grid, need = result.turning.required_mm;
    const layer = el('g', {opacity: 0.5}, svg);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        if (g.values[r * g.cols + c] >= need) {
          el('rect', {
            x: c * g.step_mm, y: r * g.step_mm,
            width: g.step_mm, height: g.step_mm,
            fill: 'var(--accent-soft)',
          }, layer);
        }
      }
    }
  }

  // -- 100 mm grid ---------------------------------------------------
  if ($('#t-grid').checked) {
    const g = el('g', {stroke: 'var(--grid)', 'stroke-width': 4}, svg);
    for (let x = 0; x <= W; x += 1000) el('line', {x1: x, y1: 0, x2: x, y2: D}, g);
    for (let y = 0; y <= D; y += 1000) el('line', {x1: 0, y1: y, x2: W, y2: y}, g);
  }

  // -- external envelope --------------------------------------------
  el('rect', {
    x: ext / 2, y: ext / 2, width: W - ext, height: D - ext,
    fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': ext,
  }, svg);

  // -- windows -------------------------------------------------------
  plan.shell.windows.forEach(w => {
    el('line', {
      x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
      stroke: 'var(--c1)', 'stroke-width': ext + 20, 'stroke-linecap': 'butt',
    }, svg);
    el('line', {
      x1: w.x1, y1: w.y1 + 10, x2: w.x2, y2: w.y2 + 10,
      stroke: 'var(--raised)', 'stroke-width': 30,
    }, svg);
  });

  // -- room area labels ----------------------------------------------
  if ($('#t-rooms').checked && result) {
    result.rooms.forEach(r => {
      const state = r.reachable ? '' : ' ⚠';
      const t = el('text', {
        x: r.centroid[0], y: r.centroid[1],
        'text-anchor': 'middle', 'font-size': 210,
        'font-family': 'var(--mono)', fill: 'var(--muted)',
      }, svg);
      t.textContent = `${fmt1(r.area_m2)} m²${state}`;
      const t2 = el('text', {
        x: r.centroid[0], y: r.centroid[1] + 230,
        'text-anchor': 'middle', 'font-size': 160,
        'font-family': 'var(--mono)', fill: 'var(--muted)', opacity: .75,
      }, svg);
      t2.textContent = r.kind + (r.daylight ? ' · daylit' : '');
    });
  }

  // -- clearance zones -----------------------------------------------
  if ($('#t-clearance').checked) {
    const layer = el('g', {}, svg);
    plan.furniture.forEach(f => {
      const s = BOOT.furniture.find(x => x.id === f.type);
      if (!s || !s.clearance_front_mm) return;
      const rect = el('rect', {
        x: f.x - s.w / 2, y: f.y + s.d / 2, width: s.w, height: s.clearance_front_mm,
        fill: 'var(--c5)', opacity: .17,
        transform: `rotate(${f.rot || 0} ${f.x} ${f.y})`,
      }, layer);
      rect.style.pointerEvents = 'none';
      if (s.clearance_side_mm) {
        [-1, 1].forEach(sign => {
          const sr = el('rect', {
            x: sign < 0 ? f.x - s.w / 2 - s.clearance_side_mm : f.x + s.w / 2,
            y: f.y - s.d / 2, width: s.clearance_side_mm, height: s.d,
            fill: 'var(--c4)', opacity: .13,
            transform: `rotate(${f.rot || 0} ${f.x} ${f.y})`,
          }, layer);
          sr.style.pointerEvents = 'none';
        });
      }
    });
  }

  // -- walls ---------------------------------------------------------
  const blockedIds = new Set((result?.blocked || []).map(b => b.id));
  plan.walls.forEach(w => {
    const type = BOOT.wall_types.find(t => t.id === w.component);
    const isSel = selected?.kind === 'wall' && selected.id === w.id;
    const line = el('line', {
      x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
      stroke: isSel ? 'var(--accent)' : 'var(--ink)',
      'stroke-width': w.thickness || 100,
      'stroke-linecap': 'square',
      opacity: (type && type.reversibility >= 0.8) ? 0.55 : 1,
    }, svg);
    line.style.cursor = tool === 'door' ? 'copy' : 'pointer';
    line.addEventListener('pointerdown', e => onWallDown(e, w));
    const t = el('title', {}, line);
    t.textContent = type
      ? `${type.name}\nRw ${type.rw} · reversibility ${type.reversibility}\n` +
        `${fmt(type.cost_m2)} SEK/m² · ${fmt(type.carbon_m2)} kgCO2e/m²`
      : w.component;
  });

  // -- doors ---------------------------------------------------------
  plan.doors.forEach(d => {
    const w = plan.walls.find(x => x.id === d.wall_id);
    if (!w) return;
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len;
    const cx = w.x1 + ux * len * d.t, cy = w.y1 + uy * len * d.t;
    const h = d.clear_mm / 2;
    const dl = el('line', {
      x1: cx - ux * h, y1: cy - uy * h, x2: cx + ux * h, y2: cy + uy * h,
      stroke: 'var(--raised)', 'stroke-width': (w.thickness || 100) + 12,
      'stroke-linecap': 'butt',
    }, svg);
    const swing = el('path', {
      d: `M ${cx - ux * h} ${cy - uy * h} a ${d.clear_mm} ${d.clear_mm} 0 0 1 ${uy * d.clear_mm + ux * h} ${-ux * d.clear_mm + uy * h}`,
      fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 18,
    }, svg);
    swing.style.pointerEvents = 'none';
    dl.style.cursor = 'pointer';
    dl.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (tool === 'door') { remove({kind: 'door', id: d.id}); }
      else select({kind: 'door', id: d.id});
    });
    const t = el('title', {}, dl);
    t.textContent = `Door, ${d.clear_mm} mm clear`;
  });

  // -- furniture ------------------------------------------------------
  plan.furniture.forEach(f => {
    const s = BOOT.furniture.find(x => x.id === f.type);
    if (!s) return;
    const isSel = selected?.kind === 'furniture' && selected.id === f.id;
    const isBlocked = blockedIds.has(f.id);
    const g = el('g', {transform: `rotate(${f.rot || 0} ${f.x} ${f.y})`}, svg);
    g.classList.add('drag');
    const rect = el('rect', {
      x: f.x - s.w / 2, y: f.y - s.d / 2, width: s.w, height: s.d,
      rx: 30,
      fill: s.is_space_reservation ? 'none' : CAT_COLOR[s.category] || 'var(--muted)',
      'fill-opacity': s.is_space_reservation ? 0 : .8,
      stroke: isSel ? 'var(--accent)' : (isBlocked ? 'var(--critical)' : 'var(--raised)'),
      'stroke-width': isSel ? 70 : (isBlocked ? 55 : 25),
      'stroke-dasharray': s.is_space_reservation ? '90 70' : 'none',
    }, g);
    // A tick on the front face, so rotation is readable at a glance.
    el('line', {
      x1: f.x - s.w / 2 + 60, y1: f.y + s.d / 2 - 40,
      x2: f.x + s.w / 2 - 60, y2: f.y + s.d / 2 - 40,
      stroke: 'var(--raised)', 'stroke-width': 35, opacity: .75,
    }, g);
    const t = el('title', {}, rect);
    t.textContent = `${s.name}\n${fmt(s.cost_sek)} SEK · ${fmt(s.carbon_kgco2e)} kgCO2e` +
      (isBlocked ? '\n\n⚠ ' + (result.blocked.find(b => b.id === f.id)?.detail || '') : '');
    g.addEventListener('pointerdown', e => onFurnitureDown(e, f));
  });

  // -- entry ----------------------------------------------------------
  const e = plan.shell.entry;
  el('circle', {cx: e.x, cy: e.y, r: 110, fill: 'var(--good)'}, svg);
  const et = el('text', {
    x: e.x, y: e.y - 190, 'text-anchor': 'middle', 'font-size': 170,
    'font-family': 'var(--mono)', fill: 'var(--good)',
  }, svg);
  et.textContent = 'ENTRY';

  // -- drawing a wall -------------------------------------------------
  if (drawStart) {
    el('circle', {cx: drawStart.x, cy: drawStart.y, r: 70, fill: 'var(--accent)'}, svg);
  }

  // The ghost line lives in the SVG we just cleared.
  ghost = null;
}

/* ------------------------------------------------------------------ */
/* interaction                                                         */
/* ------------------------------------------------------------------ */

function toMM(evt) {
  const svg = $('#plan');
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return {x: p.x, y: p.y};
}
const snap = v => Math.round(v / SNAP) * SNAP;

let ghost = null;

function onCanvasDown(evt) {
  if (tool !== 'wall') return;
  const p = toMM(evt);
  if (!drawStart) {
    drawStart = {x: snap(p.x), y: snap(p.y)};
    setHint('Click the other end of the wall. <b>Esc</b> cancels.');
    draw();
  } else {
    const end = {x: snap(p.x), y: snap(p.y)};
    // Keep walls orthogonal — the dominant axis wins.
    if (Math.abs(end.x - drawStart.x) > Math.abs(end.y - drawStart.y)) end.y = drawStart.y;
    else end.x = drawStart.x;
    if (Math.hypot(end.x - drawStart.x, end.y - drawStart.y) >= 300) {
      plan.walls.push({
        id: nextId('w'), x1: drawStart.x, y1: drawStart.y, x2: end.x, y2: end.y,
        thickness: 100, component: wallType,
      });
      evaluate();
    }
    drawStart = null;
    setHint();
    draw();
  }
}

function onCanvasMove(evt) {
  if (tool !== 'wall' || !drawStart) return;
  const p = toMM(evt);
  const end = {x: snap(p.x), y: snap(p.y)};
  if (Math.abs(end.x - drawStart.x) > Math.abs(end.y - drawStart.y)) end.y = drawStart.y;
  else end.x = drawStart.x;
  if (ghost) ghost.remove();
  ghost = el('line', {
    x1: drawStart.x, y1: drawStart.y, x2: end.x, y2: end.y,
    stroke: 'var(--accent)', 'stroke-width': 100, opacity: .5,
    'stroke-linecap': 'square',
  }, $('#plan'));
  ghost.style.pointerEvents = 'none';
}

function onWallDown(evt, wall) {
  evt.stopPropagation();
  if (tool === 'door') {
    const p = toMM(evt);
    const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const t = Math.max(0.08, Math.min(0.92,
      ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / (len * len)));
    const need = BOOT.user_groups.find(g => g.id === $('#group').value)?.door_clear || 850;
    plan.doors.push({id: nextId('d'), wall_id: wall.id, t, clear_mm: Math.max(850, need)});
    evaluate();
    return;
  }
  if (tool !== 'select') return;
  select({kind: 'wall', id: wall.id});
  startDrag(evt, delta => {
    wall.x1 = snap(wall._ox1 + delta.x); wall.x2 = snap(wall._ox2 + delta.x);
    wall.y1 = snap(wall._oy1 + delta.y); wall.y2 = snap(wall._oy2 + delta.y);
  }, () => {
    wall._ox1 = wall.x1; wall._ox2 = wall.x2; wall._oy1 = wall.y1; wall._oy2 = wall.y2;
  });
}

function onFurnitureDown(evt, item) {
  evt.stopPropagation();
  if (tool !== 'select') return;
  select({kind: 'furniture', id: item.id});
  startDrag(evt, delta => {
    item.x = snap(item._ox + delta.x);
    item.y = snap(item._oy + delta.y);
  }, () => { item._ox = item.x; item._oy = item.y; });
}

function startDrag(evt, apply, prime) {
  prime();
  const origin = toMM(evt);
  let moved = false;
  const move = e => {
    const p = toMM(e);
    apply({x: p.x - origin.x, y: p.y - origin.y});
    moved = true;
    draw();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    if (moved) evaluate();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ */
/* KPI panel                                                           */
/* ------------------------------------------------------------------ */

function deltaSpan(now, before, invert) {
  if (before == null || before === now) return '';
  const d = now - before;
  const worse = invert ? d < 0 : d > 0;
  const sign = d > 0 ? '+' : '';
  return `<span class="delta ${worse ? 'up' : 'down'}">${sign}${fmt(d)}</span>`;
}

function row(label, value, delta, cls) {
  return `<div class="row ${cls || ''}"><span>${label}</span>` +
         `<span>${value}${delta || ''}</span></div>`;
}

function renderPanel() {
  if (!result) return;
  const f = result.financial, e = result.environmental;
  const bf = baseline?.financial, be = baseline?.environmental;

  $('#k-financial').innerHTML =
    row('Capex', sek(f.capex) + ' SEK', deltaSpan(f.capex, bf?.capex)) +
    row('per m²', fmt(f.capex_m2) + ' SEK', '', 'sub') +
    row('Opex, year 1', sek(f.opex_annual) + ' SEK/yr', deltaSpan(f.opex_annual, bf?.opex_annual)) +
    row('Opex, NPV', sek(f.opex_npv) + ' SEK', '', 'sub') +
    row('Replacements, NPV', sek(f.replacement_npv) + ' SEK', '', 'sub') +
    row('Residual value', '−' + sek(f.residual_npv) + ' SEK', '', 'sub') +
    row(`LCC over ${result.years} yr`, sek(f.lcc) + ' SEK', deltaSpan(f.lcc, bf?.lcc), 'big') +
    row('per m²', fmt(f.lcc_m2) + ' SEK/m²', '', 'sub');

  $('#k-environmental').innerHTML =
    row('Upfront A1–A5', kg(e.upfront), deltaSpan(e.upfront, be?.upfront)) +
    row('Replacement B4', kg(e.b4), '', 'sub') +
    row('End of life C1–C4', kg(e.c1c4), '', 'sub') +
    row('Embodied total', kg(e.embodied), deltaSpan(e.embodied, be?.embodied)) +
    row('Operational B6', kg(e.operational), '', 'sub') +
    row(`LCA over ${result.years} yr`, kg(e.total), deltaSpan(e.total, be?.total), 'big') +
    row('per m²', fmt1(e.total_m2) + ' kg/m²', '', 'sub') +
    row('Embodied share', Math.round(e.embodied_share * 100) + '%', '', 'sub') +
    row('Module D (not netted)', kg(e.d_credit), '', 'sub');

  $('#k-social').innerHTML = result.social.map(m => {
    const b = baseline?.social.find(x => x.name === m.name);
    return `<div class="metric">
      <div class="top"><b>${m.name}</b><span class="v">${m.score}${
        b && b.score !== m.score ? deltaSpan(m.score, b.score, true) : ''}</span></div>
      <div class="bar"><i class="b-${m.band}" style="width:${m.score}%"></i></div>
      <div class="d">${m.detail}</div>
    </div>`;
  }).join('') +
    row('Mean', result.social_mean + ' / 100',
        baseline ? deltaSpan(result.social_mean, baseline.social_mean, true) : '', 'big');

  const issues = result.issues;
  $('#k-issues').innerHTML = issues.length
    ? issues.map(i => `<div class="issue"><span class="tag ${i.severity}">${i.severity}</span>
        <div><b>${i.title}</b><p>${i.detail}</p></div></div>`).join('')
    : '<p class="empty">Nothing blocking. Every item has its clearance and every room is reachable.</p>';

  $('#k-rooms').innerHTML =
    result.rooms.map(r => row(
      `${r.kind === 'wet' ? 'Wet room' : 'Room ' + r.index}${r.daylight ? '' : ' · no window'}`,
      `${fmt1(r.area_m2)} m² · turn ${fmt(r.turn_mm)}`,
    )).join('') +
    row('Turning circle needed', fmt(result.turning.required_mm) + ' mm', '', 'sub') +
    row('Largest available', fmt(result.turning.max_mm) + ' mm', '', 'sub') +
    row('Floor area', fmt1(result.area_m2) + ' m²', '', 'sub') +
    row('Free floor', fmt1(result.free_floor_m2) + ' m²', '', 'sub');
}

boot();
