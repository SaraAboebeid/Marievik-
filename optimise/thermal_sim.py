"""Thermal comfort by EnergyPlus, one apartment layout per case.

Runs in the simulation venv, not the engine's interpreter:

    .venv-sim\\Scripts\\python.exe optimise\\thermal_sim.py cases.json results.json

It is a separate process on purpose. Honeybee and EnergyPlus are heavy, the
engine does not need them to cost a plan, and keeping them apart means a
broken simulation install can never stop the rest of the model from running.
`optimise.thermal` is the side that writes the cases and reads the answers.

What is modelled, and the positions taken:

  - One thermal zone per room of the plan, from the room rectangles the
    scheme generator drew. Partitions are real interzone surfaces, so a
    bedroom against the facade and a hall behind it behave differently.
  - Only the facade is exposed. Party walls, the corridor wall, floor and
    ceiling are adiabatic: neighbours are heated to the same temperature.
    That is the standard mid-floor, mid-plan assumption and it is stated
    rather than hidden, because a corner or top-floor unit would differ.
  - The 1985 envelope as surveyed (placeholders): wall U 0.45, fixed double
    glazing U 2.8. The upgrade case is triple glazing U 0.9 with openable
    sashes, which is what makes purge ventilation possible at all.
  - Heavy concrete slabs above and below. Exposed thermal mass is most of
    what keeps a free-running flat out of overheating, so it is modelled.
  - Dwellings and care are free-running in summer (no cooling, as built in
    Sweden). Office has cooling at 26 C, because Swedish offices do, and its
    cooling energy is reported instead of being disguised as comfort.

Comfort is judged by the adaptive model of EN 16798-1, category II, over
occupied hours only. Hours nobody is home do not count either way.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EPW = ROOT / "data" / "climate" / "SWE_ST_Stockholm.024850_TMYx.2011-2025.epw"
DDY = EPW.with_suffix(".ddy")


def _weather(case: dict) -> tuple[Path, Path]:
    """The case's weather file (by name, in data/climate), Stockholm by default."""
    name = case.get("epw")
    epw = EPW.parent / name if name else EPW
    return epw, epw.with_suffix(".ddy")


def _envelopes(case: dict) -> dict:
    """Glazing options, with the shell's own description of what exists."""
    out = {k: dict(v) for k, v in ENVELOPES.items()}
    out["existing"].update(case.get("existing_glazing") or {})
    return out
CASE_TIMEOUT_S = 300  # a normal case takes 3-10 s


# ---------------------------------------------------------------------------
# Use profiles. Internal gains and schedules per use, PLACEHOLDER but sourced
# in spirit from Sveby brukarindata (residential) and EN 16798-1 annex (office).
# ---------------------------------------------------------------------------

def _hours(on: list[tuple[int, int, float]], base: float = 0.0) -> list[float]:
    values = [base] * 24
    for start, end, value in on:
        for h in range(start, end):
            values[h] = value
    return values


PROFILES = {
    "home": {
        # Home evenings and nights, partly by day.
        "occupancy": _hours([(0, 7, 1.0), (7, 9, 0.5), (9, 16, 0.25), (16, 18, 0.6), (18, 24, 0.9)]),
        "occupancy_weekend": _hours([(0, 10, 1.0), (10, 18, 0.5), (18, 24, 0.9)]),
        # Lights and appliances are an evening load, not a sleeping one.
        "gains": _hours([(6, 8, 0.6), (17, 23, 0.8)], base=0.1),
        "gains_weekend": _hours([(8, 23, 0.5), (17, 23, 0.8)], base=0.1),
        "lighting_w_m2": 4.0, "equipment_w_m2": 3.5,
        "heating_c": 21.0, "cooling_c": None,
    },
    "care": {
        # A care resident is home all day; staff visits add to the gains.
        "occupancy": _hours([(0, 24, 1.0)]),
        "occupancy_weekend": _hours([(0, 24, 1.0)]),
        "gains": _hours([(7, 21, 0.7)], base=0.1),
        "gains_weekend": _hours([(7, 21, 0.7)], base=0.1),
        "lighting_w_m2": 5.0, "equipment_w_m2": 4.5,
        "heating_c": 22.0, "cooling_c": None,
    },
    "office": {
        "occupancy": _hours([(8, 12, 0.9), (12, 13, 0.5), (13, 17, 0.9)]),
        "occupancy_weekend": _hours([]),
        "gains": _hours([(7, 18, 0.9)], base=0.1),
        "gains_weekend": _hours([], base=0.1),
        "lighting_w_m2": 7.0, "equipment_w_m2": 10.0,
        "heating_c": 21.0, "cooling_c": 26.0,
    },
}

