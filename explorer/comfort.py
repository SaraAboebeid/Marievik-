"""
explorer.comfort - quick indoor thermal comfort for every unit of a floor (a few seconds).

The validated route is EnergyPlus through Honeybee (explorer/sim/full_sim.py, same assumptions
as optimise/thermal_sim.py). This quick route makes the same positions with a much simpler
model, so it can answer while a slider moves:

  Model       EN ISO 13790 / ISO 52016 "5R1C" simple hourly method, one zone per unit, 8760 h,
              Stockholm TMYx weather (data/climate). Free-running in summer: no cooling except
              offices (26 C), heating to 21 C in the heating season (off 15 May - 15 Sep).
  Exposure    only the unit's own facade (and the roof on the top floor) is exposed; walls to
              neighbouring units, corridors and the slab below are adiabatic (mid-floor
              assumption, stated as in thermal_sim.py).
  Envelope    retained 1985 shell (placeholders as surveyed): wall U 0.45, double glazing U 2.8,
              g 0.70, fixed; upgraded: triple glazing U 0.9, g 0.45, openable. Added floors:
              CLT wall U 0.15, triple glazing, roof U 0.10, light timber mass.
  Sun         beam + isotropic diffuse + ground-reflected on each window's own orientation,
              beam blocked when the sun is below that window's obstruction horizon (from every
              site building), interior blinds at > 200 W/m2 on the glass.
  Comfort     EN 16798-1 adaptive model, category II, occupied hours only. The upper limit is
              held at its 10 C value below a running mean of 10 C; below 15 C the building is
              heated and the lower limit is the category II minimum of 20 C operative.
  Ventilation 0.35 l/s m2 (+7 l/s per person in offices and schools), heat recovery 45 % in the
              heating season and bypassed in summer; openable windows purge at ~2 ach above 24 C.
Everything marked PLACEHOLDER in the data stays a placeholder here.
"""
from __future__ import annotations

import math

import numpy as np

from . import climate, daylight, model as M

ENVELOPE = {
    "existing": {"window_u": 2.8, "window_g": 0.70, "openable": False},
    "upgraded": {"window_u": 0.9, "window_g": 0.45, "openable": True},
}
WALL_U = {"existing": 0.45, "added": 0.15}
ROOF_U = {"existing": 0.20, "added": 0.10}
MASS = {"heavy": (3.0, 260_000.0), "light": (2.5, 110_000.0)}        # (A_m / A_f, C_m per m2 A_f [J/K])
HEAT_RECOVERY = 0.45                                                 # existing AHU, survey placeholder
HEATING_OFF = ((5, 15), (9, 15))


def _hours(on, base=0.0):
    v = [base] * 24
    for a, b, x in on:
        for h in range(a, b):
            v[h] = x
    return v


# Schedules as in optimise/thermal_sim.py (Sveby / EN 16798-1 annex spirit, PLACEHOLDER).
PROFILES = {
    "home": {"occ": _hours([(0, 7, 1.0), (7, 9, 0.5), (9, 16, 0.25), (16, 18, 0.6), (18, 24, 0.9)]),
             "occ_we": _hours([(0, 10, 1.0), (10, 18, 0.5), (18, 24, 0.9)]),
             "gain": _hours([(6, 8, 0.6), (17, 23, 0.8)], 0.1), "gain_we": _hours([(8, 23, 0.5), (17, 23, 0.8)], 0.1),
             "light": 4.0, "equip": 3.5, "m2_per_person": 30.0, "heat": 21.0, "cool": None, "vent_pp": 0.0},
    "office": {"occ": _hours([(8, 12, 0.9), (12, 13, 0.5), (13, 17, 0.9)]), "occ_we": _hours([]),
               "gain": _hours([(7, 18, 0.9)], 0.1), "gain_we": _hours([], 0.1),
               "light": 7.0, "equip": 10.0, "m2_per_person": 12.0, "heat": 21.0, "cool": 26.0, "vent_pp": 0.007},
    "school": {"occ": _hours([(8, 12, 0.9), (12, 13, 0.3), (13, 16, 0.9)]), "occ_we": _hours([]),
               "gain": _hours([(7, 17, 0.9)], 0.1), "gain_we": _hours([], 0.1),
               "light": 8.0, "equip": 5.0, "m2_per_person": 3.0, "heat": 21.0, "cool": None, "vent_pp": 0.007},
    "hotel": {"occ": _hours([(0, 8, 0.9), (8, 18, 0.2), (18, 24, 0.8)]), "occ_we": _hours([(0, 10, 0.9), (10, 18, 0.3), (18, 24, 0.8)]),
              "gain": _hours([(6, 9, 0.6), (18, 23, 0.8)], 0.1), "gain_we": _hours([(8, 23, 0.6)], 0.1),
              "light": 5.0, "equip": 4.0, "m2_per_person": 15.0, "heat": 21.0, "cool": None, "vent_pp": 0.0},
    "retail": {"occ": _hours([(10, 19, 0.8)]), "occ_we": _hours([(10, 17, 0.9)]),
               "gain": _hours([(9, 20, 1.0)], 0.1), "gain_we": _hours([(9, 18, 1.0)], 0.1),
               "light": 12.0, "equip": 5.0, "m2_per_person": 20.0, "heat": 20.0, "cool": 26.0, "vent_pp": 0.007},
}
PROFILE_FOR = {"residential": "home", "office_cellular": "office", "office_open": "office", "school": "school",
               "hotel": "hotel", "retail": "retail"}


