// Two projects side by side (?split=marievik,lindangen): one full explorer per pane, each in its own frame,
// so each keeps its own site, camera, scale and panels. The frames get ?embed=1, which hides this button in them.
import { useEffect, useState } from 'react'
import { PROJECTS } from './profile'

const KEYS = Object.keys(PROJECTS)

function readSplit(): [string, string] {
  const q = new URLSearchParams(window.location.search)
  const [a, b] = (q.get('split') ?? '').split(',')
  const left = PROJECTS[a] ? a : 'marievik'
  const right = PROJECTS[b] ? b : KEYS.find((k) => k !== left)!
  return [left, right]
}

/** The address of one pane: the parent's query (profile, lite …) with this project, embedded. */
function paneSrc(project: string) {
  const q = new URLSearchParams(window.location.search)
  q.delete('split')
  q.delete('building')
  q.set('project', project)
  q.set('embed', '1')
  return `${window.location.pathname}?${q.toString()}`
}

/** Leave side by side for one project (the left one). */
export function singleHref(project: string) {
  const q = new URLSearchParams(window.location.search)
  q.delete('split')
  q.delete('embed')
  q.set('project', project)
  return `${window.location.pathname}?${q.toString()}`
}

/** Open side by side from a single-project view: this project on the left, the next one with its own model on the right. */
export function splitHref(project: string) {
  const other = KEYS.find((k) => k !== project && !PROJECTS[k].placeholder) ?? KEYS.find((k) => k !== project)!
  const q = new URLSearchParams(window.location.search)
  q.delete('building')
  q.set('split', `${project},${other}`)
  return `${window.location.pathname}?${q.toString()}`
}

function Picker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] font-semibold">
      <span className="text-ink-2">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border-2 border-edge bg-surface px-2 py-1 font-semibold shadow-[2px_2px_0_var(--color-edge)]">
        {KEYS.map((k) => (
          <option key={k} value={k}>{PROJECTS[k].name}, {PROJECTS[k].city}{PROJECTS[k].placeholder ? ' (placeholder model)' : ''}</option>
        ))}
      </select>
    </label>
  )
}

export default function SideBySide() {
  const [[left, right], setPair] = useState<[string, string]>(readSplit)

  // keep the URL in step so a reload or a shared link opens the same pair
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    q.set('split', `${left},${right}`)
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
  }, [left, right])

  const btn = 'rounded-md border-2 border-edge bg-surface px-3 py-1 text-[12.5px] font-semibold shadow-[2px_2px_0_var(--color-edge)] hover:bg-accent-soft'
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <header className="z-10 flex flex-wrap items-center gap-3 border-b-2 border-edge bg-surface px-4 py-2 shadow-[0_3px_0_var(--color-edge)]">
        <span className="font-mono text-[13px] font-bold uppercase tracking-wide">Side by side</span>
        <Picker label="Left" value={left} onChange={(v) => setPair([v, right])} />
        <button className={btn} onClick={() => setPair([right, left])} title="Swap the two projects">⇄ Swap</button>
        <Picker label="Right" value={right} onChange={(v) => setPair([left, v])} />
        <a className={`${btn} ml-auto`} href={singleHref(left)} title="Back to one project (the left one)">Close side by side</a>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {[left, right].map((p, i) => (
          <iframe key={`${i}:${p}`} src={paneSrc(p)} title={`${PROJECTS[p].name} explorer`}
            className={`min-h-0 flex-1 border-edge ${i === 0 ? 'border-b-2 md:border-b-0 md:border-r-2' : ''}`} />
        ))}
      </div>
    </div>
  )
}