# Swedish heating season. With openable windows and heating left on all
# year, the model opens the window at 24 C and then reheats the room to
# 21 C — 170 kWh of summer heating in a bedroom, which nobody's system does.
HEATING_OFF = ((5, 15), (9, 15))

ENVELOPES = {
    "existing": {"window_u": 2.8, "window_g": 0.70, "window_vt": 0.75, "openable": False},
    "upgraded": {"window_u": 0.9, "window_g": 0.45, "window_vt": 0.65, "openable": True},
}


# ---------------------------------------------------------------------------
# Model construction
# ---------------------------------------------------------------------------


def _constructions(envelope: str, env: dict | None = None):
    from honeybee_energy.construction.opaque import OpaqueConstruction
    from honeybee_energy.construction.window import WindowConstruction
    from honeybee_energy.construction.windowshade import WindowConstructionShade
    from honeybee_energy.constructionset import ConstructionSet
    from honeybee_energy.material.glazing import EnergyWindowMaterialSimpleGlazSys
    from honeybee_energy.material.shade import EnergyWindowMaterialBlind
    from honeybee_energy.material.opaque import EnergyMaterial

    env = env or ENVELOPES[envelope]
    concrete = EnergyMaterial("Concrete 150", 0.15, 1.7, 2300, 880)
    slab = EnergyMaterial("Slab 280", 0.28, 1.7, 2300, 880)
    # Insulation thickness chosen to land the 1985 sandwich panel on U 0.45.
    insulation = EnergyMaterial("Mineral wool 1985", 0.072, 0.036, 30, 840)
    plaster = EnergyMaterial("Plaster 15", 0.015, 0.5, 1300, 1000)
    gypsum = EnergyMaterial("Gypsum 25", 0.025, 0.25, 900, 1000)
    stud_air = EnergyMaterial("Stud cavity 95", 0.095, 0.045, 20, 840)

    wall = OpaqueConstruction("Precast sandwich 1985", [concrete, insulation, concrete, plaster])
    floor = OpaqueConstruction("Concrete slab", [slab])
    partition = OpaqueConstruction("Light partition", [gypsum, stud_air, gypsum])
    glass = EnergyWindowMaterialSimpleGlazSys(
        f"Glazing {envelope}", env["window_u"], env["window_g"], env["window_vt"]
    )
    window = WindowConstruction(f"Window {envelope}", [glass])
    # Interior venetian blinds, drawn when sun on the glass exceeds 200 W/m².
    # Every 1985 office had them and every dwelling gets curtains; leaving
    # them out reports 45 C bedrooms that no occupant would actually tolerate.
    blind = EnergyWindowMaterialBlind(f"Interior blind {envelope}")
    shaded = WindowConstructionShade(
        f"Window {envelope} with blind", window, blind,
        shade_location="Interior", control_type="OnIfHighSolarOnWindow", setpoint=200,
    )

    cset = ConstructionSet(f"Marievik {envelope}")
    cset.wall_set.exterior_construction = wall
    cset.wall_set.interior_construction = partition
    cset.floor_set.exterior_construction = floor
    cset.floor_set.interior_construction = floor
    cset.roof_ceiling_set.exterior_construction = floor
    cset.roof_ceiling_set.interior_construction = floor
    cset.aperture_set.window_construction = window
    cset.aperture_set.operable_construction = window
    return cset, shaded


