"""The apartments the lab can work on.

Each shell is a file in data/shells/ (a traced real plan) plus the original
Marievik+ structural bay from demo_plans.json. A shell holds what cannot
change without touching the building — outline, windows as built, entry,
drainage — and one or more starting configurations of what can.

Fixed elements are marked in the configuration (`"fixed": true` on walls
and furniture) and listed on the shell (`fixed_walls`, `wet`). The editor
lets you move them anyway; the optimiser does not.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"


def _marievik_bay() -> dict:
    demo = json.loads((DATA / "demo_plans.json").read_text(encoding="utf-8"))
    shell = dict(demo["shell"])
    # Describe the wet core the same way traced shells do.
    shell.setdefault("wet", {"x0": 5150, "y0": 4050, "x1": 8150, "y1": 6950})
    shell.setdefault("fixed_walls", [])
    return {
        "label": "Marievik+ structural bay (8.4 × 7.2 m)",
        "shell": shell,
        "configurations": demo["configurations"],
        "_meta": demo.get("_meta", {}),
    }


@lru_cache(maxsize=None)
def all_shells() -> dict[str, dict]:
    out = {"marievik_bay": _marievik_bay()}
    for path in sorted((DATA / "shells").glob("*.json")):
        out[path.stem] = json.loads(path.read_text(encoding="utf-8"))
    return out


def shell(shell_id: str) -> dict:
    return all_shells()[shell_id]
