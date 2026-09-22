"""Bridge to CAD — get real geometry in, get layouts back out.

The engine currently infers a rectangular floor plate from area and
perimeter. That is a reasonable approximation for early feasibility and a
poor one for anything else: real plates have notches, atria, setbacks and
cores in awkward places, and those are exactly the features that decide
whether a conversion works.

This module closes that gap in both directions:

    import   a .3dm floor outline  ->  measured shell parameters
    export   a generated layout    ->  .3dm zones and partitions, plus CSV
                                       for Grasshopper to drive further

IFC support is optional and requires ifcopenshell, which is not installed
here. The Rhino path works now and covers the normal workflow at Chalmers;
IFC matters when the model has to survive a handover to a consultant.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path

from . import layout as layout_module
from . import loader

try:
    import rhino3dm

    RHINO_AVAILABLE = True
except ImportError:  # pragma: no cover
    RHINO_AVAILABLE = False

try:
    import ifcopenshell  # noqa: F401

    IFC_AVAILABLE = True
except ImportError:
    IFC_AVAILABLE = False


IFC_INSTALL_HINT = (
    "IFC support needs ifcopenshell, which is not installed.\n"
    "    pip install ifcopenshell\n"
    "  (On Windows, prefer the conda-forge build if the wheel fails:\n"
    "   conda install -c conda-forge ifcopenshell)\n"
    "  The Rhino/.3dm path below works without it and covers the normal\n"
    "  workflow; IFC matters mainly for consultant handover."
)


# ---------------------------------------------------------------------------
# Import: measured geometry -> shell parameters
# ---------------------------------------------------------------------------


@dataclass
class MeasuredPlate:
    """What the engine needs from a floor outline, measured rather than inferred."""

    area_m2: float
    perimeter_m: float
    bounding_width_m: float
    bounding_depth_m: float
    curve_count: int
    source: str

    @property
    def compactness(self) -> float:
        """Plate area against the area of a circle with the same perimeter.

        1.0 is a circle; a square is about 0.79. Below ~0.5 means a
        convoluted plate — long thin wings, deep notches — which is good
        for daylight and expensive for circulation, and makes the
        rectangular approximation elsewhere in the engine unreliable.
        """
        if self.perimeter_m <= 0:
            return 0.0
        return 4.0 * math.pi * self.area_m2 / (self.perimeter_m ** 2)

    @property
    def warning(self) -> str | None:
        """Guard against the obvious misuse: pointing this at the wrong layer.

        Area sums correctly over many curves; perimeter does not. Reading a
        grid of bay rectangles gives the right area and a perimeter several
        times too large, and nothing downstream would notice — facade length
        and plan depth would both silently improve.
        """
        if self.curve_count > 2:
            return (
                f"{self.curve_count} closed curves were measured and their perimeters "
                "SUMMED. That is correct only if the plate is genuinely several separate "
                "wings. If these are rooms, bays or a hatch pattern, the perimeter is "
                "far too large and every facade and daylight result downstream will be "
                "flattered. Pass layer_name= to isolate the floor outline."
            )
        if self.curve_count == 2:
            return (
                "Two closed curves measured — read as an outline plus a courtyard or "
                "atrium void. Confirm that is what they are; the void's edge counts as "
                "facade, which is usually right but occasionally very wrong."
            )
        return None

    @property
    def inferred_vs_measured_note(self) -> str:
        half = self.perimeter_m / 2.0
        discriminant = half * half - 4.0 * self.area_m2
        if discriminant < 0:
            return (
                "No rectangle has this area and perimeter — the plate is more "
                "convoluted than the engine's fallback assumes. Measured values "
                "should be used from here on."
            )
        root = math.sqrt(discriminant)
        width, depth = (half + root) / 2.0, (half - root) / 2.0
        return (
            f"Equivalent rectangle {width:.1f} x {depth:.1f} m "
            f"(bounding box {self.bounding_width_m:.1f} x {self.bounding_depth_m:.1f} m, "
            f"compactness {self.compactness:.2f})."
        )

    def as_shell_patch(self) -> dict:
        """The fields to paste into data/building/marievik_shell.json."""
        return {
            "structure": {"gross_floor_area_per_storey_m2": round(self.area_m2, 1)},
            "envelope": {"facade_perimeter_m_per_storey": round(self.perimeter_m, 1)},
            "_measured_from": self.source,
        }


def read_plate_from_3dm(path: str | Path, layer_name: str | None = None) -> MeasuredPlate:
    """Measure the floor plate from closed curves in a Rhino file.

    Put the floor outline on its own layer (default: any closed planar
    curve is considered). Units are assumed to be metres; if the model is
    in millimetres the numbers will be obviously wrong by 10^6 in area,
    which is easier to notice than a silent unit conversion.
    """
    if not RHINO_AVAILABLE:
        raise RuntimeError("rhino3dm is not installed: pip install rhino3dm")

    path = Path(path)
    model = rhino3dm.File3dm.Read(str(path))
    if model is None:
        raise ValueError(f"Could not read {path}")

    layer_index = None
    if layer_name:
        for index, layer in enumerate(model.Layers):
            if layer.Name.lower() == layer_name.lower():
                layer_index = index
                break
        if layer_index is None:
            available = ", ".join(layer.Name for layer in model.Layers)
            raise ValueError(f"No layer named {layer_name!r}. Available: {available}")

    total_area = 0.0
    total_perimeter = 0.0
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    count = 0

    for obj in model.Objects:
        geometry = obj.Geometry
        if not isinstance(geometry, rhino3dm.Curve):
            continue
        if layer_index is not None and obj.Attributes.LayerIndex != layer_index:
            continue
        if not geometry.IsClosed:
            continue

        points = _sample_curve(geometry)
        if len(points) < 3:
            continue

        total_area += abs(_shoelace_area(points))
        total_perimeter += _polyline_length(points)
        for x, y in points:
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
        count += 1

    if count == 0:
        raise ValueError(
            f"No closed curves found in {path.name}"
            + (f" on layer {layer_name!r}" if layer_name else "")
            + ". The floor outline must be a closed planar curve."
        )

    return MeasuredPlate(
        area_m2=total_area,
        perimeter_m=total_perimeter,
        bounding_width_m=max_x - min_x,
        bounding_depth_m=max_y - min_y,
        curve_count=count,
        source=path.name,
    )


def _sample_curve(curve, divisions: int = 200) -> list[tuple[float, float]]:
    """Flatten any curve to a 2D polyline by sampling its domain."""
    domain = curve.Domain
    points: list[tuple[float, float]] = []
    for i in range(divisions + 1):
        t = domain.T0 + (domain.T1 - domain.T0) * i / divisions
        point = curve.PointAt(t)
        points.append((point.X, point.Y))
    return points


def _shoelace_area(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += x0 * y1 - x1 * y0
    return total / 2.0


def _polyline_length(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += math.hypot(x1 - x0, y1 - y0)
    return total


def read_plate_from_ifc(path: str | Path) -> MeasuredPlate:
    """Measure a plate from an IFC model. Requires ifcopenshell."""
    if not IFC_AVAILABLE:
        raise RuntimeError(IFC_INSTALL_HINT)
    raise NotImplementedError(
        "IFC import is stubbed pending ifcopenshell. When enabled it should read "
        "IfcSlab and IfcSpace footprints per IfcBuildingStorey, which also gives "
        "the existing room schedule — a far better RETAIN inventory than a floor "
        "outline alone."
    )


# ---------------------------------------------------------------------------
# Export: layout -> CAD
# ---------------------------------------------------------------------------


def export_layout_3dm(
    result: layout_module.Layout,
    path: str | Path,
    elevation_m: float = 0.0,
) -> Path:
    """Write a generated layout to a Rhino file.

    Layers:
        Zone_<space_id>   closed rectangle per bay, one layer per programme zone
        Partitions        lines where two different zones meet — the quantity
                          that becomes cost and carbon
        Core              the fixed core
        Labels            text dots naming each zone
    """
    if not RHINO_AVAILABLE:
        raise RuntimeError("rhino3dm is not installed: pip install rhino3dm")

    path = Path(path)
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    layer_indices: dict[str, int] = {}

    def ensure_layer(name: str, colour: tuple[int, int, int]) -> int:
        if name in layer_indices:
            return layer_indices[name]
        layer = rhino3dm.Layer()
        layer.Name = name
        layer.Color = (*colour, 255)
        layer_indices[name] = model.Layers.Add(layer)
        return layer_indices[name]

    palette = [
        (198, 74, 60), (76, 132, 196), (92, 160, 106), (214, 152, 58),
        (140, 104, 182), (86, 166, 166), (196, 106, 150), (120, 124, 132),
    ]

    # Bay rectangles, grouped onto a layer per zone.
    for index, bay in enumerate(result.grid):
        x0 = sum(b.width_m for b in result.grid[:bay.col] if b.row == 0)
        y0 = sum(
            result.grid[r * result.n_cols].depth_m for r in range(bay.row)
        )
        x1, y1 = x0 + bay.width_m, y0 + bay.depth_m

        if bay.is_core:
            layer_index = ensure_layer("Core", (60, 60, 60))
            label = "CORE"
        else:
            space_id = result.assignment[index]
            zone_order = sorted(result.zones)
            colour = palette[zone_order.index(space_id) % len(palette)]
            layer_index = ensure_layer(f"Zone_{space_id}", colour)
            label = space_id

        corners = [
            rhino3dm.Point3d(x0, y0, elevation_m),
            rhino3dm.Point3d(x1, y0, elevation_m),
            rhino3dm.Point3d(x1, y1, elevation_m),
            rhino3dm.Point3d(x0, y1, elevation_m),
            rhino3dm.Point3d(x0, y0, elevation_m),
        ]
        attributes = rhino3dm.ObjectAttributes()
        attributes.LayerIndex = layer_index
        attributes.Name = label
        model.Objects.AddPolyline(corners, attributes)

    # Partition lines — where two different zones meet.
    partition_layer = ensure_layer("Partitions", (220, 40, 40))
    drawn: set[tuple[int, int]] = set()
    for index, label in enumerate(result.assignment):
        if label is None or result.grid[index].is_core:
            continue
        bay = result.grid[index]
        for other, _edge in result.neighbours(index):
            pair = (min(index, other), max(index, other))
            if pair in drawn:
                continue
            drawn.add(pair)
            other_label = result.assignment[other]
            if other_label is None or other_label == label:
                continue

            other_bay = result.grid[other]
            x0 = sum(b.width_m for b in result.grid[:bay.col] if b.row == 0)
            y0 = sum(result.grid[r * result.n_cols].depth_m for r in range(bay.row))

            if other_bay.col != bay.col:  # vertical shared edge
                x = x0 + (bay.width_m if other_bay.col > bay.col else 0.0)
                start = rhino3dm.Point3d(x, y0, elevation_m)
                end = rhino3dm.Point3d(x, y0 + bay.depth_m, elevation_m)
            else:  # horizontal shared edge
                y = y0 + (bay.depth_m if other_bay.row > bay.row else 0.0)
                start = rhino3dm.Point3d(x0, y, elevation_m)
                end = rhino3dm.Point3d(x0 + bay.width_m, y, elevation_m)

            attributes = rhino3dm.ObjectAttributes()
            attributes.LayerIndex = partition_layer
            model.Objects.AddLine(start, end, attributes)

    model.Write(str(path), 7)
    return path


def export_layout_csv(result: layout_module.Layout, path: str | Path) -> Path:
    """Bay table for Grasshopper, or anything else that reads CSV.

    Deliberately flat and dumb: one row per bay, absolute coordinates, no
    nesting. Grasshopper's CSV reading is awkward enough without structure.
    """
    path = Path(path)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "bay_index", "col", "row", "x_m", "y_m",
            "width_m", "depth_m", "area_m2",
            "zone_id", "zone_label", "has_facade", "is_core", "daylight_required",
        ])
        for index, bay in enumerate(result.grid):
            x = sum(b.width_m for b in result.grid[:bay.col] if b.row == 0)
            y = sum(result.grid[r * result.n_cols].depth_m for r in range(bay.row))
            zone_id = result.assignment[index] or ""
            zone = result.zones.get(zone_id)
            writer.writerow([
                index, bay.col, bay.row, round(x, 3), round(y, 3),
                round(bay.width_m, 3), round(bay.depth_m, 3), round(bay.area_m2, 2),
                zone_id, zone.label if zone else "",
                int(bay.has_facade), int(bay.is_core),
                int(zone.daylight_required) if zone else 0,
            ])
    return path


def export_all(program_id: str, out_dir: str | Path | None = None) -> dict[str, Path]:
    """Generate a layout and write every export format."""
    out_dir = Path(out_dir or (loader.ROOT / "runs" / "cad"))
    out_dir.mkdir(parents=True, exist_ok=True)

    result = layout_module.generate(program_id)
    written: dict[str, Path] = {}

    written["csv"] = export_layout_csv(result, out_dir / f"{program_id}_bays.csv")
    if RHINO_AVAILABLE:
        written["3dm"] = export_layout_3dm(result, out_dir / f"{program_id}_layout.3dm")
    return written
