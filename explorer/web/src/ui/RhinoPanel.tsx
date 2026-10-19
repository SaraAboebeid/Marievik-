import { useRef } from 'react'
import { Section, Toggle } from './kit'

export interface RhinoLayer { name: string; visible: boolean; color: string }

interface Props {
  models: { name: string; url: string; bytes: number }[]
  layers: RhinoLayer[]
  loaded: string | null
  onLoad: (src: string | ArrayBuffer, label: string) => void
  onLayers: (visible: Set<string>) => void
  showGenerated: boolean
  setShowGenerated: (v: boolean) => void
}

/** Import a Rhino .3dm into the view. Its status shows even when the section is folded. */
export function RhinoPanel({ models, layers, loaded, onLoad, onLayers, showGenerated, setShowGenerated }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const shown = layers.filter((l) => l.visible).length
  return (
    <Section id="rhino" title="Import Rhino model" defaultOpen={false}
      right={loaded
        ? <span className="max-w-[9rem] truncate rounded bg-good-bg px-1.5 font-mono text-[10.5px] text-good" title={loaded}>loaded</span>
        : <span className="font-mono text-[10.5px] text-muted">none</span>}>
      <div className="mb-2.5 rounded-md bg-sunken px-2.5 py-1.5 text-[12px]">
        {loaded
          ? <><b className="font-medium text-ink">{loaded}</b><span className="text-ink-2"> · {layers.length} layers, {shown} shown</span></>
          : <span className="text-ink-2">No model loaded.</span>}
      </div>
      <p className="mb-2 text-[12px] leading-snug text-ink-2">
        Open a .3dm in metres, in the same site coordinates as Grasshopper. Files in <span className="font-mono">explorer/models</span> are
        listed here.
      </p>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {models.map((m) => (
          <button key={m.name} onClick={() => onLoad(m.url, m.name)}
            className="rounded border border-line-strong bg-surface px-2 py-1 text-[12px] hover:border-ink-2">
            {m.name} <span className="font-mono text-muted">{(m.bytes / 1e6).toFixed(1)} MB</span>
          </button>
        ))}
        <button onClick={() => file.current?.click()} className="rounded border border-dashed border-line-strong px-2 py-1 text-[12px] hover:border-ink-2">
          Open .3dm file…
        </button>
        <input ref={file} type="file" accept=".3dm" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) onLoad(await f.arrayBuffer(), f.name)
          e.target.value = ''
        }} />
      </div>
      <div className="mb-1.5"><Toggle on={showGenerated} onChange={setShowGenerated} label="Show generated buildings" /></div>
      {layers.length > 0 && (
        <ul className="max-h-56 overflow-y-auto border-t border-line pt-1">
          {layers.map((l) => (
            <li key={l.name}>
              <label className="flex items-center gap-1.5 py-[2px] text-[12px]">
                <input type="checkbox" checked={l.visible} onChange={(e) => {
                  const vis = new Set(layers.filter((x) => (x.name === l.name ? e.target.checked : x.visible)).map((x) => x.name))
                  onLayers(vis)
                }} />
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: l.color }} />
                <span className="truncate">{l.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
