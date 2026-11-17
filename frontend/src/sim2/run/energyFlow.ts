/**
 * 17 Nov 2026 (Linzie 21:38, "borrow from the visual styles that we had in the original NZA Sim... the Sankey diagrams
 * help us visualise and test whether this model is working"): a run's energy as today's Systems Sankey draws it
 * (`systems_flow`: fuel → system → what it delivers), so the Model workspace shows the same chart as today's Systems
 * module (`SystemSankeyChart`) instead of one of its own.
 *
 * It reads only the run's energy summary (Rule 11, Rule 7): no figure is worked out here, only grouped. Every kWh of
 * every fuel is drawn (Rule 9): each fuel's links out sum to its line in `by_fuel`, and an end use's fuel that no listed
 * system accounts for is drawn as its own node rather than dropped. Two flows today's chart does not draw are added,
 * because without them a node's in and out do not match and the chart cannot be used as a check: a boiler's fuel it does
 * not turn into heat ("losses", the fuel used less the heat served), and a heat pump's heat taken from outside (the heat
 * served less the electricity used). Cooling is drawn as today's chart draws it: the electricity in, the cooling given out.
 */
import type { Summary } from './seam'

type Energy = Extract<NonNullable<Summary['energy']>, { ok: true }>
export type FlowNode = { id: string; label: string; type: 'source' | 'system' | 'building' | 'end_use' | 'waste' | 'recovered'; metric?: string }
export type FlowLink = { source: string; target: string; value_kWh: number; style: string }
export type SystemsFlow = { nodes: FlowNode[]; links: FlowLink[] }
export type FuelSplit = { total_kWh: number; electricity_kWh: number; electricity_pct: number; gas_kWh: number; gas_pct: number }

const FUEL_WORDS: Record<string, string> = {
  electricity: 'Grid Electricity', gas: 'Natural Gas', oil: 'Oil', biomass: 'Biomass', district_heating: 'District heat', district_cooling: 'District cooling',
}
const FUEL_STYLE: Record<string, string> = { electricity: 'electricity', gas: 'gas' }
/** Where each service's energy goes, as today's chart names its end nodes. */
const END: Record<string, { id: string; label: string; type: FlowNode['type']; style: string }> = {
  heating: { id: 'space_heat', label: 'Space Heating', type: 'building', style: 'heating' },
  cooling: { id: 'space_cool', label: 'Space Cooling', type: 'end_use', style: 'cooling' },
  dhw: { id: 'dhw_del', label: 'Hot Water', type: 'end_use', style: 'dhw' },
  lighting: { id: 'light_del', label: 'Light', type: 'end_use', style: 'electricity' },
  small_power: { id: 'equip_del', label: 'Equipment', type: 'end_use', style: 'electricity' },
  fans: { id: 'moving', label: 'Moving air and water', type: 'end_use', style: 'air' },
  pumps: { id: 'moving', label: 'Moving air and water', type: 'end_use', style: 'air' },
  dhw_circulation: { id: 'moving', label: 'Moving air and water', type: 'end_use', style: 'air' },
  auxiliary: { id: 'aux_del', label: 'Other electrical', type: 'end_use', style: 'electricity' },
}
/** The node an end use's energy passes through when no system is listed for it (today's 'lighting', 'small_power'). */
const VIA: Record<string, string> = {
  heating: 'Other heating', cooling: 'Other cooling', dhw: 'Other hot water', lighting: 'Lighting', small_power: 'Small Power',
  fans: 'Fans', pumps: 'Pumps', dhw_circulation: 'Hot water pump', auxiliary: 'Other loads',
}
/** Today's chart's prefixes (sh_ sc_ dhw_ vent_), so a click finds the same section. */
const PREFIX: Record<string, string> = { heating: 'sh_', cooling: 'sc_', dhw: 'dhw_', lighting: 'light_' }

