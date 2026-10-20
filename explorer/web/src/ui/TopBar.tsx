import type { ReactNode } from 'react'
import type { SitePayload } from '../types'

export type Tab = 'explore' | 'design' | 'analyse' | 'compare'
export const TABS: [Tab, string, string][] = [
  ['explore', 'Explore', 'Move through the site, a building, a floor and a unit; set up the building and see its figures'],
]

// AMF Marievik's own palette (amffastigheter.se/marievik/): deep ink bar, brand blue and coral accents.
const INK = '#202020'
const BLUE = '#0528ca'
const CORAL = '#fd876e'

interface Props {
  site: SitePayload | null
  tab: Tab
  setTab: (t: Tab) => void
  building: string | null
  onBuilding: (id: string | null) => void
  location: string
  profile: { value: string; options: [string, string][]; onChange: (v: string) => void }
  right?: ReactNode
}

/** The lab's bar: brand, the four ways of working, where you are and which building, who you are looking as. */
export function TopBar({ site, tab, setTab, building, onBuilding, location, profile, right }: Props) {
  const initials = (profile.options.find(([k]) => k === profile.value)?.[1] ?? '')
    .split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-6 px-5 text-[13.5px] shadow-md"
      style={{ background: INK, color: '#eef0ef' }}>
      <a href="/" className="flex items-baseline gap-2.5" title="Back to the Digital Lab home page">
        <span className="text-[22px] tracking-tight" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          Marievik<span style={{ color: BLUE }}>+</span>
        </span>
        <span className="font-mono text-[11px] tracking-[0.12em]" style={{ color: CORAL }}>DIGITAL LAB</span>
      </a>
      <nav className="ml-8 flex h-full items-stretch" aria-label="Mode">
        {TABS.map(([id, label, hint]) => (
          <button key={id} onClick={() => setTab(id)} title={hint} aria-pressed={tab === id}
            className={`relative px-5 font-medium transition-colors ${tab === id ? 'bg-white/10 text-white' : 'text-white/80 hover:text-white'}`}>
            {label}
            {tab === id && <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: BLUE }} />}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {right}
        <span className="hidden items-center gap-1.5 text-white/85 xl:flex">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10z" /><circle cx="10" cy="8" r="2.2" />
          </svg>
          {location}
        </span>
        <select value={building ?? ''} onChange={(e) => onBuilding(e.target.value || null)} aria-label="Building"
          className="max-w-[15rem] rounded-md border border-white/15 bg-white/10 px-2.5 py-1.5 text-[12.5px] text-white outline-none">
          <option value="" className="text-black">Whole site</option>
          {site?.buildings.map((b) => (
            <option key={b.id} value={b.id} className="text-black">{b.id} – {b.name.split(' - ')[0]}{b.name.includes(' - ') ? ` (${b.name.split(' - ')[1].split(' (')[0]})` : ''}</option>
          ))}
        </select>
        <label className="relative" title="View as: the stakeholder profile whose KPIs are shown">
          <select value={profile.value} onChange={(e) => profile.onChange(e.target.value)} aria-label="View as profile"
            className="absolute inset-0 cursor-pointer opacity-0">
            <option value="">No profile</option>
            {profile.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="grid h-9 w-9 place-items-center rounded-full text-[12.5px] font-semibold" style={{ background: BLUE, color: '#fff' }}>
            {initials || '·'}
          </span>
        </label>
      </div>
    </header>
  )
}
