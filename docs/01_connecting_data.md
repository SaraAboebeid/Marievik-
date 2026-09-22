# Connecting the lab to real data

The engine works. Every number in it is a placeholder. This document is the
route from one to the other, in the order that gives the most return.

---

## 1. Neufert — what is actually possible

**There is no Neufert database to connect to.** *Architects' Data* (Neufert,
Wiley/Blackwell) is a copyrighted reference work sold as a book and a
licensed PDF. There is no public API, no open dataset, and no licensing
programme for extracting its tables into third-party software. Several
commercial tools claim "Neufert-based" space standards; they are using their
own re-derived figures, not licensed data.

Bulk-copying its tables into `data/standards/` would create a rights problem
for anything this lab publishes or shares — with suppliers, with the
municipality, or as research output. So the platform is built the other way
round: it reproduces the *structure* Neufert gives you without reproducing
its content.

**What the lab uses instead, all freely citable:**

| Source | What it gives you | Status |
|---|---|---|
| **BBR** (Boverkets byggregler) | Swedish mandatory minima: accessibility, egress, ventilation, daylight, acoustics | Public, citable. *Note: BBR is being replaced by Boverket's new regulations — confirm which applies to your consent date.* |
| **SS 91 42 21** | Swedish dwelling dimensioning: wheelchair turning circles, furnishing zones, at normal and raised levels | SIS standard, Chalmers has institutional access |
| **SS 25268** | Sound classification for care, preschool, school, housing | SIS, Chalmers access |
| **EN 17210** | Accessibility & usability of the built environment — functional requirements | CEN standard, Chalmers access |
| **AFS 2020:1, AFS 2012:2** | Workplace and ergonomic requirements — this is how care *staff* become a user group with legal standing | Arbetsmiljöverket, free |
| **Boverket friyta guidance** | Outdoor area per child for preschool | Free |
| **Municipal programme documents** (Stockholms stad) | SÄBO and förskola briefing standards — often stricter than national minima and the ones that actually bind | Free |

**How to use your own Neufert copy correctly:** as a *verification* source.
Every requirement in `data/standards/` has a `source_ref` array already
seeded with `"VERIFY: Neufert p.___"`. Fill in the page number, confirm the
value, and cite the regulation — not Neufert — as the published source.
Neufert then does what it is good at: catching the requirement you forgot to
model at all. That is where its real value sits for this project anyway.

**Your actual competitive advantage is not Neufert.** Neufert tells you a
wheelchair needs a 1500 mm turning circle. It does not tell you what it costs
in SEK and kg CO₂e to give one to a 1985 office shell with 1400 mm corridors.
Nothing does. That gap is what this lab fills, and no book is competing with
it.

---

## 2. The project Google Drive

The folder you shared is private — it redirects to a Google sign-in, so
neither this session nor any unauthenticated tool can read it. Two routes:

**Route A — Google Drive for Desktop (recommended).** Not currently installed
on this machine. Once installed and signed in with your Chalmers account, the
project folder mounts as a normal drive (typically `G:\Shared drives\...`)
and every file becomes directly readable — drawings, spreadsheets, survey
reports — with no export step, staying in sync as colleagues update it. On a
Chalmers-managed device this may need IT approval; it is standard software
and usually granted.

**Route B — export what matters now.** Download the folder as a ZIP from the
Drive web UI and unpack into `data/source/`. Faster to start, but it is a
snapshot: it will drift from what your colleagues are editing, and drifting
source data in a carbon model is a genuine hazard. Fine for a one-off pull of
as-built drawings, poor as a standing arrangement.

Either way, `data/source/` should be added to `.gitignore` if it will hold
large drawing files — the repository should carry the *structured extract*
(`marievik_shell.json`), not the raw CAD.

**What to pull first**, in the order the `doctor` command ranks them:

1. Structural drawings and any load calculation — the slab capacity decides
   which uses are available at all.
2. As-built plans — grid, core, façade module, drainage stack positions.
3. Any existing condition or asbestos survey.
4. The detaljplan and any planning correspondence.

---

## 3. Supplier onboarding

Each partner supplier submits one JSON object per product, matching the
schema in `data/components/catalogue.json`. Send them that file as the
specification — it is self-documenting.

The three fields most suppliers cannot fill are the three that matter most
here:

- `reversibility` — how the product is fixed, and what that implies for removal
- `recovery_rate` — what fraction survives removal intact and reusable
- `carbon_kgco2e.C1C4` and `.D` — end-of-life and reuse potential

Most EPDs stop at A1–A3. **Asking for C1–C4 and D is not a formality.** They
are where a reuse argument is won or lost, and a supplier who can answer them
is demonstrating something real about their product. Expect the request
itself to be productive: it tells you which suppliers have thought about
disassembly and which have only thought about marketing.

Ask also for `labour_demount` cost. Almost nobody publishes it, contractors
rarely price it, and it is the single weakest number in the entire model. If
this project produces a credible demount-cost dataset for Swedish
conditions, that is a contribution in its own right — arguably a more
original one than the layout engine.

---

## 4. Replacing the shell template

`data/building/marievik_shell.json` is a template with invented numbers. Its
field names are the survey brief: if you cannot fill a field, that gap is
itself a RETAIN-stage finding, and `python -m engine.cli doctor` lists them
in priority order.

Two flags propagate into every result until cleared:

- `structure.live_load_verified: false`
- `condition_survey.asbestos_survey_done: false`

The engine prints results while these are false, but labels them conditional.
Do not remove that behaviour — it is what keeps early feasibility numbers
from being quoted later as though they were verified.
