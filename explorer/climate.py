"""
explorer.climate - the weather file and the sun, without third-party packages.

EPW: data/climate/SWE_ST_Stockholm.024850_TMYx.2011-2025.epw (the same file the EnergyPlus
thermal simulation in optimise/thermal_sim.py uses). Sun position: NOAA solar position
equations (accurate to well under a degree, which is ample for shading and solar gains).
"""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EPW_DEFAULT = ROOT / "data" / "climate" / "SWE_ST_Stockholm.024850_TMYx.2011-2025.epw"


class Weather:
    def __init__(self, path: Path):
        self.path = Path(path)
        lines = self.path.read_text(encoding="utf-8", errors="ignore").splitlines()
        loc = lines[0].split(",")
        self.city = loc[1]
        self.lat, self.lon, self.tz, self.elev = float(loc[6]), float(loc[7]), float(loc[8]), float(loc[9])
        rows = [ln.split(",") for ln in lines[8:] if ln.count(",") > 20]
        rows = rows[:8760]
        self.month = [int(r[1]) for r in rows]
        self.day = [int(r[2]) for r in rows]
        self.hour = [int(r[3]) for r in rows]                     # 1..24, end of the hour
        self.dry_bulb = [float(r[6]) for r in rows]
        self.rh = [float(r[8]) for r in rows]
        self.ghi = [float(r[13]) for r in rows]
        self.dni = [float(r[14]) for r in rows]
        self.dhi = [float(r[15]) for r in rows]
        self.wind = [float(r[21]) for r in rows]
        self._sun = None

    @property
    def sun(self) -> list[tuple[float, float]]:
        """(altitude, azimuth) in degrees for the middle of every hour; azimuth from north, clockwise."""
        if self._sun is None:
            out = []
            doy = 0
            last = None
            for m, d, h in zip(self.month, self.day, self.hour):
                if (m, d) != last:
                    doy += 1
                    last = (m, d)
                out.append(sun_position(self.lat, self.lon, self.tz, doy, h - 0.5))
            self._sun = out
        return self._sun

    def daily_means(self) -> list[float]:
        return [sum(self.dry_bulb[i:i + 24]) / 24 for i in range(0, len(self.dry_bulb), 24)]

    def running_mean(self, alpha: float = 0.8) -> list[float]:
        """EN 16798-1 exponentially weighted running mean of the daily mean outdoor temperature, per day."""
        dm = self.daily_means()
        out = []
        trm = sum(dm[-7:]) / 7                                       # start from the last week of the year
        for t in dm:
            out.append(trm)
            trm = (1 - alpha) * t + alpha * trm
        return out


@lru_cache(maxsize=4)
def load(path: str | None = None) -> Weather:
    return Weather(Path(path) if path else EPW_DEFAULT)


def sun_position(lat: float, lon: float, tz: float, doy: int, hour: float) -> tuple[float, float]:
    """Solar altitude and azimuth (deg) for local standard time `hour` on day-of-year `doy`."""
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hour * 60 + eqt + 4 * lon - 60 * tz
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    cz = max(-1.0, min(1.0, cz))
    zen = math.acos(cz)
    alt = 90 - math.degrees(zen)
    sz = math.sin(zen)
    if sz < 1e-6:
        az = 180.0
    else:
        ca = (math.sin(la) * cz - math.sin(decl)) / (math.cos(la) * sz)
        az = math.degrees(math.acos(max(-1.0, min(1.0, ca))))
        az = (az + 180) % 360 if ha > 0 else (540 - az) % 360
    return alt, az
