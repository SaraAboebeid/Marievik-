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

## Quick start

```powershell
python -m engine.cli doctor          # data health + confidence report
python -m engine.cli fit             # which uses fit the shell, and how well
python -m engine.cli compare         # cost/carbon of every use transition
```

## Data honesty rule

Every number in `data/` carries a `provenance` field. Anything not yet traced to an
EPD, a priced tender, or a cited standard is marked `PLACEHOLDER`. `cli.py doctor`
reports what fraction of any result rests on placeholders. **No result leaves this lab
without that fraction attached.** This is what makes it a research instrument rather
than a spreadsheet with opinions.
