"""Build the publishable dashboard.

    python -m engine.build_web

Regenerates the engine's data payload, injects it into the template, and
writes runs/web/index.html. Run this after changing any data file and the
published page is one Artifact republish away from being current.

The data is embedded rather than fetched: the published page is a snapshot
with its generation timestamp and placeholder share baked in, which is the
honest way to publish a result that still rests on placeholder data.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import export_web, loader

TEMPLATE = loader.ROOT / "web" / "dashboard_template.html"
OUT = loader.ROOT / "runs" / "web" / "index.html"
MARKER = "/*__DATA__*/{}"


def main() -> Path:
    payload = export_web.build()

    # The full JSON schema is large and only its field names are shown on
    # the page, so it is dropped from the embedded payload.
    payload.pop("schema", None)

    template = TEMPLATE.read_text(encoding="utf-8")
    if MARKER not in template:
        raise ValueError(f"Marker {MARKER!r} not found in {TEMPLATE}")

    # </script> inside embedded JSON would close the script tag early.
    blob = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(template.replace(MARKER, blob), encoding="utf-8")

    size = OUT.stat().st_size
    print(f"Wrote {OUT.relative_to(loader.ROOT)}  ({size:,} bytes, {size / 1048576:.2f} MB)")
    if size > 16 * 1048576:
        print("  WARNING: over the 16 MB artifact limit.")
    print(f"  {payload['provenance']['caveat']}")
    return OUT


if __name__ == "__main__":
    main()
