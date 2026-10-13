# Marievik+ — Digital Lab

A computational platform for **adaptive reuse**: testing how one building shell can serve
different uses, different user groups, and different time horizons — and what each
transformation costs in **SEK** and **kg CO₂e**.

The lab answers one question repeatedly, at different scales:

> Given what already exists, what can this space become — and what does becoming it cost?

---

## The loop this platform implements

| Stage | Question | Where it lives in the code |
|---|---|---|
| **RETAIN** | What material, economic, spatial and social value already exists? | `data/building/` — the shell inventory. Every element carries quantity, layer, condition, remaining service life, and embodied carbon *already spent*. |
| **ENABLE** | What physical scope for action exists? | `engine/capacity.py` — headroom analysis: structural spare capacity, floor-to-floor, daylight, core position, servicing routes. |
| **ADAPT** | What changing needs must it meet? | `data/standards/` + `engine/fit.py` — use programs × user groups → requirements → fit test against the shell. |
| **IMPLEMENT** | What happens when we try? Where do obstacles arise? | `engine/scenarios.py` — transformation modelling, plus an explicit `blockers` register per scenario (technical, regulatory, financial, organisational, process). |
| **EVALUATE** | What value is created, what costs and conflicts arise? | `engine/evaluate.py` — cost + carbon + experience KPIs, with data-confidence tracking. |
| **LEARN → ADJUST → TEST → SCALE** | | Every run writes a timestamped record to `runs/`. Scenarios are versioned, so the loop is auditable. |

---

## Core design principle: separate what lasts from what changes

The platform models every physical element on a **shearing layer** (after Brand /
Duffy) with a **service life** and a **reversibility** score:

```
site        500 yr   never touched
structure   100 yr   RETAIN — the constraint you design within
skin         40 yr   ENABLE — where headroom is won or lost
services     20 yr   the usual reason "flexible" buildings aren't
space_plan   15 yr   ADAPT — this is what the lab optimises
stuff         5 yr   suppliers, furniture, the fast layer
```

**Flexibility is not an adjective here — it is a measured quantity.** It is the cost
and carbon of moving from state A to state B. A partition that unbolts and gets reused
carries almost no transformation carbon. The same partition, glued and skimmed, carries
its full replacement burden every time the use changes. That difference is the
entire thesis, and the engine computes it.

---

## Repository layout

```
data/
  standards/          user groups, ergonomics, space & performance requirements
  components/         supplier catalogue — cost, carbon, reversibility, performance
  building/           the existing shell (RETAIN inventory)
  scenarios/          use programs over time
engine/
  models.py           the data model (dataclasses, single source of truth)
  loader.py           load + validate + report data confidence
  standards.py        query requirements by use × user group
  evaluate.py         cost + carbon (embodied A1–A5, B4, C1–C4, D; operational B6)
  scenarios.py        transformation between states; adaptability index
  layout.py           parametric bay-based layout generation and scoring
  cli.py              run everything from the terminal
docs/
runs/                 timestamped outputs — the LEARN layer
```

## Setup

Commands are for bash (Git Bash on Windows), run from the repository root. On Linux or macOS the
virtual environment's scripts live in `bin/` rather than `Scripts/`.

**1. Python packages** (main environment)

```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -e ".[cad]"
```

Dependencies and their versions are listed in [pyproject.toml](pyproject.toml). This covers the engine, the
Apartment Lab, the Explorer and the optimiser. Needs Python 3.11 or newer. The `[cad]` extra adds `rhino3dm`,
which is only needed for the `.3dm` import and export; use `pip install -e .` to leave it out.
`engine.intake` and most of `engine.cli` need no packages at all.

**2. Simulation environment** (optional: EnergyPlus thermal comfort and Radiance daylight)

The optimiser and the Explorer's Ladybug Tools method run their simulations in a second environment,
`.venv-sim`. Without it the optimiser and the Explorer can't run the full simulations. The Explorer's quick
method still works.

```bash
py -3.11 -m venv .venv-sim          # any Python 3.7-3.13; openstudio has no build for 3.14
.venv-sim/Scripts/pip install -r requirements-sim.txt
```

EnergyPlus and Radiance themselves can't be installed with pip. The Ladybug Tools installer includes both.
It puts them in `~/ladybug_tools`, which is where honeybee looks for them.

**3. Web front ends** (needs Node.js)

```bash
(cd frontend && npm install && npm run build)              # Apartment Lab
(cd explorer/web && npm install && npm run build)          # Explorer (run_explorer.bat does this if needed)
```

The Apartment Lab build writes to `apartment/static/dist`. Until it exists, `apartment.server` fails on
import, and so do `tests.test_optimise` and `tests.test_tool`.

## Quick start

```bash
python -m engine.cli doctor          # data health + what is still unknown
python -m engine.cli fit             # which uses the shell can host, and what stops it
python -m engine.cli layout          # parametric bay layouts + partition demand per use
python -m engine.cli experience      # daylight, acoustics, access, staff — the third KPI
python -m engine.cli compare         # cost/carbon across 50-year use timelines
python -m engine.cli cad             # export layouts to Rhino/.3dm + CSV for Grasshopper
python -m engine.cli cad -r plan.3dm # measure a real floor plate, replacing the template
python -m engine.cli all             # everything, written to runs/

python -m engine.intake file.json    # validate a supplier submission (no dependencies)
python -m engine.grasshopper         # list + re-price Grasshopper exports (runs/grasshopper/)
python -m engine.build_web           # rebuild the published dashboard
python -m tests.test_engine          # 29 checks incl. ledger conservation
python -m tests.test_explorer        # explorer: scenarios, added floors, daylight, comfort
```

