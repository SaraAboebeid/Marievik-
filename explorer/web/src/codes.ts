// What a building is called on screen: the owner's own code where it is confirmed (AMF's M27 for B01, from
// data/projects/<project>/phasing.json), else the model's id. Ids stay the keys everywhere; only labels change.
import type { SitePayload } from './types'

let CODES: Record<string, string> = {}

export function setCodes(site: SitePayload) {
  CODES = Object.fromEntries(site.buildings.filter((b) => b.code).map((b) => [b.id, b.code!]))
}

/** The on-screen name of building `id`: "M27" for B01, "B05" where no code is confirmed. */
export const bl = (id: string) => CODES[id] ?? id
