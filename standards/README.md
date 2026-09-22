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

## On Neufert specifically

**There is no licensed Neufert database or API.** *Architects' Data* is a
copyrighted work sold as a book and a licensed PDF. Copying its tables into
this repository would create a rights problem for anything the project
publishes or shares with suppliers and the municipality.

So this engine reproduces the *structure* Neufert gives you without
reproducing its content. Values are seeded from sources you can cite freely:

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
