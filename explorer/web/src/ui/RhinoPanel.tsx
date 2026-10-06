import { useRef, useState } from 'react'
import { Card, Toggle } from './kit'

export interface RhinoLayer { name: string; visible: boolean; color: string }

interface Props {
  models: { name: string; url: string; bytes: number }[]
  layers: RhinoLayer[]
  onLoad: (src: string | ArrayBuffer, label: string) => void
  onLayers: (visible: Set<string>) => void
  showGenerated: boolean
  setShowGenerated: (v: boolean) => void
}

export function RhinoPanel({ models, layers, onLoad, onLayers, showGenerated, setShowGenerated }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Card title="Rhino model" right={
      <button className="text-[11px] text-accent hover:underline" onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'show'}</button>}>
      {open && (
        <>
          <p className="mb-2 text-[11px] leading-snug text-muted">
            Open a .3dm (meters, same site coordinates as Grasshopper) to see it in this view, with its layers.
            Files in <span className="font-mono">explorer/models</span> are listed here.
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {models.map((m) => (
              <button key={m.name} onClick={() => onLoad(m.url, m.name)}
                className="rounded border border-line bg-surface px-2 py-0.5 text-[11.5px] hover:border-accent">
                {m.name} <span className="font-mono text-muted">{(m.bytes / 1e6).toFixed(1)} MB</span>
              </button>
            ))}
            <button onClick={() => file.current?.click()} className="rounded border border-dashed border-line-strong px-2 py-0.5 text-[11.5px] hover:border-accent">
              Open .3dm…
            </button>
            <input ref={file} type="file" accept=".3dm" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) onLoad(await f.arrayBuffer(), f.name)
              e.target.value = ''
            }} />
          </div>
          <div className="mb-1.5"><Toggle on={showGenerated} onChange={setShowGenerated} label="Generated buildings" /></div>
          {layers.length > 0 && (
            <ul className="max-h-56 overflow-y-auto border-t border-line pt-1">
              {layers.map((l) => (
                <li key={l.name}>
                  <label className="flex items-center gap-1.5 py-[1px] text-[11.5px]">
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
        </>
      )}
    </Card>
  )
}
