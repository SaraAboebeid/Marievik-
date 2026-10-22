"""A working day on one furnished floor, many times over: who is in, where they sit, which rooms they book,
how long they queue. An agent-based model in one-minute steps, 06:00-22:00, over a number of working days.

Uncalibrated. Arrivals, departures and the lunch dip come from the use catalogue's hourly presence
(data/catalogue/uses/<use>.json); meeting, focus and WC rates and dwell times are stated assumptions below,
to be replaced with sensor and booking data when there is some.

Two kinds of floor:
- work floors (office, cowork): a fixed staff, each with a propensity to come in; desks (own or shared),
  meetings booked into the smallest free room that fits, focus rooms, lunch on the floor or out, WCs.
- guest floors (café, restaurant, the ground floor): guests arrive at a rate that fills the catalogue's
  hourly profile, take a seat if there is one and are turned away if not; staff are in through opening hours.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .engine import field, is_guest_seat, is_work_desk, nearest_walkable, poi_cells

USES_DIR = Path(__file__).resolve().parents[2] / "data" / "catalogue" / "uses"
T0, T1 = 6 * 60, 22 * 60          # the simulated day, minutes after midnight
NT = T1 - T0
HOURS = list(range(6, 22))
DOW = [0.95, 1.1, 1.1, 1.0, 0.85]  # Monday..Friday, relative attendance (mean 1)

# assumptions (per person present, per hour unless stated)
A = {
    "meet_rate": 0.06,             # meetings organised
    "meet_sizes": ([2, 3, 4, 6, 8, 12], [0.4, 0.2, 0.12, 0.13, 0.08, 0.07]),
    "meet_mins": ([30, 60, 90], [0.4, 0.5, 0.1]),
    "focus_rate": 0.25,            # calls or focus work in a focus room, 15-30 min
    "wc_rate": 0.45,               # WC visits
    "wc_service": 3.0,             # mean minutes in a cubicle
    "lunch_in_mins": 25,           # lunch at the pantry or café on the floor
    "lunch_out_mins": 50,          # lunch away from the floor
    "seat_fill": 0.85,             # share of guest seats usable when parties do not fill tables
    "dwell": {"cafe": 35, "ground": 25, "restaurant_lunch": 45, "restaurant_evening": 80},
}
FOOD_ROOMS = ("pantry", "cafe", "lounge")
MEET_ROOMS = ("meeting", "project")
CATALOGUE_USE = {"office": "office", "cowork": "coworking", "cafe": "restaurant_cafe", "restaurant": "restaurant_cafe",
                 "ground": "restaurant_cafe"}
_curves: dict[str, list[float]] = {}


def presence(use: str) -> list[float]:
    """The catalogue's hourly presence (24 values, share of capacity) for a layout's use."""
    cu = CATALOGUE_USE.get(use, "office")
    if cu not in _curves:
        _curves[cu] = json.loads((USES_DIR / f"{cu}.json").read_text(encoding="utf-8"))["occupancy"]["hourly_presence"]
    return _curves[cu]


def _hourly(minute_arr: np.ndarray) -> np.ndarray:
    """Per-minute values -> hourly means for 06..21."""
    return minute_arr.reshape(len(HOURS), 60).mean(axis=1)


def _sample_minutes(rng, weights_by_hour: dict[int, float], n: int) -> np.ndarray:
    hs = np.array(list(weights_by_hour), dtype=float)
    w = np.array(list(weights_by_hour.values()), dtype=float)
    h = rng.choice(hs, size=n, p=w / w.sum())
    return np.clip(np.round((h - 0.5) * 60 + rng.uniform(0, 60, n)), T0, T1 - 1).astype(int) - T0


def _wc_queue(rng, arrivals: np.ndarray, cubicles: int):
    """FIFO queue at one WC room, minute by minute: returns (waits in minutes, people in the room per minute)."""
    busy, queue, waits, inside = 0, [], [], np.zeros(NT)
    p_done = 1.0 / A["wc_service"]
    for t in range(NT):
        if busy:
            busy -= rng.binomial(busy, p_done)
        queue.extend([t] * int(arrivals[t]))
        while queue and busy < cubicles:
            waits.append(t - queue.pop(0))
            busy += 1
        inside[t] = busy + len(queue)
    return waits, inside


def _setup(m):
    """What the model needs from a built floor: desks, rooms, seats, WCs and walking distances."""
    rooms, items, G, grid = m["rooms"], m["items"], m["graph"], m["grid"]
    by_id = {r["id"]: r for r in rooms}
    desks = [i for i, it in enumerate(items) if is_work_desk(m, it, by_id)]
    desk_cell = np.array([nearest_walkable(grid, items[i]["x"] + items[i]["w"] / 2, items[i]["y"] + items[i]["h"] / 2) for i in desks], dtype=int)
    desk_owner = [items[i]["owner"] for i in desks]
    room_seats = {f["id"]: f["seats"] for f in m["roomFig"]}
    meet = sorted(({"id": r["id"], "name": r["name"], "cap": room_seats[r["id"]]} for r in rooms if r["t"] in MEET_ROOMS and room_seats[r["id"]] >= 2),
                  key=lambda r: r["cap"])
    focus = [r["id"] for r in rooms if r["t"] == "booth"]
    food_owner = {}
    for s in m["seats"]:
        o = items[s["item"]]["owner"]
        if by_id.get(o, {}).get("t") in FOOD_ROOMS or (o == "zone" and m["L"].use in ("office", "cowork")):
            food_owner[o] = food_owner.get(o, 0) + s["n"]
    guest_owner = {}
    for s in m["seats"]:
        if is_guest_seat(m, s, by_id):
            o = items[s["item"]]["owner"]
            guest_owner[o] = guest_owner.get(o, 0) + s["n"]
    wcs = [r for r in rooms if r["t"] == "wc"]
    wc_cubicles = [sum(1 for it in items if it["owner"] == r["id"] and it["k"] in ("cubicle", "acc")) for r in wcs]
    wc_src = [nearest_walkable(grid, (r["r"][0] + r["r"][2]) / 2, (r["r"][1] + r["r"][3]) / 2) for r in wcs]
    d_entry = field(G, poi_cells(m, "entry"))[0]
    d_wc, wc_of = field(G, wc_src)[:2]
    d_food = field(G, poi_cells(m, "food"))[0]
    d_meet = field(G, poi_cells(m, "meet"))[0]
    seat_cells = np.array([s["cell"] for s in m["seats"] if is_guest_seat(m, s, by_id) for _ in range(s["n"])], dtype=int)

    def mean_d(d, cells):
        v = d[cells[cells >= 0]] if len(cells) else np.array([])
        v = v[np.isfinite(v)]
        return float(v.mean()) if v.size else 0.0
    return {"by_id": by_id, "desks": desks, "desk_cell": desk_cell, "desk_owner": desk_owner, "meet": meet, "focus": focus,
            "food_owner": food_owner, "guest_owner": guest_owner, "wcs": wcs, "wc_cubicles": wc_cubicles,
            "wc_of": wc_of, "seat_cells": seat_cells,
            "d_entry": d_entry, "d_wc": d_wc, "d_food": d_food, "d_meet": d_meet, "mean_d": mean_d}


def _book(rooms_busy, rooms, size, a, b):
    """Smallest free room that seats `size` for [a, b): its index, or -1 (none free) / -2 (none big enough)."""
    fits = [k for k, r in enumerate(rooms) if r["cap"] >= size]
    if not fits:
        return -2
    for k in fits:
        if all(b <= s or a >= e for s, e in rooms_busy[k]):
            rooms_busy[k].append((a, b))
            return k
    return -1


def simulate(m, days: int = 20, seed: int = 1, attendance: float | None = None, demand: float = 1.0) -> dict:
    """Run `days` working days on a built floor (engine.build). `attendance` overrides the catalogue's peak share of
    staff in (e.g. 0.5 for a hybrid policy); `demand` scales guest arrivals."""
    rng = np.random.default_rng(seed)
    L, fig = m["L"], m["fig"]
    S = _setup(m)
    f = presence(L.use)
    work = L.use in ("office", "cowork")
    n_staff = fig["staff"]
    n_desks = len(S["desks"])
    shared = L.desk_ratio is not None

    acc = {k: [] for k in ("present", "desk", "meeting", "food", "focus", "wc", "guests")}
    room_use = {}                                   # owner -> per-minute sum over days
    peaks, person_hours, desk_peak, no_desk, short_days = [], [], [], [], 0
    meet_req = meet_denied = meet_toobig = focus_req = focus_denied = 0
    meet_minutes = np.zeros(len(S["meet"])); meet_fill = np.zeros(len(S["meet"])); meet_n = np.zeros(len(S["meet"]))
    food_peaks, waits_all, wc_peak_waits, walk = [], [], [], []
    covers = turned = 0

    def use_add(owner, a, b, w=1.0):
        arr = room_use.setdefault(owner, np.zeros(NT))
        arr[a:b] += w

    morning = {h: max(0.0, f[h] - f[h - 1]) for h in range(6, 12)}
    evening = {h: max(0.0, f[h - 1] - f[h]) for h in range(14, 23)}
    peak_share = max(f[8:12]) or 0.01
    lunch_out = max(0.0, 1 - min(f[11:14]) / peak_share)
    staff_attend = attendance if attendance is not None else peak_share
    # each person's own habit: some come in most days, some rarely (mean = the attendance share)
    k = 6.0
    habit = rng.beta(max(0.05, staff_attend * k), max(0.05, (1 - staff_attend) * k), n_staff) if work and n_staff else np.zeros(0)

    for day in range(days):
        dow = DOW[day % 5] * float(np.exp(rng.normal(0, 0.06)))
        present = np.zeros(NT); at_food = np.zeros(NT); in_meet = np.zeros(NT); in_focus = np.zeros(NT); guests = np.zeros(NT)
        wc_rate = np.zeros(NT)
        walk_day = 0.0
        if work and n_staff:
            who = np.nonzero(rng.random(n_staff) < np.minimum(1.0, habit * dow))[0]
            n = len(who)
            arr = _sample_minutes(rng, morning, n) if n else np.zeros(0, int)
            dep = _sample_minutes(rng, evening, n) if n else np.zeros(0, int)
            dep = np.maximum(dep, np.minimum(arr + 180, NT - 1))
            # desks: own desk, or the first free one on arrival when desks are shared
            order = np.argsort(arr)
            free_at = np.full(n_desks, -1)
            got = np.full(n, -1)
            missing = 0
            for i in order:
                if shared:
                    cand = np.nonzero(free_at <= arr[i])[0]
                    if len(cand):
                        d = cand[rng.integers(len(cand))]
                        got[i], free_at[d] = d, dep[i]
                    else:
                        missing += 1
                else:
                    d = who[i] % max(1, n_desks)
                    got[i] = d if n_desks else -1
            no_desk.append(missing)
            short_days += missing > 0
            claimed = np.zeros(NT)
            for i in range(n):
                a, b = arr[i], dep[i]
                if got[i] >= 0:
                    claimed[a:b] += 1
                    use_add(S["desk_owner"][got[i]], a, b)
                present[a:b] += 1
                # lunch: out of the building, or at the pantry / café on the floor
                if T0 + a < 12 * 60 and T0 + b > 13 * 60:
                    l0 = int(rng.uniform(11.5 * 60, 12.75 * 60)) - T0
                    if rng.random() < lunch_out:
                        l1 = min(b, l0 + int(rng.normal(A["lunch_out_mins"], 8)))
                        present[l0:l1] -= 1
                        walk_day += 2 * _d(S["d_entry"], S, got[i])
                    else:
                        l1 = min(b, l0 + A["lunch_in_mins"])
                        at_food[l0:l1] += 1
                        walk_day += 2 * _d(S["d_food"], S, got[i])
                walk_day += 2 * _d(S["d_entry"], S, got[i])
                hrs = (b - a) / 60
                # meetings this person organises, booked into the smallest free room that fits
                for _ in range(rng.poisson(A["meet_rate"] * hrs)):
                    size = int(rng.choice(A["meet_sizes"][0], p=A["meet_sizes"][1]))
                    mins = int(rng.choice(A["meet_mins"][0], p=A["meet_mins"][1]))
                    t = int(rng.integers(a, max(a + 1, b - mins)))
                    t = int(np.ceil(t / 30) * 30)              # meetings start on the half hour
                    if t + mins > NT:
                        continue
                    meet_req += 1
                    r = _book(S.setdefault("busy", {}).setdefault(day, [[] for _ in S["meet"]]), S["meet"], size, t, t + mins)
                    if r < 0:
                        meet_denied += 1
                        meet_toobig += r == -2
                        continue
                    in_meet[t:t + mins] += size
                    meet_minutes[r] += mins; meet_fill[r] += size / S["meet"][r]["cap"]; meet_n[r] += 1
                    use_add(S["meet"][r]["id"], t, t + mins)
                    walk_day += size * 2 * _d(S["d_meet"], S, got[i])
                # calls and focus work in a focus room
                for _ in range(rng.poisson(A["focus_rate"] * hrs)):
                    focus_req += 1
                    mins = int(rng.integers(15, 31))
                    t = int(rng.integers(a, max(a + 1, b - mins)))
                    busy = S.setdefault("fbusy", {}).setdefault(day, {r: [] for r in S["focus"]})
                    room = next((r for r in S["focus"] if all(t + mins <= s or t >= e for s, e in busy[r])), None)
                    if room is None:
                        focus_denied += 1
                        continue
                    busy[room].append((t, t + mins))
                    in_focus[t:t + mins] += 1
                    use_add(room, t, t + mins)
            in_meet = np.minimum(in_meet, present * 0.7)
            desk_peak.append(float(claimed.max()) if n else 0.0)
            wc_rate += present * A["wc_rate"] / 60
            nd = max(1, n)
            walk_day += sum(A["wc_rate"] * (b - a) / 60 * 2 * _d(S["d_wc"], S, got[i]) for i, (a, b) in enumerate(zip(arr, dep)))
            walk.append(walk_day / nd if n else 0.0)
        else:
            # guests fill the catalogue profile when there are seats; the rest are turned away
            cap = int(A["seat_fill"] * sum(S["guest_owner"].values()))
            leave = np.zeros(NT + 400, int)
            seated = 0
            for t in range(NT):
                seated -= leave[t]
                h = (T0 + t) // 60
                dwell = (A["dwell"]["cafe"] if L.use == "cafe" else A["dwell"]["ground"] if L.use == "ground"
                         else A["dwell"]["restaurant_lunch"] if h < 15 else A["dwell"]["restaurant_evening"])
                lam = demand * dow * f[h] * cap / dwell
                k_arr = rng.poisson(lam)
                take = min(k_arr, cap - seated)
                turned += k_arr - take
                covers += take
                for _ in range(take):
                    leave[t + max(5, int(rng.gamma(4, dwell / 4)))] += 1
                seated += take
                guests[t] = seated
            for o, n_o in S["guest_owner"].items():
                use_add(o, 0, NT, 0)
                room_use[o] += guests * n_o / max(1, sum(S["guest_owner"].values())) / max(1, n_o)
            # staff through opening hours
            open_h = [h for h in HOURS if f[h] > 0.05]
            staff = fig["workDesks"]
            if open_h and staff:
                present[(open_h[0] - 1) * 60 - T0 if open_h[0] > 6 else 0:(open_h[-1] + 1) * 60 - T0] += staff
            present += guests
            wc_rate += (guests * 0.4 + (present - guests) * A["wc_rate"]) / 60
            walk.append(2 * S["mean_d"](S["d_entry"], S["seat_cells"]))
        # food rooms share whoever is at lunch on the floor by their seats
        food_seats = sum(S["food_owner"].values())
        if work and food_seats:
            for o, n_o in S["food_owner"].items():
                use_add(o, 0, NT, 0)
                room_use[o] += at_food * (n_o / food_seats) / max(1, n_o)
        food_peaks.append(float(at_food.max()))
        # WCs: each person goes to the nearest WC room
        share = _wc_share(S)
        day_waits, wc_inside = [], np.zeros(NT)
        for w_i, cub in enumerate(S["wc_cubicles"]):
            arrivals = rng.poisson(wc_rate * share[w_i])
            ws, inside = _wc_queue(rng, arrivals, max(1, cub))
            day_waits += ws
            wc_inside += inside
        waits_all += day_waits
        wc_peak_waits.append(max(day_waits) if day_waits else 0)
        desk_now = np.maximum(0, present - in_meet - at_food - in_focus - wc_inside - guests)
        for key, v in (("present", present), ("desk", desk_now), ("meeting", in_meet), ("food", at_food), ("focus", in_focus),
                       ("wc", wc_inside), ("guests", guests)):
            acc[key].append(_hourly(v))
        peaks.append(float(present.max()))
        person_hours.append(float(present.sum() / 60))

    P = np.array(acc["present"])
    hourly = {k: np.round(np.mean(v, axis=0), 1).tolist() for k, v in acc.items()}
    waits = np.array(waits_all) if waits_all else np.zeros(1)
    open_minutes = (17 - 8) * 60 * days       # rooms counted over a working day, 08-17
    meet_rooms = [{"id": r["id"], "name": r["name"], "cap": r["cap"],
                   "bookedShare": round(float(meet_minutes[k] / open_minutes), 3),
                   "avgFill": round(float(meet_fill[k] / meet_n[k]), 2) if meet_n[k] else 0.0} for k, r in enumerate(S["meet"])]
    seats_by_owner = {**{o: S["desk_owner"].count(o) for o in set(S["desk_owner"])}, **{r["id"]: 1 for r in S["meet"]},
                      **{r: 1 for r in S["focus"]}}
    room_hourly = {o: np.round(np.clip(_hourly(v / days / (seats_by_owner.get(o, 1))), 0, 1), 3).tolist()
                   for o, v in room_use.items()}
    out = {
        "use": CATALOGUE_USE.get(L.use, "office"), "kind": "work" if work else "guests", "days": days, "seed": seed,
        "hours": HOURS, "curve": [f[h] for h in HOURS],
        "people": {"mean": hourly["present"], "p90": np.round(np.percentile(P, 90, axis=0), 1).tolist()},
        "activity": {k: hourly[k] for k in ("desk", "meeting", "food", "focus", "wc", "guests")},
        "peak": {"mean": round(float(np.mean(peaks)), 1), "p90": round(float(np.percentile(peaks, 90)), 1), "max": int(max(peaks)),
                 "planned": fig["people"], "legalMax": fig["designLoad"]},
        "personHours": round(float(np.mean(person_hours)), 1),
        "m2PerPersonHour": round(fig["gfa"] / max(1.0, float(np.mean(person_hours))), 2),
        "wc": {"cubicles": int(sum(S["wc_cubicles"])), "waitMean": round(float(waits.mean()), 2),
               "waitP90": round(float(np.percentile(waits, 90)), 1), "waitP99": round(float(np.percentile(waits, 99)), 1),
               "worstDay": round(float(np.mean(wc_peak_waits)), 1)},
        "walk": {"perPersonDay": round(float(np.mean(walk)), 1)},
        "roomUse": room_hourly,
        "assumptions": {k: v for k, v in A.items() if not isinstance(v, tuple)},
        "note": "Uncalibrated: hourly presence from the use catalogue, other rates are assumptions. No sensor data yet.",
    }
    if work:
        out["staff"] = n_staff
        out["attendance"] = round(float(staff_attend), 2)
        out["lunchOut"] = round(lunch_out, 2)
        out["desks"] = {"n": n_desks, "shared": shared, "peakMean": round(float(np.mean(desk_peak)), 1),
                        "peakP90": round(float(np.percentile(desk_peak, 90)), 1),
                        "useAtPeak": round(float(np.mean(desk_peak)) / max(1, n_desks), 2),
                        "shortDays": round(short_days / days, 2), "withoutDesk": round(float(np.mean(no_desk)), 1)}
        out["meetings"] = {"rooms": meet_rooms, "perDay": round(meet_req / days, 1), "deniedPerDay": round(meet_denied / days, 1),
                           "deniedShare": round(meet_denied / max(1, meet_req), 3), "tooBigShare": round(meet_toobig / max(1, meet_req), 3)}
        out["focus"] = {"rooms": len(S["focus"]), "perDay": round(focus_req / days, 1), "deniedShare": round(focus_denied / max(1, focus_req), 3)}
        food_seats = sum(S["food_owner"].values())
        out["food"] = {"seats": food_seats, "peakMean": round(float(np.mean(food_peaks)), 1),
                       "crowding": round(float(np.mean(food_peaks)) / max(1, food_seats), 2)}
    else:
        out["demand"] = demand
        out["guests"] = {"seats": int(sum(S["guest_owner"].values())), "usable": int(A["seat_fill"] * sum(S["guest_owner"].values())),
                         "coversPerDay": round(covers / days, 1), "turnedAwayPerDay": round(turned / days, 1),
                         "turnedAwayShare": round(turned / max(1, covers + turned), 3),
                         "peakFill": round(float(np.max(hourly["guests"])) / max(1, A["seat_fill"] * sum(S["guest_owner"].values())), 2)}
    return out


def _d(dist, S, desk):
    """Walking distance from a person's desk (or the floor's average desk) along a distance field."""
    cells = S["desk_cell"]
    if desk is not None and desk >= 0 and cells[desk] >= 0 and np.isfinite(dist[cells[desk]]):
        return float(dist[cells[desk]])
    return S["mean_d"](dist, cells)


def _wc_share(S):
    """Share of the floor whose nearest WC room is each one (by desk, else evenly)."""
    n = len(S["wcs"])
    if not n:
        return []
    cells = S["desk_cell"][S["desk_cell"] >= 0] if len(S["desk_cell"]) else S["seat_cells"]
    near = S["wc_of"][cells] if len(cells) else np.array([], dtype=int)
    near = near[near >= 0]
    if not near.size:
        return [1 / n] * n
    return [float((near == k).sum() / near.size) for k in range(n)]