Add `-v` before the subcommand for detail: `python -m engine.cli -v compare`.

## Apartment Lab — the interactive model

```bash
python -m apartment.server     # http://127.0.0.1:8000
```

Local, parametric, one apartment. Drag walls, doors, windows and furniture;
capex, opex, LCC, LCA and the social metrics update together on every edit. See
[apartment/README.md](apartment/README.md).

If port 8000 is taken, run `python -m apartment.server --port 8010`.

- **Flat**: the Marievik+ bay, or a traced real plan from `apartment/data/shells/`
  (Mandolingatan 13 · 1802 is there, traced from its 1:100 sales plan).
- **Criteria strip**: LCC and carbon per person, thermal comfort, usability and
  functionality, live, against a baseline you set. Comfort runs EnergyPlus on
  the plan as drawn (~6 s); tick *auto* to re-simulate after every edit.
- **Parameters**: glazing, sill height, window width, wall system, products,
  people, wall position, furniture arrangement, orientation. Change one to apply
  it, or press ▶ to play it through its range: the plan animates through every
  scenario, a chart scores each on all five criteria, and it stops on the one
  with the least regret.
- **Optimise**: runs the full optimiser on the current flat in the background
  and returns ten options per use; open any of them in the editor.

This is where the project's argument becomes something you can feel: switch the
user group from `adult` to `care_resident_assisted` and watch a comfortable plan
stop working, because the bed's staff working space and the 1800 mm turning
circle are not negotiable.

## Explorer — the site in 3D, from site to unit

```bash
python -m explorer.server      # http://127.0.0.1:8020   (on Windows you can also double-click run_explorer.bat)
```

A rendered three.js view of the Marievik site, with sky, sun and shadows, built on the SB-Chalmers
threejsEditor stack. Go from **site → building → floor → unit**. For each building, set the ground- and
upper-floor uses, the partition system and the windows, or **add floors on top**. KPIs update at every
level: area, units, cost, carbon, retained share and blockers.

On any floor you can run **daylight factor** and **thermal comfort**. The quick method takes seconds. The
Ladybug Tools method runs Honeybee with EnergyPlus and Radiance in `.venv-sim`. Rhino `.3dm` files open in
the same view, with their layers. Saved scenarios sit side by side in a comparison table. The layouts come
from the parametric engine in `parametric/` (the Grasshopper model's code). See [explorer/README.md](explorer/README.md).

## Optimiser — ten options per use, and the one to regret least

```bash
python -m optimise                                    # all four uses, ~10 min
python -m optimise --uses student_housing family_housing
python -m optimise --azimuth 90 --carbon-price 2.0    # east facade, dearer carbon
python -m optimise --quick                            # small search, for testing
```

No dragging: pick the uses and the engine does the rest. For each use it
generates partition layouts on the shell (`optimise/schemes.py`, briefs in
`optimise/programs.py`), furnishes them with the annealer, specifies every
combination of partition system, product strategy and window intervention, and
simulates thermal comfort in EnergyPlus (`optimise/thermal_sim.py`, run in
`.venv-sim`, Stockholm weather in `data/climate/`). It keeps ten options that
span the trade-off and recommends the one with the least **maximum regret**
across five stakeholder weightings (`optimise/selection.py`). With more than one
use it also asks which option today you would regret least if the use changes
in year 10 or 20, costing each conversion wall by wall (`optimise/adapt.py`).

Output: `runs/optimise/<timestamp>/report.html` (self-contained) and
`results.json`. Furniture alternatives live in
`data/products/furniture_products.json` — dummy data until suppliers replace it.
Thermal results are cached in `runs/optimise/thermal_cache.json`, so re-running
after a cost change does not re-simulate.

## Grasshopper building model

The Rhino/Grasshopper definition in [`parametric/`](parametric/README.md) (component *MVK Building*) generates
floor-by-floor layouts per use on a real footprint and prices them from **this** catalogue. With
*Export = true* it writes `runs/grasshopper/<building>.json` (every use x partition system, plus plan
geometry). `engine/grasshopper.py` prices each bill again with `evaluate.evaluate_bill`, so dashboard
figures from the bay engine and from the Rhino model share one method. Rebuild with
`python -m engine.build_web` and the *Model* section of the dashboard updates.

## Published dashboard

https://claude.ai/artifact/8Pz3DFeq814iwewoRzMcyR — private until shared from the
page's Share menu. Rebuild with `python -m engine.build_web`, then republish.

The page embeds a timestamped snapshot of the engine's output, carrying its own
placeholder share in a banner. That is deliberate: a published figure should say
how much of itself is real.

## Data honesty rule

Every number in `data/` carries a `provenance` field. Anything not yet traced to an
EPD, a priced tender, or a cited standard is marked `PLACEHOLDER`. `cli.py doctor`
reports what fraction of any result rests on placeholders. **No result leaves this lab
without that fraction attached.** This is what makes it a research instrument rather
than a spreadsheet with opinions.
