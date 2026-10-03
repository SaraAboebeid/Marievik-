"""The parametric tool: traced shells, zoning, window works, sweeps."""

from apartment import envelope, geometry, shells, tool_api
from apartment.server import specs_for
from optimise import zones


def _flat(config="furnished_one"):
    entry = shells.shell("mandolingatan_1802")
    cfg = entry["configurations"][config]
    plan = {"shell": entry["shell"], "walls": cfg["walls"], "doors": cfg["doors"], "furniture": cfg["furniture"]}
    settings = {"use": "student_housing", "user_group": "adult", "occupants": 1, "years": 50,
                "shell_id": "mandolingatan_1802"}
    return plan, settings


def test_traced_flat_matches_the_drawing():
    plan, _ = _flat("as_drawn")
    geo = geometry.analyse(plan, specs_for("adult"), 1200, 900, 800)
    # The sales plan says 34 m².
    assert 33.0 <= geo.total_floor_m2 <= 35.5
    assert not geo.unreachable_rooms


def test_zones_cover_every_room_and_touch_across_walls():
    plan, _ = _flat()
    z = zones.from_plan(plan, specs_for("adult"), 1)
    assert {x["kind"] for x in z} >= {"habitable", "wet"}
    # Snapping closes the 100 mm partition gap: some zone edge is shared.
    edges = {(x["x1"]) for x in z} & {(x["x0"]) for x in z}
    assert edges
    assert abs(sum(x["people"] for x in z) - 1.0) < 0.01


def test_window_works_cost_only_what_changes():
    built = [{"id": "a", "x1": 0, "x2": 2000, "sill_mm": 900, "head_mm": 2100}]
    assert envelope.window_works(built, built) == []
    lowered = [{**built[0], "sill_mm": 600}]
    works = envelope.window_works(built, lowered)
    assert works == [{"component": envelope.CUT, "quantity": 0.6, "source": "windows"}]
    glazed = [{**built[0], "glazing": "upgraded"}]
    assert envelope.window_works(built, glazed)[0]["component"] == envelope.TRIPLE


def test_sweep_moves_a_wall_and_the_walls_meeting_it():
    plan, settings = _flat("as_drawn")
    applied = tool_api.apply_parameter(plan, settings, "wall_offset", 400, "w_st_r")
    assert applied is not None
    moved, _ = applied
    wall = next(w for w in moved["walls"] if w["id"] == "w_st_r")
    top = next(w for w in moved["walls"] if w["id"] == "w_st_top")
    assert wall["x1"] == 2480
    assert max(top["x1"], top["x2"]) == 2480  # the storage room stays closed


def test_fixed_walls_do_not_move():
    plan, settings = _flat("as_drawn")
    assert tool_api.apply_parameter(plan, settings, "wall_offset", 400, "w_wc") is None


def test_least_regret_picks_a_frame_that_is_not_dominated():
    frames = [
        {"criteria": {"lcc": 100, "carbon": 10, "usability": 50, "functionality": 50}},
        {"criteria": {"lcc": 90, "carbon": 9, "usability": 60, "functionality": 60}},   # dominates 0
        {"criteria": {"lcc": 200, "carbon": 20, "usability": 90, "functionality": 90}},
    ]
    assert tool_api.least_regret(frames) in (1, 2)
