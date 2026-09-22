# Standards engine

The layer Neufert occupies in a design office, rebuilt as code the rest of the
project queries.

```
data/ergonomics.json    bodies, reach envelopes, the space an ACTIVITY needs
data/space_types.json   rooms declared as the activities they must support
rules.py                resolves one against the other, for a given user group
```

---

## Why the indirection

A wardrobe does not have a clearance. A wardrobe has an **activity** — standing
at it with the door open — and that activity needs a different depth for an
ambulant adult than for a wheelchair user. Writing `750` into the furniture
record hides that and makes the model correct for exactly one user group.

So nothing stores a clearance. Items declare which activity they must support,
activities carry a reference dimension, and the engine resolves the two against
the ergonomic envelope of whoever is being designed for:

| Wardrobe approach | |
|---|---|
| Adult, ambulant | 750 mm |
| Manual wheelchair user | 1200 mm |
| Care resident, assisted | 1300 mm |

Nobody edited the wardrobe to get those. Change the user group in the app and
every requirement in the building moves.

---

## How a requirement is derived

Each activity zone splits into a **body** part and a **task** part. The body
part grows with the user's occupied size; the task part does not, because an
oven door opens the same distance for everyone.

The growth is **additive**, not multiplicative. This matters more than it
sounds: a wheelchair's 1200 mm occupied depth is 2.7× a standing adult's
450 mm, and multiplying turned *turn around on the spot* into a 2400 mm
requirement — nonsense. Adding the difference gives 1500 mm, the real
accessible figure. Body depth is an offset, not a multiplier.

Zones already dimensioned around a device — turning, wheelchair transfer,
two-staff assistance, hoist transfer — do not scale at all, or the wheelchair
that defines them gets counted twice. `stand_and_turn` resolves to the user
group's own turning circle rather than being derived a second time.

Every resolved requirement carries its reasoning and its citation back out, so
any number the platform shows can be traced to the clause it came from.

---

## Neufert as the reference

Values are verified against **Neufert, *Architects' Data*, 3rd English edition
(4th German edition)** and cited by printed page. Dimensional facts are not
copyrightable and citing them is ordinary scholarly practice; what this
repository does not do is reproduce the work itself — no scanned pages, no
redrawn figures, no wholesale transcription of a table's selection and
arrangement. A reader with their own copy can check every number.

**Method, and why it matters.** The scanned copy is OCR'd, and OCR of a
technical reference gets *digits* wrong more than words. So the OCR text is
used only to locate pages; every number is read off the rendered page
directly. A silently wrong dimension propagating into a carbon model is the
worst failure this system has, and it would look exactly like a correct one.

Pages verified so far: **23** (accessible housing), **29** (body measurements and
space requirements), **150** (kitchens), **157** (living areas and bedrooms),
**161** (bathrooms), **169** (nursing and care homes), **175** (dining and
catering). `neufert_index.json` is a finding aid mapping this project's topics
to page numbers, so the next verification pass knows where to look.

### The result that matters most so far

Neufert p.157 fig.1 names a room type it calls a **flexibly functional
individual room** — 13 m2, min 3.60 x 3.50 m, *including* a 1.50 x 1.50 m
wheelchair movement area. Run both through `check_space`:

| | Adult | Wheelchair user |
|---|---|---|
| Minimal single bedroom, 8 m2 | passes | **fails** — needs 1500 mm to make the bed and to turn |
| Flexible individual room, 13 m2 | passes | **passes** |

That is the adaptability argument in two rows, from a published reference: 8 m2
buys a room that works for one user, 13 m2 buys a room that works for both. The
~60% area premium is what the flexibility case has to earn back — and now it is
a number rather than a conviction.

The satisfying check: with bed access made turn-bounded, the engine
reproduces Neufert p.23 fig.9 exactly — **1.20 m** along the access side of an
ambulant user's bed, **1.50 m** for a wheelchair user — without those figures
being entered anywhere. They fall out of the turning circles, which is not a
coincidence: you have to turn to get out of bed.

`sources.json` is the bibliographic register, and `rules.cite()` resolves a
loose reference like `"Neufert p.23"` into a full entry plus page, so a number
on screen becomes a footnote without anyone retyping it.

Values are also seeded from sources you can cite freely:

- **BBR** — accessibility, egress, ventilation, daylight, dwelling design
- **SS 91 42 21** — dwelling dimensioning, normal and raised level
- **SS 25268** — sound classification
- **EN 17210** — accessibility and usability of the built environment
- **AFS 2020:1 / 2012:2** — workplace and ergonomic requirements
- **ISO 7176** — wheelchair dimensions

Every record carries an empty `neufert_ref` field. Fill it from your own copy
as an internal verification pass, then cite the regulation — not the book — as
the published source. Neufert then does what it is genuinely best at: catching
the requirement you forgot to model at all.

`rules.coverage()` reports how many records are traced to a source and how
many you have verified, and the app shows it. A standards engine that cannot
say which of its own rules are uncited is an opinion with a schema.

---

## Using it

```python
from standards import rules

rules.summary("wheelchair_manual")          # the full sheet for one person
rules.item_clearances("wardrobe.1000", "wheelchair_manual")
rules.turning_circle("older_adult_rollator")
rules.reach_band("wheelchair_manual")       # (400, 1200) - put controls here
rules.check_space("bedroom_single", "wheelchair_manual",
                  area_m2=7.2, min_width_mm=2100, turn_available_mm=1200,
                  has_daylight=True, fixtures_present=["bed.single.900"])
rules.coverage()
```

Over HTTP: `GET /api/standards/{user_group}` and `GET /api/standards`.