def _schedule(name: str, weekday: list[float], weekend: list[float]):
    from honeybee_energy.lib.scheduletypelimits import fractional
    from honeybee_energy.schedule.ruleset import ScheduleRuleset

    # Sunday first, then Monday..Saturday, as the API expects.
    days = [weekend] + [weekday] * 5 + [weekend]
    return ScheduleRuleset.from_week_daily_values(
        name, *days, holiday_values=weekend, schedule_type_limit=fractional,
    )


def _heating_season():
    from ladybug.dt import Date
    from honeybee_energy.lib.scheduletypelimits import on_off
    from honeybee_energy.schedule.day import ScheduleDay
    from honeybee_energy.schedule.rule import ScheduleRule
    from honeybee_energy.schedule.ruleset import ScheduleRuleset

    on = ScheduleDay("heating_on", [1])
    off = ScheduleDay("heating_off", [0])
    (m0, d0), (m1, d1) = HEATING_OFF
    summer = ScheduleRule(off, apply_sunday=True, apply_monday=True, apply_tuesday=True,
                          apply_wednesday=True, apply_thursday=True, apply_friday=True,
                          apply_saturday=True, start_date=Date(m0, d0), end_date=Date(m1, d1))
    return ScheduleRuleset("heating_season", on, [summer], on_off)


def _program(case: dict, room_area: float, room_people: float):
    from honeybee_energy.lib.scheduletypelimits import temperature
    from honeybee_energy.load.equipment import ElectricEquipment
    from honeybee_energy.load.infiltration import Infiltration
    from honeybee_energy.load.lighting import Lighting
    from honeybee_energy.load.people import People
    from honeybee_energy.load.setpoint import Setpoint
    from honeybee_energy.load.ventilation import Ventilation
    from honeybee_energy.programtype import ProgramType
    from honeybee_energy.schedule.ruleset import ScheduleRuleset

    profile = PROFILES[case["profile"]]
    occ = _schedule(f"occ_{case['profile']}", profile["occupancy"], profile["occupancy_weekend"])
    gains = _schedule(f"gain_{case['profile']}", profile["gains"], profile["gains_weekend"])
    activity = ScheduleRuleset.from_constant_value("activity_120W", 120)

    program = ProgramType(f"prog_{case['profile']}_{room_people:.2f}_{room_area:.1f}")
    program.people = People(
        "people", max(0.0001, room_people / max(1.0, room_area)), occ, activity,
    )
    program.lighting = Lighting("lighting", profile["lighting_w_m2"], gains)
    program.electric_equipment = ElectricEquipment("equipment", profile["equipment_w_m2"], gains)
    # 1.6 l/s·m² at 50 Pa (survey placeholder) -> roughly 0.1 l/s·m² facade in use.
    program.infiltration = Infiltration("infiltration", 0.0001)
    # BBR: at least 0.35 l/s·m², plus 7 l/s per person in offices.
    program.ventilation = Ventilation(
        "ventilation",
        flow_per_person=0.007 if case["profile"] == "office" else 0.0,
        flow_per_area=0.00035,
    )
    heat = ScheduleRuleset.from_constant_value(
        f"heat_{profile['heating_c']}", profile["heating_c"], temperature,
    )
    cool_c = profile["cooling_c"] if profile["cooling_c"] is not None else 60.0
    cool = ScheduleRuleset.from_constant_value(f"cool_{cool_c}", cool_c, temperature)
    program.setpoint = Setpoint("setpoint", heat, cool)
    return program


