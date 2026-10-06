"""Validated analysis of one floor with Ladybug Tools: EnergyPlus comfort + Radiance daylight factor.

Runs in the simulation venv (the same one optimise/thermal_sim.py uses), never in the server's:

    .venv-sim\\Scripts\\python.exe explorer\\sim\\full_sim.py case.json result.json

The case is written by explorer/server.py from the scenario the explorer shows. Model:
  - One Honeybee room per unit of the floor (corridors and cores too, so walls between
    units and light paths are real). Unit polygons are extruded by the clear height.
  - Exterior: walls on the building footprint (outside face, incl. courtyards) are outdoors,
    with the windows of the scenario as apertures. Walls to an atrium void, between rooms,
    floor and ceiling are adiabatic, except the roof on the top floor (mid-floor assumption,
    as in optimise/thermal_sim.py).
  - Context: every site building as a shade prism at its scenario height; this building
    below and above the floor too, so it shades its own courtyard and wings.
  - Energy: constructions, schedules, ventilation, heating season and blinds are taken from
    optimise/thermal_sim.py (one set of assumptions in the repository). Comfort: EN 16798-1
    adaptive, category II, occupied hours (ladybug-comfort).
  - Daylight: Radiance daylight factor (lbt-recipes "daylight-factor") on a sensor grid
    0.8 m above the floor of every unit.
Either part is skipped, with the reason in the result, when EnergyPlus or Radiance is missing.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

PROFILE_MAP = {"home": "home", "hotel": "home", "office": "office", "school": "office", "retail": "office"}
TIMEOUT_S = 900


def _face(points, z):
    from ladybug_geometry.geometry3d import Face3D, Point3D
    return Face3D([Point3D(x, y, z) for x, y in points])


def build_model(case: dict, for_energy: bool = True):
    from honeybee.boundarycondition import boundary_conditions as bcs, Surface
    from honeybee.facetype import face_types
    from honeybee.aperture import Aperture
    from honeybee.model import Model
    from honeybee.room import Room
    from honeybee.shade import Shade
    from ladybug_geometry.geometry2d import Polygon2D, Point2D, LineSegment2D
    from ladybug_geometry.geometry3d import Face3D, Point3D, Polyface3D, Vector3D

    z, h = case["z"], case["height"]
    rooms = []
    for u in case["units"]:
        def clean(ring):
            pg = Polygon2D([Point2D(x, y) for x, y in ring[:-1]])
            try:
                pg = pg.remove_colinear_vertices(0.01)
            except Exception:
                pass
            return [Point3D(p.x, p.y, z) for p in pg.vertices]
        boundary = clean(u["poly"])
        holes = [clean(r) for r in (u.get("holes") or [])] or None
        floor = Face3D(boundary, holes=holes)
        if floor.normal.z < 0:          # extrude upwards from the floor
            floor = floor.flip()
        room = Room.from_polyface3d(u["id"].replace("-", "_"), Polyface3D.from_offset_face(floor, h))
        room.display_name = u["name"]
        room.user_data = {"unit": u["id"], "kind": u["kind"]}
        rooms.append(room)
    Room.intersect_adjacency(rooms, 0.01, 1.0)
    Room.solve_adjacency(rooms, 0.01)

    outer = [Polygon2D([Point2D(x, y) for x, y in r[:-1]]) for r in case["exterior_rings"]]
    segs = [s for p in outer for s in p.segments]

    def on_exterior(face):
        c = face.geometry.center
        p = Point2D(c.x, c.y)
        return min(s.distance_to_point(p) for s in segs) < 0.15

    wins_by_unit = {}
    for w in case["windows"]:
        wins_by_unit.setdefault(w["unit"].replace("-", "_"), []).append(w)

    for room in rooms:
        for face in room.faces:
            if isinstance(face.boundary_condition, Surface):
                continue
            if face.type == face_types.wall and on_exterior(face):
                face.boundary_condition = bcs.outdoors
                fn = face.normal
                for k, w in enumerate(wins_by_unit.get(room.identifier, [])):
                    (ax, ay), (bx, by) = w["a"], w["b"]
                    mid = Point2D((ax + bx) / 2, (ay + by) / 2)
                    bottom = [v for v in face.geometry.vertices if abs(v.z - z) < 0.02]
                    if len(bottom) < 2:
                        continue
                    seg = LineSegment2D.from_end_points(Point2D(bottom[0].x, bottom[0].y), Point2D(bottom[-1].x, bottom[-1].y))
                    if seg.distance_to_point(mid) > 0.15 or abs(fn.x * w["n"][0] + fn.y * w["n"][1]) < 0.9:
                        continue
                    z0 = max(w["z0"], z + 0.02)
                    z1 = min(w["z1"], z + h - 0.02)
                    if z1 - z0 < 0.2:
                        continue
                    # rebuild the window on the wall's own line, clipped to it, so it is coplanar
                    p0, p1 = bottom[0], bottom[-1]
                    L = ((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2) ** 0.5
                    if L < 0.3:
                        continue
                    ex, ey = (p1.x - p0.x) / L, (p1.y - p0.y) / L
                    sa = (ax - p0.x) * ex + (ay - p0.y) * ey
                    sb = (bx - p0.x) * ex + (by - p0.y) * ey
                    sa, sb = max(min(sa, sb), 0.05), min(max(sa, sb), L - 0.05)
                    if sb - sa < 0.2:
                        continue
                    A = (p0.x + ex * sa, p0.y + ey * sa)
                    B = (p0.x + ex * sb, p0.y + ey * sb)
                    geo = Face3D([Point3D(A[0], A[1], z0), Point3D(B[0], B[1], z0),
                                  Point3D(B[0], B[1], z1), Point3D(A[0], A[1], z1)])
                    if geo.normal.dot(fn) < 0:
                        geo = geo.flip()
                    ap = Aperture("%s_w%d" % (room.identifier, k), geo, is_operable=case["openable"])
                    try:
                        face.add_aperture(ap)
                    except Exception:
                        pass
            elif face.type == face_types.roof_ceiling and case["top"]:
                face.boundary_condition = bcs.outdoors
            else:
                face.boundary_condition = bcs.adiabatic

    shades = []
    for i, c in enumerate(case["context"]):
        for j, ring in enumerate(c["rings"][:1]):
            base = _face(ring[:-1], c.get("z0", 0.0))
            if base.normal.z < 0:
                base = base.flip()
            try:
                pf = Polyface3D.from_offset_face(base, c["height"] - c.get("z0", 0.0))
            except Exception:
                continue
            for k, f in enumerate(pf.faces):
                shades.append(Shade("ctx_%d_%d_%d" % (i, j, k), f, is_detached=True))
    model = Model("explorer_" + case["id"], rooms, orphaned_shades=shades, units="Meters",
                  tolerance=0.01, angle_tolerance=1.0)
    return model


# ---------------------------------------------------------------------------- energy
def run_energy(case, model, folder: Path) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    from honeybee_energy.config import folders
    if not folders.energyplus_path:
        return {"ok": False, "error": "EnergyPlus not found in this environment"}
    from optimise import thermal_sim as TS
    from honeybee.altnumber import no_limit
    from honeybee_energy.hvac.idealair import IdealAirSystem
    from honeybee_energy.simulation.parameter import SimulationParameter
    from honeybee_energy.ventcool.control import VentilationControl
    from honeybee_energy.ventcool.opening import VentilationOpening
    from ladybug.epw import EPW
    from ladybug.sql import SQLiteResult
    from ladybug_comfort.collection.adaptive import Adaptive
    from ladybug_comfort.parameter.adaptive import AdaptiveParameter

    profile = PROFILE_MAP.get(case["profile"], "office")
    env = "upgraded" if case["envelope"] in ("upgraded", "added") else "existing"
    cset, shaded = TS._constructions(env)
    season = TS._heating_season()
    tcase = {"profile": profile}
    for room in model.rooms:
        room.properties.energy.construction_set = cset
        people = room.floor_area / case.get("m2_per_person", 30.0) if room.user_data.get("kind") == "unit" else 0.0
        room.properties.energy.program_type = TS._program(tcase, room.floor_area, people)
        room.properties.energy.hvac = IdealAirSystem(
            "ideal_%s" % room.identifier, economizer_type="NoEconomizer", sensible_heat_recovery=0.45,
            heating_limit=no_limit, cooling_limit=no_limit, heating_availability=season)
        for f in room.faces:
            for ap in f.apertures:
                ap.properties.energy.construction = shaded
        if case["openable"] and any(ap.is_operable for f in room.faces for ap in f.apertures):
            room.properties.energy.window_vent_control = VentilationControl(
                min_indoor_temperature=24.0, max_indoor_temperature=100.0,
                min_outdoor_temperature=12.0, max_outdoor_temperature=100.0, delta_temperature=-1.0)
            room.properties.energy.assign_ventilation_opening(
                VentilationOpening(fraction_area_operable=0.3, fraction_height_operable=1.0))

    epw_path = Path(case["epw"])
    sim_par = SimulationParameter()
    sim_par.output.reporting_frequency = "Hourly"
    sim_par.output.add_output("Zone Operative Temperature")
    sim_par.output.add_output("Zone Ideal Loads Supply Air Total Heating Energy")
    sim_par.output.add_output("Zone Ideal Loads Supply Air Total Cooling Energy")
    ddy = epw_path.with_suffix(".ddy")
    if ddy.is_file():
        sim_par.sizing_parameter.add_from_ddy_996_004(str(ddy))
    sim_par.terrain_type = "City"
    idf = folder / "in.idf"
    idf.write_text("\n\n".join([sim_par.to_idf(), model.to.idf(model)]), encoding="utf-8")
    exe = Path(folders.energyplus_path) / ("energyplus.exe" if os.name == "nt" else "energyplus")
    with open(folder / "console.txt", "w") as console:
        subprocess.run([str(exe), "-w", str(epw_path), "-d", str(folder), "-x", str(idf)],
                       stdout=console, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                       timeout=TIMEOUT_S, cwd=str(folder))
    sql = folder / "eplusout.sql"
    if not sql.is_file() or sql.stat().st_size == 0:
        err = folder / "eplusout.err"
        return {"ok": False, "error": err.read_text(errors="ignore")[-3000:] if err.is_file() else "no output"}
    res = SQLiteResult(str(sql))
    op = {c.header.metadata.get("Zone", "").upper(): c for c in res.data_collections_by_output_name("Zone Operative Temperature")}
    heat = {c.header.metadata.get("System", c.header.metadata.get("Zone", "")).upper(): c
            for c in res.data_collections_by_output_name("Zone Ideal Loads Supply Air Total Heating Energy")}
    cool = {c.header.metadata.get("System", c.header.metadata.get("Zone", "")).upper(): c
            for c in res.data_collections_by_output_name("Zone Ideal Loads Supply Air Total Cooling Energy")}
    prof = TS.PROFILES[profile]
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    first = days.index(sim_par.run_period.start_day_of_week)
    mask = []
    for d in range(365):
        we = (first + d) % 7 in (0, 6)
        mask += [v > 0.01 for v in (prof["occupancy_weekend"] if we else prof["occupancy"])]
    outdoor = EPW(str(epw_path)).dry_bulb_temperature
    par = AdaptiveParameter(ashrae_or_en=False, avg_month_or_running_mean=False)
    par.set_neutral_offset_from_comfort_class(2)
    units = {}
    for room in model.rooms:
        if room.user_data.get("kind") != "unit":
            continue
        t = op.get(room.identifier.upper())
        if t is None:
            continue
        cond = Adaptive(outdoor, t, comfort_parameter=par).thermal_condition.values
        n = sum(mask[: len(cond)]) or 1
        ok = sum(1 for c, o in zip(cond, mask) if o and c == 0)
        hot = sum(1 for c, o in zip(cond, mask) if o and c > 0)
        cold = sum(1 for c, o in zip(cond, mask) if o and c < 0)
        hk = sum(v.values and sum(v.values) or 0 for k, v in heat.items() if room.identifier.upper() in k)
        ck = sum(v.values and sum(v.values) or 0 for k, v in cool.items() if room.identifier.upper() in k)
        units[room.user_data["unit"]] = {
            "name": room.display_name, "area": round(room.floor_area, 1),
            "comfortable_pct": round(100 * ok / n, 1), "overheating_pct": round(100 * hot / n, 1),
            "too_cold_pct": round(100 * cold / n, 1),
            "hours_above_26": sum(1 for v, o in zip(t.values, mask) if o and v > 26),
            "hours_above_27": sum(1 for v, o in zip(t.values, mask) if o and v > 27),
            "max_op": round(max(t.values), 1),
            "heating_kwh_m2": round(hk / room.floor_area, 1), "cooling_kwh_m2": round(ck / room.floor_area, 1)}
    return {"ok": True, "units": units}


# ---------------------------------------------------------------------------- daylight
def run_daylight(case, model, folder: Path) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    from honeybee_radiance.config import folders as rfolders
    if not rfolders.radiance_path:
        return {"ok": False, "error": "Radiance not found in this environment"}
    from honeybee_radiance.sensorgrid import SensorGrid  # noqa: F401
    from lbt_recipes.recipe import Recipe
    from lbt_recipes.settings import RecipeSettings

    grids = []
    for room in model.rooms:
        if room.user_data.get("kind") != "unit":
            continue
        g = room.properties.radiance.generate_sensor_grid(case.get("grid", 0.75), offset=0.8)
        if g is not None:
            g.identifier = room.identifier
            g.display_name = room.user_data["unit"]
            grids.append(g)
    model.properties.radiance.sensor_grids = grids
    recipe = Recipe("daylight-factor")
    recipe.input_value_by_name("model", model)
    settings = RecipeSettings(folder=str(folder), workers=max(1, (os.cpu_count() or 2) - 1), reload_old=False)
    project = recipe.run(settings, radiance_check=True, silent=True)
    # Newer lbt-recipes return result values, not a folder, from output_value_by_name("results"),
    # so read the per-grid .res files from the recipe's results folder directly.
    found = {p.stem: p for p in Path(folder).rglob("*.res") if p.parent.name == "results"}
    units = {}
    for g in grids:
        f = found.get(g.identifier)
        if f is None:
            continue
        vals = [float(v) for v in f.read_text().split()]
        pts = [[round(s.pos[0], 2), round(s.pos[1], 2), round(v, 2)] for s, v in zip(g.sensors, vals)]
        n = len(vals) or 1
        a300 = sum(1 for v in vals if v >= 2.1) / n
        a100 = sum(1 for v in vals if v >= 0.7) / n
        units[g.display_name] = {"points": pts, "mean": round(sum(vals) / n, 2),
                                 "median": round(sorted(vals)[n // 2], 2) if vals else 0,
                                 "min": round(min(vals), 2) if vals else 0, "max": round(max(vals), 2) if vals else 0,
                                 "area_300": round(a300, 3), "area_100": round(a100, 3),
                                 "pass_en17037": a300 >= 0.5 and a100 >= 0.95}
    return {"ok": True, "units": units}


def main(argv):
    case = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    out = {"id": case["id"], "method": "ladybug_tools"}
    folder = Path(tempfile.mkdtemp(prefix="mvx_%s_" % case["id"]))
    try:
        model = build_model(case)
        out["rooms"] = len(model.rooms)
        out["apertures"] = sum(len(f.apertures) for r in model.rooms for f in r.faces)
        if case.get("run_energy", True):
            try:
                out["comfort"] = run_energy(case, model.duplicate(), folder / "energy")
            except Exception as e:
                out["comfort"] = {"ok": False, "error": "%s\n%s" % (e, traceback.format_exc()[-1500:])}
        if case.get("run_daylight", True):
            try:
                out["daylight"] = run_daylight(case, model.duplicate(), folder / "daylight")
            except Exception as e:
                out["daylight"] = {"ok": False, "error": "%s\n%s" % (e, traceback.format_exc()[-1500:])}
    except Exception as e:
        out["error"] = "%s\n%s" % (e, traceback.format_exc()[-2000:])
    Path(argv[2]).write_text(json.dumps(out), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
