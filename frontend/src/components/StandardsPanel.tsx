import { fmt } from '../api'
import type { StandardsSummary } from '../types'

/**
 * What the standards engine says about designing for this person.
 *
 * This is the sheet you would otherwise look up in a reference book,
 * assembled for the specific user group being tested — and, unlike a book,
 * it says which of its own numbers are traced to a source.
 */
export function StandardsPanel({ std }: { std: StandardsSummary }) {
  const env = std.envelope as Record<string, number | string>

  return (
    <div className="space-y-2">
      <section className="rounded-md border border-line bg-raised px-3 py-2.5">
        <h4 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
          Designing for
        </h4>
        <p className="mt-1 text-[15px] font-semibold">{std.label}</p>
        <p className="text-[11.5px] text-muted">{String(std.posture).replace(/_/g, ' ')}</p>

        <dl className="mt-2.5 space-y-1 text-[12px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Turning circle</dt>
            <dd className="font-mono tabular-nums">{fmt(std.turning_circle_mm)} mm</dd>
          </div>
          {std.reach_band_mm && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Comfortable reach band</dt>
              <dd className="font-mono tabular-nums">
                {fmt(std.reach_band_mm[0])}–{fmt(std.reach_band_mm[1])} mm
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Max sill for a real view</dt>
            <dd className="font-mono tabular-nums">{fmt(std.max_sill_for_view_mm)} mm</dd>
          </div>
          {typeof env.eye_height_p50 === 'number' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Eye height</dt>
              <dd className="font-mono tabular-nums">{fmt(env.eye_height_p50)} mm</dd>
            </div>
          )}
          {typeof env.occupied_depth === 'number' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Occupied depth</dt>
              <dd className="font-mono tabular-nums">{fmt(env.occupied_depth)} mm</dd>
            </div>
          )}
        </dl>

        {std.reach_band_mm && (
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Anything this person must operate — switch, handle, socket, shelf, hob
            control — belongs inside the reach band. Most standard kitchens put half
            their storage outside it.
          </p>
        )}
      </section>

      <section className="rounded-md border border-line bg-raised px-3 py-2.5">
        <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
          Heights
        </h4>
        <p className="mb-2 text-[11px] leading-snug text-muted">
          A counter height <em>is</em> this person&rsquo;s work surface; a switch
          <em> is</em> somewhere inside their reach. Derived, so one change of user
          group moves every height at once.
        </p>
        <div className="space-y-0">
          {(std.heights ?? []).map((h) => (
            <details key={h.id} className="border-t border-line py-1.5 first:border-t-0">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 text-[12px]">
                <span className={h.warning ? 'text-warn' : undefined}>
                  {h.label}{h.warning ? ' ⚠' : ''}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-ink-2">
                  {h.is_maximum && <span className="text-muted">≤ </span>}
                  {fmt(h.value_mm)}<span className="text-muted"> mm</span>
                </span>
              </summary>
              <p className="mt-1 text-[11px] leading-snug text-muted">{h.basis}</p>
              {h.warning && (
                <p className="mt-1 text-[11px] leading-snug text-warn">{h.warning}</p>
              )}
              {h.note && (
                <p className="mt-1 text-[11px] leading-snug text-muted">{h.note}</p>
              )}
              <p className="mt-1 font-mono text-[10px] text-muted">
                {h.source_ref.length ? h.source_ref.join(' · ') : '⚠ uncited'}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-raised px-3 py-2.5">
        <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
          Space each activity needs
        </h4>
        <p className="mb-2 text-[11px] leading-snug text-muted">
          Derived from this person&rsquo;s body, not looked up as a fixed number.
          Change the user group and every figure moves.
        </p>
        <div className="space-y-0">
          {std.activities.filter((a) => a.depth_mm > 0).map((a) => (
            <details key={a.id} className="border-t border-line py-1.5 first:border-t-0">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 text-[12px]">
                <span>{a.label}</span>
                <span className="whitespace-nowrap font-mono tabular-nums text-ink-2">
                  {fmt(a.depth_mm)}
                  {a.width_mm > 0 && <span className="text-muted"> × {fmt(a.width_mm)}</span>}
                  <span className="text-muted"> mm</span>
                </span>
              </summary>
              <p className="mt-1 text-[11px] leading-snug text-muted">{a.basis}</p>
              {a.note && <p className="mt-1 text-[11px] leading-snug text-muted">{a.note}</p>}
              {a.neufert_ref && (
                <p className="mt-1 rounded border-l-2 border-accent bg-accent-soft px-2 py-1 font-mono text-[10px] leading-snug text-ink-2">
                  Neufert {a.neufert_ref}
                </p>
              )}
              <p className="mt-1 font-mono text-[10px] text-muted">
                {a.source_ref.length ? a.source_ref.join(' · ') : '⚠ uncited — verify before publishing'}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-raised px-3 py-2.5">
        <h4 className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-muted">
          Source coverage
        </h4>
        <div className="flex justify-between gap-3 text-[12px]">
          <span className="text-muted">Records traced to a source</span>
          <span className="font-mono tabular-nums">
            {std.coverage.cited}/{std.coverage.records} ({Math.round(std.coverage.cited_share * 100)}%)
          </span>
        </div>
        <div className="flex justify-between gap-3 text-[12px]">
          <span className="text-muted">Verified against Neufert</span>
          <span className="font-mono tabular-nums">
            {std.coverage.neufert_verified}/{std.coverage.records}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-sunken">
          <div className="h-full rounded-sm bg-accent"
            style={{ width: `${std.coverage.cited_share * 100}%` }} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Every rule carries a <code className="font-mono">neufert_ref</code> slot.
          Fill it from your own copy as an internal verification pass, and cite the
          regulation — not the book — as the published source.
        </p>
        {std.coverage.uncited.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[10.5px] text-warn">
              {std.coverage.uncited.length} uncited records
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted">
              {std.coverage.uncited.map((u) => <li key={u}>{u}</li>)}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
