"""Parametric layout — allocate the floor plate to a use programme.

Deliberately coarse. The unit of allocation is the structural bay, not the
room, because in adaptive reuse the grid is fixed and the grid is what
decides everything. A bay-resolution layout answers the questions that
matter at this stage — does the daylight work, how much partition does this
programme need, which zones can go deep — without pretending to a precision
the input data cannot support.

The output that matters is not the picture. It is `partition_length_m`,
which becomes the bill of quantities, which becomes cost and carbon. That
chain is the point: a layout that cannot be costed is a drawing, not a model.

Method: greedy seed, then simulated annealing on bay swaps.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from . import loader

# Penalty weights. These encode design priorities, so they are the honest
# place to argue about what "good" means — change them and say you did.
W_NO_DAYLIGHT = 120.0      # a daylight-requiring space with no facade
W_WASTED_FACADE = 12.0     # a windowless space occupying a perimeter bay
W_FRAGMENTED = 28.0        # a zone split into disconnected pieces
W_PARTITION = 1.4          # per metre of internal partition
W_AREA_ERROR = 3.0         # per m² away from the target area


@dataclass
class Bay:
    col: int
    row: int
    width_m: float
    depth_m: float
    has_facade: bool
    is_core: bool = False

    @property
    def area_m2(self) -> float:
        return self.width_m * self.depth_m


@dataclass
class Zone:
    """One space unit's demand, expressed in bays."""

    space_id: str
    label: str
    target_area_m2: float
    daylight_required: bool
    room_area_m2: float | None = None  # for intra-zone subdivision
    bays: list[int] = field(default_factory=list)


@dataclass
class Layout:
    program_id: str
    grid: list[Bay]
    n_cols: int
    n_rows: int
    assignment: list[str | None]
    zones: dict[str, Zone]
    clear_height_m: float
    score: float = 0.0

    # --- geometry ------------------------------------------------------

    def _index(self, col: int, row: int) -> int:
        return row * self.n_cols + col

    def neighbours(self, index: int) -> list[tuple[int, float]]:
        """Adjacent bay indices and the length of the shared edge."""
        bay = self.grid[index]
        out: list[tuple[int, float]] = []
        if bay.col > 0:
            out.append((self._index(bay.col - 1, bay.row), bay.depth_m))
        if bay.col < self.n_cols - 1:
            out.append((self._index(bay.col + 1, bay.row), bay.depth_m))
        if bay.row > 0:
            out.append((self._index(bay.col, bay.row - 1), bay.width_m))
        if bay.row < self.n_rows - 1:
            out.append((self._index(bay.col, bay.row + 1), bay.width_m))
        return out

    @property
    def partition_length_m(self) -> float:
        """Total internal partition: between zones, plus within them."""
        between = 0.0
        seen: set[tuple[int, int]] = set()
        for index, label in enumerate(self.assignment):
            if label is None:
                continue
            for other, edge in self.neighbours(index):
                pair = (min(index, other), max(index, other))
                if pair in seen:
                    continue
                seen.add(pair)
                other_label = self.assignment[other]
                if other_label is not None and other_label != label:
                    between += edge

        # Subdivision inside a zone — care apartments, student rooms.
        # Approximated as rooms laid out square, walls shared between
        # neighbours, so half the perimeter is counted per room.
        within = 0.0
        for zone in self.zones.values():
            if not zone.room_area_m2 or not zone.bays:
                continue
            zone_area = sum(self.grid[i].area_m2 for i in zone.bays)
            rooms = zone_area / zone.room_area_m2
            room_side = math.sqrt(zone.room_area_m2)
            within += rooms * room_side * 2.0  # half of a 4-sided perimeter

        return between + within

    @property
    def partition_area_m2(self) -> float:
        return self.partition_length_m * self.clear_height_m

    def zone_area(self, space_id: str) -> float:
        return sum(self.grid[i].area_m2 for i in self.zones[space_id].bays)

    # --- scoring -------------------------------------------------------

    def evaluate(self) -> float:
        penalty = 0.0

        # Rebuild zone membership from the assignment.
        for zone in self.zones.values():
            zone.bays = []
        for index, label in enumerate(self.assignment):
            if label is not None:
                self.zones[label].bays.append(index)

        for zone in self.zones.values():
            area = sum(self.grid[i].area_m2 for i in zone.bays)
            penalty += W_AREA_ERROR * abs(area - zone.target_area_m2)

            for index in zone.bays:
                bay = self.grid[index]
                if zone.daylight_required and not bay.has_facade:
                    penalty += W_NO_DAYLIGHT * bay.area_m2 / 50.0
                if not zone.daylight_required and bay.has_facade:
                    penalty += W_WASTED_FACADE * bay.area_m2 / 50.0

            penalty += W_FRAGMENTED * max(0, self._island_count(zone.bays) - 1)

        penalty += W_PARTITION * self.partition_length_m
        self.score = penalty
        return penalty

    def _island_count(self, bays: list[int]) -> int:
        """How many disconnected pieces this zone is in."""
        remaining = set(bays)
        islands = 0
        while remaining:
            islands += 1
            stack = [remaining.pop()]
            while stack:
                current = stack.pop()
                for neighbour, _edge in self.neighbours(current):
                    if neighbour in remaining:
                        remaining.discard(neighbour)
                        stack.append(neighbour)
        return islands

    # --- output --------------------------------------------------------

    def to_ascii(self) -> str:
        """A readable plan. Rows run front (facade) to back."""
        symbols: dict[str, str] = {}
        for i, space_id in enumerate(sorted(self.zones)):
            symbols[space_id] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24]

        lines = []
        for row in range(self.n_rows):
            cells = []
            for col in range(self.n_cols):
                index = self._index(col, row)
                if self.grid[index].is_core:
                    cells.append(" ## ")
                else:
                    label = self.assignment[index]
                    cells.append(f" {symbols[label]}  " if label else " .. ")
            lines.append("|" + "|".join(cells) + "|")

        divider = "+" + "+".join(["----"] * self.n_cols) + "+"
        plan = divider + "\n" + ("\n" + divider + "\n").join(lines) + "\n" + divider

        legend = ["", "  ## = core / stairs / lifts     .. = unassigned", ""]
        for space_id in sorted(self.zones):
            zone = self.zones[space_id]
            actual = self.zone_area(space_id)
            delta = actual - zone.target_area_m2
            legend.append(
                f"  {symbols[space_id]} = {zone.label[:36]:<38}"
                f"{actual:>7.0f} m² (target {zone.target_area_m2:.0f}, "
                f"{delta:+.0f})"
                + ("  [needs daylight]" if zone.daylight_required else "")
            )
        return plan + "\n" + "\n".join(legend)


