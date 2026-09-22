# Apartment Lab

A local parametric model of one apartment. Move a wall or a chair and cost,
carbon and the social metrics update together.

```powershell
python -m apartment.server     # http://127.0.0.1:8000
```

Binds to localhost only. Nothing leaves the machine.

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

Not just the score. `care_resident_assisted` raises any bed's working space to
900 mm on both sides and 1200 mm at the foot, because in assisted care that is
an occupational-health requirement under arbetsmiljölagen rather than a comfort
preference. The turning circle goes to 1800 mm and passage to 1300 mm.

Load **Care apartment** and watch what a single change of user group does to a
plan that was comfortable a moment ago. That is the project's argument in one
interaction.

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