function metric(service: string, fuel: string, eff: number | null): string | undefined {
  if (eff == null || !(eff > 0)) return undefined
  if (fuel === 'electricity' && eff > 1) return service === 'cooling' ? `SEER ${eff.toFixed(1)}` : `SCOP ${eff.toFixed(1)}`
  if (eff <= 1) return `${Math.round(eff * 100)}% eff`
  return undefined
}

export function energyFlow(e: Energy): SystemsFlow {
  const nodes: FlowNode[] = []
  const links: FlowLink[] = []
  const seen = new Set<string>()
  const node = (n: FlowNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n) } }
  const link = (source: string, target: string, kwh: number, style: string) => { if (kwh > 0.5) links.push({ source, target, value_kWh: Math.round(kwh), style }) }
  const src = (fuel: string) => { node({ id: `fuel_${fuel}`, label: FUEL_WORDS[fuel] ?? fuel, type: 'source' }); return `fuel_${fuel}` }
  const end = (use: string) => { const t = END[use]!; node({ id: t.id, label: t.label, type: t.type }); return t }

  // Sources first, in the summary's order, so the chart's left column reads as `by_fuel`.
  for (const f of e.by_fuel) if (f.kwh > 0.5) src(f.fuel)

  // Each listed system: its fuel in, what it serves out, and the difference shown either side.
  const listed = new Map<string, number>() // `${service}|${fuel}` → kWh of fuel the listed systems account for
  for (const s of e.systems) {
    const t = END[s.service]
    if (!t) continue
    const id = `${PREFIX[s.service] ?? `${s.service}_`}${s.id}`
    node({ id, label: s.label, type: 'system', metric: metric(s.service, s.fuel, s.efficiency) })
    link(src(s.fuel), id, s.fuel_kwh, FUEL_STYLE[s.fuel] ?? 'default')
    listed.set(`${s.service}|${s.fuel}`, (listed.get(`${s.service}|${s.fuel}`) ?? 0) + s.fuel_kwh)
    link(id, end(s.service).id, s.served_kwh, t.style)
    if (s.service === 'heating' || s.service === 'dhw') {
      if (s.fuel_kwh - s.served_kwh > 0.5) {
        node({ id: 'losses', label: 'Losses at the plant', type: 'waste' })
        link(id, 'losses', s.fuel_kwh - s.served_kwh, 'waste')
      } else if (s.served_kwh - s.fuel_kwh > 0.5) {
        node({ id: 'ambient', label: 'Heat taken from outside', type: 'recovered' })
        link('ambient', id, s.served_kwh - s.fuel_kwh, 'recovered')
      }
    }
  }

  // Every end use's fuel not accounted for by a listed system: pumps, fans, small power, other loads, and any remainder.
  for (const u of e.end_uses) {
    const rest = u.kwh - (listed.get(`${u.end_use}|${u.fuel}`) ?? 0)
    if (rest <= 0.5) continue
    const t = END[u.end_use]
    const via = `via_${u.end_use}_${u.fuel}`
    node({ id: via, label: VIA[u.end_use] ?? u.end_use, type: 'system' })
    link(src(u.fuel), via, rest, FUEL_STYLE[u.fuel] ?? 'default')
    if (t) link(via, end(u.end_use).id, rest, t.style)
  }

  // Order: sources, then systems, then where the energy goes, so the chart keeps groups together (nodeSort(null)).
  const rank: Record<FlowNode['type'], number> = { source: 0, recovered: 1, system: 2, building: 3, end_use: 4, waste: 5 }
  nodes.sort((a, b) => rank[a.type] - rank[b.type])
  return { nodes, links }
}

export function fuelSplit(e: Energy): FuelSplit {
  const of = (f: string) => e.by_fuel.find((x) => x.fuel === f)?.kwh ?? 0
  const total = e.total_kwh
  const pct = (k: number) => (total > 0 ? Math.round((k / total) * 100) : 0)
  return { total_kWh: total, electricity_kWh: of('electricity'), electricity_pct: pct(of('electricity')), gas_kWh: of('gas'), gas_pct: pct(of('gas')) }
}