# ---------------------------------------------------------------------------
# Building a layout
# ---------------------------------------------------------------------------


def build_grid(shell: dict | None = None) -> tuple[list[Bay], int, int, float]:
    """Derive the bay grid from the shell's structural grid and plate size."""
    data = shell or loader.shell()
    structure = data["structure"]
    envelope = data["envelope"]

    area = structure["gross_floor_area_per_storey_m2"]
    perimeter = envelope["facade_perimeter_m_per_storey"]

    half = perimeter / 2.0
    discriminant = half * half - 4.0 * area
    if discriminant < 0:
        width = depth = math.sqrt(area)
    else:
        root = math.sqrt(discriminant)
        width, depth = (half + root) / 2.0, (half - root) / 2.0

    grid_m = structure["grid_x_mm"] / 1000.0
    n_cols = max(1, round(width / grid_m))
    n_rows = max(1, round(depth / grid_m))
    bay_w = width / n_cols
    bay_d = depth / n_rows

    core_position = data["core_and_circulation"]["cores"][0]["position_mm"]
    core_col = min(n_cols - 1, int(core_position[0] / 1000.0 / bay_w))
    core_row = min(n_rows - 1, int(core_position[1] / 1000.0 / bay_d))

    bays: list[Bay] = []
    for row in range(n_rows):
        for col in range(n_cols):
            on_perimeter = col in (0, n_cols - 1) or row in (0, n_rows - 1)
            bays.append(Bay(
                col=col,
                row=row,
                width_m=bay_w,
                depth_m=bay_d,
                has_facade=on_perimeter,
                is_core=(col == core_col and row == core_row),
            ))

    clear_height = structure["clear_height_under_services_mm"] / 1000.0
    return bays, n_cols, n_rows, clear_height


def _zones_for_program(program: dict, available_area: float) -> dict[str, Zone]:
    """Turn a use programme into area demands scaled to the plate."""
    raw: list[tuple[str, str, float, bool, float | None]] = []

    for space in program["space_units"]:
        if space.get("location") == "outdoor":
            continue
        daylight = bool(space.get("daylight_required", False))
        room_area = space.get("area_m2") if space.get("count_rule") == "per_resident" else None

        # Relative weight — actual areas are normalised to the plate below.
        if "area_factor_of_net" in space:
            weight = space["area_factor_of_net"] * 100.0
        elif "area_factor_of_hall" in space:
            weight = space["area_factor_of_hall"] * 100.0
        elif "area_m2_per_child" in space:
            weight = space["area_m2_per_child"] * 10.0
        elif "area_m2_per_resident" in space:
            weight = space["area_m2_per_resident"] * 10.0
        elif "area_m2_per_workplace" in space:
            weight = space["area_m2_per_workplace"] * 10.0
        elif "area_m2_per_person" in space:
            weight = space["area_m2_per_person"] * 30.0
        elif "area_m2" in space:
            weight = space["area_m2"]
        else:
            weight = 40.0

        raw.append((space["id"], space.get("label", space["id"]), weight, daylight, room_area))

    total_weight = sum(item[2] for item in raw) or 1.0
    return {
        space_id: Zone(
            space_id=space_id,
            label=label,
            target_area_m2=available_area * weight / total_weight,
            daylight_required=daylight,
            room_area_m2=room_area,
        )
        for space_id, label, weight, daylight, room_area in raw
    }


