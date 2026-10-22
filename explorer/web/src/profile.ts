// Stakeholder profile and project, chosen on the landing page and carried in the URL (?profile=…&project=…).

export const PROFILE_LABEL: Record<string, string> = {
  developer: 'Project developer',
  investor: 'Real estate investor',
  finance: 'Financial consultant',
  environmental: 'Environmental consultant',
  supplier: 'Material supplier',
}

/** Every project opens the Marievik model until its own is added. */
export const PROJECTS: Record<string, { name: string; city: string; placeholder: boolean }> = {
  marievik: { name: 'Marievik', city: 'Stockholm', placeholder: false },
  lindangen: { name: 'Lindängen', city: 'Malmö', placeholder: true },
  sandvangen: { name: 'Sandvången', city: 'Malmö', placeholder: true },
  uppsala: { name: 'Uppsala', city: 'Uppsala', placeholder: true },
  lillabommen: { name: 'Lilla Bommen', city: 'Göteborg', placeholder: true },
  gothenburg_schools: { name: 'Schools', city: 'Göteborg', placeholder: true },
  skelleftea_campus: { name: 'University campus', city: 'Skellefteå', placeholder: true },
}

/** A profile id is either generic (PROFILE_LABEL) or one of the project's own (data/projects/<id>.json),
 *  which is only known once the project has loaded, so any id is accepted here. */
export function readChoice(): { profile: string | null; project: string; kpis: string[] | null } {
  const q = new URLSearchParams(window.location.search)
  const profile = q.get('profile')
  const project = q.get('project')
  // ?kpis=a,b,c — the 10-year timeline KPIs picked on the landing page's step 3, overriding the profile's
  // own default set until the person picks a different profile (readChoice runs once, at load).
  const kpis = q.get('kpis')
  return {
    profile: profile && /^[a-z_]+$/.test(profile) ? profile : null,
    project: project && PROJECTS[project] ? project : 'marievik',
    kpis: kpis ? kpis.split(',').filter((k) => /^[a-z_]+$/.test(k)) : null,
  }
}

/** Keep the URL in step so a reload or a shared link opens the same view. */
export function writeChoice(profile: string | null, project: string) {
  const q = new URLSearchParams(window.location.search)
  if (profile) q.set('profile', profile); else q.delete('profile')
  q.set('project', project)
  window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
}
