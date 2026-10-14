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
  gothenburg: { name: 'Gothenburg', city: 'Göteborg', placeholder: true },
}

export function readChoice(): { profile: string | null; project: string } {
  const q = new URLSearchParams(window.location.search)
  const profile = q.get('profile')
  const project = q.get('project')
  return {
    profile: profile && PROFILE_LABEL[profile] ? profile : null,
    project: project && PROJECTS[project] ? project : 'marievik',
  }
}

/** Keep the URL in step so a reload or a shared link opens the same view. */
export function writeChoice(profile: string | null, project: string) {
  const q = new URLSearchParams(window.location.search)
  if (profile) q.set('profile', profile); else q.delete('profile')
  q.set('project', project)
  window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
}