def build_model(case: dict):
    from honeybee.boundarycondition import Surface, boundary_conditions as bcs
    from honeybee.altnumber import no_limit
    from honeybee.aperture import Aperture
    from honeybee.facetype import face_types
    from honeybee.model import Model
    from honeybee.room import Room
    from honeybee_energy.hvac.idealair import IdealAirSystem
    from honeybee_energy.ventcool.control import VentilationControl
    from honeybee_energy.ventcool.opening import VentilationOpening
    from ladybug_geometry.geometry3d import Face3D, Point3D

    shell = case["shell"]
    depth_m = shell["depth_mm"] / 1000.0
    # Inside face of the facade; traced shells state it, the bay uses its wall.
    facade_mm = shell.get("facade_y_mm", shell.get("external_wall_thickness_mm", 250))
    height = shell.get("ceiling_mm", 2500) / 1000.0
    facade_y = depth_m - facade_mm / 1000.0  # plan y (inside of facade) -> model Y
    # Each window may carry its own glazing; the case default covers the rest.
    envelopes = _envelopes(case)
    built = {k: _constructions(k, envelopes[k]) for k in envelopes}
    cset = built[case["envelope"]][0]

    rooms = []
    for spec in case["rooms"]:
        x0, y0, x1, y1 = (v / 1000.0 for v in (spec["x0"], spec["y0"], spec["x1"], spec["y1"]))
        # Plan y runs down from the facade; model Y runs up to it.
        room = Room.from_box(
            spec["id"], x1 - x0, y1 - y0, height,
            origin=Point3D(x0, depth_m - y1, 0),
        )
        room.display_name = spec.get("label", spec["id"])
        rooms.append((room, spec))

    heating_season = _heating_season()

    hb_rooms = [r for r, _s in rooms]
    Room.intersect_adjacency(hb_rooms, 0.01, 1.0)  # splits faces in place
    adjacency = Room.solve_adjacency(hb_rooms, 0.01)

    # An L-shaped room is drawn as two rectangles. The face between them is
    # open air, not a partition; marking it so lets the two halves mix.
    space_of = {r.identifier: s.get("space", s["id"]) for r, s in rooms}
    for pair in adjacency["adjacent_faces"]:
        f_a, f_b = pair
        room_a = f_a.parent.identifier if f_a.parent else None
        room_b = f_b.parent.identifier if f_b.parent else None
        if room_a and room_b and space_of.get(room_a) == space_of.get(room_b):
            if f_a.type == face_types.wall:
                f_a.type = face_types.air_boundary
                f_b.type = face_types.air_boundary

    for room, spec in rooms:
        room.properties.energy.construction_set = cset
        room.properties.energy.program_type = _program(case, room.floor_area, spec.get("people", 0.0))
        hvac = IdealAirSystem(
            f"ideal_{spec['id']}",
            economizer_type="NoEconomizer",
            sensible_heat_recovery=0.45,  # the existing AHU, survey placeholder
            heating_limit=no_limit,
            cooling_limit=no_limit,
            heating_availability=heating_season,
        )
        room.properties.energy.hvac = hvac

        for face in room.faces:
            if isinstance(face.boundary_condition, Surface):
                continue
            normal = face.normal
            on_facade = (
                face.type == face_types.wall
                and normal.y > 0.99
                and abs(face.geometry.center.y - facade_y) < 0.02
            )
            if not on_facade:
                face.boundary_condition = bcs.adiabatic
                continue
            face.boundary_condition = bcs.outdoors
            fx0 = min(v.x for v in face.geometry.vertices)
            fx1 = max(v.x for v in face.geometry.vertices)
            for n, win in enumerate(case["windows"]):
                a = max(fx0 + 0.05, win["x1"] / 1000.0)
                b = min(fx1 - 0.05, win["x2"] / 1000.0)
                if b - a < 0.2:
                    continue
                z0 = win["sill_mm"] / 1000.0
                z1 = min(height - 0.05, win["head_mm"] / 1000.0)
                if z1 - z0 < 0.2:
                    continue
                # Counter-clockwise seen from outside (from +Y), matching the face.
                geo = Face3D([
                    Point3D(b, facade_y, z0), Point3D(a, facade_y, z0),
                    Point3D(a, facade_y, z1), Point3D(b, facade_y, z1),
                ])
                if geo.normal.y < 0:
                    geo = geo.flip()
                glazing = win.get("glazing", case["envelope"])
                aperture = Aperture(f"{spec['id']}_win{n}", geo,
                                    is_operable=envelopes[glazing]["openable"])
                aperture.properties.energy.construction = built[glazing][1]
                face.add_aperture(aperture)

        if any(ap.is_operable for f in room.faces for ap in f.apertures):
            room.properties.energy.window_vent_control = VentilationControl(
                min_indoor_temperature=24.0, max_indoor_temperature=100.0,
                min_outdoor_temperature=12.0, max_outdoor_temperature=100.0,
                delta_temperature=-1.0,
            )
            room.properties.energy.assign_ventilation_opening(
                VentilationOpening(fraction_area_operable=0.3, fraction_height_operable=1.0)
            )

    model = Model(f"case_{case['id']}", hb_rooms, units="Meters", tolerance=0.01, angle_tolerance=1.0)
    # Facade normal is +Y (north) as drawn. Turn it to the requested azimuth.
    from ladybug_geometry.geometry3d import Point3D as P

    model.rotate_xy(-float(case.get("facade_azimuth_deg", 180.0)), P(0, 0, 0))
    return model


