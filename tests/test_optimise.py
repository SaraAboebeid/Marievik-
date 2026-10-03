"""The optimiser's invariants: valid schemes, honest change accounting, sound regret."""

from apartment import geometry
from apartment.server import specs_for
from engine import loader
from optimise import adapt, pipeline, programs, schemes, selection


def _door_clear():
    return {k: g.get("clearances_mm", {}).get("door_clear_width", 850)
            for k, g in loader.user_groups().items()}


def _option(use="student_housing", index=0, partition="conventional", products="standard"):
    brief = programs.brief(use)
    scheme = [s for s in schemes.generate(brief, _door_clear()) if s.window == "existing"][index]
    specs = specs_for(scheme.density.user_group)
    geo = geometry.analyse(scheme.plan, specs, 1200, 900, 800)
    plan = pipeline.apply_products(pipeline.search.apply_spec(scheme.plan, partition), products)
    option = pipeline._evaluate(brief, scheme.density, scheme, plan, geo, partition, products, 0)
    option.comfort = 90.0
    return option


def test_every_enclosed_room_has_a_window_and_a_door():
    for brief in programs.BRIEFS.values():
        for scheme in schemes.generate(brief, _door_clear()):
            windows = scheme.plan["shell"]["windows"]
            walls = {w["id"] for w in scheme.plan["walls"]}
            for cell in scheme.cells:
                lit = sum(max(0, min(cell["x1"], w["x2"]) - max(cell["x0"], w["x1"])) for w in windows)
                assert lit >= schemes.MIN_WINDOW_OVERLAP, scheme.id
            for door in scheme.plan["doors"]:
                assert door["wall_id"] in walls
                assert 0.0 < door["t"] < 1.0


def test_window_upgrade_is_costed_only_when_chosen():
    brief = programs.brief("family_housing")
    by_window = {}
    for s in schemes.generate(brief, _door_clear()):
        by_window.setdefault(s.window, s)
    assert by_window["existing"].plan["works"] == []
    assert any(w["component"] == "skin.window.triple.openable" for w in by_window["upgraded"].plan["works"])
    assert any(w["component"] == "skin.window.lowered.sill" for w in by_window["lowered"].plan["works"])


def test_changing_to_the_same_layout_costs_nothing():
    a = _option()
    change = adapt.change(a, a)
    assert change["cost"] == 0 and change["carbon"] == 0
    assert change["furniture_bought"] == 0


def test_demountable_walls_make_a_change_cheaper_in_carbon():
    conventional = _option("student_housing", 3, "conventional")
    demountable = _option("student_housing", 3, "demountable")
    target = _option("family_housing", 0)
    assert adapt.change(demountable, target)["carbon"] < adapt.change(conventional, target)["carbon"]


def test_products_change_cost_but_not_geometry():
    cheap = _option(products="circular")
    premium = _option(products="durable")
    assert cheap.capex < premium.capex
    assert [f["x"] for f in cheap.plan["furniture"]] == [f["x"] for f in premium.plan["furniture"]]


def test_minimax_regret_picks_the_smallest_worst_case():
    options = [_option("student_housing", i, p, pr)
               for i in (0, 3) for p in ("conventional", "demountable") for pr in ("standard", "durable")]
    for n, o in enumerate(options):
        o.comfort = 60.0 + 10 * n
        o.id = f"{o.id}.{n}"
    result = selection.regret(options)
    worst = {k: v["max_regret"] for k, v in result["table"].items()}
    assert worst[result["recommended"]] == min(worst.values())
    for k, v in result["table"].items():
        assert all(r >= -1e-9 for r in v["regret"].values())
