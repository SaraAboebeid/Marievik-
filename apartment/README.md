# Apartment Lab

A local parametric model of one apartment. Move a wall or a chair and cost,
carbon and the social metrics update together.

Stack: **Vite + React + TypeScript + Tailwind v4** front end, **FastAPI** engine.
The browser owns interaction and drawing; Python owns every number, so there is
one implementation of the costing and nothing to keep in sync.

```powershell
# 1. build the frontend once
cd frontend
npm install
npm run build

# 2. run the app
cd ..
python -m apartment.server         # http://127.0.0.1:8000
```

For frontend work, leave the Python server running and start Vite alongside it:

```powershell
cd frontend
npm run dev                        # http://localhost:5173, proxies /api to 8000
```

Both halves then hot-reload independently. Binds to localhost only; nothing
leaves the machine.

---

## What it is for

One shell, several fit-outs, three kinds of consequence measured at once:

| | Covers |
|---|---|
| **Financial** | capex, opex year one, opex NPV, replacement NPV, residual value, **LCC** |
| **Environmental** | A1–A5 upfront, B4 replacement, C1–C4 end of life, B6 operational, **LCA total**. Module D reported, never netted. |
| **Social** | accessible circulation, daylight, acoustic privacy, space per occupant, furniture usability, storage |

Separating these is how the cheap-and-unusable option wins an argument. The
point of putting them on one screen is that you cannot improve one without
watching what it does to the others.

---

## How the social metrics are computed

These are the part worth trusting, because they are geometry rather than
opinion. The plan is rasterised at 50 mm and the hard questions become image
operations:

- **Rooms** — connected components of free space, with walls solid. Doors do
  not merge rooms.
- **Turning circle** — a distance transform gives the largest circle that fits
  at every point. Thresholding it at the user group's turning diameter shows
  exactly where a wheelchair can turn. That is the blue wash on the plan.
- **Reachability** — flood fill from the entry through space wide enough to
  pass. Measured twice, because *blocked* and *tight* are different problems:
  - **blocked** — no route at any width. A door is missing or furniture is in
    the way. Move something.
  - **tight** — you can walk there, but no route holds the clear width this
    user group needs. Moving furniture will not fix it; the room has to
    get bigger.
- **Furniture usability** — every item declares the clearance it needs in
  front, and some a transfer zone to one side. Those zones are tested against
  walls, the envelope and other furniture. An item without its clearance fits
  on a drawing and does not work in a room.

A doorway is judged against the **door** standard and a corridor against the
**passage** standard. Conflating the two marks every compliant plan
unreachable — it is the first bug this model had.

---

## Switching user group changes the building

Not just the score. Every clearance in the plan is resolved by the
[standards engine](../standards/README.md) against the ergonomic envelope of
whoever you are designing for. Nothing is hardcoded per user group:

| Wardrobe approach | |
|---|---|
| Adult, ambulant | 750 mm |
| Manual wheelchair user | 1200 mm |
| Care resident, assisted | 1300 mm |

Turning goes 1200 → 1500 → 1800 mm, passage 900 → 1300 mm, and in assisted care
a bed inherits two-staff working space because arbetsmiljölagen makes it an
occupational-health requirement rather than a comfort preference.

Load **Care apartment**, then switch the user group back to *Adult* and forward
again. Watch a comfortable plan stop working. That is the project's argument in
one interaction — and the **Standards** tab on the right shows exactly which
rule moved and what it is cited to.

---

## Placement

New furniture is placed by the engine, not dropped in the middle. It searches
for a position where the item *and its clearance* fit without taking the space
another item needs to be usable, preferring backs against walls. If nothing
fits it says so rather than stacking items on top of each other.

The search and the analysis build their clearance zones with the same function.
They did not at first, and the placements the search called valid were then
flagged as blocked — the two disagreed about which way "front" pointed after
rotation.

---

## Editing

| Tool | |
|---|---|
| **Select** | click to select, drag to move. `R` rotates, `Delete` removes, `Esc` deselects. Snaps to 50 mm. |
| **Wall** | click both ends. Walls are orthogonal. The wall type on the left sets cost, carbon, Rw and reversibility. |
| **Door** | click a wall to add a door there; click a door to remove it. |

**Set current as baseline**, then change something: every figure shows the
delta. That is the fastest way to answer a specific question — what does moving
this partition actually cost, in all three currencies at once.

---

## Where the numbers come from

Wall types and their cost, carbon and reversibility come from
`data/components/catalogue.json` in the main engine, so there is one catalogue
for the whole project. Furniture is `apartment/data/furniture.json`. Energy,
carbon factors and the discount rate come from `data/factors/operational.json`.

Conventions, each a position rather than an oversight:

- **money is discounted, carbon is not** — a tonne in 2070 is the same tonne
- **module D is never netted** into any total, per EN 15978
- **residual value is counted in LCC** — at the end of the study period a
  demountable wall is worth something and a skimmed one is not, and that
  difference is the whole adaptability case

Every cost and carbon value is still `PLACEHOLDER`. Replace them through the
supplier intake schema and the plan geometry stays exactly as valid.
