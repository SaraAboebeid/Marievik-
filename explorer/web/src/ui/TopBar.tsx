import type { ReactNode } from 'react'
import type { SiteBuilding } from '../types'

export type Tab = 'explore' | 'design' | 'analyse' | 'compare'
export const TABS: [Tab, string, string][] = [
  ['explore', 'Explore', 'Move through the site, a building, a floor and a unit; set up the building and see its figures'],
]

/** A building's street address, the part of its name before the " - description" (e.g. "Marievik 27"). */
export function buildingAddress(b: SiteBuilding): string {
  return b.name.split(' - ')[0]
}

// Checkerboard style: a Marievik-blue bar, coral for whatever is active, ink outlines.
const INK = '#202020'
const BLUE = '#0528ca'
const CORAL = '#fd876e'

function BarTab({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`whitespace-nowrap rounded-md border-2 px-3.5 py-1.5 font-semibold transition-transform hover:-translate-y-px ${on ? '' : 'border-transparent text-white hover:bg-white/15'}`}
      style={on ? { background: CORAL, color: INK, borderColor: INK, boxShadow: `3px 3px 0 ${INK}` } : undefined}>
      {children}
    </button>
  )
}

interface Props {
  tab: Tab
  setTab: (t: Tab) => void
  location: string
  profile: { value: string; options: [string, string][]; onChange: (v: string) => void }
  tools?: { label: string; title?: string; open: boolean; onClick: () => void }[]
  right?: ReactNode
}

/** The lab's bar: brand, the four ways of working, where you are and which building, who you are looking as. */
export function TopBar({ tab, setTab, location, profile, tools, right }: Props) {
  const initials = (profile.options.find(([k]) => k === profile.value)?.[1] ?? '')
    .split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <header className="absolute inset-x-0 top-0 z-20">
    <div className="flex h-[52px] items-center gap-6 px-5 text-[13.5px]" style={{ background: BLUE, color: '#fff' }}>
      <a href="/" className="flex items-baseline gap-2.5" title="Back to the Digital Lab home page">
        <span className="text-[23px] tracking-tight" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
          Marievik<span style={{ color: CORAL }}>+</span>
        </span>
        <span className="font-mono text-[11px] font-medium tracking-[0.14em]" style={{ color: CORAL }}>DIGITAL LAB</span>
      </a>
      <nav className="ml-6 flex items-center gap-1.5" aria-label="Mode">
        {TABS.map(([id, label, hint]) => (
          <BarTab key={id} on={tab === id} onClick={() => setTab(id)} title={hint}>{label}</BarTab>
        ))}
        {tools?.map((t) => (
          <BarTab key={t.label} on={t.open} onClick={t.onClick} title={t.title}>{t.label}</BarTab>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {right}
        <span className="hidden items-center gap-1.5 font-medium text-white xl:flex">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10z" /><circle cx="10" cy="8" r="2.2" />
          </svg>
          {location}
        </span>
        <label className="relative" title="View as: the stakeholder profile whose KPIs are shown">
          <select value={profile.value} onChange={(e) => profile.onChange(e.target.value)} aria-label="View as profile"
            className="absolute inset-0 cursor-pointer opacity-0">
            <option value="">No profile</option>
            {profile.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="grid h-9 w-9 place-items-center rounded-full border-2 text-[12.5px] font-extrabold"
            style={{ background: CORAL, color: INK, borderColor: INK }}>
            {initials || '·'}
          </span>
        </label>
      </div>
    </div>
    <div className="checker-ribbon h-[12px]" aria-hidden />
    </header>
  )
}
