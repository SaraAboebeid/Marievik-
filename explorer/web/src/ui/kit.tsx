import { useState, type ReactNode } from 'react'

// Accent colour is reserved for primary actions and the selected building; everything else is neutral.

/** Card and section titles: the same small bold capitals in every panel. */
export const CARD_TITLE = 'font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink'

export function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-xl border bg-raised shadow-sm">
      <div className="checker-band flex items-center justify-between gap-2 px-4 pb-3 pt-2">
        <h4 className={CARD_TITLE}>{title}</h4>
        {right}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/** A card whose body folds away; the open state is remembered per section in this browser. */
export function Section({ id, title, right, children, defaultOpen = true }: {
  id: string; title: ReactNode; right?: ReactNode; children: ReactNode; defaultOpen?: boolean
}) {
  const key = `mvx-section-${id}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key, o ? '0' : '1') } catch { /* private window */ }
      return !o
    })
  }
  return (
    <section className="mb-3 overflow-hidden rounded-xl border bg-raised shadow-sm">
      <div className={`checker-band flex items-center justify-between gap-2 px-4 pb-3 pt-2 ${open ? '' : '-mb-[2px]'}`}>
        <button type="button" onClick={toggle} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`inline-block text-[10px] text-ink transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>▶</span>
          <span className={`truncate ${CARD_TITLE}`}>{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="px-4 py-3">{children}</div>}
    </section>
  )
}

export function Row({ label, value, sub, strong }: { label: ReactNode; value: ReactNode; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-[3px] ${sub ? 'pl-2 text-[12px] text-ink-2' : 'text-[13px] text-ink'} ${strong ? 'mt-1 border-t border-line pt-1.5 font-semibold' : ''}`}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="whitespace-nowrap font-medium tabular-nums">{value}</span>
    </div>
  )
}

/** A headline number: label, big value, small qualifier. */
export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-line bg-sunken px-3 py-2.5">
      <div className="flex items-baseline gap-1">
        <span className="text-[19px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}</span>
        {unit && <span className="text-[12px] font-medium text-ink-2">{unit}</span>}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-tight text-ink-2">{label}</div>
      {sub && <div className="mt-1 text-[11px] leading-tight text-muted">{sub}</div>}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 flex justify-between text-[12px] text-ink-2">
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
      className="w-full rounded border-2 border-edge bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50"
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
      className="w-full accent-[var(--color-ink-2)]"
    />
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`rounded border-2 px-2 py-0.5 text-[12px] transition-colors ${on ? 'border-edge bg-accent font-semibold text-white' : 'border-line-strong bg-surface text-ink-2 hover:text-ink'}`}
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
      className={`rounded-md border-2 border-edge px-3 py-1.5 text-[12.5px] font-semibold transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${primary ? 'bg-accent text-white' : 'bg-surface text-ink'}`}
    >
      {children}
    </button>
  )
}

/** A destructive action that asks once more, inline, before it acts. */
export function ConfirmButton({ children, confirm, onConfirm }: { children: ReactNode; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}
        className="rounded border border-line px-3 py-1.5 text-[12.5px] text-critical hover:border-critical">
        {children}
      </button>
    )
  }
  return (
    <div className="rounded border border-critical bg-critical-bg px-2.5 py-2 text-[12px] text-critical">
      <p className="mb-1.5 leading-snug">{confirm}</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => { setAsking(false); onConfirm() }}
          className="rounded bg-critical px-2.5 py-1 font-medium text-white hover:brightness-110">Yes, reset</button>
        <button type="button" onClick={() => setAsking(false)}
          className="rounded border border-line bg-surface px-2.5 py-1 text-ink">Cancel</button>
      </div>
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'serious' | 'critical' | 'muted'; children: ReactNode }) {
  const cls = {
    good: 'bg-good-bg text-good', warn: 'bg-warn-bg text-warn', serious: 'bg-serious-bg text-serious',
    critical: 'bg-critical-bg text-critical', muted: 'bg-sunken text-ink-2',
  }[tone]
  return <span className={`rounded px-1.5 py-[1px] font-mono text-[10.5px] font-medium ${cls}`}>{children}</span>
}

export function Legend({ title, bins }: { title: string; bins: { color: string; label: string }[] }) {
  return (
    <div className="rounded-md border border-line bg-raised/95 px-3 py-2 shadow-sm">
      <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">{title}</div>
      <div className="flex gap-0.5">
        {bins.map((b) => (
          <div key={b.label} className="flex flex-col items-center">
            <span className="h-2.5 w-11 rounded-[2px]" style={{ background: b.color }} />
            <span className="mt-0.5 font-mono text-[10.5px] text-ink-2">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
