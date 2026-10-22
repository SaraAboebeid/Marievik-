// Who rents what, floor by floor — served by POST /api/tenancy from data/projects/<project>/leases.json
// (example data until AMF's rent roll replaces it).
import type { Rect } from './engine'

export interface Suite {
  id: string; label: string; r: Rect; area: number; shared: boolean; tenant: string | null; sector: string | null
  rent: number | null; leaseStart: number | null; leaseEnd: number | null; colour: string
}
export interface FloorTenancy { floor: number; leasable: number; rented: number; vacant: number; shared: number; suites: Suite[]; example: boolean }
export const VACANT_COLOR = '#9a978e'
