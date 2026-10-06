import type { ReactNode } from 'react'

export function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-2 rounded-md border border-line bg-raised/95 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, value, sub, strong }: { label: ReactNode; value: ReactNode; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2.5 py-[2px] ${sub ? 'text-[11.5px] text-muted' : 'text-[12.5px]'} ${strong ? 'mt-1 border-t border-line pt-1.5 font-semibold' : ''}`}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="whitespace-nowrap font-mono tabular-nums">{value}</span>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 flex justify-between text-[11px] text-ink-2">
        <span>{label}</span>
        {hint && <span className="font-mono text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function Select({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-line bg-surface px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

export function Slider({ value, min, max, step = 1, onChange, onCommit }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void
}) {
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      className="w-full accent-[var(--color-accent)]"
    />
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`rounded border px-2 py-0.5 text-[11.5px] transition-colors ${on ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface text-muted hover:text-ink'}`}
    >
      {label}
    </button>
  )
}

export function Button({ children, onClick, primary, disabled, title }: {
  children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${primary ? 'bg-accent text-white hover:brightness-110' : 'border border-line bg-surface text-ink hover:border-line-strong'}`}
    >
      {children}
    </button>
  )
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'serious' | 'critical' | 'muted'; children: ReactNode }) {
  const cls = {
    good: 'bg-good-bg text-good', warn: 'bg-warn-bg text-warn', serious: 'bg-serious-bg text-serious',
    critical: 'bg-critical-bg text-critical', muted: 'bg-sunken text-muted',
  }[tone]
  return <span className={`rounded px-1.5 py-[1px] font-mono text-[10px] font-medium ${cls}`}>{children}</span>
}

export function Legend({ title, bins }: { title: string; bins: { color: string; label: string }[] }) {
  return (
    <div className="rounded-md border border-line bg-raised/95 px-2.5 py-2">
      <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.09em] text-muted">{title}</div>
      <div className="flex gap-0.5">
        {bins.map((b) => (
          <div key={b.label} className="flex flex-col items-center">
            <span className="h-2.5 w-11 rounded-[2px]" style={{ background: b.color }} />
            <span className="mt-0.5 font-mono text-[9.5px] text-ink-2">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
