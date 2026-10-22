"""Ten years of Marievik as a market: tenants looking for space, choosing between Marievik's buildings and the
rest of Stockholm, renewing or leaving, while AMF plays strategies (B-U-S cards). An agent-based model in
quarterly steps, run many times over.

Spaces: every floor of the 13 study buildings split into lettable units of about 900 m2 (data/district).
Who is in today comes from the rent roll (data/projects/marievik/leases.json; example occupancy elsewhere).
Tenants (10 types) score a unit on what it is and where it is: walk to Liljeholmen station, active ground
floors nearby, green and plaza within reach, water, building quality, demountable fit-out, evening life,
office workers nearby (for shops and cafés), and rent against what they will pay. Each quarter new tenants
arrive (Poisson, with a yearly trend per type) and take the best unit if it beats an average location
elsewhere (binary logit); at lease end tenants renew with a probability that rises with how good the unit is.

What it reports, per building, for the district and for the wider (urban) area: vacancy, rent, net income,
capex, operational and embodied carbon, people and evening life, demand won and lost. Everything is example
data and stated assumptions until AMF's rent roll and letting history replace them.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
MARKET = ROOT / "data" / "district" / "marievik_market.json"
COSTS = ROOT / "data" / "studio" / "costs.json"
REACH = 150.0
KIND_OF_USE = {"office": "office", "retail": "ground", "restaurant_cafe": "ground", "residential": "residential",
               "school": "school", "hotel": "hotel"}
OPEX_FAMILY = {"office": "office", "ground": "retail", "residential": "residential", "school": "school", "hotel": "hotel", "shared": "office"}
B01_SECTOR = {"Tech company": "office_corporate", "Consultancy": "office_sme", "Public agency": "public_agency",
              "Engineering firm": "office_corporate", "Media house": "office_corporate", "Start-up hub": "office_sme",
              "Coworking operator": "cowork", "Law firm": "office_sme", "Food and drink": "food"}
ATTRS = ("transit", "life", "green", "water", "quality", "flex", "evening", "workers")
_prep: dict | None = None


def market() -> dict:
    return json.loads(MARKET.read_text(encoding="utf-8"))


def _h(s: str) -> int:
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


# ------------------------------------------------------------------ the district as it stands
def prepare(site) -> dict:
    """Buildings, their fixed location qualities and today's units (cached: the site does not change)."""
    global _prep
    if _prep is not None:
        return _prep
    from parametric.mvk import site as S   # noqa: WPS433 (the explorer's own site helpers)
    from .studio import tenancy

    mk = market()
    ctx = site.context()
    urban = {u["id"]: u for u in site.urban_summary()}
    water = unary_union([Polygon(r[0], r[1:]) for e in ctx.get("water", []) for r in e["rings"]]) if ctx.get("water") else None
    station = Point(*mk["station"]["xy"])
    blds = []
    for b in site.site["buildings"]:
        fp = S.footprint(b)
        kind = KIND_OF_USE.get(b["current_use"], "office")
        u = urban.get(b["id"], {})
        blds.append({
            "id": b["id"], "name": b["name"], "fp": fp, "levels": int(b["levels"]), "kind": kind, "role": b.get("role"),
            "c": (fp.centroid.x, fp.centroid.y), "fp_m2": fp.area,
            "transit": math.exp(-fp.distance(station) / 450.0),
            "water": math.exp(-(fp.distance(water) if water is not None else 500.0) / 80.0),
            "green_m2": u.get("green_m2", 0) + u.get("plaza_m2", 0),
        })
    near = {a["id"]: [b["id"] for b in blds if a["fp"].distance(b["fp"]) <= REACH] for a in blds}
    _prep = {"buildings": blds, "near": near, "market": mk}
    return _prep