def _heating_on(m, d):
    (m0, d0), (m1, d1) = HEATING_OFF
    return not ((m, d) >= (m0, d0) and (m, d) <= (m1, d1))


def _incident(w, sun, ghi, dni, dhi):
    """Hourly irradiance on a vertical window (W/m2), with its own obstruction horizon."""
    n_az = w["n_az"]
    hz = w["horizon"]
    # diffuse sky seen by a vertical surface, reduced by the obstruction profile
    sky_view = 0.5 * float(np.mean(np.cos(hz) ** 2))
    alt = np.radians(sun[:, 0])
    az = np.radians(sun[:, 1])
    rel = (az - n_az + np.pi) % (2 * np.pi) - np.pi
    cos_i = np.cos(alt) * np.cos(rel)
    idx = np.clip(((rel - daylight.AZ_REL[0]) / math.radians(daylight.AZ_STEP)).round().astype(int), 0, len(hz) - 1)
    sunlit = (alt > 0) & (cos_i > 0) & (np.abs(rel) < math.pi / 2) & (alt > hz[idx])
    beam = np.where(sunlit, dni * cos_i, 0.0)
    return beam + dhi * sky_view * 2 * 0.5 + 0.2 * ghi * 0.5


def simulate_unit(u, wins, env_key, top: bool, added: bool, use: str, wall_h: float, wx) -> dict:
    prof = PROFILES[PROFILE_FOR.get(use, "office")]
    env = ENVELOPE["upgraded" if added else env_key]
    A_f = max(u["area"], 1.0)
    uw = [wins[i] for i in u["windows"] if i in wins]
    A_w = sum(w["width"] * (w["z1"] - w["z0"]) for w in uw)
    A_op = max(0.0, u["facade_m"] * wall_h - A_w)
    H_tr_w = env["window_u"] * A_w
    H_op = (WALL_U["added" if added else "existing"] * A_op
            + (ROOF_U["added" if added else "existing"] * A_f if top else 0.0))
    a_m, c_m = MASS["light" if added else "heavy"]
    A_m, C_m = a_m * A_f, c_m * A_f
    A_t = 4.5 * A_f
    H_tr_is = 3.45 * A_t
    H_tr_ms = 9.1 * A_m
    H_tr_em = 1.0 / max(1e-6, (1.0 / max(H_op, 1e-6) - 1.0 / H_tr_ms)) if H_op > 0 else 0.0

    n = len(wx.dry_bulb)
    te = np.asarray(wx.dry_bulb)
    sun = np.asarray(wx.sun)
    ghi, dni, dhi = np.asarray(wx.ghi), np.asarray(wx.dni), np.asarray(wx.dhi)
    q_sol = np.zeros(n)
    for w in uw:
        inc = _incident(w, sun, ghi, dni, dhi)
        g = np.where(inc > 200, env["window_g"] * 0.35, env["window_g"])          # interior blind
        q_sol += w["width"] * (w["z1"] - w["z0"]) * 0.8 * g * inc

    # schedules (Jan 1 of a TMY is taken as a Monday)
    occ = np.zeros(n)
    gain = np.zeros(n)
    heat_on = np.zeros(n, dtype=bool)
    for i in range(n):
        day = i // 24
        we = day % 7 in (5, 6)
        h = i % 24
        occ[i] = (prof["occ_we"] if we else prof["occ"])[h]
        gain[i] = (prof["gain_we"] if we else prof["gain"])[h]
        heat_on[i] = _heating_on(wx.month[i], wx.day[i])
    people = A_f / prof["m2_per_person"]
    q_int = occ * people * 75.0 + gain * (prof["light"] + prof["equip"]) * A_f

    flow = 0.00035 * A_f + prof["vent_pp"] * people * (occ > 0.05)                   # m3/s
    # heat recovery in the heating season; summer bypass (as any AHU with a bypass damper)
    H_ve_mech = 1200.0 * flow * np.where(heat_on, 1 - HEAT_RECOVERY, 1.0)
    H_ve_purge = 1200.0 * (2.0 * A_f * wall_h / 3600.0) if env["openable"] else 0.0  # ~2 ach, window open

    theta_m = 20.0
    theta_op = np.zeros(n)
    heating = np.zeros(n)
    cooling = np.zeros(n)
    cool_sp = prof["cool"]
    te_l, qi_l, qs_l = te.tolist(), q_int.tolist(), q_sol.tolist()
    for i in range(n):
        t_e = te_l[i]
        phi_int, phi_sol = qi_l[i], qs_l[i]

        def step(phi_hc, h_ve, theta_m_prev):
            phi_ia = 0.5 * phi_int
            phi_m = A_m / A_t * (0.5 * phi_int + phi_sol)
            phi_st = (1 - A_m / A_t - H_tr_w / (9.1 * A_t)) * (0.5 * phi_int + phi_sol)
            h1 = 1.0 / (1.0 / h_ve + 1.0 / H_tr_is)
            h2 = h1 + H_tr_w
            h3 = 1.0 / (1.0 / h2 + 1.0 / H_tr_ms)
            phi_mtot = phi_m + H_tr_em * t_e + h3 * (phi_st + H_tr_w * t_e + h1 * ((phi_ia + phi_hc) / h_ve + t_e)) / h2
            tm = (theta_m_prev * (C_m / 3600 - 0.5 * (h3 + H_tr_em)) + phi_mtot) / (C_m / 3600 + 0.5 * (h3 + H_tr_em))
            tmm = 0.5 * (tm + theta_m_prev)
            ts = (H_tr_ms * tmm + phi_st + H_tr_w * t_e + h1 * (t_e + (phi_ia + phi_hc) / h_ve)) / (H_tr_ms + H_tr_w + h1)
            ta = (H_tr_is * ts + h_ve * t_e + phi_ia + phi_hc) / (H_tr_is + h_ve)
            return tm, ta, 0.3 * ta + 0.7 * ts

        h_ve = max(float(H_ve_mech[i]), 1e-3)
        tm, ta, top_ = step(0.0, h_ve, theta_m)
        # purge ventilation through openable windows (as the EnergyPlus model's VentilationControl)
        if env["openable"] and ta > 24.0 and 12.0 < t_e < ta - 1.0:
            h_ve = float(H_ve_mech[i]) + H_ve_purge
            tm, ta, top_ = step(0.0, h_ve, theta_m)
        phi = 0.0
        if heat_on[i] and ta < prof["heat"]:
            _, ta10, _ = step(10.0 * A_f, h_ve, theta_m)
            phi = 10.0 * A_f * (prof["heat"] - ta) / max(1e-6, ta10 - ta)
            tm, ta, top_ = step(phi, h_ve, theta_m)
            heating[i] = phi
        elif cool_sp is not None and ta > cool_sp:
            _, ta10, _ = step(-10.0 * A_f, h_ve, theta_m)
            phi = -10.0 * A_f * (ta - cool_sp) / max(1e-6, ta - ta10)
            tm, ta, top_ = step(phi, h_ve, theta_m)
            cooling[i] = -phi
        theta_m = tm
        theta_op[i] = top_
    return {"op": theta_op, "occ": occ > 0.05, "heating": heating, "cooling": cooling, "A_f": A_f, "A_w": A_w}


