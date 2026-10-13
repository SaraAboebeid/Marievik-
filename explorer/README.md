# Marievik+ Explorer — adaptive reuse in 3D

A browser tool for testing adaptive reuse scenarios on the Marievik site. You move from **site → building →
floor → unit** in a rendered 3D view with sky, sun and shadows. At every level you see the KPIs for the
scenario you set, and you can run daylight and thermal comfort analysis on any floor.

It follows the architecture of the SB-Chalmers
[threejsEditor](https://github.com/SB-Chalmers/threejsEditor) (React + TypeScript + Vite + three.js +
rhino3dm), adapted to this repository's rule that **every number comes from Python**. The browser only draws
and asks.

```
explorer/
  server.py        FastAPI server + API                    python -m explorer.server  ->  http://127.0.0.1:8020
  model.py         scenarios: site > building > floor > unit, added floors, KPIs
  daylight.py      quick daylight factor (seconds)
  comfort.py       quick thermal comfort (seconds)
  climate.py       Stockholm EPW reader + sun position
  sim/full_sim.py  Ladybug Tools run: Honeybee-Energy (EnergyPlus) + Honeybee-Radiance, in .venv-sim
  web/             the 3D app (three.js, rhino3dm, React); `npm run build` -> web/dist
  models/          .3dm files listed in the viewer's Rhino panel
```

## Run it

```powershell
# once
pip install -e .   # see Setup in the main README
cd explorer\web; npm install; npm run build; cd ..\..

# every time
python -m explorer.server          # or double-click run_explorer.bat
```

Then open http://127.0.0.1:8020. The server lays out all 13 buildings at start (about 30 s). The page fills
in as each building arrives.

For development, run `npm run dev` in `explorer/web` (http://localhost:5174, hot reload), with the
server running.

The layouts come from the parametric engine in [`parametric/`](../parametric/): the same `mvk` code the
Grasshopper component runs. The server looks for it in `%MVK_PARAMETRIC%`, else in `parametric/`. Prices and carbon
come from this repository's catalogue.

## What you can do

| Level | You see | You can change |
|---|---|---|
| **Site** | All buildings with facade materials, windows, roofs and balconies. Site totals (GFA, units, fit-out cost, upfront carbon) and a table of every building. | Click a building. Save the current site scenario. |
| **Building** | That building, with the neighbours ghosted. GFA, floors, height, units by type, net-to-gross, window-to-floor ratio, cost and carbon (A1–A5, C1–C4, D), retained share, blockers. | Ground-floor use and upper-floor use. Partition system. Windows (keep or replace). **Add floors on top** (0–8) and their use. Facade detail on/off. Explode the floors. |
| **Floor** | The floor in 3D: walls by type, windows, doors, units coloured by type. Floor KPIs. | **Daylight** and **Thermal comfort** analysis, quick or Ladybug Tools. Overlay the results on the plan. PageUp/PageDown changes floor. |
| **Unit** | One apartment, office, hotel room or classroom: area, orientation, glazing, rooms, its daylight, and its comfort including the hottest week. | — |

Esc goes up one level. The sun bar sets the date and time (Stockholm sun), with sky, shadows and ambient
occlusion. Add `?lite=1` to the address on a slow GPU.

**Rhino.** The Rhino panel opens any `.3dm` file (drag one in with *Open .3dm…*, or put it in
`explorer/models`). It shows the file's layers, with their Rhino visibility, in the same coordinates as the
Grasshopper model.

**Scenarios.** *Scenarios* opens a comparison table. Each saved scenario keeps every building's settings,
the site KPIs, and the analysis of the floor that was open. *Load* restores a saved scenario. Saved scenarios
are stored in this browser.

## Analysis — what each method assumes

**Quick (always available, seconds)**
- *Daylight factor.* Split-flux method under a CIE overcast sky, on a 0.75 m grid 0.8 m above the floor. The
  sky component is integrated over each window of the unit. The obstruction horizon is taken from every site
  building at its scenario height, so added floors on a neighbour darken your units. The externally and
  internally reflected components use the BRE formula.
  - Reported: mean DF, the share of the area at DF ≥ 2.1 % (≈ 300 lx) and at DF ≥ 0.7 % (≈ 100 lx), and the
    EN 17037 minimum for Stockholm.
- *Thermal comfort.* EN ISO 13790 5R1C hourly model, one zone per unit, 8760 h of Stockholm TMYx weather.
  Comfort is judged by the EN 16798-1 adaptive model, category II, over occupied hours. The schedules, the
  1985 envelope placeholders, ventilation, the heating season and the blinds follow `optimise/thermal_sim.py`.
  - Mid-floor assumption: only the unit's own facade is exposed, plus the roof on the top floor.
  - Added floors are modelled as CLT construction with triple glazing.

**Ladybug Tools (validated, minutes).** This builds a Honeybee model of the whole floor: every unit is a
zone, the site context becomes shades, and the windows are apertures. It then runs **EnergyPlus**
(constructions and programmes from `optimise/thermal_sim.py`, adaptive comfort with ladybug-comfort) and the
**Radiance** daylight-factor recipe. It runs in the `.venv-sim` environment that the optimiser already uses.
  - Radiance also needs `lbt-recipes` and a Radiance install. The Ladybug Tools installer for Grasshopper
    includes both.
  - Missing engines are reported in the result; nothing fails silently.

```powershell
.venv-sim\Scripts\pip install honeybee-radiance lbt-recipes     # if only honeybee-energy is there
```

## Data honesty

The facade, use and footprint data are visual estimates and OpenStreetMap data. The layouts are mock plans
from the parametric engine until the real plans arrive. Costs and carbon are catalogue values, mostly
PLACEHOLDER. The UI shows the placeholder share and the mock-priced items.

Added floors raise blockers: structural capacity is not verified, fire class above 8 storeys, and the
detailed development plan (detaljplan). These stay until the data exists to clear them.

## Next steps (not built yet)

- Real plans: the engine already takes footprints. Real floor plans should replace the mock layouts per building.
- Unit-level editing (move walls, doors), reusing the Apartment Lab (`apartment/`).
- Annual daylight (sDA/ASE) and the Radiance view of a unit; daylight to neighbours for added floors.
- Structural headroom per building (`engine/capacity.py`) feeding the added-floors limit.
- A live link to Rhino/Grasshopper (Rhino.Compute) instead of the shared `mvk` code.