def _initial_units(prep, project: str = "marievik") -> list[dict]:
    """Every lettable unit with who is in it today. B01 from the rent roll; elsewhere example occupancy."""
    from .studio import tenancy

    mk = prep["market"]
    T = mk["tenants"]
    leases = tenancy.leases(project) or {}
    start = mk["start_year"]
    units = []
    for b in prep["buildings"]:
        let_m2 = b["fp_m2"] * mk["lettable_share"]
        for f in range(b["levels"]):
            n = max(1, round(let_m2 / mk["unit_m2"]))
            area = let_m2 / n
            ft = tenancy.floor_tenancy(project, b["id"], f, b["fp_m2"])
            vac_share = ft["vacant"] / max(1, ft["leasable"])
            for k in range(n):
                h = _h(f"{b['id']}:{f}:{k}")
                if b["kind"] != "office":
                    kind = b["kind"]
                elif f == 0:
                    kind = "ground" if k == 0 else "office"     # one shop or café on the street, the rest lobby and back office
                else:
                    kind = "office"
                u = {"b": b["id"], "floor": f, "k": k, "area": area, "kind": kind, "tenant": None, "rent": 0.0, "end": 0,
                     "start_q": 0, "vacant_q": 0, "quality": 0.6 if kind != "residential" else 0.7, "flex": False, "works_until": -1,
                     "lease_end_year": None}
                vacant = (h % 1000) / 1000 < vac_share
                if kind == "residential":
                    vacant = (h % 1000) < 20
                if not vacant:
                    sector = None
                    if b["id"] == "B01" and ft.get("suites"):
                        let = [s for s in ft["suites"] if s["tenant"] and not s["shared"]]
                        if let:
                            s = let[k % len(let)]
                            sector = B01_SECTOR.get(s["sector"])
                            u["rent"] = float(s["rent"] or 0)
                            u["end"] = max(1, (int(s["leaseEnd"]) - start) * 4) if s.get("leaseEnd") else 0
                    if not sector:
                        cands = [t for t, d in T.items() if kind in d["uses"]]
                        sector = cands[h % len(cands)] if cands else None
                    if sector:
                        u["tenant"] = sector
                        if not u["rent"]:
                            u["rent"] = T[sector]["wtp"] * (0.92 + (h % 13) / 100)
                        if not u["end"]:
                            u["end"] = 1 + (h >> 8) % max(1, 4 * T[sector]["lease_years"])
                units.append(u)
    return units


# ------------------------------------------------------------------ one run
def _attributes(prep, units, extra):
    """Location and life attributes per building this quarter (0-1)."""
    mk = prep["market"]
    by_b = {}
    for u in units:
        by_b.setdefault(u["b"], []).append(u)
    active = set(mk["active_ground"])
    out = {}
    for b in prep["buildings"]:
        nb = prep["near"][b["id"]]
        act = sum(1 for i in nb for u in by_b.get(i, []) if u["kind"] in ("ground",) and u["tenant"] in active)
        eve = sum(u["area"] / 100 * mk["people_per_100m2"].get(u["kind"], 0) * mk["evening_share"].get(u["kind"], 0)
                  for i in nb for u in by_b.get(i, []) if u["tenant"])
        work = sum(u["area"] / 100 * mk["people_per_100m2"]["office"] for i in nb for u in by_b.get(i, []) if u["tenant"] and u["kind"] == "office")
        out[b["id"]] = {
            "transit": b["transit"], "water": b["water"],
            "life": min(1.0, (act + extra["life"]) / 8.0),
            "green": min(1.0, (b["green_m2"] + extra["green_m2"]) / 12000.0),
            "evening": min(1.0, eve / 400.0),
            "workers": min(1.0, work / 1500.0),
        }
    return out


def _utility(t, u, A, rent):
    w = t["w"]
    a = A[u["b"]]
    s = sum(w.get(k, 0.0) * a.get(k, 0.0) for k in ("transit", "life", "green", "water", "evening", "workers"))
    s += w.get("quality", 0.0) * u["quality"] + w.get("flex", 0.0) * (1.0 if u["flex"] else 0.0)
    return s - t["rent_sense"] * (rent / t["wtp"] - 1.0)


def _outside(t):
    """An average location elsewhere in Stockholm, at the rent the tenant expects."""
    return 0.5 * sum(t["w"].values())


