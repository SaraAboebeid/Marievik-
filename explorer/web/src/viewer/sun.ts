// NOAA solar position (same equations as explorer/climate.py), local standard time.
export function sunPosition(lat: number, lon: number, tz: number, doy: number, hour: number) {
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24)
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const tst = hour * 60 + eqt + 4 * lon - 60 * tz
  const ha = ((tst / 4 - 180) * Math.PI) / 180
  const la = (lat * Math.PI) / 180
  const cz = Math.min(1, Math.max(-1, Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha)))
  const zen = Math.acos(cz)
  const alt = 90 - (zen * 180) / Math.PI
  let az = 180
  const sz = Math.sin(zen)
  if (sz > 1e-6) {
    const ca = Math.min(1, Math.max(-1, (Math.sin(la) * cz - Math.sin(decl)) / (Math.cos(la) * sz)))
    az = (Math.acos(ca) * 180) / Math.PI
    az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360
  }
  return { altitude: alt, azimuth: az }
}

export function dayOfYear(month: number, day: number) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  return cum[month - 1] + day
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
