"""Use briefs: what each use needs from one apartment shell.

A brief is the input to the generator. It says how many people the use can
put in the shell, which rooms they need, what furniture each room must hold
and which user group the standards engine should check it against. It does
not say where anything goes; that is the generator's job.

Occupancy is a design variable, not a given. Two students or one, four desks
or eight: the same shell at different densities is a different option, and
"number of people per space" is one of the results the report compares.

Everything here is PLACEHOLDER brief-writing, deliberately explicit so it
can be argued with. Change a number here and every option downstream moves.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Cell:
    """An enclosed room against the facade."""

    kind: str                      # bedroom | care_room | meeting | focus
    widths: tuple[int, ...]        # candidate clear widths, mm
    items: tuple[str, ...]         # furniture types placed inside it
    label: str = ""


@dataclass(frozen=True)
class Density:
    """One occupancy level of a use, with the rooms it implies."""

    occupants: int
    user_group: str
    # Alternative room programmes for this density. Each is a tuple of cells;
    # an empty tuple means everything happens in one open space.
    cell_sets: tuple[tuple[Cell, ...], ...]
    living_items: tuple[str, ...]
    wet_items: tuple[str, ...] = ()
    label: str = ""


@dataclass(frozen=True)
class Brief:
    id: str
    label: str
    thermal_profile: str           # home | care | office (see thermal_sim)
    target_area_m2: float          # floor area per person that counts as adequate
    needs_beds: bool
    densities: tuple[Density, ...]
    hot_water_kwh_m2: float        # added to simulated space heating
    notes: str = ""
    # What the functionality score checks, beyond counts.
    separate_sleeping: bool = True
    seated_view_matters: bool = False
    meeting_room_from: int = 0     # office: enclosed meeting room needed at >= this many desks


WET_BASE = ("shower.900", "basin.600", "wc.pan")

_single = Cell("bedroom", (2600, 2900, 3200), ("bed.single.900", "wardrobe.1000", "desk.1200"), "Bedroom")
_double = Cell("bedroom", (3000, 3300, 3600), ("bed.double.1600", "wardrobe.1000", "wardrobe.1000"), "Main bedroom")
_kids_bunk = Cell("bedroom", (2600, 2900, 3200), ("bed.bunk.900", "wardrobe.1000", "desk.child.1000"), "Children")
_kid = Cell("bedroom", (2400, 2600, 2900), ("bed.single.900", "wardrobe.1000", "desk.child.1000"), "Child")
_senior = Cell("bedroom", (3000, 3300, 3600), ("bed.single.900", "wardrobe.1000", "space.rollator"), "Bedroom")
_senior_two = Cell("bedroom", (3300, 3600), ("bed.double.1600", "wardrobe.1000", "wardrobe.1000"), "Bedroom")
_care = Cell("care_room", (3600, 3900), ("bed.care.profiling", "wardrobe.1000"), "Care room")
_meeting = Cell("meeting", (2600, 3000), ("table.meeting.2000",), "Meeting")
_focus = Cell("focus", (2000, 2400), ("desk.office.1400",), "Focus room")


BRIEFS: dict[str, Brief] = {
    "student_housing": Brief(
        id="student_housing",
        label="Student housing",
        thermal_profile="home",
        target_area_m2=20.0,
        needs_beds=True,
        hot_water_kwh_m2=25.0,
        densities=(
            Density(
                1, "adult",
                cell_sets=((), (_single,)),
                living_items=("sofa.2seat", "table.dining.1200", "chair.dining", "chair.dining",
                              "kitchen.kitchenette.1200", "fridge.600", "shelf.800"),
                wet_items=WET_BASE,
                label="Single student",
            ),
            Density(
                2, "adult",
                cell_sets=((_single, _single),),
                living_items=("sofa.2seat", "table.dining.1200", "chair.dining", "chair.dining",
                              "kitchen.run.2400", "fridge.600"),
                wet_items=WET_BASE + ("washer.600",),
                label="Two students sharing",
            ),
            Density(
                3, "adult",
                cell_sets=((_single, _single, _single),),
                living_items=("table.dining.1200", "chair.dining", "chair.dining", "chair.dining",
                              "kitchen.run.2400", "fridge.600"),
                wet_items=WET_BASE + ("washer.600",),
                label="Three students sharing",
            ),
        ),
        notes="Private room per student is the norm; a studio is cheaper per bed but scores no acoustic privacy.",
    ),
    "elderly_care": Brief(
        id="elderly_care",
        label="Senior / elderly housing",
        thermal_profile="care",
        target_area_m2=32.0,
        needs_beds=True,
        hot_water_kwh_m2=30.0,
        seated_view_matters=True,
        densities=(
            Density(
                1, "older_adult_rollator",
                cell_sets=((), (_senior,)),
                living_items=("armchair.800", "sofa.2seat", "table.dining.1200", "chair.dining", "chair.dining",
                              "kitchen.run.2400", "fridge.600", "space.rollator"),
                wet_items=WET_BASE + ("washer.600",),
                label="Senior, independent",
            ),
            Density(
                2, "older_adult_rollator",
                cell_sets=((_senior_two,), (_senior, _senior)),
                living_items=("armchair.800", "sofa.2seat", "table.dining.1200", "chair.dining", "chair.dining",
                              "kitchen.run.2400", "fridge.600"),
                wet_items=WET_BASE + ("washer.600",),
                label="Senior couple",
            ),
            Density(
                1, "care_resident_assisted",
                cell_sets=((_care,),),
                living_items=("armchair.800", "table.dining.1200", "chair.dining", "chair.dining",
                              "kitchen.kitchenette.1200", "fridge.600"),
                wet_items=WET_BASE,
                label="Care resident with staff support",
            ),
        ),
        notes="Rollator users need 1500 mm turning; a care resident with a hoist needs 1800 mm and 900 mm working space at the bed.",
    ),
    "office_flexible": Brief(
        id="office_flexible",
        label="Office / co-working",
        thermal_profile="office",
        target_area_m2=10.0,
        needs_beds=False,
        hot_water_kwh_m2=3.0,
        separate_sleeping=False,
        meeting_room_from=6,
        densities=(
            Density(
                4, "adult",
                cell_sets=((), (_meeting,), (_focus,)),
                living_items=("desk.office.1400",) * 4 + ("storage.cabinet.1200", "lockers.900",
                              "kitchen.kitchenette.1200", "fridge.600", "sofa.2seat"),
                wet_items=WET_BASE,
                label="Four workplaces",
            ),
            Density(
                6, "adult",
                cell_sets=((), (_meeting,), (_meeting, _focus)),
                living_items=("desk.office.1400",) * 6 + ("storage.cabinet.1200", "lockers.900", "lockers.900",
                              "kitchen.kitchenette.1200", "fridge.600"),
                wet_items=WET_BASE,
                label="Six workplaces",
            ),
            Density(
                8, "adult",
                cell_sets=((), (_meeting,)),
                living_items=("desk.office.1400",) * 8 + ("storage.cabinet.1200", "lockers.900", "lockers.900",
                              "lockers.900", "kitchen.kitchenette.1200", "fridge.600"),
                wet_items=WET_BASE,
                label="Eight workplaces",
            ),
        ),
        notes="Desks need daylight and a meeting room needs a door; the generator decides whether there is room for both.",
    ),
    "family_housing": Brief(
        id="family_housing",
        label="Family apartment",
        thermal_profile="home",
        target_area_m2=15.0,
        needs_beds=True,
        hot_water_kwh_m2=25.0,
        densities=(
            Density(
                3, "adult",
                cell_sets=((_double, _kid),),
                living_items=("sofa.3seat", "table.dining.1200", "chair.dining", "chair.dining", "chair.dining",
                              "kitchen.run.2400", "fridge.600", "storage.cabinet.1200"),
                wet_items=WET_BASE + ("washer.600",),
                label="Two adults, one child",
            ),
            Density(
                4, "adult",
                cell_sets=((_double, _kids_bunk), (_double, _kid, _kid)),
                living_items=("sofa.3seat", "table.dining.1800", "kitchen.run.2400", "fridge.600",
                              "storage.cabinet.1200"),
                wet_items=WET_BASE + ("washer.600",),
                label="Two adults, two children",
            ),
        ),
        notes="Parents separated from children; a bunk bed buys a room back at the cost of the children sharing.",
    ),
}


def brief(use_id: str) -> Brief:
    return BRIEFS[use_id]
