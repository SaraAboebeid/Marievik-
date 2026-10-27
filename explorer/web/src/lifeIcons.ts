// Urban scale, "Life on Marievik": one small line icon per activity category and amenity type,
// shared by the map pins (Viewer.setLifePins) and the panel (ui/LifePanel.tsx).

const P: Record<string, string> = {
  // activity categories (urban_life.json → categories)
  kultur: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  mat: '<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M18 21V3c-2.5 1-4 4-4 9h4"/>',
  hallbarhet: '<path d="M5 20c-1-9 5-15 15-15 0 10-6 15-15 15z"/><path d="M5 20l8-8"/>',
  halsa: '<path d="M2.5 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2.5 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  community: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2.7-6 6-6s6 2 6 6"/><path d="M15.5 14.3c3 0 5.5 1.7 5.5 5.7"/>',
  fysiska: '<rect x="3" y="13" width="8" height="7"/><rect x="13" y="13" width="8" height="7"/><rect x="8" y="5" width="8" height="7"/>',
  // amenity types (urbanLife.ts → AMENITY_TYPES)
  restaurant: '<circle cx="12" cy="12" r="5.5"/><path d="M3 4v6.5M3 10.5V20M21 4c-1.3.8-2 2.5-2 5h2M21 9v11"/>',
  cafe: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2.5M12 3.5v2.5"/>',
  bar: '<path d="M4 4h16l-8 9z"/><path d="M12 13v7M8 20h8"/>',
  fast_food: '<path d="M4 11a8 6 0 0 1 16 0z"/><path d="M3 14.5h18"/><path d="M4 17.5h16v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  hotel: '<path d="M3 19V6M3 14h18v5M21 14v-1.5A3.5 3.5 0 0 0 17.5 9H11v5"/><circle cx="7" cy="11" r="2"/>',
  spa: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  venue: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  park: '<path d="M12 21v-5"/><path d="M12 3L6 11.5h3L5.5 16h13L15 11.5h3z"/>',
  playground: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3.2 3 3.2 14 0 17M12 3.5c-3.2 3-3.2 14 0 17"/>',
  supermarket: '<path d="M2.5 4h3l2.2 11h11l2-8H6.6"/><circle cx="9" cy="19.3" r="1.5"/><circle cx="17.5" cy="19.3" r="1.5"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
}

/** The icon as an inline SVG string (stroke follows `color`, so the pin or chip sets it). */
export function lifeIconSvg(key: string, size = 14, stroke = 2.3): string {
  const d = P[key] ?? P.dot
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
}

/** Ink or cream, whichever reads on a fill colour. */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#202020'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return L > 0.2 ? '#202020' : '#fffdf6'
}
