# Supplier catalogues (local, not committed)

Each `*.json` file here has the same shape as `../catalogue.json` (`{"_meta": {...}, "components": [...]}`)
and is merged into the catalogue by `engine/loader.py` and `parametric/mvk/pricing.py` when it exists.
A supplier entry may not reuse an id from `catalogue.json`.

The JSON files are gitignored because supplier prices are often given in confidence (Smartax's are marked
"KONFIDENTIELLT – endast för användning inom MARIEVIK+"). Without them the tool still runs: the options that
need them (the Smartax partition system) are simply not offered.

Check a file against the supplier schema before using it:

```
python -m engine.intake data/components/suppliers/smartax.json
```

Provenance: a value is counted as unverified when its `provenance` is PLACEHOLDER, UNKNOWN or GENERIC, or
starts with `ESTIMATE:` (derived by us, not stated by the supplier).

| File | Supplier | Received | Originals |
|---|---|---|---|
| smartax.json | Smartax Byggmaterial AB | 2026-10-19 | `Smartax/` in the repository root (gitignored) |