def evaluate(sim, wx) -> dict:
    trm_day = np.repeat(np.asarray(wx.running_mean()), 24)[: len(sim["op"])]
    comfort = 0.33 * trm_day + 18.8
    upper = 0.33 * np.clip(trm_day, 10, 30) + 18.8 + 3.0
    # below a running mean of 15 C the building is heated: category II fixed minimum, 20 C operative
    lower = np.where(trm_day < 15, 20.0, 0.33 * np.clip(trm_day, 15, 30) + 18.8 - 3.0)
    op, occ = sim["op"], sim["occ"]
    n_occ = max(1, int(occ.sum()))
    hot = (op > upper) & occ
    cold = (op < lower) & occ
    ok = occ & ~hot & ~cold
    month = np.asarray(wx.month)
    monthly = [{"month": m, "mean": round(float(op[month == m].mean()), 1), "max": round(float(op[month == m].max()), 1),
                "min": round(float(op[month == m].min()), 1)} for m in range(1, 13)]
    # hottest week: the 7 days with the highest mean operative temperature
    daily = op[: 365 * 24].reshape(365, 24).mean(axis=1)
    wk = int(np.argmax(np.convolve(daily, np.ones(7) / 7, mode="valid")))
    sl = slice(wk * 24, wk * 24 + 168)
    return {"comfortable_pct": round(100 * ok.sum() / n_occ, 1),
            "overheating_pct": round(100 * hot.sum() / n_occ, 1),
            "too_cold_pct": round(100 * cold.sum() / n_occ, 1),
            "hours_above_26": int(((op > 26) & occ).sum()), "hours_above_27": int(((op > 27) & occ).sum()),
            "max_op": round(float(op.max()), 1),
            "heating_kwh_m2": round(float(sim["heating"].sum()) / 1000 / sim["A_f"], 1),
            "cooling_kwh_m2": round(float(sim["cooling"].sum()) / 1000 / sim["A_f"], 1),
            "monthly": monthly,
            "hot_week": {"start_day": wk + 1, "op": [round(float(v), 1) for v in op[sl]],
                         "out": [round(float(v), 1) for v in np.asarray(wx.dry_bulb)[sl]],
                         "upper": [round(float(v), 1) for v in upper[sl]],
                         "lower": [round(float(v), 1) for v in lower[sl]],
                         "comfort": [round(float(v), 1) for v in comfort[sl]]}}


