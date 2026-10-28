"""Draw dimensioned standards sheets from the use catalogue and the Marievik shell.

Every number on a sheet is read from the JSON; every sheet prints the sources behind
its numbers (reference, strength, confidence, URL) under the drawing.

    python docs/draw_standards_sheets.py

Inputs:  data/catalogue/cross_cutting.json
         data/catalogue/uses/shared_amenities.json
         data/catalogue/uses/elderly_care_home.json
         data/building/marievik_shell.json
Output:  docs/standards_sheets/*.svg
"""

from __future__ import annotations

import html
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "data" / "catalogue"
SHELL_PATH = ROOT / "data" / "building" / "marievik_shell.json"
OUTPUT = ROOT / "docs" / "standards_sheets"
DRAWN = "2026-10-20"

# the explorer's palette and type (explorer/web/src/index.css): ink, cream paper, Marievik+ blue for dimensions
INK = "#202020"
GREY = "#6e6a5e"
LIGHT = "#d8d3bf"
WALL = "#f2efe2"
ACCENT = "#0528ca"
PAPER = "#fffdf6"
FONT = "'Bricolage Grotesque','Segoe UI','Helvetica Neue',Arial,sans-serif"

W = 1200
FRAME_X, FRAME_Y, FRAME_W = 40, 175, 1120
COS30 = math.cos(math.radians(30))


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


CC = load(CATALOGUE / "cross_cutting.json")
AMEN = load(CATALOGUE / "uses" / "shared_amenities.json")
CARE = load(CATALOGUE / "uses" / "elderly_care_home.json")
SHELL = load(SHELL_PATH)


def rule(section: str, rule_id: str) -> dict[str, Any]:
    return next(r for r in CC[section] if r["id"] == rule_id)


def space(use: dict[str, Any], space_id: str) -> dict[str, Any]:
    return next(s for s in use["spaces"] if s["id"] == space_id)


def source_url(use: dict[str, Any], startswith: str) -> str:
    return next(s["url"] for s in use["sources"] if s["ref"].startswith(startswith))


def find(pattern: str, haystack: str) -> re.Match[str]:
    """Pull a number out of a sourced sentence; fail loudly if the wording changed."""
    match = re.search(pattern, haystack)
    if not match:
        raise ValueError(f"pattern {pattern!r} not found in: {haystack[:120]}…")
    return match


def lead(sentence: str) -> tuple[str, str]:
    """Split 'Topic: rest' into a bold lead and the rest; fall back to the first three words."""
    if ": " in sentence[:60]:
        bold, rest = sentence.split(": ", 1)
        return bold + ":", rest
    words = sentence.split(" ")
    return " ".join(words[:3]), " ".join(words[3:])


def mm(value_m: float) -> int:
    return round(value_m * 1000)


def num(value: float) -> str:
    """1100 -> '1 100' (Swedish thin-space thousands), 800 -> '800'."""
    return f"{value:,.0f}".replace(",", " ")


# ---------------------------------------------------------------- svg primitives

def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def text(x: float, y: float, value: Any, size: float = 14, color: str = INK, weight: int = 400,
         anchor: str = "start", rotate: float = 0, spacing: float = 0, italic: bool = False) -> str:
    rot = f' transform="rotate({rotate:.2f} {x:.1f} {y:.1f})"' if rotate else ""
    style = ' font-style="italic"' if italic else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}" letter-spacing="{spacing}"{style}{rot}>{esc(value)}</text>')


def line(x1: float, y1: float, x2: float, y2: float, color: str = INK, sw: float = 1.2,
         dash: str = "", cap: str = "butt") -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="{cap}"{d}/>')


def rect(x: float, y: float, w: float, h: float, fill: str = "none", stroke: str = INK,
         sw: float = 1.2, rx: float = 0, dash: str = "") -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}"{d}/>')


def poly(points: Iterable[tuple[float, float]], fill: str = "none", stroke: str = INK,
         sw: float = 1.2, dash: str = "", closed: bool = True) -> str:
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    tag = "polygon" if closed else "polyline"
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<{tag} points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" '
            f'stroke-linejoin="round"{d}/>')


def circle(cx: float, cy: float, r: float, fill: str = "none", stroke: str = INK, sw: float = 1.2,
           dash: str = "") -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>'


def ellipse(cx: float, cy: float, rx: float, ry: float, fill: str = "none", stroke: str = INK,
            sw: float = 1.2, dash: str = "") -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}"{d}/>')


def dim(x1: float, y1: float, x2: float, y2: float, label: str, offset: float = 0,
        color: str = INK, size: float = 13, ext: bool = True, label_color: str | None = None) -> str:
    """Architectural dimension: extension lines, 45° tick slashes, label along the line."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    ax, ay = x1 + nx * offset, y1 + ny * offset
    bx, by = x2 + nx * offset, y2 + ny * offset
    out = []
    if ext and offset:
        sign = 1 if offset > 0 else -1
        out.append(line(x1 + nx * 4 * sign, y1 + ny * 4 * sign, ax + nx * 6 * sign, ay + ny * 6 * sign, color, 0.7))
        out.append(line(x2 + nx * 4 * sign, y2 + ny * 4 * sign, bx + nx * 6 * sign, by + ny * 6 * sign, color, 0.7))
    out.append(line(ax - ux * 6, ay - uy * 6, bx + ux * 6, by + uy * 6, color, 0.9))
    tx, ty = (ux + nx) * 5, (uy + ny) * 5
    out.append(line(ax - tx, ay - ty, ax + tx, ay + ty, color, 1.6))
    out.append(line(bx - tx, by - ty, bx + tx, by + ty, color, 1.6))
    angle = math.degrees(math.atan2(dy, dx))
    if angle > 90 or angle <= -90:
        angle -= 180
    mx, my = (ax + bx) / 2, (ay + by) / 2
    rad = math.radians(angle)
    px, py = math.sin(rad) * 7, -math.cos(rad) * 7
    out.append(text(mx + px, my + py, label, size, label_color or color, 600, "middle", angle))
    return "".join(out)


def leader(x1: float, y1: float, x2: float, y2: float, color: str = INK) -> str:
    """Dotted call-out leader with a dot at the target end (x1, y1)."""
    return (circle(x1, y1, 2.6, color, color, 0) +
            line(x1, y1, x2, y2, color, 1.4, "0.1 4.5", "round"))


def wrap(value: str, width_px: float, size: float) -> list[str]:
    max_chars = max(10, int(width_px / (size * 0.53)))
    words, lines, current = value.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > max_chars and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def callout(x: float, y: float, bold: str, rest: str, width: float = 300, size: float = 14,
            color: str = INK, anchor: str = "start") -> tuple[str, float]:
    """A text block whose first words are bold, like the reference sheets. Returns (svg, bottom y)."""
    tokens = [(w, True) for w in bold.split()] + [(w, False) for w in rest.split()]
    max_chars = max(10, int(width / (size * 0.53)))
    lines: list[list[tuple[str, bool]]] = [[]]
    count = 0
    for word, is_bold in tokens:
        if count + len(word) + 1 > max_chars and lines[-1]:
            lines.append([])
            count = 0
        lines[-1].append((word, is_bold))
        count += len(word) + 1
    out = []
    lh = size * 1.32
    for i, words in enumerate(lines):
        spans = []
        for j, (word, is_bold) in enumerate(words):
            sep = " " if j else ""
            spans.append(f'<tspan font-weight="{700 if is_bold else 400}">{esc(sep + word)}</tspan>')
        out.append(f'<text x="{x:.1f}" y="{y + i * lh:.1f}" font-family="{FONT}" font-size="{size}" '
                   f'fill="{color}" text-anchor="{anchor}">{"".join(spans)}</text>')
    return "".join(out), y + len(lines) * lh


def paragraph(x: float, y: float, value: str, width: float, size: float = 12, color: str = INK,
              weight: int = 400, lh: float = 1.35) -> tuple[str, float]:
    out = []
    for i, ln in enumerate(wrap(value, width, size)):
        out.append(text(x, y + i * size * lh, ln, size, color, weight))
    return "".join(out), y + len(wrap(value, width, size)) * size * lh


def badge(x: float, y: float, n: int | str, color: str = ACCENT) -> str:
    return (circle(x, y, 12, PAPER, color, 1.4) +
            text(x, y + 4.5, n, 13, color, 700, "middle"))


DEFS = f"""<defs>
  <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="9" stroke="{ACCENT}" stroke-width="1.3" stroke-opacity="0.75"/>
  </pattern>
  <pattern id="hatch-soft" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    <line x1="0" y1="0" x2="0" y2="9" stroke="{ACCENT}" stroke-width="1" stroke-opacity="0.45"/>
  </pattern>
  <pattern id="earth" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="14" stroke="{GREY}" stroke-width="0.7" stroke-opacity="0.7"/>
  </pattern>
  <pattern id="concrete" width="6" height="6" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="0.7" fill="{GREY}" fill-opacity="0.6"/>
    <circle cx="4.5" cy="4" r="0.5" fill="{GREY}" fill-opacity="0.5"/>
  </pattern>