def generate(
    program_id: str,
    iterations: int = 12000,
    seed: int = 7,
) -> Layout:
    """Generate a bay layout for one use programme."""
    rng = random.Random(seed)
    program = loader.use_programs()[program_id]
    bays, n_cols, n_rows, clear_height = build_grid()

    usable = [i for i, bay in enumerate(bays) if not bay.is_core]
    available_area = sum(bays[i].area_m2 for i in usable)
    zones = _zones_for_program(program, available_area)

    # --- Greedy seed: daylight-hungry zones take perimeter bays first ---
    assignment: list[str | None] = [None] * len(bays)
    order = sorted(
        zones.values(),
        key=lambda z: (not z.daylight_required, -z.target_area_m2),
    )
    perimeter = [i for i in usable if bays[i].has_facade]
    interior = [i for i in usable if not bays[i].has_facade]

    for zone in order:
        pool = (perimeter + interior) if zone.daylight_required else (interior + perimeter)
        needed = zone.target_area_m2
        taken = 0.0
        for index in list(pool):
            if assignment[index] is not None:
                continue
            if taken >= needed and taken > 0:
                break
            assignment[index] = zone.space_id
            taken += bays[index].area_m2

    # Anything left over joins a neighbouring zone.
    for index in usable:
        if assignment[index] is None:
            options = [assignment[n] for n, _e in _static_neighbours(index, n_cols, n_rows)]
            options = [o for o in options if o]
            assignment[index] = options[0] if options else order[0].space_id

    # Guarantee every zone at least one bay. A programme element allocated
    # zero area has not been optimised away — it has been forgotten, and
    # it will reappear as a problem on site. Take from whoever is most
    # over target.
    for zone in zones.values():
        if zone.space_id in assignment:
            continue
        areas = {
            z.space_id: sum(bays[i].area_m2 for i, a in enumerate(assignment) if a == z.space_id)
            for z in zones.values()
        }
        donor = max(
            zones.values(),
            key=lambda z: areas.get(z.space_id, 0.0) - z.target_area_m2,
        )
        donor_bays = [i for i, a in enumerate(assignment) if a == donor.space_id]
        if len(donor_bays) > 1:
            assignment[donor_bays[-1]] = zone.space_id

    layout = Layout(
        program_id=program_id,
        grid=bays,
        n_cols=n_cols,
        n_rows=n_rows,
        assignment=assignment,
        zones=zones,
        clear_height_m=clear_height,
    )

    # --- Simulated annealing on bay swaps -------------------------------
    current = layout.evaluate()
    best_assignment = list(assignment)
    best = current

    for step in range(iterations):
        temperature = max(0.01, 40.0 * (1.0 - step / iterations))
        a, b = rng.sample(usable, 2)
        if layout.assignment[a] == layout.assignment[b]:
            continue

        # A swap exchanges two labels, so zone bay-counts are preserved
        # throughout annealing. Only the greedy seed can starve a zone,
        # which is why the guarantee above sits there and not here.
        layout.assignment[a], layout.assignment[b] = layout.assignment[b], layout.assignment[a]
        candidate = layout.evaluate()
        delta = candidate - current

        if delta < 0 or rng.random() < math.exp(-delta / temperature):
            current = candidate
            if candidate < best:
                best = candidate
                best_assignment = list(layout.assignment)
        else:
            layout.assignment[a], layout.assignment[b] = (
                layout.assignment[b],
                layout.assignment[a],
            )

    layout.assignment = best_assignment
    layout.evaluate()
    return layout


def _static_neighbours(index: int, n_cols: int, n_rows: int) -> list[tuple[int, float]]:
    col, row = index % n_cols, index // n_cols
    out = []
    if col > 0:
        out.append((index - 1, 1.0))
    if col < n_cols - 1:
        out.append((index + 1, 1.0))
    if row > 0:
        out.append((index - n_cols, 1.0))
    if row < n_rows - 1:
        out.append((index + n_cols, 1.0))
    return out


def bill_from_layout(layout: Layout, partition_component: str) -> dict[str, float]:
    """Turn a layout into a bill of quantities the evaluator can price.

    This is the join between the two halves of the lab: geometry becomes
    quantity becomes cost and carbon. Until this function exists, a layout
    is only a picture.
    """
    floor_area = sum(bay.area_m2 for bay in layout.grid if not bay.is_core)
    return {
        partition_component: round(layout.partition_area_m2, 1),
        "floor.linoleum.2.5": round(floor_area, 1),
        "ceiling.acoustic.baffle": round(floor_area * 0.4, 1),
    }