def floor_comfort(site: "M.Site", bid: str, index: int, raw: dict | None, context_settings: dict | None = None,
                  unit_ids: list[str] | None = None) -> dict:
    sc = site.scenario(bid, raw)
    F = sc["res"]["floors"][index]
    wx = climate.load()
    prisms = site.context_prisms(dict(context_settings or {}, **{bid: raw or {}}))
    added = index >= sc["levels"]
    wins = daylight.floor_windows(F, daylight.context_edges(prisms), added=added)
    env_key = "upgraded" if sc["settings"]["windows"] != "existing" else "existing"
    top = index == len(sc["res"]["floors"]) - 1
    out = {}
    for u in sc["units"][index]:
        if u["kind"] != "unit" or (unit_ids and u["id"] not in unit_ids):
            continue
        sim = simulate_unit(u, wins, env_key, top, added, F.use, F.wall_h, wx)
        r = evaluate(sim, wx)
        if not unit_ids:
            r.pop("hot_week")
        out[u["id"]] = dict(r, name=u["name"], area=u["area"], orientation=u["orientation"])
    vals = list(out.values())
    area = sum(v["area"] for v in vals) or 1
    summ = {k: round(float(sum(v[k] * v["area"] for v in vals) / area), 1)
            for k in ("comfortable_pct", "overheating_pct", "too_cold_pct", "heating_kwh_m2", "cooling_kwh_m2")} if vals else {}
    summ["units"] = len(vals)
    summ["max_op"] = max((v["max_op"] for v in vals), default=None)
    return {"building": bid, "floor": index, "method": "quick", "units": out, "summary": summ,
            "weather": wx.path.name, "envelope": "added floor (CLT, triple glazing)" if added else env_key,
            "note": "Quick 5R1C hourly model, EN 16798-1 adaptive category II over occupied hours. "
                    "Use the EnergyPlus run (Ladybug Tools) for the validated result."}