# ---------------------------------------------------------------------------
# Simulation and post-processing
# ---------------------------------------------------------------------------


def simulate(case: dict) -> dict:
    from ladybug.sql import SQLiteResult
    from honeybee_energy.config import folders
    from honeybee_energy.simulation.parameter import SimulationParameter
    from ladybug.epw import EPW as LBEPW
    from ladybug_comfort.collection.adaptive import Adaptive
    from ladybug_comfort.parameter.adaptive import AdaptiveParameter

    model = build_model(case)
    sim_par = SimulationParameter()
    sim_par.output.reporting_frequency = "Hourly"
    sim_par.output.add_output("Zone Operative Temperature")
    sim_par.output.add_output("Zone Ideal Loads Supply Air Total Heating Energy")
    sim_par.output.add_output("Zone Ideal Loads Supply Air Total Cooling Energy")
    epw_path, ddy_path = _weather(case)
    sim_par.sizing_parameter.add_from_ddy_996_004(str(ddy_path))
    sim_par.terrain_type = "City"

    folder = Path(tempfile.mkdtemp(prefix=f"mv_{case['id']}_"))
    idf_text = "\n\n".join([sim_par.to_idf(), model.to.idf(model)])
    idf = folder / "in.idf"
    idf.write_text(idf_text, encoding="utf-8")
    # EnergyPlus is called directly, its console going to a file and with a
    # time limit. Through honeybee's runner, with the console on a pipe, a
    # few runs stalled indefinitely after sizing and held the whole batch.
    exe = Path(folders.energyplus_path) / ("energyplus.exe" if os.name == "nt" else "energyplus")
    with open(folder / "console.txt", "w") as console:
        try:
            subprocess.run(
                [str(exe), "-w", str(epw_path), "-d", str(folder), "-x", str(idf)],
                stdout=console, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                timeout=CASE_TIMEOUT_S, cwd=str(folder),
            )
        except subprocess.TimeoutExpired:
            return {"id": case["id"], "ok": False, "error": f"EnergyPlus exceeded {CASE_TIMEOUT_S} s"}
    sql = folder / "eplusout.sql"
    if not sql.is_file() or sql.stat().st_size == 0:
        err = folder / "eplusout.err"
        detail = err.read_text(errors="ignore")[-3000:] if err.is_file() else "no err file"
        return {"id": case["id"], "ok": False, "error": detail}
    sql = str(sql)

    result = SQLiteResult(sql)
    op = {c.header.metadata.get("Zone", "").upper(): c
          for c in result.data_collections_by_output_name("Zone Operative Temperature")}
    heat = result.data_collections_by_output_name("Zone Ideal Loads Supply Air Total Heating Energy")
    cool = result.data_collections_by_output_name("Zone Ideal Loads Supply Air Total Cooling Energy")

    # Occupied hours come from the use profile, not from each zone's head
    # count: a living room with no people assigned is still lived in.
    profile = PROFILES[case["profile"]]
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    first = days.index(sim_par.run_period.start_day_of_week)
    schedule_mask = []
    for day in range(365):
        weekend = (first + day) % 7 in (0, 6)
        hours = profile["occupancy_weekend"] if weekend else profile["occupancy"]
        schedule_mask.extend(v > 0.01 for v in hours)

    epw = LBEPW(str(epw_path))
    outdoor = epw.dry_bulb_temperature
    # EN 16798-1, category II: +/- 3 K around the neutral temperature.
    parameter = AdaptiveParameter(ashrae_or_en=False, avg_month_or_running_mean=False)
    parameter.set_neutral_offset_from_comfort_class(2)

    area_total = sum(r.floor_area for r in model.rooms)
    rooms_out = []
    for room in model.rooms:
        key = room.identifier.upper()
        temps = op.get(key)
        if temps is None:
            continue
        occupied = schedule_mask[: len(temps)]
        adaptive = Adaptive(outdoor, temps, comfort_parameter=parameter)
        conditions = adaptive.thermal_condition.values
        occ_hours = sum(occupied) or 1
        comfortable = sum(1 for c, o in zip(conditions, occupied) if o and c == 0)
        hot = sum(1 for c, o in zip(conditions, occupied) if o and c > 0)
        cold = sum(1 for c, o in zip(conditions, occupied) if o and c < 0)
        over26 = sum(1 for t, o in zip(temps.values, occupied) if o and t > 26.0)
        # Degree-hours above the category II upper limit: how bad, not only how often.
        dh = 0.0
        for t, n, o in zip(temps.values, adaptive.neutral_temperature.values, occupied):
            if o and t > n + 3.0:
                dh += t - (n + 3.0)
        rooms_out.append({
            "id": room.identifier,
            "label": room.display_name,
            "area_m2": round(room.floor_area, 2),
            "occupied_hours": occ_hours,
            "comfort_pct": round(100.0 * comfortable / occ_hours, 1),
            "hot_pct": round(100.0 * hot / occ_hours, 1),
            "cold_pct": round(100.0 * cold / occ_hours, 1),
            "hours_over_26": over26,
            "overheat_degree_hours": round(dh, 1),
            "max_op_c": round(max(temps.values), 1),
            "min_op_c": round(min(temps.values), 1),
        })

    # Already in kWh. Ideal loads report heat delivered to the zone, which
    # is space heating only; hot water is added on the engine side.
    heating_kwh = sum(sum(c.values) for c in heat)
    cooling_kwh = sum(sum(c.values) for c in cool)
    return {
        "id": case["id"],
        "ok": True,
        "rooms": rooms_out,
        "floor_area_m2": round(area_total, 2),
        "heating_kwh_m2": round(heating_kwh / area_total, 1),
        "cooling_kwh_m2": round(cooling_kwh / area_total, 1),
        "facade_azimuth_deg": case.get("facade_azimuth_deg", 180.0),
        "envelope": case["envelope"],
    }


def _safe(case: dict) -> dict:
    try:
        return simulate(case)
    except Exception as exc:  # one broken case must not lose the batch
        import traceback
        return {"id": case["id"], "ok": False, "error": f"{exc}\n{traceback.format_exc()[-2000:]}"}


def main(argv: list[str]) -> None:
    cases = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    workers = max(1, min(len(cases), (os.cpu_count() or 2) - 1))
    if workers == 1:
        results = [_safe(c) for c in cases]
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(_safe, cases))
    Path(argv[2]).write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
