// Colours with a job. Unit types are categorical (fixed order, never cycled: an unknown type
// folds into "other"); daylight factor and comfort are sequential bins of one perceptual ramp.

// Marievik+ categorical set (frontend/src/index.css, CVD-validated), assigned by use family.
export const UNIT_COLORS: Record<string, string> = {
  Apartment: '#3d8fd1',
  Office: '#d2601a',
  'Open office': '#d2601a',
  'Guest room': '#c46ba4',
  Classroom: '#128f6e',
  Retail: '#dfa00c',
  Shop: '#dfa00c',
  other: '#8a72d8',
}
export const COMMON_COLOR = '#9aa19d'

export function unitColor(name: string, kind: string): string {
  if (kind === 'common') return COMMON_COLOR
  for (const k of Object.keys(UNIT_COLORS)) if (name.startsWith(k)) return UNIT_COLORS[k]
  return UNIT_COLORS.other
}

// Daylight factor bins (%), keyed to EN 17037 for Stockholm: < 0.7 % is below 100 lx,
// 2.1 % is the 300 lx target. A cividis-like ramp: dark blue (little light) to pale yellow.
export const DF_BINS = [
  { max: 0.7, color: '#1d2f5a', label: '< 0.7' },
  { max: 1.4, color: '#3f4e6e', label: '0.7–1.4' },
  { max: 2.1, color: '#6d6d72', label: '1.4–2.1' },
  { max: 3.5, color: '#9e8f62', label: '2.1–3.5' },
  { max: 5.0, color: '#cfb44c', label: '3.5–5' },
  { max: Infinity, color: '#fbe14a', label: '≥ 5' },
]
export function dfColor(v: number) {
  return (DF_BINS.find((b) => v < b.max) ?? DF_BINS[DF_BINS.length - 1]).color
}

// Share of occupied hours inside the EN 16798-1 category II band.
export const COMFORT_BINS = [
  { max: 70, color: '#5b1f2c', label: '< 70 %' },
  { max: 80, color: '#93413a', label: '70–80' },
  { max: 90, color: '#c47a4c', label: '80–90' },
  { max: 95, color: '#d9b77a', label: '90–95' },
  { max: Infinity, color: '#e9e3c9', label: '≥ 95 %' },
]
export function comfortColor(v: number) {
  return (COMFORT_BINS.find((b) => v < b.max) ?? COMFORT_BINS[COMFORT_BINS.length - 1]).color
}

export function rgb(c: [number, number, number] | undefined, fallback = '#d8d4cc') {
  if (!c) return fallback
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
