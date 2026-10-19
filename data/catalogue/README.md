# Use catalogue

A project-neutral catalogue of building uses and the spaces each one **must**, **should** or **usually** contains,
with the Swedish source behind every requirement. It is shared by all pilots (Marievik, Lindängen, Sandvången,
Uppsala, Gothenburg, …): a pilot picks uses from here; it never edits them.

```
catalogue/
  README.md              this file: the format
  cross_cutting.json     rules that apply to every use (accessibility, fire class, staff facilities, WC, ventilation)
  uses/<use_id>.json     one file per use
```

## Why every value carries a strength

Swedish law mostly says that a function **must exist**, rarely **how large** it must be. A school must serve
meals (Skollagen 10 kap.), but no law gives m² per pupil for the dining hall; that comes from municipal
programmes and practice. So existence and size are sourced separately, each with its own strength:

| strength     | meaning                                                                   | in the fit test        |
|--------------|---------------------------------------------------------------------------|------------------------|
| `law`        | binding requirement in law, ordinance or regulation (SFS, BBR, AFS, LIVSFS) | missing = hard blocker |
| `guidance`   | official general advice or guidance (allmänna råd, Boverket/Skolverket/Socialstyrelsen vägledning) | missing = must be justified |
| `programme`  | a municipal or operator space programme (e.g. a city's school or SÄBO lokalprogram) | missing = negotiation with operator |
| `practice`   | rule of thumb, design literature (Neufert page refs only — never copy its tables) | indicative only |

`confidence` says how sure we are that the value is right: `verified` (checked against the cited text),
`sourced` (taken from a cited source but not re-checked) or `indicative` (working value, MUST be verified).

## A use file

```jsonc
{
  "id": "school_compulsory",
  "label_en": "Compulsory school (grundskola)",
  "label_sv": "Grundskola",
  "family": "education",                  // education | care | housing | work | commercial | community | health | hospitality
  "summary": "…",
  "regulatory": {
    "bbr_verksamhetsklass": "2B",          // BBR 5:2 fire occupancy class, with source
    "key_laws": [{ "ref": "Skollagen (2010:800)", "url": "https://…" }],
    "permits": ["Bygglov for change of use (PBL 9 kap. 2 §)", "…"],
    "operator_oversight": "Skolinspektionen"
  },
  "occupancy": {
    "unit": "pupil",                       // what is counted: pupil, resident, workplace, seat, visitor…
    "gross_m2_per_unit": { "value": 10, "range": [8, 12], "strength": "programme", "source": "…", "confidence": "sourced" },
    "staff_per_unit": { "value": 0.1, "strength": "practice", "source": "…" },
    "hours_profile": "weekday_daytime",    // weekday_daytime | 24_7 | evening_weekend | retail_hours | office_hours
    "hourly_presence": [0,0,0,0,0,0,0,0.2,0.9,1,1,1,1,1,1,0.6,0.3,0.1,0,0,0,0,0,0]  // share of capacity present, hour 0-23, weekday
  },
  "spaces": [
    {
      "id": "school_dining",
      "label_en": "Dining hall", "label_sv": "Matsal",
      "required": { "strength": "law", "basis": "Skollagen 10 kap. 10 § — free, nutritious school meals", "url": "…" },
      "size": {
        "rule": "per_seat",                 // fixed | per_unit | per_seat | per_group | per_building | derived
        "value_m2": 1.2, "range_m2": [1.0, 1.5],
        "count": "pupils / sittings (typically 2-3)",
        "strength": "programme", "source": "…", "url": "…", "confidence": "indicative"
      },
      "constraints": { "min_ceiling_height_mm": 2700, "daylight_required": true, "facade_required": false },
      "depends_on": ["school_kitchen"],
      "shareable_with": ["restaurant", "assembly_hall"],   // other use ids that could share this space out of hours
      "shareable_note": "Evening restaurant or community dining outside school hours.",
      "binding_constraint": "ventilation_and_egress",       // what is most likely to fail first in an existing building
      "layer": "space_plan",                                // site | structure | skin | services | space_plan | stuff
      "notes": "…"
    }
  ],
  "variants": [ { "id": "…", "label": "…", "changes": "e.g. cooking kitchen vs. receiving kitchen" } ],
  "conversion_from_office": {
    "typical_blockers": ["…"],
    "typical_enablers": ["…"]
  },
  "sources": [ { "ref": "…", "url": "…", "accessed": "2026-10-19" } ],
  "open_questions": ["…"]
}
```

A size of `null` with `"strength": "none"` is a valid and important answer: it records that the function is
required but no source sets its size.