def run(site, cards: list[str], seed: int = 1, project: str = "marievik") -> dict:
    prep = prepare(site)
    mk = prep["market"]
    T, ST = mk["tenants"], mk["strategies"]
    C = json.loads(COSTS.read_text(encoding="utf-8"))
    energy = C["energy"]
    rng = np.random.default_rng(seed)
    units = _initial_units(prep, project)
    Q = mk["years"] * 4
    tau = mk["choice_spread"]
    cards = set(cards)
    flexible = "flexible_fitout" in cards
    extra = {"life": 0.0, "green_m2": 0.0}
    energy_cut = {b["id"]: 0.0 for b in prep["buildings"]}
    bids = [b["id"] for b in prep["buildings"]]
    # yearly records
    Y = mk["years"]
    rec = {k: np.zeros(Y) for k in ("rent", "opex", "capex", "noi", "co2_op", "co2_emb", "people", "evening", "let_m2", "lettable_m2",
                                     "lettings", "lost", "renewals", "moveouts", "conversions")}
    by_b = {bid: {k: np.zeros(Y) for k in ("let_m2", "lettable_m2", "noi", "people", "attract", "co2")} for bid in bids}
    lost_by_type = {t: 0 for t in T}
    won_by_type = {t: 0 for t in T}
    unmet = {"residential": 0.0, "hotel": 0.0, "school": 0.0}
    retrofit_order = sorted((b for b in prep["buildings"] if b["kind"] == "office"), key=lambda b: -b["fp_m2"] * b["levels"])

    def works(u, kind_to, q):
        """Fit-out or conversion of a unit: cost, carbon, quarters out of use."""
        if kind_to != u["kind"]:
            cv = mk["conversion"][kind_to]
            sek, kg, qs = cv["sek"], cv["kg"], cv["quarters"]
            if flexible and {u["kind"], kind_to} <= {"office", "school"}:
                sek, kg, qs = sek * 0.5, kg * 0.4, max(1, qs - 1)
            u["kind"] = kind_to
            u["quality"] = max(u["quality"], cv["quality"])
            rec["conversions"][q // 4] += 1
        else:
            fo = mk["fit_out"]["flexible"] if flexible else mk["fit_out"]
            sek, kg, qs = fo["sek"], fo["kg"], fo["quarters"]
        if flexible:
            u["flex"] = True
            u["quality"] = min(1.0, u["quality"] + 0.05)
        rec["capex"][q // 4] += sek * u["area"]
        rec["co2_emb"][q // 4] += kg * u["area"]
        by_b[u["b"]]["co2"][q // 4] += kg * u["area"]
        u["works_until"] = q + qs

    # strategies that act once at the start
    if "shared_amenities" in cards:
        hub = next((u for u in units if u["b"] == "B01" and u["floor"] == 1), None)
        if hub:
            hub.update(kind="shared", tenant=None)
            rec["capex"][0] += 4000 * hub["area"]
            rec["co2_emb"][0] += 50 * hub["area"]
            for u in units:
                if u["kind"] == "office":
                    u["quality"] = min(1.0, u["quality"] + ST["shared_amenities"]["quality"])
    if "public_realm" in cards:
        s = ST["public_realm"]
        rec["capex"][0] += s["sek"]
        rec["co2_emb"][0] += s["kg"]
        extra["green_m2"] += s["green_m2"]
        extra["life"] += s["life"]

    for q in range(Q):
        y = q // 4
        idx = (1 + mk["rent_index"]) ** (q / 4)
        if "energy_retrofit" in cards and q % 4 == 0 and y < len(retrofit_order):
            b = retrofit_order[y]
            s = ST["energy_retrofit"]
            gfa = b["fp_m2"] * b["levels"]
            rec["capex"][y] += s["sek_m2"] * gfa
            rec["co2_emb"][y] += s["kg_m2"] * gfa
            by_b[b["id"]]["co2"][y] += s["kg_m2"] * gfa
            energy_cut[b["id"]] = s["energy_cut"]
            for u in units:
                if u["b"] == b["id"]:
                    u["quality"] = min(1.0, u["quality"] + s["quality"])
        A = _attributes(prep, units, extra)
        # leases ending: renew or move out
        for u in units:
            if u["tenant"] and u["end"] <= q:
                t = T[u["tenant"]]
                gap = (_utility(t, u, A, u["rent"] * 1.0) - _outside(t)) / tau
                p = min(0.97, t["renew"] * 2 / (1 + math.exp(-gap)))
                if rng.random() < p:
                    u["end"] = q + 4 * t["lease_years"]
                    u["rent"] = max(u["rent"], t["wtp"] * idx * 0.97)
                    rec["renewals"][y] += 1
                else:
                    u["tenant"], u["vacant_q"] = None, 0
                    rec["moveouts"][y] += 1
        # strategies acting on vacant units
        for u in units:
            if u["tenant"] or u["kind"] == "shared" or u["works_until"] > q:
                continue
            if "activate_ground" in cards and u["floor"] == 0 and u["kind"] == "office":
                works(u, "ground", q)
            elif "convert_vacant" in cards and u["kind"] == "office" and u["vacant_q"] >= 4:
                target = max(unmet, key=unmet.get)
                if unmet[target] > 0.5:
                    works(u, target, q)
                    unmet[target] = max(0.0, unmet[target] - u["area"] / mk["unit_m2"])
        # new tenants looking
        for tid, t in T.items():
            lam = t["per_year"] / 4 * (1 + t["trend"]) ** (q / 4)
            for _ in range(rng.poisson(lam)):
                need = int(rng.integers(t["units"][0], t["units"][1] + 1))
                kinds = set(t["uses"]) | ({"office"} if flexible and tid == "school" else set())
                best, best_u = None, -1e9
                for bid in bids:
                    free = [u for u in units if u["b"] == bid and not u["tenant"] and u["kind"] in kinds and u["works_until"] <= q + 2]
                    if len(free) < need:
                        continue
                    free.sort(key=lambda u: -u["quality"])
                    pick = free[:need]
                    ask = np.mean([_ask(mk, u, idx, cards) for u in pick])
                    ut = np.mean([_utility(t, u, A, ask) for u in pick]) + rng.gumbel(0, tau)
                    if ut > best_u:
                        best, best_u = (pick, ask), ut
                if best is None:
                    lost_by_type[tid] += 1
                    rec["lost"][y] += 1
                    for k in ("residential", "hotel", "school"):
                        if k in t["uses"]:
                            unmet[k] += need
                    continue
                if best_u < _outside(t) + rng.gumbel(0, tau):
                    lost_by_type[tid] += 1
                    rec["lost"][y] += 1
                    continue
                pick, ask = best
                for u in pick:
                    to = "school" if tid == "school" else u["kind"]
                    if u["works_until"] <= q:
                        works(u, to, q)
                    u.update(tenant=tid, rent=float(ask), end=u["works_until"] + 4 * t["lease_years"], start_q=u["works_until"], vacant_q=0)
                won_by_type[tid] += 1
                rec["lettings"][y] += 1
        # money, carbon, people this quarter
        for u in units:
            if u["kind"] == "shared":
                continue
            fam = C["opex_per_m2_year"].get(OPEX_FAMILY.get(u["kind"], "office"), C["opex_per_m2_year"]["office"])
            kwh = fam["kwh"] * (1 - energy_cut[u["b"]]) * (1.0 if u["tenant"] else 0.6)
            paying = u["tenant"] and q >= u["start_q"]
            rent = u["rent"] * u["area"] / 4 if paying else 0.0
            opex = fam["maint"] * u["area"] / 4 + (0 if u["tenant"] else (fam["clean"] * 0.2 + kwh * energy["sek_per_kwh"]) * u["area"] / 4)
            co2 = kwh * energy["kgco2e_per_kwh"] * u["area"] / 4
            ppl = u["area"] / 100 * mk["people_per_100m2"].get(u["kind"], 5) if paying else 0.0
            rec["rent"][y] += rent
            rec["opex"][y] += opex
            rec["co2_op"][y] += co2
            rec["people"][y] += ppl / 4
            rec["evening"][y] += ppl * mk["evening_share"].get(u["kind"], 0) / 4
            rec["let_m2"][y] += (u["area"] if u["tenant"] else 0) / 4
            rec["lettable_m2"][y] += u["area"] / 4
            bb = by_b[u["b"]]
            bb["let_m2"][y] += (u["area"] if u["tenant"] else 0) / 4
            bb["lettable_m2"][y] += u["area"] / 4
            bb["noi"][y] += rent - opex
            bb["people"][y] += ppl / 4
            bb["co2"][y] += co2
            if not u["tenant"]:
                u["vacant_q"] += 1
        ref = T["office_corporate"]
        for bid in bids:
            bu = [u for u in units if u["b"] == bid and u["kind"] != "shared"]
            if bu:
                by_b[bid]["attract"][y] += np.mean([_utility(ref, u, A, ref["wtp"] * idx) - _outside(ref) for u in bu]) / 4
    rec["noi"] = rec["rent"] - rec["opex"]
    return {"rec": rec, "by_b": by_b, "lost": lost_by_type, "won": won_by_type,
            "final": [{k: u[k] for k in ("b", "floor", "k", "kind", "tenant", "area")} for u in units]}


def _ask(mk, u, idx, cards):
    """AMF's asking rent for a unit: what its likely tenants pay, indexed, cut if long vacant under flexible rents."""
    pays = [t["wtp"] for t in mk["tenants"].values() if u["kind"] in t["uses"]] or [2500]
    r = float(np.mean(pays)) * idx * (0.9 + 0.2 * u["quality"])
    if "rent_flex" in cards and u["vacant_q"] >= 2:
        r *= 1 - mk["strategies"]["rent_flex"]["cut"]
    return r


# ------------------------------------------------------------------ many runs, summarised
def simulate(site, cards: list[str], runs: int = 20, seed: int = 1, project: str = "marievik") -> dict:
    prep = prepare(site)
    mk = prep["market"]
    years = [mk["start_year"] + i for i in range(mk["years"])]
    R = [run(site, cards, seed + i, project) for i in range(runs)]

    def band(arrs, scale=1.0, nd=1):
        a = np.array(arrs) * scale
        return {"mean": np.round(a.mean(0), nd).tolist(), "p10": np.round(np.percentile(a, 10, 0), nd).tolist(),
                "p90": np.round(np.percentile(a, 90, 0), nd).tolist()}
    vac = [1 - r["rec"]["let_m2"] / np.maximum(1, r["rec"]["lettable_m2"]) for r in R]
    disc = np.array([(1 + mk["discount_rate"]) ** -(i + 0.5) for i in range(len(years))])
    value = [float(((r["rec"]["noi"] - r["rec"]["capex"]) * disc).sum()) for r in R]
    carbon = [float((r["rec"]["co2_op"] + r["rec"]["co2_emb"]).sum()) for r in R]
    buildings = []
    for b in prep["buildings"]:
        bb = [r["by_b"][b["id"]] for r in R]
        v = [1 - x["let_m2"] / np.maximum(1, x["lettable_m2"]) for x in bb]
        buildings.append({
            "id": b["id"], "name": b["name"], "kind": b["kind"],
            "vacancy": np.round(np.mean(v, 0), 3).tolist(),
            "noi_msek": np.round(np.mean([x["noi"] for x in bb], 0) / 1e6, 2).tolist(),
            "people": np.round(np.mean([x["people"] for x in bb], 0)).tolist(),
            "attract": np.round(np.mean([x["attract"] for x in bb], 0), 2).tolist(),
            "co2_t": np.round(np.mean([x["co2"] for x in bb], 0) / 1000, 1).tolist(),
            "transit": round(b["transit"], 2), "water": round(b["water"], 2),
        })
    rec = lambda k: [r["rec"][k] for r in R]   # noqa: E731
    last = R[0]["final"]
    mix = {}
    for u in last:
        if u["tenant"]:
            mix[u["kind"]] = mix.get(u["kind"], 0) + u["area"]
    return {
        "cards": sorted(cards), "runs": runs, "years": years,
        "district": {
            "vacancy": band(vac, 1, 3), "rent_msek": band(rec("rent"), 1e-6, 2), "noi_msek": band(rec("noi"), 1e-6, 2),
            "capex_msek": band(rec("capex"), 1e-6, 2), "co2_op_t": band(rec("co2_op"), 1e-3, 1), "co2_emb_t": band(rec("co2_emb"), 1e-3, 1),
            "people": band(rec("people"), 1, 0), "evening": band(rec("evening"), 1, 0),
            "lettings": band(rec("lettings"), 1, 1), "lost": band(rec("lost"), 1, 1), "conversions": band(rec("conversions"), 1, 1),
        },
        "totals": {
            "value_msek": round(float(np.mean(value)) / 1e6, 1), "value_p10": round(float(np.percentile(value, 10)) / 1e6, 1),
            "value_p90": round(float(np.percentile(value, 90)) / 1e6, 1),
            "carbon_t": round(float(np.mean(carbon)) / 1e3, 0),
            "co2_emb_t": round(float(np.mean([r["rec"]["co2_emb"].sum() for r in R])) / 1e3, 0),
            "vacancy_end": round(float(np.mean([v[-1] for v in vac])), 3),
            "people_end": round(float(np.mean([r["rec"]["people"][-1] for r in R]))),
            "evening_end": round(float(np.mean([r["rec"]["evening"][-1] for r in R]))),
            "kg_per_person_year": round(float(np.mean(carbon)) / max(1.0, float(np.mean([r["rec"]["people"].sum() for r in R]))), 1),
        },
        "demand": {t: {"label": mk["tenants"][t]["label"], "won": round(np.mean([r["won"][t] for r in R]), 1),
                       "lost": round(np.mean([r["lost"][t] for r in R]), 1)} for t in mk["tenants"]},
        "mix_end_m2": {k: round(v) for k, v in mix.items()},
        "buildings": buildings,
        "urban": _urban(prep, R, years),
        "note": "Example market data and stated assumptions (data/district/marievik_market.json); not a forecast. "
                f"Mean of {runs} runs, band = 10th-90th percentile.",
    }


def _urban(prep, R, years):
    """Beyond the district: what Marievik adds to Liljeholmen - people and evening life on the street, trips to
    the station, demand captured from the wider market."""
    mk = prep["market"]
    people = np.mean([r["rec"]["people"] for r in R], 0)
    evening = np.mean([r["rec"]["evening"] for r in R], 0)
    won = np.mean([sum(r["won"].values()) for r in R])
    lost = np.mean([sum(r["lost"].values()) for r in R])
    return {
        "station_trips_per_day": np.round(people * 2 * 0.6).tolist(),   # two trips a day, 60 % by public transport (assumed)
        "street_evening_people": np.round(evening).tolist(),
        "capture_share": round(float(won / max(1.0, won + lost)), 3),
        "station": mk["station"]["name"],
        "note": "Trips assume 2 a day per person and 60 % by public transport; capture = lettings won / all tenants who looked.",
    }


def compare(site, runs: int = 12, seed: int = 1, project: str = "marievik") -> dict:
    """Each strategy card alone, all together, and none: value against carbon - the profit / carbon trade-off."""
    mk = market()
    rows = []
    for name, cards in [("none", [])] + [(k, [k]) for k in mk["strategies"]] + [("all", list(mk["strategies"]))]:
        s = simulate(site, cards, runs, seed, project)
        rows.append({"id": name, "label": "Business as usual" if name == "none" else "All cards" if name == "all" else mk["strategies"][name]["label"],
                     "card": mk["strategies"].get(name, {}).get("card"), **s["totals"]})
    return {"rows": rows, "runs": runs}


def meta() -> dict:
    mk = market()
    return {"strategies": [{"id": k, **v} for k, v in mk["strategies"].items()],
            "tenants": {k: v["label"] for k, v in mk["tenants"].items()},
            "years": mk["years"], "start_year": mk["start_year"], "status": mk["_meta"]["status"]}