</defs>"""


# ---------------------------------------------------------------- iso projection

class Iso:
    """Isometric projection: x runs down-right, y down-left, z up. Units are mm."""

    def __init__(self, ox: float, oy: float, scale: float):
        self.ox, self.oy, self.s = ox, oy, scale

    def p(self, x: float, y: float, z: float = 0) -> tuple[float, float]:
        return (self.ox + (x - y) * COS30 * self.s, self.oy + (x + y) * 0.5 * self.s - z * self.s)

    def face(self, pts: Iterable[tuple[float, float, float]], **kw: Any) -> str:
        return poly([self.p(*q) for q in pts], **kw)

    def floor_circle(self, cx: float, cy: float, r: float, **kw: Any) -> str:
        X, Y = self.p(cx, cy)
        return ellipse(X, Y, 1.2247 * r * self.s, 0.7071 * r * self.s, **kw)

    def wheel(self, x: float, cy: float, cz: float, r: float, **kw: Any) -> str:
        """Circle in the y-z plane (a wheel whose axle runs along x)."""
        pts = [self.p(x, cy + r * math.cos(t), cz + r * math.sin(t))
               for t in (i * math.pi / 18 for i in range(36))]
        return poly(pts, **kw)

    def box(self, x: float, y: float, z: float, dx: float, dy: float, dz: float,
            fill: str = PAPER, stroke: str = INK, sw: float = 1.1) -> str:
        top = [(x, y, z + dz), (x + dx, y, z + dz), (x + dx, y + dy, z + dz), (x, y + dy, z + dz)]
        right = [(x + dx, y, z), (x + dx, y + dy, z), (x + dx, y + dy, z + dz), (x + dx, y, z + dz)]
        front = [(x, y + dy, z), (x + dx, y + dy, z), (x + dx, y + dy, z + dz), (x, y + dy, z + dz)]
        return "".join(self.face(f, fill=fill, stroke=stroke, sw=sw) for f in (right, front, top))

    def dim(self, a: tuple[float, float, float], b: tuple[float, float, float], label: str,
            offset: float = 0, color: str = INK, **kw: Any) -> str:
        return dim(*self.p(*a), *self.p(*b), label, offset, color, **kw)


def iso_wheelchair_user(iso: Iso, x: float, y: float, facing: str = "-y") -> str:
    """A seated wheelchair user drawn as simple boxes and wheels (700 x 1300 envelope).

    The chair faces -y (towards the back wall) by default; x is the left edge, y the rear edge."""
    out = []
    w, l = 700, 1300
    # rear big wheels (axle along x), casters and frame
    out.append(iso.wheel(x + 20, y + 1000, 300, 300, fill=PAPER, sw=1.1))
    out.append(iso.wheel(x + 20, y + 1000, 300, 250, fill="none", sw=0.6))
    out.append(iso.box(x + 90, y + 450, 430, 520, 480, 60))          # seat
    out.append(iso.box(x + 90, y + 900, 430, 520, 60, 460))          # backrest
    out.append(iso.box(x + 160, y + 120, 60, 380, 120, 30))          # footplate
    out.append(iso.box(x + 170, y + 250, 120, 140, 210, 330))        # left shin
    out.append(iso.box(x + 390, y + 250, 120, 140, 210, 330))        # right shin
    out.append(iso.box(x + 150, y + 350, 490, 400, 450, 150))        # thighs
    out.append(iso.box(x + 140, y + 700, 520, 420, 220, 520))        # torso
    hx, hy = iso.p(x + 350, y + 790, 1180)
    out.append(circle(hx, hy, 11 * iso.s / 0.1, PAPER, INK, 1.1))   # head
    out.append(iso.wheel(x + w - 20, y + 1000, 300, 300, fill=PAPER, sw=1.1))
    out.append(iso.wheel(x + w - 20, y + 1000, 300, 250, fill="none", sw=0.6))
    for cx in (x + 110, x + w - 110):
        out.append(iso.wheel(cx, y + 180, 70, 70, fill=PAPER, sw=1))
    return "".join(out)


def plan_wheelchair(cx: float, cy: float, s: float, rotate: float = 0, length: float = 1300,
                    width: float = 700) -> str:
    """Top view of a wheelchair user inside its dimensioning envelope; front points up (-y)."""
    def r(x, y, w, h, **kw):
        return rect(cx + x * s, cy + y * s, w * s, h * s, **kw)
    hl, hw = length / 2, width / 2
    parts = [
        rect(cx - hw * s, cy - hl * s, width * s, length * s, "none", ACCENT, 1, 0, "5 4"),
        r(-hw + 10, -60, 60, 640, fill=PAPER, sw=1.1, rx=3),           # left wheel
        r(hw - 70, -60, 60, 640, fill=PAPER, sw=1.1, rx=3),            # right wheel
        r(-hw + 75, -40, 15, 600, fill="none", sw=0.6),
        r(hw - 90, -40, 15, 600, fill="none", sw=0.6),
        r(-230, -120, 460, 600, fill=PAPER, sw=1.1, rx=8),             # seat + back
        r(-230, 420, 460, 60, fill=PAPER, sw=1.1, rx=4),               # backrest
        r(-190, -hl + 40, 150, 90, fill=PAPER, sw=1, rx=4),            # footplates
        r(40, -hl + 40, 150, 90, fill=PAPER, sw=1, rx=4),
        r(-185, -hl + 120, 130, 420, fill=PAPER, sw=1, rx=30),         # legs
        r(55, -hl + 120, 130, 420, fill=PAPER, sw=1, rx=30),
        r(-250, 80, 500, 300, fill=PAPER, sw=1.1, rx=60),              # shoulders
        circle(cx, cy + 230 * s, 105 * s, PAPER, INK, 1.1),            # head
    ]
    return f'<g transform="rotate({rotate} {cx:.1f} {cy:.1f})">{"".join(parts)}</g>'


# ---------------------------------------------------------------- the sheet

class Sheet:
    def __init__(self, number: int, kicker: str, title: list[str], frame_h: float, caption: str,
                 data_ref: str):
        self.number, self.kicker, self.title = number, kicker, title
        self.frame_h, self.caption, self.data_ref = frame_h, caption, data_ref
        self.body: list[str] = []
        self.notes: list[tuple[str, str, str]] = []
        self.sources: list[dict[str, str]] = []

    def add(self, *parts: str) -> None:
        self.body.extend(parts)

    def note(self, marker: str, bold: str, rest: str) -> None:
        self.notes.append((marker, bold, rest))

    def source(self, ref: str, strength: str, confidence: str = "", url: str = "",
               used_for: str = "") -> None:
        entry = {"ref": ref, "strength": strength, "confidence": confidence or "—",
                 "url": url or "", "used_for": used_for}
        if entry not in self.sources:
            self.sources.append(entry)

    def render(self) -> str:
        top = []
        top.append(text(60, 70, f"STANDARDS SHEET {self.number:02d}  ·  {self.kicker}", 14, GREY, 700,
                        spacing=1.6))
        for i, ln in enumerate(self.title):
            top.append(text(58, 112 + i * 40, ln, 34, ACCENT, 800, spacing=0.5))
        frame_y = FRAME_Y + (len(self.title) - 1) * 40
        top.append(f'<g transform="translate(0 {frame_y - FRAME_Y})">')
        top.append(rect(FRAME_X, FRAME_Y, FRAME_W, self.frame_h, "none", INK, 1.5, 18))
        top.extend(self.body)
        top.append(text(FRAME_X + 22, FRAME_Y + self.frame_h - 22, self.caption, 17, INK, 800, spacing=0.4))
        top.append("</g>")
        y = frame_y + self.frame_h + 44

        # numbered notes, two columns
        if self.notes:
            col_w = 520
            ys = [y, y]
            half = math.ceil(len(self.notes) / 2)
            for i, (marker, bold, rest) in enumerate(self.notes):
                col = 0 if i < half else 1
                x = 60 + col * 560
                if marker:
                    top.append(badge(x + 12, ys[col] - 5, marker))
                svg, bottom = callout(x + 34, ys[col], bold, rest, col_w - 40, 13)
                top.append(svg)
                ys[col] = bottom + 12
            y = max(ys) + 8

        # sources
        top.append(line(60, y, W - 60, y, INK, 1))
        top.append(text(60, y + 26, "SOURCES", 14, ACCENT, 800, spacing=1.6))
        top.append(text(W - 60, y + 26, "strength · confidence (see data/catalogue/README.md)", 11, GREY, 600, "end"))
        y += 50
        for i, s in enumerate(self.sources, 1):
            tag = f"[{s['strength'].upper()} · {s['confidence']}]"
            top.append(text(60, y, f"{i}.", 12, INK, 700))
            top.append(text(82, y, tag, 11, ACCENT, 700))
            svg, y2 = paragraph(82 + len(tag) * 6.9 + 8, y, s["ref"], W - 150 - len(tag) * 6.9, 12, INK, 600)
            top.append(svg)
            y = y2
            extra = " — ".join(v for v in (s["used_for"], s["url"]) if v)
            if extra:
                svg, y = paragraph(82, y + 2, extra, W - 150, 10.5, GREY)
                top.append(svg)
            y += 9
        y += 8
        top.append(line(60, y, W - 60, y, LIGHT, 1))
        y += 22
        svg, y = paragraph(60, y, f"Data: {self.data_ref}. Drawn {DRAWN} by docs/draw_standards_sheets.py. "
                           "Diagrammatic, not to scale; figures and furniture without a dimension are illustrative only. "
                           "No values are taken from Neufert (catalogue policy: page references only).",
                           W - 120, 10.5, GREY)
        top.append(svg)
        height = math.ceil(y + 30)
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{height}" viewBox="0 0 {W} {height}" '
                f'role="img" aria-labelledby="t"><title id="t">{esc(" ".join(self.title))}</title>{DEFS}'
                f'<rect width="{W}" height="{height}" fill="{PAPER}"/>')
        return head + "".join(top) + "</svg>"


def src_rule(sheet: Sheet, r: dict[str, Any], used_for: str = "") -> None:
    sheet.source(r["source"], r["strength"], r.get("confidence", ""), r.get("url", ""), used_for)


# ---------------------------------------------------------------- 01 wheelchair

def sheet_wheelchair() -> Sheet:
    r = rule("accessibility", "access_design_dimensions")
    afs = rule("accessibility", "access_workplace_exemption")
    sh = Sheet(1, "ACCESSIBILITY", ["DIMENSIONING WHEELCHAIR:", "PASSAGE AND TURNING"], 1040,
               "DIMENSIONING WHEELCHAIR · BFS 2024:12 1 KAP. 6 §",
               "data/catalogue/cross_cutting.json → accessibility / access_design_dimensions, access_workplace_exemption")
    s = 0.145
    cases = [("PUBLIC & GENERAL", r["values"]["general"], 75),
             ("INSIDE A DWELLING", r["values"]["inside_dwelling"], 635)]
    for title, v, x0 in cases:
        cw, cl = (mm(a) for a in v["wheelchair_plan_m"])
        d = mm(v["turning_circle_d_m"])
        pw = mm(v["clear_passage_min_m"])
        wall, band = 150, 650
        top_y = 120
        length = 200 + cl + (d - pw) + d + (d - pw) + cl + 200
        ox = x0 + (band + wall) * s + 40
        oy = FRAME_Y + 120

        def P(x, y):
            return ox + x * s, oy + y * s
        n0 = 200 + cl
        right = [(pw, 0), (pw, n0), (d, n0 + (d - pw)), (d, n0 + (d - pw) + d),
                 (pw, n0 + 2 * (d - pw) + d), (pw, length)]
        # hatched earth bands and wall fills
        sh.add(rect(*P(-wall - band, 0), band * s, length * s, "url(#earth)", "none", 0))
        sh.add(rect(*P(-wall, 0), wall * s, length * s, WALL, INK, 1.4))
        outer = [(x + wall, y) for x, y in right]
        outer[1] = (pw + wall, n0 - wall * 0.41)
        outer[-2] = (pw + wall, n0 + 2 * (d - pw) + d + wall * 0.41)
        outer[2] = (d + wall, n0 + (d - pw) - wall * 0.41)
        outer[3] = (d + wall, n0 + (d - pw) + d + wall * 0.41)
        band_pts = [(x + band, y) for x, y in outer]
        sh.add(poly([P(*q) for q in outer + band_pts[::-1]], "url(#earth)", "none", 0))
        sh.add(poly([P(*q) for q in right + outer[::-1]], WALL, INK, 1.4))
        # turning circle
        ccx, ccy = P(d / 2, n0 + (d - pw) + d / 2)
        sh.add(circle(ccx, ccy, d / 2 * s, "url(#hatch-soft)", ACCENT, 1.3, "7 5"))
        sh.add(line(ccx - d / 2 * s, ccy, ccx + d / 2 * s, ccy, ACCENT, 0.9))
        sh.add(text(ccx, ccy - 8, f"Ø {num(d)}", 17, ACCENT, 700, "middle"))
        # wheelchairs
        sh.add(plan_wheelchair(*P(pw / 2, 200 + cl / 2), s, 180, cl, cw))
        sh.add(plan_wheelchair(*P(pw / 2, length - 200 - cl / 2), s, 0, cl, cw))
        # dimensions
        sh.add(dim(*P(pw / 2 - cw / 2, 200), *P(pw / 2 + cw / 2, 200), num(cw), -14, ACCENT, 12, False))
        sh.add(dim(*P(0, length), *P(pw, length), num(pw), -28, INK, 15))
        sh.add(dim(*P(-wall - band, 200), *P(-wall - band, 200 + cl), num(cl), 24, ACCENT))
        sh.add(dim(*P(d + wall + band, n0 + (d - pw)), *P(d + wall + band, n0 + (d - pw) + d), num(d), -22))
        sh.add(text(ox + pw / 2 * s, FRAME_Y + 60, title, 17, INK, 800, "middle", spacing=0.8))
        sh.add(text(ox + pw / 2 * s, FRAME_Y + 82, f"wheelchair {num(cw)} × {num(cl)} · Ø {num(d)} · passage ≥ {num(pw)}",
                    12, GREY, 600, "middle"))
    g, gd = r["values"]["general"], r["values"]["inside_dwelling"]
    sh.note("1", "Dimensioning wheelchair:", f"{num(mm(g['wheelchair_plan_m'][0]))} × {num(mm(g['wheelchair_plan_m'][1]))} mm; "
            f"inside a dwelling {num(mm(gd['wheelchair_plan_m'][0]))} × {num(mm(gd['wheelchair_plan_m'][1]))} mm. "
            "Use it for buildings, fixed furniture and equipment that must be accessible.")
    sh.note("2", "Turning circle:", f"Ø {num(mm(g['turning_circle_d_m']))} mm (dwelling Ø {num(mm(gd['turning_circle_d_m']))}). "
            "The same Ø 1 500 sizes wheelchair refuges (BFS 2024:7 2 kap. 32 §) and is AFS 2023:12 advice "
            f"for workplaces (Ø {num(mm(afs['values']['afs_advice_turning_circle_m']))}).")
    sh.note("3", "Clear passage:", f"≥ {num(mm(g['clear_passage_min_m']))} mm (dwelling ≥ {num(mm(gd['clear_passage_min_m']))}); "
            f"AFS advice for workplace doors {num(mm(afs['values']['afs_advice_door_clear_m']))} mm. " + r["conversion_note"].split(". ", 1)[1])
    sh.note("", "Strength:", f"{r['strength']} · {r['confidence']}. These figures are binding; the old BBR 3:12 had the same values.")
    src_rule(sh, r, "wheelchair plan, turning circle, clear passage")
    src_rule(sh, afs, "workplace advice: turning circle and door clear width")
    return sh


# ---------------------------------------------------------------- 02 accessible WC

def sheet_accessible_wc() -> Sheet:
    pub = rule("accessibility", "access_public_premises_wc")
    work = rule("sanitary", "san_workplace")
    dims = rule("accessibility", "access_design_dimensions")
    amen = space(AMEN, "shared_accessible_wc")
    sh = Sheet(2, "SANITARY · SHARED AMENITY", ["PLANNING GUIDE:", "ACCESSIBLE WC"], 1110,
               "ACCESSIBLE WC FOR VISITORS AND STAFF",
               "data/catalogue/cross_cutting.json → accessibility / access_public_premises_wc, access_design_dimensions; "
               "sanitary / san_workplace; data/catalogue/uses/shared_amenities.json → shared_accessible_wc")
    room_w, room_d = (mm(v) for v in work["values"]["accessible_wc_room_advice_m"])
    turn = mm(dims["values"]["general"]["turning_circle_d_m"])
    door = mm(dims["values"]["general"]["clear_passage_min_m"])
    H = 2300
    iso = Iso(600, FRAME_Y + 500, 0.2)
    P = iso.p
    # back walls
    sh.add(iso.face([(0, 0, 0), (room_w, 0, 0), (room_w, 0, H), (0, 0, H)], fill=PAPER, sw=1.1))
    sh.add(iso.face([(0, 0, 0), (0, room_d, 0), (0, room_d, H), (0, 0, H)], fill=PAPER, sw=1.1))
    sh.add(iso.face([(0, 0, 0), (room_w, 0, 0), (room_w, room_d, 0), (0, room_d, 0)], fill=PAPER, sw=1.1))
    # transfer zones (hatched) and turning circle
    zone = 900
    wc_w = room_w - 2 * zone
    for x0 in (0, room_w - zone):
        sh.add(iso.face([(x0 + 40, 40, 0), (x0 + zone - 40, 40, 0), (x0 + zone - 40, 1300, 0), (x0 + 40, 1300, 0)],
                        fill="url(#hatch)", stroke=ACCENT, sw=0.8))
    cx, cy = room_w / 2, room_d - turn / 2 - 60
    sh.add(iso.floor_circle(cx, cy, turn / 2, fill="none", stroke=ACCENT, sw=1.6, dash="8 6"))
    # fixtures (illustrative)
    sh.add(iso.box(zone, 0, 0, wc_w, 650, 420))
    sh.add(iso.box(zone, 0, 420, wc_w, 180, 380))
    for gx in (zone - 120, room_w - zone + 120):
        sh.add(line(*P(gx, 0, 780), *P(gx, 780, 780), INK, 3, cap="round"))
        sh.add(line(*P(gx, 780, 780), *P(gx, 780, 700), INK, 3, cap="round"))
    sh.add(iso.box(0, 1450, 820, 480, 520, 60))
    sh.add(iso.face([(0, 1500, 1050), (0, 1920, 1050), (0, 1920, 1750), (0, 1500, 1750)], fill=PAPER, sw=1))
    sh.add(line(*P(room_w - 150, 0, 2100), *P(room_w - 150, 0, 300), ACCENT, 1.2, "3 3"))
    sh.add(circle(*P(room_w - 150, 0, 300), 4, ACCENT, ACCENT, 0))
    # cut wall tops and front edges in accent
    sh.add(poly([P(0, room_d, H), P(0, 0, H), P(room_w, 0, H)], "none", ACCENT, 2.6, closed=False))
    sh.add(line(*P(0, room_d, H), *P(0, room_d, 0), ACCENT, 2.6))
    sh.add(line(*P(room_w, 0, H), *P(room_w, 0, 0), ACCENT, 2.6))
    d0, d1 = room_d / 2 - door / 2, room_d / 2 + door / 2
    sh.add(poly([P(room_w, 0), P(room_w, d0)], "none", ACCENT, 2.6, closed=False))
    sh.add(poly([P(room_w, d1), P(room_w, room_d), P(0, room_d)], "none", ACCENT, 2.6, closed=False))
    sh.add(iso.face([(room_w, d0, 0), (room_w + door * 0.7, d0 + door * 0.7, 0)], stroke=INK, sw=1, closed=False))
    # wheelchair user in the circle
    sh.add(iso_wheelchair_user(iso, cx - 350, cy - 500))
    # dimensions
    sh.add(iso.dim((0, room_d, 0), (room_w, room_d, 0), num(room_w), 40, label_color=INK, size=15))
    sh.add(iso.dim((room_w, d0, 0), (room_w, d1, 0), f"≥ {num(door)} clear", -34, ACCENT))
    sh.add(iso.dim((room_w, 0, 0), (room_w, room_d, 0), num(room_d), -95, label_color=INK, size=15))
    # numbered badges on the plan
    sh.add(badge(*P(cx, cy + 520), 1))
    sh.add(badge(*P(zone / 2, 350, 0), 2))
    sh.add(badge(*P(room_w - zone / 2, 350, 0), 3))
    sh.add(badge(*P(room_w + 260, room_d / 2, 0), 4))
    # callouts
    bx, by = P(room_w - 150, 0, 1600)
    sh.add(leader(bx, by, 900, FRAME_Y + 130))
    svg, _ = callout(905, FRAME_Y + 120, "Alarm, contrast markings and suitable fittings",
                     "are part of the AFS 2023:12 advice for accessible workplace toilets.", 220, 13)
    sh.add(svg)
    gx, gy = P(zone / 2, 700, 0)
    sh.add(leader(gx, gy, 180, FRAME_Y + 150))
    svg, _ = callout(70, FRAME_Y + 120, "Transfer from both sides:",
                     "room to turn and to move sideways between toilet and wheelchair on either side. "
                     "No zone width is set in the regulation.", 230, 13)
    sh.add(svg)
    sh.note("1", "Circular turning space", f"Ø {num(turn)} mm (BFS 2024:12 1 kap. 6 §).")
    sh.note("2", "Transfer space, left of WC.", "Sideways transfer on both sides is law (BFS 2024:12 2 kap. 7 §); its width is not.")
    sh.note("3", "Transfer space, right of WC.", "Zones drawn to show the principle, not a sourced width.")
    sh.note("4", "Door:", f"clear passage ≥ {num(door)} mm on the accessible route.")
    sh.note("", "Room size:", f"{num(room_w)} × {num(room_d)} mm is guidance (AFS 2023:12 3 kap. 58 § allmänt råd; "
            f"repealed BBR 3:1453 had the same figure), about {amen['size']['value_m2']} m² per WC. "
            "BFS 2024:12 sets no room size.")
    sh.note("", "Count:", f"≥ {pub['values']['min_accessible_wc_if_public_wc_exist']} accessible WC if public WCs exist; "
            f"≥ {work['values']['accessible_wc_per_floor_new_or_rebuild']} per floor in new or rebuilt workplaces; staff WCs "
            f"1 per started {work['values']['employees_per_wc_advice']} employees (advice).")
    src_rule(sh, pub, "accessible WC required, transfer both sides, old 2.2 × 2.2 m advice")
    src_rule(sh, work, "2.2 × 2.2 m room, alarm and contrast, 1 per floor, 1 WC per 15 employees")
    src_rule(sh, dims, "turning circle Ø 1 500, clear passage 800")
    sh.source(amen["size"]["source"], amen["size"]["strength"], amen["size"]["confidence"], amen["size"].get("url", ""),
              "shared_amenities: 4.84 m² per accessible WC")
    return sh


# ---------------------------------------------------------------- 03 escape

def sheet_escape() -> Sheet:
    r = rule("fire_occupancy_classes", "fire_egress_dimensions")
    v = r["values"]
    st = SHELL["structure"]
    cc = SHELL["core_and_circulation"]
    sh = Sheet(3, "FIRE · EGRESS", ["ESCAPE ROUTES:", "EXITS, DOORS AND PASSAGES"], 1050,
               "PRESCRIPTIVE ROUTE · BFS 2024:7 7 KAP.",
               "data/catalogue/cross_cutting.json → fire_occupancy_classes / fire_egress_dimensions; "
               "data/building/marievik_shell.json (TEMPLATE values)")
    # row A: exit counts
    y0 = FRAME_Y + 70
    sh.add(text(70, y0, "A   NUMBER OF INDEPENDENT EXITS", 14, INK, 800, spacing=1))
    rooms = list(v["exits_by_persons"].items())
    for i, (band, exits) in enumerate(rooms):
        x = 110 + i * 360
        w, h = 240, 190
        ry = y0 + 40
        sh.add(rect(x, ry, w, h, PAPER, INK, 3))
        for k in range(16):
            for j in range(5):
                sh.add(circle(x + 30 + k * 12.5, ry + 45 + j * 24, 3.2, "none", GREY, 0.8))
        gaps = {2: [("L", 0.5), ("R", 0.5)], 3: [("L", 0.5), ("R", 0.5), ("B", 0.5)],
                4: [("L", 0.5), ("R", 0.5), ("B", 0.3), ("B", 0.7)]}[exits]
        for side, f in gaps:
            if side == "L":
                gx, gy = x, ry + h * f
                sh.add(line(gx, gy - 18, gx, gy + 18, PAPER, 5))
                sh.add(line(gx - 4, gy, gx - 34, gy, ACCENT, 2.2))
                sh.add(poly([(gx - 40, gy), (gx - 30, gy - 6), (gx - 30, gy + 6)], ACCENT, ACCENT, 1))
            elif side == "R":
                gx, gy = x + w, ry + h * f
                sh.add(line(gx, gy - 18, gx, gy + 18, PAPER, 5))
                sh.add(line(gx + 4, gy, gx + 34, gy, ACCENT, 2.2))
                sh.add(poly([(gx + 40, gy), (gx + 30, gy - 6), (gx + 30, gy + 6)], ACCENT, ACCENT, 1))
            else:
                gx, gy = x + w * f, ry + h
                sh.add(line(gx - 18, gy, gx + 18, gy, PAPER, 5))
                sh.add(line(gx, gy + 4, gx, gy + 30, ACCENT, 2.2))
                sh.add(poly([(gx, gy + 36), (gx - 6, gy + 26), (gx + 6, gy + 26)], ACCENT, ACCENT, 1))
        sh.add(text(x + w / 2, ry + h + 62, f"{band.replace('<=', '≤ ').replace('>', '> ').replace('-', '–')} persons", 15, INK, 700, "middle"))
        sh.add(text(x + w / 2, ry + h + 82, f"{exits} exits", 14, ACCENT, 700, "middle"))
        if i == 0:
            sh.add(dim(x, ry, x + w, ry, f"exits ≥ {v['min_exit_spacing_m']} m apart", -16, ACCENT, 12))
    # row B: doors
    y1 = y0 + 350
    sh.add(text(70, y1, "B   CLEAR WIDTH OF EXIT DOORS", 14, INK, 800, spacing=1))
    s = 0.11
    for i, (band, width_m) in enumerate(v["door_clear_width_m"].items()):
        width = mm(width_m)
        x = 170 + i * 330
        wy = y1 + 110
        sh.add(rect(x - 90, wy - 12, 90, 24, WALL, INK, 1.2))
        sh.add(rect(x + width * s, wy - 12, 90, 24, WALL, INK, 1.2))
        sh.add(line(x, wy + 12, x, wy + 12 + width * s, INK, 1.6))
        sh.add(f'<path d="M{x + width * s:.1f},{wy + 12:.1f} A{width * s:.1f},{width * s:.1f} 0 0 1 {x:.1f},{wy + 12 + width * s:.1f}" '
               f'fill="none" stroke="{GREY}" stroke-width="0.8" stroke-dasharray="4 3"/>')
        sh.add(rect(x, wy - 12, width * s, 24, "url(#hatch)", ACCENT, 0.8))
        sh.add(dim(x, wy - 12, x + width * s, wy - 12, num(width), -22, ACCENT, 15))
        sh.add(text(x + width * s / 2, wy - 60, f"{band.replace('<=', '≤ ').replace('>', '> ')} persons", 14, INK, 700, "middle"))
    svg, _ = callout(800, y1 + 50, "In total:",
                     f"at least {v['door_total_width_m_per_150_persons']:g} m of exit-door width per 150 persons. "
                     "Example: 450 persons need 3.0 m in total, e.g. three doors of 1.0 m.", 300, 14)
    sh.add(svg)
    # row C: passages and Marievik corridor
    y2 = y1 + 290
    sh.add(text(70, y2, "C   ESCAPE-ROUTE PASSAGES", 14, INK, 800, spacing=1))
    widths = [(f"{k.replace('<=', '≤ ').replace('>', '> ')} persons", mm(val), INK) for k, val in v["passage_clear_width_m"].items()]
    widths.append(("Marievik corridor (template)", cc["corridor_clear_width_mm"], GREY))
    for i, (lab, width, col) in enumerate(widths):
        x = 120 + i * 190
        py = y2 + 40
        sh.add(rect(x - 22, py, 22, 160, WALL, INK, 1.1))
        sh.add(rect(x + width * 0.11, py, 22, 160, WALL, INK, 1.1))
        sh.add(line(x + width * 0.055, py + 15, x + width * 0.055, py + 145, ACCENT if col == INK else GREY, 1.4, "8 6"))
        sh.add(dim(x, py + 160, x + width * 0.11, py + 160, num(width), 22, col, 13))
        sh.add(text(x + width * 0.055, py + 205, lab, 12, col, 700, "middle"))
    ok = cc["corridor_clear_width_mm"] >= mm(v["passage_clear_width_m"][">150"])
    svg, _ = callout(705, y2 + 50, "Marievik check:",
                     f"corridor {num(cc['corridor_clear_width_mm'])} mm {'≥' if ok else '<'} "
                     f"{num(mm(v['passage_clear_width_m']['>150']))} mm for more than 150 persons "
                     f"({'passes' if ok else 'fails'}, on TEMPLATE data). Stair clear width "
                     f"{num(cc['cores'][0]['stair_clear_width_mm'])} mm, {cc['escape_routes']} escape routes.", 200, 13)
    sh.add(svg)
    # height triggers bar
    bx, base, top = 990, y2 + 215, y2 + 10
    hmax = 45
    def hy(m: float) -> float:
        return base - (base - top) * m / hmax
    height = st["storeys_above_ground"] * st["floor_to_floor_mm"] / 1000
    sh.add(line(bx, base, bx, top, INK, 1.2))
    for m_val, lab in ((v["riser_trigger_height_m"], "riser pipe"), (v["firefighting_lift_trigger_m"], "firefighting lift"),
                       (v["pressurised_riser_trigger_m"], "pressurised riser")):
        sh.add(line(bx - 8, hy(m_val), bx + 8, hy(m_val), ACCENT, 2))
        sh.add(text(bx + 16, hy(m_val) + 4, f"> {m_val} m  {lab}", 12, ACCENT, 700))
    sh.add(rect(bx - 40, hy(height), 26, base - hy(height), "url(#concrete)", INK, 1))

    sh.add(text(bx, base + 22, f"bar: Marievik ≈ {height:.1f} m (template)", 11, GREY, 600, "middle"))
    sh.note("A", "Exits:", f"2 up to 600 persons, 3 for 601–1 000, 4 above 1 000; at least {v['min_exit_spacing_m']} m apart.")
    sh.note("B", "Exit doors:", "0.80 m clear up to 150 persons, 1.15 m above, and ≥ 1.0 m in total per 150 persons.")
    sh.note("C", "Passages:", "0.90 m clear up to 150 persons, 1.20 m above. Travel distances are reduced by four times any level difference (7 kap. 22 §).")
    sh.note("", "Access for the fire service:", "max distance from access route to the most remote point 50 m (80 m with sprinkler); "
            "riser above 24 m, pressurised above 40 m, firefighting lift above 30 m.")
    sh.note("", "Conversion:", r["conversion_note"])
    src_rule(sh, r, "exits, door and passage widths, height triggers")
    sh.source("Marievik+ shell — " + SHELL["_meta"]["status"], "template", "placeholder",
              "data/building/marievik_shell.json", "corridor, stair, storeys × floor-to-floor")
    return sh


# ---------------------------------------------------------------- 04 ramps, lifts, HIN

def sheet_ramps_lifts() -> Sheet:
    lv = rule("accessibility", "access_level_changes_ramps_lifts")
    hin = rule("accessibility", "access_hin")
    chg = rule("accessibility", "access_change_lift")
    core = SHELL["core_and_circulation"]["cores"][0]
    st = SHELL["structure"]
    dims = rule("accessibility", "access_design_dimensions")
    sh = Sheet(4, "ACCESSIBILITY · LEVEL CHANGES", ["RAMPS, HANDRAILS,", "LIFTS AND DOOR OPENERS"], 1060,
               "LEVEL CHANGES · BFS 2024:12 & HIN 3",
               "data/catalogue/cross_cutting.json → accessibility / access_level_changes_ramps_lifts, access_hin, "
               "access_change_lift, access_design_dimensions; data/building/marievik_shell.json (TEMPLATE values)")
    # A: ramp section
    y0 = FRAME_Y + 70
    sh.add(text(70, y0, "A   RAMP SECTION", 14, INK, 800, spacing=1))
    steep = int(lv["values"]["ramp_max_slope"].split(":")[1])
    gentle = int(hin["values"]["ramp_preferred_slope_advice"].split(":")[1])
    ext = hin["values"]["handrail_extension_cm"] * 10
    rise = 500
    s = 0.065
    x0, base = 150, y0 + 300
    run_s, run_g = rise * steep, rise * gentle
    sh.add(rect(x0 - 100, base, (run_g + 2400) * s, 40, "url(#earth)", "none", 0))
    sh.add(line(x0 - 100, base, x0 + (run_g + 2200) * s, base, INK, 1.6))
    top_y = base - rise * s * 4  # vertical exaggeration ×4, stated on the sheet
    sh.add(poly([(x0, base), (x0 + run_s * s, top_y), (x0 + (run_s + 1500) * s, top_y), (x0 + (run_s + 1500) * s, base)],
                "url(#hatch)", ACCENT, 1.6))
    sh.add(line(x0, base, x0 + run_g * s, top_y, INK, 1.2, "7 5"))
    rail = 900 * s * 1.0
    sh.add(line(x0 - ext * s, base - rail, x0, base - rail, INK, 2.4, cap="round"))
    sh.add(line(x0, base - rail, x0 + run_s * s, top_y - rail, INK, 2.4, cap="round"))
    sh.add(line(x0 + run_s * s, top_y - rail, x0 + (run_s + ext) * s, top_y - rail, INK, 2.4, cap="round"))
    sh.add(dim(x0 - ext * s, base - rail, x0, base - rail, f"≥ {ext}", -16, ACCENT, 12))
    sh.add(dim(x0 + run_s * s, top_y - rail, x0 + (run_s + ext) * s, top_y - rail, f"≥ {ext}", -16, ACCENT, 12))
    sh.add(text(x0 + run_s * s * 0.4, base - (base - top_y) * 0.4 - 14, f"max 1:{steep}", 16, ACCENT, 800, "end", -math.degrees(math.atan2(base - top_y, run_s * s))))
    sh.add(text(x0 + run_g * s * 0.62, top_y + 30, f"preferred 1:{gentle} or flatter", 13, INK, 700, "middle"))
    sh.add(dim(x0, base, x0 + run_s * s, base, f"{num(run_s)} for {rise} rise at 1:{steep}", 34, INK, 12))
    sh.add(text(70, base + 100, "Section drawn with heights ×4 for legibility. Handrail height not set in the cited rules.",
                11, GREY, 600, italic=True))
    svg, _ = callout(840, y0 + 60, f"Lift required",
                     f"for level changes over {lv['values']['lift_required_if_level_difference_gt_m']:g} m. Ramps need landings "
                     "long enough for a wheelchair pushed by a helper.", 270, 13)
    sh.add(svg)
    svg, _ = callout(840, y0 + 160, "Contrast:", f"light-reflectance contrast ≥ {hin['values']['contrast_ncs_min']:.2f} (NCS) "
                     "on stairs and glazed areas (HIN advice).", 330, 13)
    sh.add(svg)
    # B: lift car plan
    y1 = y0 + 470
    sh.add(text(70, y1, "B   LIFT CAR (PLAN)", 14, INK, 800, spacing=1))
    short = lv["values"]["lift_car_min_short_side_mm"]
    cw, cd = core["lift_car_mm"]
    s2 = 0.2
    lx, ly = 150, y1 + 60
    sh.add(rect(lx - 18, ly - 18, cw * s2 + 36, cd * s2 + 36, WALL, INK, 1.2))
    sh.add(rect(lx, ly, cw * s2, cd * s2, PAPER, INK, 1.6))
    sh.add(line(lx + 20, ly + cd * s2 + 18, lx + cw * s2 - 20, ly + cd * s2 + 18, PAPER, 8))
    sh.add(plan_wheelchair(lx + 380 * s2, ly + cd * s2 / 2, s2, 0,
                           *(mm(v) for v in dims["values"]["general"]["wheelchair_plan_m"][::-1])))
    sh.add(circle(lx + cw * s2 - 190 * s2, ly + cd * s2 - 190 * s2, 22, "url(#hatch-soft)", ACCENT, 1))
    sh.add(text(lx + cw * s2 - 190 * s2, ly + cd * s2 - 186 * s2, "helper", 9, ACCENT, 700, "middle"))
    sh.add(dim(lx, ly, lx + cw * s2, ly, f"{num(cw)}", -28, ACCENT, 14))
    sh.add(dim(lx + cw * s2, ly, lx + cw * s2, ly + cd * s2, f"{num(cd)}", -42, INK, 14))
    meets = cw >= short
    svg, _ = callout(lx + cw * s2 + 90, ly + 10, "Short side",
                     f"≥ {num(short)} mm: room for a wheelchair user plus a helper (BFS 2024:12). Marievik car {num(cw)} × {num(cd)} mm "
                     f"{'meets' if meets else 'fails'} this on TEMPLATE data.", 260, 13)
    sh.add(svg)
    stretcher = lv["values"]["stretcher_lift_if_dwelling_storeys_gt"]
    svg, _ = callout(lx + cw * s2 + 90, ly + 120, "Stretcher:",
                     f"in dwelling blocks over {stretcher} storeys a stretcher must fit in a lift. Marievik has "
                     f"{st['storeys_above_ground']} storeys and lift_bed_capable = {str(core['lift_bed_capable']).lower()} "
                     "→ flag for housing and care conversions.", 260, 13)
    sh.add(svg)
    svg, _ = callout(lx + cw * s2 + 90, ly + 240, "On alteration:",
                     f"a multi-dwelling building over {chg['values']['storeys_trigger_gt']} storeys must get an accessible lift "
                     "when the stairwell, layout or structure is substantially changed.", 260, 13)
    sh.add(svg)
    # C: door opener elevation
    y2 = y1
    ex = 820
    sh.add(text(ex - 40, y2, "C   DOOR-OPENER BUTTON", 14, INK, 800, spacing=1))
    s3 = 0.16
    btn_h = hin["values"]["door_button_height_cm"] * 10
    corner = int(find(r"at least (\d+) cm from corners", hin["rule_plain_english"]).group(1)) * 10
    floor_y = y2 + 60 + 2300 * s3
    sh.add(line(ex - 40, floor_y, ex + 300, floor_y, INK, 1.8))
    sh.add(rect(ex - 40, floor_y, 340, 18, "url(#earth)", "none", 0))
    sh.add(line(ex, floor_y, ex, y2 + 60, INK, 2.4))
    sh.add(rect(ex + 160, y2 + 60 + 200 * s3, 1000 * s3 * 0.9, 2100 * s3 - 200 * s3, PAPER, INK, 1.2))
    bxx = ex + corner * s3
    sh.add(rect(bxx - 7, floor_y - btn_h * s3 - 7, 14, 14, ACCENT, ACCENT, 0, 2))
    sh.add(dim(bxx + 10, floor_y, bxx + 10, floor_y - btn_h * s3, f"≈ {btn_h}", -26, ACCENT, 12))
    sh.add(dim(ex, floor_y - btn_h * s3 - 30, bxx, floor_y - btn_h * s3 - 30, f"≥ {corner}", 0, ACCENT, 12, False))
    sh.add(text(ex + 12, y2 + 80, "inside corner", 10, GREY, 600))
    sh.note("1", "Ramp:", f"max 1:{steep} (BFS 2024:12, law); HIN advice prefers 1:{gentle} or flatter for existing public premises.")
    sh.note("2", "Handrails:", f"extend at least {ext} mm beyond the start and end of the stair or ramp (HIN advice).")
    sh.note("3", "Lift:", f"short side ≥ {num(short)} mm; more than one lift above {lv['values']['multiple_lifts_if_storeys_gt']} storeys.")
    sh.note("4", "Door opener:", f"push button centred about {btn_h} mm above floor and at least {corner} mm from corners (HIN advice).")
    sh.note("", "Conversion:", lv["conversion_note"])
    sh.note("", "HIN applies without a permit:", hin["conversion_note"].split(". HIN is not")[0] + ".")
    src_rule(sh, lv, "ramp 1:12, lift > 1 m, lift short side 1 100, stretcher lift")
    src_rule(sh, hin, "1:20 preferred, contrast 0.40, handrail +300, button 800 / 700")
    src_rule(sh, chg, "lift on alteration of multi-dwelling buildings")
    src_rule(sh, dims, "wheelchair envelope in the lift")
    sh.source("Marievik+ shell — " + SHELL["_meta"]["status"], "template", "placeholder",
              "data/building/marievik_shell.json", "lift car 1 100 × 1 400, lift_bed_capable, storeys")
    return sh


# ---------------------------------------------------------------- 05 care apartment

def sheet_care_apartment() -> Sheet:
    apt = space(CARE, "sabo_apartment")
    bath = space(CARE, "sabo_bathroom")
    c = apt["constraints"]
    cs = apt["constraints_sources"]
    hall_min = int(find(r"Hall turning (\d+) mm minimum", cs).group(1))
    bw, bd = (round(float(g.replace(",", ".")) * 1000) for g in find(r"(\d,\d) x (\d,\d) meter", bath["size"]["source"]).groups())
    sh = Sheet(5, "CARE · ELDERLY CARE HOME (SÄBO)", ["PLANNING GUIDE:", "CARE APARTMENT"], 1010,
               "ONE-PERSON SÄBO APARTMENT, 30–35 M²",
               "data/catalogue/uses/elderly_care_home.json → spaces / sabo_apartment, sabo_bathroom (constraints, constraints_sources)")
    clear = c["bed_clearance_both_sides_mm"]
    hall = c["hall_turning_diameter_mm"]
    door = c["door_clear_width_mm"]
    ceil = c["min_ceiling_height_mm"]
    AW, AD = 5000, 6600  # illustrative footprint ≈ 33 m², inside the 30–35 m² programme range
    iso = Iso(665, FRAME_Y + 330, 0.085)
    P = iso.p
    sh.add(iso.face([(0, 0, 0), (AW, 0, 0), (AW, 0, ceil), (0, 0, ceil)], fill=PAPER))
    sh.add(iso.face([(0, 0, 0), (0, AD, 0), (0, AD, ceil), (0, 0, ceil)], fill=PAPER))
    sh.add(iso.face([(0, 0, 0), (AW, 0, 0), (AW, AD, 0), (0, AD, 0)], fill=PAPER))
    # window on facade wall y=0
    sh.add(iso.face([(1500, 0, 600), (4400, 0, 600), (4400, 0, 2200), (1500, 0, 2200)], fill=PAPER, sw=1))
    sh.add(line(*P(2950, 0, 600), *P(2950, 0, 2200), INK, 0.8))
    # bed with care clearance zones
    bx0, by0, bl, bwid = 0, 1300, 2100, 1000
    zones = [(0, by0 - clear, bl, clear), (0, by0 + bwid, bl, clear), (bl, by0 - clear, clear, bwid + 2 * clear)]
    for zx, zy, zw, zd in zones:
        sh.add(iso.face([(zx, zy, 0), (zx + zw, zy, 0), (zx + zw, zy + zd, 0), (zx, zy + zd, 0)],
                        fill="url(#hatch)", stroke=ACCENT, sw=0.8))
    sh.add(iso.box(bx0, by0, 0, bl, bwid, 520))
    sh.add(iso.box(bx0, by0, 520, 120, bwid, 380))
    sh.add(iso.box(bx0 + 150, by0 + 150, 520, 420, bwid - 300, 90))
    # bathroom and hall
    hx0 = AW - bw
    sh.add(iso.face([(hx0, AD - bd, 0), (AW, AD - bd, 0), (AW, AD, 0), (hx0, AD, 0)], fill=WALL, stroke=INK, sw=1))
    for a, b in (((hx0, AD - bd), (AW, AD - bd)), ((hx0, AD - bd), (hx0, AD - 1100))):
        sh.add(iso.face([(*a, 0), (*b, 0), (*b, 1100), (*a, 1100)], fill=PAPER, sw=1.1))
    sh.add(text(*P(hx0 + bw / 2, AD - bd / 2, 0), "BATHROOM", 11, INK, 700, "middle"))
    hcx, hcy = hx0 - hall / 2 - 150, AD - hall / 2 - 100
    sh.add(iso.floor_circle(hcx, hcy, hall / 2, fill="url(#hatch-soft)", stroke=ACCENT, sw=1.5, dash="8 6"))
    # front walls cut low, with entrance door
    d0 = hcx - door / 2
    sh.add(poly([P(0, AD, 0), P(d0, AD, 0)], "none", ACCENT, 2.6, closed=False))
    sh.add(poly([P(d0 + door, AD, 0), P(AW, AD, 0), P(AW, 0, 0)], "none", ACCENT, 2.6, closed=False))
    sh.add(poly([P(0, AD, ceil), P(0, 0, ceil), P(AW, 0, ceil)], "none", ACCENT, 2.6, closed=False))
    sh.add(line(*P(0, AD, ceil), *P(0, AD, 0), ACCENT, 2.6))
    sh.add(line(*P(AW, 0, ceil), *P(AW, 0, 0), ACCENT, 2.6))
    # ceiling hoist track (dashed at ceiling height) over bed to bathroom
    sh.add(poly([P(1000, by0 + bwid / 2, ceil - 80), P(1000, AD - bd / 2, ceil - 80), P(hx0 + 900, AD - bd / 2, ceil - 80)],
                "none", ACCENT, 2, "10 6", False))
    # wheelchair user in hall
    sh.add(iso_wheelchair_user(iso, hcx - 350, hcy - 650))
    # dimensions
    sh.add(iso.dim((0, by0 + bwid, 0), (0, by0 + bwid + clear, 0), num(clear), 28, ACCENT, size=13))
    sh.add(iso.dim((0, by0 - clear, 0), (0, by0, 0), num(clear), 28, ACCENT, size=13))
    sh.add(iso.dim((bl, by0 + bwid + clear, 0), (bl + clear, by0 + bwid + clear, 0), num(clear), 22, ACCENT, size=13))
    sh.add(iso.dim((d0, AD, 0), (d0 + door, AD, 0), f"{num(door)} clear", 30, ACCENT, size=13))
    sh.add(iso.dim((hx0, AD, 0), (AW, AD, 0), num(bw), 30, INK, size=13))
    sh.add(iso.dim((AW, AD - bd, 0), (AW, AD, 0), num(bd), -30, INK, size=13))
    sh.add(iso.dim((0, 0, 0), (0, 0, ceil), f"≥ {num(ceil)}", 34, ACCENT, size=13))
    hx, hy = P(hcx, hcy)
    sh.add(text(hx - 88, hy + 6, f"Ø {num(hall)}", 15, ACCENT, 800, "end"))
    # callouts
    tx, ty = P(1000, 3200, ceil - 80)
    sh.add(leader(tx, ty, 890, FRAME_Y + 640))
    svg, _ = callout(895, FRAME_Y + 640, "Ceiling hoist:", "required or prepared, track from bed to bathroom; "
                     f"the {num(ceil)} mm ceiling height is motivated by the hoist.", 225, 13)
    sh.add(svg)
    zx, zy = P(1000, by0 - clear / 2, 0)
    sh.add(leader(zx, zy, 200, FRAME_Y + 330))
    svg, _ = callout(70, FRAME_Y + 280, "Care position:", f"{num(clear)} mm free along both long sides and the foot of the bed.",
                     220, 13)
    sh.add(svg)
    wx, wy = P(3500, 0, 1500)
    sh.add(leader(wx, wy, 900, FRAME_Y + 80))
    svg, _ = callout(860, FRAME_Y + 60, "Daylight and view", "from bed and wheelchair; facade required.", 240, 13)
    sh.add(svg)
    svg, _ = callout(70, FRAME_Y + 870, "Hall:", f"turning Ø {num(hall_min)} mm minimum, preferably Ø {num(hall)}. "
                     f"Doors used by residents {num(door)} mm clear at 90°.", 300, 13)
    sh.add(svg)
    svg, _ = callout(820, FRAME_Y + 870, f"Bathroom {bw / 1000:.1f} × {bd / 1000:.1f} m",
                     "with room to assist on both sides of WC and shower, washer and dryer; floor drain; hoist prepared.", 280, 13)
    sh.add(svg)
    sh.note("1", "Apartment:", f"{apt['size']['value_m2']} m² ({apt['size']['range_m2'][0]}–{apt['size']['range_m2'][1]}) per resident — "
            "hall, sleeping/living room with pentry, bathroom. Programme value, not law.")
    sh.note("2", "Bed clearance:", f"{num(clear)} mm both sides in care position. The law (BFS 2024:12 2 kap. 10 §) asks for free space "
            "along both long sides and the foot; the width comes from the programme.")
    sh.note("3", "Ceiling:", f"≥ {num(ceil)} mm. Marievik clear height under services is "
            f"{num(SHELL['structure']['clear_height_under_services_mm'])} mm (TEMPLATE) — exactly at the limit.")
    sh.note("4", "Work space:", "AFS 2023:12 3 kap. 6 §: normally at least 0.8 m free working space where care work involves force or bending.")
    sh.note("", "Drawn layout:", "footprint 5.0 × 6.6 m and furniture are illustrative; only dimensioned values are sourced.")
    url_bot = source_url(CARE, "Botkyrka")
    url_upp = source_url(CARE, "Uppsala")
    sh.source(apt["size"]["source"], apt["size"]["strength"], apt["size"]["confidence"], apt["size"]["url"], "apartment 30–35 m²")
    sh.source(cs, "programme", "verified", url_bot, "ceiling 2 600, bed 900, hall Ø 1 300 / 1 500, door 1 000, hoist")
    sh.source(bath["size"]["source"], bath["size"]["strength"], bath["size"]["confidence"], bath["size"]["url"], "bathroom 2.4 × 2.7 m")
    sh.source(apt["required"]["basis"], apt["required"]["strength"], "", apt["required"]["url"], "why the space is required")
    sh.source("Uppsala kommun, Funktionsprogram för nytt vård- och omsorgsboende för äldre (2021)", "programme", "verified",
              url_upp, "hoist ('travers'), view from bed and wheelchair")
    return sh


# ---------------------------------------------------------------- 06 bicycle room

def sheet_bicycle() -> Sheet:
    b = space(AMEN, "shared_bicycle_room")
    cnt = b["size"]["count"]
    sw_, sl = (round(float(v) * 1000) for v in find(r"standard cycle (\d\.\d+) x (\d\.\d+) m", cnt).groups())
    cw_, cl = (round(float(v) * 1000) for v in find(r"cargo or larger cycle (\d\.\d+) x (\d\.\d+) m", cnt).groups())
    sh = Sheet(6, "SHARED AMENITY · MOBILITY", ["BICYCLE PARKING:", "SPACES AND COUNTS"], 760,
               "CYKELPARKERINGSPLATS · BFS 2026:4 1 KAP. 7 §",
               "data/catalogue/uses/shared_amenities.json → spaces / shared_bicycle_room")
    s = 0.105
    ox, oy = 120, FRAME_Y + 150
    n = 7
    for i in range(n):
        x = ox + i * sw_ * s
        sh.add(rect(x, oy, sw_ * s, sl * s, "url(#hatch-soft)" if i % 2 else PAPER, INK, 1))
        cx = x + sw_ * s / 2
        sh.add(line(cx, oy + 18, cx, oy + sl * s - 18, INK, 2.2, cap="round"))
        sh.add(line(cx - 14, oy + 40, cx + 14, oy + 40, INK, 1.6, cap="round"))
        for wy in (oy + 30, oy + sl * s - 30):
            sh.add(rect(cx - 3, wy - 22, 6, 44, PAPER, INK, 1.2, 3))
    xc = ox + n * sw_ * s + 40
    sh.add(rect(xc, oy, cw_ * s, cl * s, "url(#hatch)", ACCENT, 1.2))
    sh.add(rect(xc + cw_ * s / 2 - 26, oy + 50, 52, 70, PAPER, INK, 1.2, 4))
    sh.add(line(xc + cw_ * s / 2, oy + 125, xc + cw_ * s / 2, oy + cl * s - 20, INK, 2.2, cap="round"))
    sh.add(rect(xc + cw_ * s / 2 - 3, oy + cl * s - 50, 6, 44, PAPER, INK, 1.2, 3))
    sh.add(dim(ox, oy, ox + sw_ * s, oy, num(sw_), -22, ACCENT, 14))
    sh.add(dim(ox, oy, ox, oy + sl * s, num(sl), 24, ACCENT, 14))
    sh.add(dim(xc, oy, xc + cw_ * s, oy, num(cw_), -22, ACCENT, 14))
    sh.add(dim(xc + cw_ * s, oy, xc + cw_ * s, oy + cl * s, num(cl), -26, ACCENT, 14))
    ay = oy + max(sl, cl) * s + 20
    sh.add(rect(ox, ay, (n * sw_ + 400 + cw_) * s, 120, "none", GREY, 1, 0, "6 5"))
    sh.add(text(ox + (n * sw_) * s / 2, ay + 66, "FREE SPACE BEHIND — REQUIRED, NOT QUANTIFIED", 13, GREY, 700, "middle"))
    sh.add(text(ox + n * sw_ * s / 2, oy - 60, f"STANDARD CYCLE  {sw_ / 1000:.2f} × {sl / 1000:.2f} m = {b['size']['value_m2']} m²",
                14, INK, 800, "middle"))
    sh.add(text(xc + cw_ * s / 2, oy - 60, f"CARGO  {cw_ / 1000:.1f} × {cl / 1000:.1f} m = {b['size']['range_m2'][1]:g} m²",
                14, INK, 800, "middle"))
    svg, _ = callout(70, ay + 175, "Flerbostadshus:",
                     "≥ 2 spaces per bostadslägenhet, plus a reasonable number for larger cycles (2 kap. 2 §).", 480, 14)
    sh.add(svg)
    svg, _ = callout(600, ay + 175, "Lokalbyggnad:",
                     "spaces for ≥ 15 % of the average or 10 % of the total user capacity (2 kap. 4 §).", 480, 14)
    sh.add(svg)
    svg, _ = callout(70, ay + 245, "Worked example (indicative):", b["notes"].split("Worked example (indicative): ")[1].split(". ")[0] + ".",
                     1000, 14)
    sh.add(svg)
    for i, m in enumerate(b["mixing_constraints"][2:4]):
        sh.note(str(i + 1), *lead(m))
    sh.note("", "On conversion:", b["notes"].split(" Worked example")[0].removeprefix("Conversion: "))
    sh.source(b["required"]["basis"], b["required"]["strength"], "", b["required"]["url"],
              "counts per dwelling / per user capacity, alteration triggers")
    sh.source(b["size"]["source"], b["size"]["strength"], b["size"]["confidence"], b["size"]["url"], "0.60 × 1.90 m and 1.20 × 2.50 m spaces")
    return sh


# ---------------------------------------------------------------- 07 waste room

def sheet_waste() -> Sheet:
    w = space(AMEN, "shared_waste_room")
    cnt = w["size"]["count"]
    containers = [(int(a), round(float(b) * 1000), round(float(c) * 1000))
                  for a, b, c in re.findall(r"(\d+) l (\d\.\d+) x (\d\.\d+)", cnt)]
    aisle = round(float(find(r"free aisle of at least (\d\.\d+) m", cnt).group(1)) * 1000)
    access = next(m for m in w["mixing_constraints"] if m.startswith("Collector access"))
    drag = int(find(r"longer than (\d+) m", access).group(1))
    dw = round(float(find(r"at least (\d\.\d+) m wide", access).group(1)) * 1000)
    dturn = round(float(find(r"\((\d\.\d+) m at turns\)", access).group(1)) * 1000)
    dh = round(float(find(r"at least (\d\.\d+) m clear height", access).group(1)) * 1000)
    slope = find(r"never steeper than (1:\d+)", access).group(1)
    sh = Sheet(7, "SHARED AMENITY · WASTE", ["WASTE ROOM:", "CONTAINERS, AISLE, DRAG ROUTE"], 790,
               "AVFALLSUTRYMME / MILJÖRUM",
               "data/catalogue/uses/shared_amenities.json → spaces / shared_waste_room (size.count, mixing_constraints)")
    s = 0.12
    ox, oy = 110, FRAME_Y + 120
    fractions = ["residual", "paper pack.", "plastic", "food", "glass"]
    order = sorted(containers, key=lambda c: -c[0])
    room_w = sum(c[1] for c in order) + 200 * (len(order) + 1)
    room_d = max(c[2] for c in order) + 200 + aisle + 200
    sh.add(rect(ox - 20, oy - 20, room_w * s + 40, room_d * s + 40, WALL, INK, 1.4))
    sh.add(rect(ox, oy, room_w * s, room_d * s, PAPER, INK, 1.4))
    x = ox + 200 * s
    for (litres, cw_, cd), frac in zip(order, fractions):
        sh.add(rect(x, oy + 100 * s, cw_ * s, cd * s, PAPER, INK, 1.3, 3))
        sh.add(line(x + 6, oy + 100 * s + 10, x + cw_ * s - 6, oy + 100 * s + 10, INK, 0.8))
        sh.add(text(x + cw_ * s / 2, oy + 100 * s + cd * s / 2 + 8, f"{litres} l", 12, INK, 800, "middle"))
        sh.add(text(x + cw_ * s / 2, oy + 100 * s + cd * s / 2 + 24, frac, 10, GREY, 600, "middle"))
        sh.add(dim(x, oy + 100 * s, x + cw_ * s, oy + 100 * s, num(cw_), -34, INK, 11))
        x += (cw_ + 200) * s
    ay = oy + (100 + max(c[2] for c in order) + 100) * s
    sh.add(rect(ox + 6, ay, room_w * s - 12, aisle * s, "url(#hatch)", ACCENT, 0.8))
    sh.add(dim(ox + room_w * s, ay, ox + room_w * s, ay + aisle * s, f"≥ {num(aisle)}", 28, ACCENT, 14))
    sh.add(text(ox + room_w * s / 2, ay + aisle * s / 2 + 6, "FREE AISLE", 15, ACCENT, 800, "middle", spacing=1))
    door_x = ox + room_w * s - 160
    sh.add(line(door_x, oy + room_d * s, door_x + 1200 * s, oy + room_d * s, PAPER, 30))
    sh.add(text(door_x + 600 * s, oy + room_d * s + 4, "no threshold", 10, GREY, 600, "middle"))
    # drag route to vehicle
    ry = oy + room_d * s + 20
    rx = door_x + 600 * s
    route = [(rx, ry), (rx, ry + 140), (rx + 260, ry + 140)]
    sh.add(poly(route, "none", ACCENT, 2, "10 7", False))
    sh.add(poly([(rx + 266, ry + 140), (rx + 254, ry + 133), (rx + 254, ry + 147)], ACCENT, ACCENT, 1))
    sh.add(text(rx + 130, ry + 130, f"≤ {drag} m", 13, ACCENT, 800, "middle"))
    sh.add(rect(rx + 270, ry + 90, 200, 100, PAPER, INK, 1.5, 8))
    sh.add(text(rx + 370, ry + 146, "refuse vehicle", 11, INK, 700, "middle"))

    svg, _ = callout(90, ry + 50, f"Drag route (dragväg) ≤ {drag} m,",
                     f"≥ {num(dw)} mm wide ({num(dturn)} mm at turns), ≥ {num(dh)} mm clear height, even, no steps, "
                     f"preferably flat and never steeper than {slope}. Max length is set in the municipal avfallstaxa.", 520, 13)
    sh.add(svg)
    svg, _ = callout(ox + room_w * s + 80, oy + 10, "Weekly volume per household",
                     "(Avfall Sverige 'normal', l/week): residual 45–55, paper packaging 40–50, plastic 20–30, food 10, "
                     "returpapper 5, metal 2, glass 2 + 2.", 240, 12.5)
    sh.add(svg)
    svg, _ = callout(ox + room_w * s + 80, oy + 175, "Containers =",
                     "volume × collection interval ÷ container size. Floor = footprints incl. spacing (+ lid depth) + aisle.",
                     240, 12.5)
    sh.add(svg)
    for i, m in enumerate(w["mixing_constraints"][:2] + w["mixing_constraints"][3:4], 1):
        sh.note(str(i), *lead(m))
    sh.note("", "Container footprints:", "; ".join(f"{l} l {a} × {b}" for l, a, b in containers) + " mm (spacing between containers drawn at 200 mm, illustrative).")
    sh.source(w["size"]["source"], w["size"]["strength"], w["size"]["confidence"], w["size"]["url"],
              "weekly volumes, container footprints, 1.5 m aisle")
    sh.source("Sysav, 'Handbok för avfallshantering' (2025) printed pp. 12-13, 18 (after Avfall Sveriges Handbok för avfallsutrymmen)",
              "programme", "sourced", next(x["url"] for x in AMEN["sources"] if x["ref"].startswith("Sysav")),
              "drag route ≤ 10 m, 1.2 / 1.35 m wide, 2.1 m high, ≤ 1:12")
    sh.source(w["required"]["basis"], w["required"]["strength"], "", w["required"]["url"],
              "waste room required, sized to limit risks")
    sh.source("Avfallsförordning (2020:614) 3 kap. 2, 2 a, 7, 8, 11, 36, 37 §§", "law", "",
              next(x["url"] for x in AMEN["sources"] if x["ref"].startswith("Avfallsförordning")), "sorting and collection duties")
    return sh


# ---------------------------------------------------------------- 08 refuse vehicle access

def sheet_vehicle() -> Sheet:
    g = space(AMEN, "shared_goods_loading")
    cnt = g["size"]["count"]
    road = round(float(find(r"at least (\d\.\d+) m wide", cnt).group(1)) * 1000)
    road2 = round(float(find(r"\((\d\.\d+) m two-way\)", cnt).group(1)) * 1000)
    height = round(float(find(r"clear height (\d\.\d+) m", cnt).group(1)) * 1000)
    turn = round(float(find(r"turning circle (\d+) m diameter", cnt).group(1)) * 1000)
    strip = round(float(find(r"plus (?:a )?(\d\.\d+) m clear strip", cnt).group(1)) * 1000)
    shell_site = SHELL["site"]
    sh = Sheet(8, "SITE · GOODS AND WASTE COLLECTION", ["REFUSE VEHICLE:", "ROAD, HEADROOM, TURNING"], 860,
               "TRANSPORT ROAD (TRANSPORTVÄG) · SYSAV 2025",
               "data/catalogue/uses/shared_amenities.json → spaces / shared_goods_loading (size.count)")
    s = 0.024
    cx, cy = 340, FRAME_Y + 400
    R = turn / 2
    sh.add(circle(cx, cy, (R + strip) * s, "url(#hatch-soft)", ACCENT, 1, "6 5"))
    sh.add(circle(cx, cy, R * s, PAPER, ACCENT, 1.8))
    sh.add(circle(cx, cy, (R - road) * s, "url(#earth)", INK, 1))
    sh.add(line(cx - R * s, cy, cx + R * s, cy, ACCENT, 0.8))
    sh.add(text(cx, cy - 12, f"Ø {num(turn)}", 18, ACCENT, 800, "middle"))
    sh.add(dim(cx + R * s, cy + 40, cx + (R + strip) * s, cy + 40, num(strip), 0, ACCENT, 11, False))
    sh.add(rect(cx + R * s - 4, cy - road * s / 2 - 200, 280, road * s, PAPER, "none", 0))
    rx = cx + (R + strip) * s + 30
    sh.add(rect(rx, cy - road2 * s / 2 - 120, 190, road2 * s, PAPER, INK, 1.5))
    sh.add(line(rx, cy - 120, rx + 190, cy - 120, GREY, 1, "12 8"))
    sh.add(dim(rx + 190, cy - road2 * s / 2 - 120, rx + 190, cy + road2 * s / 2 - 120, f"{num(road2)} two-way", -30, INK, 12))
    sh.add(rect(rx, cy + 30, 190, road * s, PAPER, INK, 1.5))
    sh.add(dim(rx + 190, cy + 30, rx + 190, cy + 30 + road * s, f"≥ {num(road)}", -30, ACCENT, 12))
    sh.add(text(rx, cy + 30 + road * s + 22, "one-way", 12, INK, 600))
    # section: clear height
    sx, sy = 920, FRAME_Y + 690
    sh.add(line(sx - 40, sy, sx + 220, sy, INK, 1.8))
    sh.add(rect(sx - 40, sy, 260, 14, "url(#earth)", "none", 0))
    sh.add(rect(sx - 40, sy - height * 0.06 - 16, 260, 16, "url(#concrete)", INK, 1.2))
    sh.add(rect(sx + 10, sy - 3300 * 0.06, 150, 3300 * 0.06 - 20, PAPER, INK, 1.3, 6))
    sh.add(circle(sx + 45, sy - 14, 14, PAPER, INK, 1.2))
    sh.add(circle(sx + 125, sy - 14, 14, PAPER, INK, 1.2))
    sh.add(dim(sx + 210, sy, sx + 210, sy - height * 0.06, f"≥ {num(height)} clear", -22, ACCENT, 12))
    sh.add(text(sx - 40, sy - height * 0.06 - 30, "SECTION AT PASSAGE / PORTE-COCHÈRE", 11, GREY, 700))
    svg, _ = callout(60, FRAME_Y + 70, "Turning:", f"circle Ø {turn / 1000:g} m plus a {strip / 1000:g} m clear strip, or a turning loop. "
                     "Vehicle reversing is to be avoided.", 520, 13)
    sh.add(svg)
    svg, _ = callout(770, FRAME_Y + 95, "Marievik site (TEMPLATE):",
                     f"plot {shell_site['plot_area_m2']:g} m², outdoor area available {shell_site['outdoor_area_available_m2']:g} m², "
                     f"{shell_site['parking_spaces']} parking spaces. An Ø {turn / 1000:g} m turning circle alone covers "
                     f"≈ {math.pi * (R / 1000) ** 2:.0f} m².", 330, 13)
    sh.add(svg)
    for i, m in enumerate(g["mixing_constraints"], 1):
        sh.note(str(i), *lead(m))
    sh.note("", "Note:", g["notes"])
    sh.source(g["size"]["source"], g["size"]["strength"], g["size"]["confidence"], g["size"]["url"],
              "road 3.5 / 5.5 m, headroom 4.7 m, turning Ø 18 m + 1.5 m")
    sh.source(g["required"]["basis"], g["required"]["strength"], "", g["required"]["url"], "loading and unloading on the plot")
    sh.source("Marievik+ shell — " + SHELL["_meta"]["status"], "template", "placeholder",
              "data/building/marievik_shell.json", "plot, outdoor area, parking")
    return sh


# ---------------------------------------------------------------- 09 Marievik section

def sheet_shell_section() -> Sheet:
    st, env = SHELL["structure"], SHELL["envelope"]
    staff = rule("staff_facilities", "staff_room_height_daylight")
    apt = space(CARE, "sabo_apartment")
    eye = int(find(r"seated eye height ~(\d+) mm", env["seated_view_note"]).group(1))
    view_sill = int(find(r"~(\d+) mm needed", env["seated_view_note"]).group(1))
    sh = Sheet(9, "MARIEVIK+ · EXISTING SHELL", ["MARIEVIK SHELL:", "SECTION AGAINST HEIGHT RULES"], 780,
               "TYPICAL BAY, 1985 CONCRETE FLAT SLAB · TEMPLATE, NOT SURVEY",
               "data/building/marievik_shell.json → structure, envelope, core_and_circulation; data/catalogue/cross_cutting.json → "
               "staff_facilities / staff_room_height_daylight; data/catalogue/uses/elderly_care_home.json → sabo_apartment")
    s = 0.14
    fx, base = 190, FRAME_Y + 640
    f2f, slab = st["floor_to_floor_mm"], st["slab_thickness_mm"]
    under_slab, under_serv = st["clear_height_under_slab_mm"], st["clear_height_under_services_mm"]
    span = st["grid_x_mm"]
    shown = 4400  # facade zone of the bay only; the section is cut at a break line
    def Y(z): return base - z * s
    # slabs
    for z0 in (-slab, f2f - slab):
        sh.add(rect(fx - 60, Y(z0 + slab), shown * s + 60, slab * s, "url(#concrete)", INK, 1.4))
    bx = fx + shown * s
    sh.add(poly([(bx, Y(f2f) - 14), (bx, Y(f2f / 2) - 12), (bx - 10, Y(f2f / 2) - 4), (bx + 10, Y(f2f / 2) + 4),
                 (bx, Y(f2f / 2) + 12), (bx, Y(-slab) + 14)], "none", INK, 1, closed=False))
    # services zone
    sh.add(rect(fx + 10, Y(f2f - slab), (shown - 100) * s, (f2f - slab - under_serv) * s, "url(#hatch-soft)", ACCENT, 0.8))
    sh.add(text(fx + shown * s / 2, Y(f2f - slab) + 20, "SERVICES ZONE (ceiling void, ducted)", 11, ACCENT, 700, "middle"))
    sh.add(line(fx + 10, Y(under_serv), bx - 10, Y(under_serv), INK, 1, "2 3"))
    # facade with ribbon window at left
    sh.add(rect(fx - 60, Y(env["sill_height_mm"]), 60, env["sill_height_mm"] * s, WALL, INK, 1.3))
    sh.add(rect(fx - 60, Y(under_slab), 60, (under_slab - env["head_height_mm"]) * s, WALL, INK, 1.3))
    sh.add(rect(fx - 48, Y(env["head_height_mm"]), 36, (env["head_height_mm"] - env["sill_height_mm"]) * s, PAPER, INK, 1))
    # seated eye line and wheelchair in profile
    px = fx + 900 * s
    sh.add(circle(px + 260 * s, Y(eye), 95 * s, PAPER, INK, 1.2))
    sh.add(rect(px + 120 * s, Y(eye - 130), 300 * s, 600 * s, PAPER, INK, 1.1, 10))
    sh.add(rect(px - 60 * s, Y(560), 520 * s, 70 * s, PAPER, INK, 1.1))
    sh.add(rect(px - 120 * s, Y(560), 160 * s, 450 * s, PAPER, INK, 1.1, 4))
    sh.add(circle(px + 300 * s, Y(300), 300 * s, PAPER, INK, 1.2))
    sh.add(circle(px - 140 * s, Y(80), 80 * s, PAPER, INK, 1.1))
    sh.add(line(px + 200 * s, Y(eye), fx - 60, Y(eye), ACCENT, 1.4, "6 4"))
    sh.add(text(px + 380 * s, Y(eye) + 4, f"seated eye ≈ {num(eye)}", 12, ACCENT, 700))
    # requirement lines
    reqs = [(int(staff["values"]["room_height_advice_m"]["general"] * 1000), "workplace (AFS)"),
            (apt["constraints"]["min_ceiling_height_mm"], "SÄBO apartment"),
            (int(staff["values"]["room_height_advice_m"]["teaching_or_many_people"] * 1000), "teaching rooms (AFS)")]
    dx = bx + 40
    rx_end = dx + 128
    for i, (h, lab) in enumerate(reqs):
        ok = under_serv >= h
        sh.add(line(bx - 260, Y(h), rx_end, Y(h), ACCENT if not ok else INK, 1.2, "9 5"))
        sh.add(text(rx_end + 6, Y(h) + (4, 11, -3)[i], f"{num(h)} {lab} {'✓' if ok else '✗'}",
                    11.5, ACCENT if not ok else INK, 700))
    # dimension chain at right
    sh.add(dim(dx, Y(0), dx, Y(under_serv), num(under_serv), 0, INK, 13, False))
    sh.add(dim(dx + 60, Y(0), dx + 60, Y(under_slab), num(under_slab), 0, INK, 13, False))
    sh.add(dim(dx + 120, Y(-slab), dx + 120, Y(f2f - slab), f"{num(f2f)} floor to floor", 0, INK, 13, False))
    sh.add(dim(fx - 60, Y(env['sill_height_mm']), fx - 60, Y(0), f"sill {num(env['sill_height_mm'])}", 30, ACCENT, 12))
    sh.add(dim(fx - 60, Y(env['head_height_mm']), fx - 60, Y(env['sill_height_mm']), f"window to {num(env['head_height_mm'])}", 30, INK, 12))
    sh.add(text(fx, Y(-slab) + 26, f"structural grid {num(span)} × {num(st['grid_y_mm'])}, columns "
                f"{st['column_size_mm'][0]} × {st['column_size_mm'][1]} (bay cut at break line)", 12, INK, 600))
    sh.add(text(fx + slab * s, Y(-slab / 2) + 4, f"slab {slab}", 10, INK, 700))
    # flags
    svg, _ = callout(70, FRAME_Y + 70, "Seated view:", env["seated_view_note"].split(". Any")[0] +
                     f" (needs ≈ {view_sill} mm).", 470, 13)
    sh.add(svg)
    svg, _ = callout(620, FRAME_Y + 70, f"Slab {st['live_load_capacity_kn_m2']} kN/m², verified = {str(st['live_load_verified']).lower()}:",
                     "see sheet 10. Every assembly and care result is conditional until a structural engineer confirms capacity.", 470, 13)
    sh.add(svg)
    sh.note("1", "Heights:", f"{num(under_serv)} mm clear under services, {num(under_slab)} under slab, {num(f2f)} floor to floor, slab {slab} mm.")
    sh.note("2", "Rules compared:", "AFS 2023:12 advice 2.40 m general and 2.70 m for teaching rooms; SÄBO apartment 2.60 m "
            "(Botkyrka programme, for ceiling hoists). Teaching rooms only fit if services are re-routed to reach the 3 020 under slab.")
    sh.note("3", "Envelope:", f"ribbon window, sill {num(env['sill_height_mm'])}, head {num(env['head_height_mm'])}, "
            f"openable windows = {str(env['openable_windows']).lower()}, glazing {env['glazing'].replace('_', ' ')}.")
    sh.note("", "Status:", SHELL["_meta"]["warning"])
    sh.source("Marievik+ shell — " + SHELL["_meta"]["status"], "template", "placeholder", "data/building/marievik_shell.json",
              "all building dimensions and the seated-eye note")
    src_rule(sh, staff, "room height 2.40 / 2.70 m")
    sh.source(apt["constraints_sources"].split(". Bed")[0], "programme", "verified", source_url(CARE, "Botkyrka"), "SÄBO ceiling 2.60 m")
    return sh


# ---------------------------------------------------------------- 10 imposed loads

def sheet_loads() -> Sheet:
    r = rule("structural_loads", "loads_imposed_table_4_1")
    st = SHELL["structure"]
    floors = r["values"]["kN_per_m2_floor"]
    cap = st["live_load_capacity_kn_m2"]
    sh = Sheet(10, "STRUCTURE · CHANGE OF USE", ["IMPOSED FLOOR LOADS:", "WHAT THE SLAB MUST CARRY"], 820,
               "BFS 2024:6 TABELL 4:1 vs MARIEVIK SLAB (TEMPLATE)",
               "data/catalogue/cross_cutting.json → structural_loads / loads_imposed_table_4_1; data/building/marievik_shell.json → structure")
    names = {"A_dwelling": "A  dwellings", "B_office": "B  offices", "C1_assembly_movable_seats": "C1  assembly, movable seats",
             "C2_assembly_fixed_seats": "C2  assembly, fixed seats", "C3_assembly_free_movement": "C3  assembly, free movement",
             "C4_physical_activity_gym": "C4  physical activity, gym", "C5_crowds": "C5  large crowds",
             "D1_retail": "D1  retail", "D2_department_store": "D2  department stores", "E1_storage_goods": "E1  storage, goods"}
    rows = [(names[k], floors[k]) for k in names]
    x0, y0, bar_h, gap = 360, FRAME_Y + 90, 30, 22
    scale = 120  # px per kN/m²
    for i in range(0, 6):
        gx = x0 + i * scale
        sh.add(line(gx, y0 - 20, gx, y0 + len(rows) * (bar_h + gap), LIGHT, 0.8))
        sh.add(text(gx, y0 - 28, f"{i}", 12, GREY, 600, "middle"))
    sh.add(text(x0 + 5 * scale + 40, y0 - 28, "kN/m²", 12, GREY, 600))
    for i, (lab, val) in enumerate(rows):
        y = y0 + i * (bar_h + gap)
        over = val > cap
        fill = "url(#hatch)" if over else PAPER
        sh.add(f'<g><title>{esc(lab)}: {val:g} kN/m² ({"exceeds" if over else "within"} {cap:g})</title>'
               f'{rect(x0, y, val * scale, bar_h, fill, ACCENT if over else INK, 1.3, 3)}</g>')
        sh.add(text(x0 - 14, y + bar_h / 2 + 5, lab, 13, INK, 600, "end"))
        pct = f"+{(val / cap - 1) * 100:.0f} %" if over else ("−20 %" if val < cap else "± 0")
        sh.add(text(x0 + max(val, cap) * scale + 10, y + bar_h / 2 + 5, f"{val:g}  {pct if val != cap else '± 0'}", 13,
                    ACCENT if over else INK, 700))
    cx = x0 + cap * scale
    yb = y0 + len(rows) * (bar_h + gap)
    sh.add(line(cx, y0 - 40, cx, yb + 10, INK, 2.2, "8 5"))
    sh.add(text(cx, yb + 32, f"Marievik slab {cap:g} kN/m² (TEMPLATE, verified = {str(st['live_load_verified']).lower()})",
                13, INK, 800, "middle"))
    svg, _ = callout(70, yb + 80, "Hatched bars", "exceed the existing slab and usually need structural verification or strengthening "
                     "(BFS 2024:6 8 kap. 3 §: the load increase is what makes the change 'require higher properties').", 980, 13)
    sh.add(svg)
    m = r["values"]["use_to_category_mapping_suggested"]
    sh.note("1", "Use → category (suggested):", "; ".join(f"{k.replace('_', ' ')} {v}" for k, v in m.items()) + ".")
    sh.note("2", "Barriers:", "office balustrades (0.5 kN/m) converted to assembly, retail or gym need 1.0–3.0 kN/m (BFS 2024:6 tabell 4:2).")
    sh.note("", "Conversion:", r["conversion_note"].split(" Under BFS")[0])
    sh.note("", "Mixed floors:", "floors with several uses are designed for the most unfavourable one.")
    src_rule(sh, r, "imposed loads per category, use mapping")
    src_rule(sh, rule("structural_loads", "loads_barriers_stairs"), "barrier line loads")
    sh.source("Marievik+ shell — " + SHELL["_meta"]["status"], "template", "placeholder", "data/building/marievik_shell.json",
              "live_load_capacity_kn_m2 = 2.5, live_load_verified = false")
    return sh


# ---------------------------------------------------------------- use programme sheets (one per use file)

TIERS = [("MUST EXIST", "required by law", ("law",)),
         ("SHOULD EXIST", "guidance or municipal / operator programme", ("guidance", "programme")),
         ("USUALLY PROVIDED", "practice, not regulated", ("practice", "none"))]
CONSTRAINT_TAGS = {
    "daylight_required": "daylight", "facade_required": "facade", "drainage_required": "drain",
    "floor_drain_required": "floor drain", "exhaust_ventilation_required": "exhaust", "ground_floor_required": "ground floor",
    "ground_floor_preferred": "ground floor pref.", "direct_link_to_outdoor": "door to outdoors",
    "direct_link_to_building": "next to building", "vehicle_access_required": "vehicle access",
    "goods_delivery_access_required": "goods access", "grease_separator_required": "grease sep.",
    "step_free_required": "step-free", "level_threshold_free": "no thresholds", "fenced": "fenced",
    "acoustic_privacy_required": "acoustic privacy", "sound_insulation_required": "sound insulation",
    "wash_basin_required": "wash basin", "hand_wash_basin": "hand basin", "water_point_required": "water point",
    "water_supply_required": "water", "fume_cupboard_required": "fume cupboard", "chemical_storage_ventilated": "vent. chem. store",
    "fire_rated_archive": "fire-rated", "dust_extraction_required": "dust extraction", "heavy_floor_load": "heavy load",
    "power_high_load": "high power", "central_location": "central", "daylight_two_directions": "light 2 sides",
    "goods_access": "goods access", "stove_guard": "stove guard", "ground_level_access": "ground level",
}


def size_line(sp: dict[str, Any], unit: str) -> tuple[str, bool]:
    size = sp.get("size") or {}
    v, rng, rule_ = size.get("value_m2"), size.get("range_m2"), size.get("rule")
    if v is None:
        return "no sourced size", False
    unit_word = unit.replace("_", " ")
    per_unit = f" per {unit_word}" if unit_word.split()[0][:4] in (size.get("count") or "") else " each"
    per = {"per_unit": per_unit, "per_seat": " per seat", "per_group": " per group",
           "per_building": "", "fixed": "", "derived": ""}.get(rule_, "")
    rng_txt = f" ({rng[0]:g}–{rng[1]:g})" if rng and rng[0] != rng[1] else ""
    return f"{v:g} m²{rng_txt}{per}", True


def constraint_tags(sp: dict[str, Any]) -> list[str]:
    c = sp.get("constraints") or {}
    tags = []
    for key in ("min_ceiling_height_mm", "min_clear_height_mm"):
        if c.get(key):
            tags.append(f"ceiling ≥ {num(c[key])}")
    for key, value in c.items():
        if key.endswith("_mm") and key not in ("min_ceiling_height_mm", "min_clear_height_mm") and isinstance(value, (int, float)):
            tags.append(f"{key.removesuffix('_mm').replace('_', ' ')} {num(value)}")
        elif key in CONSTRAINT_TAGS and value:
            tags.append(CONSTRAINT_TAGS[key])
    if c.get("column_free_span_m"):
        tags.append(f"column-free {c['column_free_span_m']} m")
    if c.get("min_classroom_m2"):
        tags.append(f"room ≥ {c['min_classroom_m2']} m²")
    if c.get("noise_max_dBA_eq_day"):
        tags.append(f"≤ {c['noise_max_dBA_eq_day']} dBA")
    if c.get("ceiling_hoist"):
        tags.append("ceiling hoist")
    return tags


def strength_badge(x: float, y: float, strength: str) -> str:
    label_ = strength.upper()
    w = len(label_) * 6.6 + 12
    if strength == "law":
        return rect(x, y, w, 16, ACCENT, ACCENT, 0, 3) + text(x + w / 2, y + 11.5, label_, 9.5, PAPER, 800, "middle", spacing=0.6)
    color = ACCENT if strength in ("guidance", "programme") else GREY
    return rect(x, y, w, 16, PAPER, color, 1, 3) + text(x + w / 2, y + 11.5, label_, 9.5, color, 800, "middle", spacing=0.6)


def sheet_program(use: dict[str, Any], number: int) -> Sheet:
    occ = use.get("occupancy", {})
    unit = occ.get("unit", "unit")
    tiles_by_tier = [[sp for sp in use["spaces"] if sp["required"].get("strength", "none") in strengths]
                     for _, _, strengths in TIERS]
    cols, tw, th, gx, gy = 4, 252, 158, 18, 16
    rows_total = sum(math.ceil(len(t) / cols) for t in tiles_by_tier if t)
    tiers_used = sum(1 for t in tiles_by_tier if t)
    top = FRAME_Y + 220
    frame_h = (top - FRAME_Y) + tiers_used * 46 + rows_total * (th + gy) + 70
    name = use["label_en"].split(" (")[0]
    sh = Sheet(number, f"USE PROGRAMME · {use['family'].upper()}", ["SPACE PROGRAMME:", name.upper()], frame_h,
               f"{use['label_sv'].upper()} · {len(use['spaces'])} SPACES",
               f"data/catalogue/uses/{use['id']}.json → regulatory, occupancy, spaces")
    # header strip: fire class, density, 24 h occupancy
    reg = str(use["regulatory"].get("bbr_verksamhetsklass", "—"))
    svg, _ = callout(70, FRAME_Y + 50, "Fire occupancy class (Vk):", reg.split(". ")[0][:150], 330, 12.5)
    sh.add(svg)
    g = occ.get("gross_m2_per_unit") or {}
    if g.get("value") is not None:
        dens = f"{g['value']:g} m²{' (' + str(g['range'][0]) + '–' + str(g['range'][1]) + ')' if g.get('range') else ''} gross per {unit.replace('_', ' ')}"
    else:
        dens = f"no sourced figure per {unit.replace('_', ' ')}"
    svg, _ = callout(430, FRAME_Y + 50, "Gross area:", f"{dens} [{g.get('strength', 'none')}].", 280, 12.5)
    sh.add(svg)
    hours = occ.get("hourly_presence") or []
    if hours:
        hx, hy, hw, hh = 760, FRAME_Y + 40, 360, 72
        sh.add(text(hx, hy + 4, f"PRESENCE OVER 24 H · {str(occ.get('hours_profile', '')).replace('_', ' ')}", 10.5, GREY, 700, spacing=0.8))
        bw = hw / 24
        for h, share in enumerate(hours):
            bh = max(share, 0) * hh
            sh.add(f'<g><title>{h:02d}:00 — {share * 100:.0f} % of capacity</title>'
                   f'{rect(hx + h * bw + 1, hy + 14 + hh - bh, bw - 2, bh, ACCENT, "none", 0, 1.5)}</g>')
        sh.add(line(hx, hy + 14 + hh, hx + hw, hy + 14 + hh, INK, 1))
        for h in (0, 6, 12, 18, 24):
            sh.add(text(hx + h * bw, hy + 14 + hh + 14, f"{h:02d}", 9.5, GREY, 600, "middle"))
        sh.add(text(hx, hy + 14 + hh + 28, "indicative modelling profile (weekday share of capacity)", 9.5, GREY, 400, italic=True))
    # legend
    ly = FRAME_Y + 196
    sh.add(line(60, ly - 22, W - 60, ly - 22, LIGHT, 1))
    sh.add(rect(70, ly - 8, 22, 14, PAPER, INK, 2))
    sh.add(text(100, ly + 4, "required by law", 11, INK, 600))
    sh.add(rect(220, ly - 8, 22, 14, PAPER, INK, 1.1))
    sh.add(text(250, ly + 4, "guidance / programme", 11, INK, 600))
    sh.add(rect(400, ly - 8, 22, 14, PAPER, GREY, 1.1, 0, "4 3"))
    sh.add(text(430, ly + 4, "practice", 11, INK, 600))
    sh.add(line(510, ly - 1, 545, ly - 1, ACCENT, 1.4, "0.1 4.5", "round"))
    sh.add(text(553, ly + 4, "depends on", 11, INK, 600))
    sh.add(text(650, ly + 4, "Badge = strength of the SIZE figure.  Tags = constraints from the JSON.", 11, GREY, 600))
    # tiles
    centers: dict[str, tuple[float, float]] = {}
    placed: list[tuple[dict[str, Any], float, float, int]] = []
    y = top
    for (title, sub, _), tiles in zip(TIERS, tiles_by_tier):
        if not tiles:
            continue
        sh.add(text(70, y + 16, title, 14, ACCENT if title == "MUST EXIST" else INK, 800, spacing=1.2))
        sh.add(text(70 + len(title) * 11 + 14, y + 16, sub, 11.5, GREY, 600))
        y += 34
        for i, sp in enumerate(tiles):
            x = 70 + (i % cols) * (tw + gx)
            yy = y + (i // cols) * (th + gy)
            centers[sp["id"]] = (x + tw / 2, yy + th / 2)
            placed.append((sp, x, yy, TIERS.index((title, sub, _))))
        y += math.ceil(len(tiles) / cols) * (th + gy) + 12
    for sp, *_ in placed:
        for dep in sp.get("depends_on") or []:
            if dep in centers:
                (x1, y1), (x2, y2) = centers[sp["id"]], centers[dep]
                sh.add(line(x1, y1, x2, y2, ACCENT, 1.4, "0.1 4.5", "round"))
    for sp, x, yy, tier in placed:
        size_txt, sized = size_line(sp, unit)
        stroke, sw, dash = ((INK, 2.2, ""), (INK, 1.1, ""), (GREY, 1.1, "5 4"))[tier]
        sh.add(rect(x, yy, tw, th, PAPER, stroke, sw, 6, dash))
        if sized:
            sh.add(rect(x + 1.5, yy + th - 46, tw - 3, 44.5, "url(#hatch-soft)", "none", 0, 4))
        name_lines = wrap(sp["label_en"], tw - 112, 13)[:3]
        for j, ln in enumerate(name_lines):
            sh.add(text(x + 12, yy + 22 + j * 16, ln, 13, INK, 800))
        sh.add(text(x + 12, yy + 22 + len(name_lines) * 16, sp.get("label_sv", ""), 10.5, GREY, 400, italic=True))
        tags = constraint_tags(sp)
        if tags:
            tag_lines = wrap("  ·  ".join(tags), tw - 24, 10)[:2]
            for j, ln in enumerate(tag_lines):
                sh.add(text(x + 12, yy + 86 + j * 13, ln, 10, INK, 600))
        sh.add(text(x + 12, yy + th - 26, size_txt, 14 if sized else 11.5, ACCENT if sized else GREY, 800 if sized else 600,
                    italic=not sized))
        cnt = (sp.get("size") or {}).get("count") or ""
        if cnt:
            sh.add(text(x + 12, yy + th - 10, (cnt[:44] + "…") if len(cnt) > 45 else cnt, 9.5, GREY, 400))
        strength = (sp.get("size") or {}).get("strength", "none")
        if strength != "none":
            sh.add(strength_badge(x + tw - len(strength) * 6.6 - 22, yy + 8, strength))
    # notes
    conv = use.get("conversion_from_office") or {}
    for i, b in enumerate((conv.get("typical_blockers") or [])[:3], 1):
        sh.note(str(i), "Blocker:", b)
    for b in (conv.get("typical_enablers") or [])[:2]:
        sh.note("+", "Enabler:", b)
    sh.note("", "Size sources per space:", f"each tile's figure and its source sentence are in uses/{use['id']}.json "
            "→ spaces[].size.source; the reference list below covers all of them.")
    for law in use["regulatory"].get("key_laws", []):
        sh.source(law["ref"], "law", "", law.get("url") or "", "key law (regulatory.key_laws)")
    for s in use.get("sources", []):
        sh.source(s["ref"], "source", f"accessed {s.get('accessed', '—')}", s.get("url") or "", "")
    return sh


SHEETS = {
    "01_wheelchair_dimensioning": sheet_wheelchair,
    "02_accessible_wc": sheet_accessible_wc,
    "03_escape_routes": sheet_escape,
    "04_ramps_lifts_door_openers": sheet_ramps_lifts,
    "05_care_apartment": sheet_care_apartment,
    "06_bicycle_parking": sheet_bicycle,
    "07_waste_room": sheet_waste,
    "08_refuse_vehicle_access": sheet_vehicle,
    "09_marievik_shell_section": sheet_shell_section,
    "10_imposed_floor_loads": sheet_loads,
}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, build in SHEETS.items():
        (OUTPUT / f"{name}.svg").write_text(build().render(), encoding="utf-8")
    uses = sorted((load(p) for p in (CATALOGUE / "uses").glob("*.json")), key=lambda u: (u["family"], u["id"]))
    for number, use in enumerate(uses, len(SHEETS) + 1):
        (OUTPUT / f"{number:02d}_use_{use['id']}.svg").write_text(sheet_program(use, number).render(), encoding="utf-8")
    print(f"Drew {len(SHEETS)} standards sheets and {len(uses)} use programme sheets in {OUTPUT}")


if __name__ == "__main__":
    main()
