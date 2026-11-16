/**
 * Brief 107 Part 1: systems by zone group. The energy each installed system draws to serve the zones' demand.
 *
 * Inputs: the document, its model results (each zone's hourly heating and cooling, Engines 1 and 2), and the weather's
 * hours. The gains' electricity and the ventilation's running hours come from `gains.ts` and `ventilation.ts`, the
 * same functions the demand run uses, so nothing is calculated a second way.
 *
 * Per end use, as today's systems path (`systemsEngine.js` computeSystemsDelivered; docs/audit/107/00_reconnaissance.md):
 *   heating, cooling   each zone's demand × the share of each enabled group serving it ÷ the group's efficiency
 *   hot water          the tap-mix model (CLAUDE.md Systems scope), per zone from its occupants or floor, × share ÷ η
 *   hot water pump     services.dhw.circulation_pump_w, all year, when any hot water system is installed
 *   fans               each running mechanical ventilation entry's SFP × flow × the hours it runs
 *   lighting, small power, auxiliary   the gains' electricity (before the gain fraction), split between the groups
 *                      that serve the zone by share × control factor (normalised, as today; the total is the
 *                      electricity whatever the factor). With no group, the electricity still counts, under no group.
 *
 * Nothing is filled in. Today's fallbacks (60/10/40 °C, 80 L, 21/24 °C, an unknown source counted as electricity, an
 * efficiency of 0 giving 0) are refusals here, each named by its path. A zone with demand that no group serves, or
 * whose groups' shares do not total 100 %, is refused. Proportional split only (no capacity, lead/lag or hand-off).
 *
 * Out of scope: carbon, renewables, plant curves, part load, distribution and standby losses (design note Rev A).
 */
import type { ModelDocument } from '../schema/model'
import { zoneGains, GainsError, type GainKind } from './gains'
import { readBuildingCoolingKwh, readBuildingHeatingKwh, type ModelResults } from './results'
import type { Weather } from './types'
import { VentilationError, zoneVentilation } from './ventilation'
import { hotWaterUse, zoneHotWater } from './hotWater'

export const FUELS = ['electricity', 'gas', 'oil', 'biomass', 'district_heating', 'district_cooling'] as const
export type Fuel = (typeof FUELS)[number]

/** A system's `source` to the fuel it draws (today's _sourceToFuel; heat pumps draw electricity). Unknown is refused. */
const SOURCE_FUEL: Record<string, Fuel> = {
  electricity: 'electricity', ambient_air: 'electricity', ambient_ground: 'electricity', gas: 'gas', oil: 'oil',
  biomass: 'biomass', district_heating: 'district_heating', district_cooling: 'district_cooling',
}

export const END_USES = ['heating', 'cooling', 'dhw', 'dhw_circulation', 'fans', 'lighting', 'small_power', 'auxiliary'] as const
export type EndUse = (typeof END_USES)[number]

/** Water's heat capacity, kWh per litre per kelvin (today's WATER_SHC_KWH_PER_L_PER_K). */
export { WATER_KWH_PER_L_K } from './hotWater'
/** Today's tolerance on a service's shares totalling 100 % (systemsEngine.js _validateShares). */
const SHARE_TOLERANCE_PCT = 0.5

export interface SystemsMissing { path: string; message: string }

export interface GroupResult {
  id: string
  service: EndUse
  label: string | null
  fuel: Fuel
  efficiency: number | null
  /** Heat (or for thin entries, electricity) the group serves over the year, kWh. */
  served_kwh: number
  /** Energy the group draws over the year, kWh of its fuel (what a meter reads). */
  fuel_kwh: number
  /** Hourly energy drawn, W per hour. */
  fuel_w: Float64Array
}

/** One line per end use and fuel: the building's energy use (Rule 9: these lines sum to the totals by fuel). */
export interface EndUseLine { end_use: EndUse; fuel: Fuel; kwh: number }

export interface SystemsResults {
  groups: GroupResult[]
  /** Energy not drawn through a group (fans, the hot water pump, and thin electricity no group names), by end use. */
  ungrouped: { end_use: EndUse; zone_id: string | null; entry_id: string | null; kwh: number; w: Float64Array }[]
  end_uses: EndUseLine[]
  /** Building energy use by fuel, kWh a year. */
  by_fuel: Record<Fuel, number>
  floor_m2: number
  /** Hourly electricity, W per hour: every end use's electricity summed. */
  electricity_w: Float64Array
  /** Hot water: tap-mix inputs as used, and the demand served (kWh a year, at the store). */
  dhw: { hot_fraction: number; demand_kwh: number } | null
  /** Each served zone's demand by service, kWh a year. */
  zone_demand: { zone_id: string; service: 'heating' | 'cooling' | 'dhw'; kwh: number }[]
  /** Inputs the document states that this engine does not use yet (review F4): shown, never silently dropped. */
  not_modelled: { path: string; what: string }[]
}

/** Thrown when what the systems serve differs from the demand the model computed (Rule 9, review F2). */
export class ServedError extends Error {}
const SERVED_TOL = (kwh: number) => 1e-6 * Math.abs(kwh) + 1e-6

/**
 * Rule 9, integrand against display (review F2): what the groups serve, per service, equals the demand computed
 * independently of serving: heating and cooling from the model's results, hot water from the tap-mix over every zone.
 */
export function checkServed(groups: readonly GroupResult[], heatingKwh: number, coolingKwh: number, dhwKwh: number): void {
  for (const [service, want] of [['heating', heatingKwh], ['cooling', coolingKwh], ['dhw', dhwKwh]] as const) {
    const got = groups.filter((g) => g.service === service).reduce((a, g) => a + g.served_kwh, 0)
    if (Math.abs(got - want) > SERVED_TOL(want)) throw new ServedError(`systems serve ${got} kWh of ${service}; the building needs ${want} kWh`)
  }
}

export type SystemsAnswer = { ok: true; systems: SystemsResults } | { ok: false; missing: SystemsMissing[] }

/** The building's floor area, m²: the zones' summed. One place, read by the systems and the seam (review F8). */
export const readDocFloorM2 = (doc: ModelDocument) => doc.zones.reduce((s, z) => s + z.area_m2, 0)
export const readSystemsTotalKwh = (s: SystemsResults) => FUELS.reduce((a, f) => a + s.by_fuel[f], 0)
/** The v2 delivered-energy EUI, kWh/m² a year (Rule 11: read only here; not the instant engine's, not EnergyPlus's). */
export const readSystemsEui = (s: SystemsResults) => readSystemsTotalKwh(s) / s.floor_m2  // runSystems refuses a zero floor
export const readEndUseKwh = (s: SystemsResults, u: EndUse) => s.end_uses.filter((l) => l.end_use === u).reduce((a, l) => a + l.kwh, 0)

const sum = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }

export function runSystems(doc: ModelDocument, results: ModelResults, hours: Weather['hours']): SystemsAnswer {
  const H = hours.count
  const missing: SystemsMissing[] = []
  const miss = (path: string, message: string) => { if (!missing.some((m) => m.path === path)) missing.push({ path, message }) }
  const zoneIdx = new Map(doc.zones.map((z, i) => [z.id, i]))

  // ── Groups: read and check each enabled one once ────────────────────────────────────────────────────────────
  interface G { i: number; id: string; service: EndUse; label: string | null; share: number; cf: number | null; fuel: Fuel; eff: number | null; zones: number[] }
  const groups: G[] = []
  const not_modelled: SystemsResults['not_modelled'] = []
  const profileIds = new Set(doc.profiles.map((x) => x.id))
  doc.system_groups.forEach((g, i) => {
    if (!g.enabled) return
    const p = `system_groups[${i}]`
    // Brief 120: a heating or cooling system's capacity limits its zones in the run; on other services it is not used.
    if (g.capacity_kw != null && g.service !== 'heating' && g.service !== 'cooling') not_modelled.push({ path: `${p}.capacity_kw`, what: 'capacity' })
    if (g.control_mechanism != null) not_modelled.push({ path: `${p}.control_mechanism`, what: 'control mechanism' })
    // Not used, so not refused when it names a schedule the building lacks (today's library schedules are not carried
    // over); the panel lists it either way.
    if (g.control_schedule_ref != null) not_modelled.push({ path: `${p}.control_schedule_ref`, what: profileIds.has(g.control_schedule_ref) ? 'control schedule' : `control schedule "${g.control_schedule_ref}" (not in this building)` })
    const service = g.service as EndUse
    const thin = service === 'lighting' || service === 'small_power' || service === 'auxiliary'
    if (!(g.share_pct >= 0 && g.share_pct <= 100)) miss(`${p}.share_pct`, 'must be 0 to 100')
    const fuel = g.source == null ? null : SOURCE_FUEL[g.source]
    if (g.source == null) miss(`${p}.source`, 'required: what the system runs on')
    else if (!fuel) miss(`${p}.source`, `unknown source "${g.source}" (${Object.keys(SOURCE_FUEL).join(', ')})`)
    let eff: number | null = null
    if (!thin && g.share_pct > 0) {
      eff = g.efficiency_metric
      if (eff == null) miss(`${p}.efficiency_metric`, `required: the system's ${service === 'cooling' ? 'SEER' : 'efficiency or SCOP'}`)
      else if (!(eff > 0)) miss(`${p}.efficiency_metric`, 'must be above 0')
    }
    if (thin && fuel && fuel !== 'electricity') miss(`${p}.source`, `${service.replace('_', ' ')} runs on electricity`)
    // The control factor only splits a zone's electricity between the groups sharing it (as today); with one group it
    // has no effect, so it may be left out. Sharing groups must state it (checked below; review F3).
    const cf = thin ? (g.control_factor ?? null) : 1
    if (thin && cf != null && !(cf >= 0)) miss(`${p}.control_factor`, 'must be ≥ 0')
    groups.push({ i, id: g.id, service, label: g.label ?? null, share: g.share_pct, cf, fuel: fuel ?? 'electricity', eff, zones: g.zones.map((z) => zoneIdx.get(z)!) })
  })
  const covering = (service: EndUse, zi: number) => groups.filter((g) => g.service === service && g.zones.includes(zi))
  const sharesOk = (service: EndUse, zi: number, what: string) => {
    const gs = covering(service, zi)
    const zone = doc.zones[zi]
    if (gs.length === 0) { miss(`zones[${zi}].${service}`, `no ${what} system serves ${zone.name || zone.id}`); return false }
    const total = gs.reduce((s, g) => s + g.share, 0)
    if (Math.abs(total - 100) >= SHARE_TOLERANCE_PCT) {
      miss(`zones[${zi}].${service}`, `the ${what} systems serving ${zone.name || zone.id} share ${+total.toFixed(1)} %, not 100 %`)
      return false
    }
    return true
  }

  // ── Service setpoints: the zones' setpoints are the run's. A custom service setpoint needs a second run. ────────
  for (const s of ['heating', 'cooling'] as const) {
    if (doc.services[s].setpoint_mode === 'custom') miss(`services.${s}.setpoint_mode`, `a ${s} setpoint different from the zones' is not modelled yet (Brief 107)`)
  }

  // ── Gains and ventilation, from the same functions as the demand run ─────────────────────────────────────────
  let gains: ReturnType<typeof zoneGains> = []
  let vent: ReturnType<typeof zoneVentilation> = []
  try { gains = zoneGains(doc, hours) } catch (e) { if (e instanceof GainsError) miss(e.path, e.message.slice(e.path.length + 2)); else throw e }
  try { vent = zoneVentilation(doc, hours) } catch (e) { if (e instanceof VentilationError) miss(e.path, e.message.slice(e.path.length + 2)); else throw e }

  // ── Heating and cooling: which zones have demand, and are they served ───────────────────────────────────────
  const demand: { zi: number; service: 'heating' | 'cooling'; w: Float64Array; kwh: number }[] = []
  results.zones.forEach((z, zi) => {
    for (const service of ['heating', 'cooling'] as const) {
      const w = service === 'heating' ? z.hourly.heating_w : z.hourly.cooling_w
      const kwh = sum(w) / 1000
      if (kwh > 0 && sharesOk(service, zi, service)) demand.push({ zi, service, w, kwh })
    }
  })

  // ── Hot water: per zone, served by the hot water groups covering it ─────────────────────────────────────────
  const dhwGroups = groups.filter((g) => g.service === 'dhw')
  let dhwInfo: SystemsResults['dhw'] = null
  const dhwDemand: { zi: number; w: Float64Array; kwh: number }[] = []
  let pumpW = 0
  let dhwNeeded = 0  // the tap-mix over every zone, independent of which zones are served (review F2)
  // Brief 112: hot water use is the spaces' (each occupancy profile's `dhw`), the heater's temperatures the building's.
  const anyUse = doc.zones.some((_, zi) => hotWaterUse(doc, zi) != null)
  // Hot water use stated with no system to serve it is named, not dropped (review F1), and a system with no use is named.
  if (dhwGroups.length === 0 && anyUse) miss('services.dhw', 'hot water use is stated on a space but no hot water system serves it')
  if (dhwGroups.length > 0 && !anyUse) miss('services.dhw', 'a hot water system is installed but no space states its hot water use (litres a day per person or per m²)')
  if (dhwGroups.length > 0) {
    const pump = doc.services.dhw.circulation_pump_w
    if (pump == null) miss('services.dhw.circulation_pump_w', 'required: a hot water system is installed')
    else if (!(pump >= 0)) miss('services.dhw.circulation_pump_w', 'must be ≥ 0')
    // Brief 120: one calculation of each zone's hot water (hotWater.ts), shared with the plant that heats it first.
    const a = zoneHotWater(doc, gains, H)
    if (!a.ok) for (const m of a.issues) miss(m.path, m.message)
    else if (a.hw) {
      let total = 0
      a.hw.zones.forEach((z, zi) => {
        if (!z) return
        dhwNeeded += z.kwh  // the tap-mix over every zone, independent of which zones are served (review F2)
        if (!sharesOk('dhw', zi, 'hot water')) return
        dhwDemand.push({ zi, w: z.w, kwh: z.kwh })
        total += z.kwh
      })
      dhwInfo = { hot_fraction: a.hw.hot_fraction, demand_kwh: total }
      pumpW = pump ?? 0
    }
  }

  // ── Fans ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const ungrouped: SystemsResults['ungrouped'] = []
  vent.forEach((list, zi) => {
    for (const v of list) {
      if (v.kind === 'natural') continue
      const j = doc.zones[zi].ventilation.findIndex((x) => x.id === v.id)
      const sfp = doc.zones[zi].ventilation[j].sfp_w_per_l_s
      const p = `zones[${zi}].ventilation[${j}].sfp_w_per_l_s`
      if (sfp == null || !Number.isFinite(sfp)) { miss(p, 'required: the fans\' specific fan power (W per l/s)'); continue }
      if (!(sfp >= 0)) { miss(p, 'must be ≥ 0'); continue }
      const w = new Float64Array(H)
      const watts = sfp * v.flow_m3s * 1000
      for (let h = 0; h < H; h++) w[h] = watts * v.running[h]
      ungrouped.push({ end_use: 'fans', zone_id: doc.zones[zi].id, entry_id: v.id, kwh: sum(w) / 1000, w })
    }
  })

  // Thin services: where groups name a zone, their shares must total 100 % (today's _validateShares). Without a group,
  // the electricity still counts (it is the gains'), under no group.
  doc.zones.forEach((_, zi) => {
    for (const [service, what] of [['lighting', 'lighting'], ['small_power', 'small power'], ['auxiliary', 'auxiliary']] as const) {
      const gs = covering(service, zi)
      if (gs.length > 0) sharesOk(service, zi, what)
      if (gs.length > 1) for (const g of gs) if (g.cf == null) miss(`system_groups[${g.i}].control_factor`, `required: ${what} systems sharing a zone are split by share × control factor`)
    }
  })
  doc.zones.forEach((z, zi) => z.ventilation.forEach((v, j) => {
    if (v.enabled && v.defrost_penalty_kwh != null) not_modelled.push({ path: `zones[${zi}].ventilation[${j}].defrost_penalty_kwh`, what: 'defrost penalty' })
  }))
  const floor_m2 = readDocFloorM2(doc)
  if (!(floor_m2 > 0)) miss('zones', 'the building has no floor area, so it has no EUI')

  if (missing.length) return { ok: false, missing }

  // ── Draw: each group's energy, hour by hour ──────────────────────────────────────────────────────────────────
  const out = new Map<number, GroupResult>()
  const groupOut = (g: G): GroupResult => {
    let r = out.get(g.i)
    if (!r) { r = { id: g.id, service: g.service, label: g.label, fuel: g.fuel, efficiency: g.eff, served_kwh: 0, fuel_kwh: 0, fuel_w: new Float64Array(H) }; out.set(g.i, r) }
    return r
  }
  const zone_demand: SystemsResults['zone_demand'] = []
  const serve = (service: 'heating' | 'cooling' | 'dhw', zi: number, w: Float64Array, kwh: number) => {
    zone_demand.push({ zone_id: doc.zones[zi].id, service, kwh })
    for (const g of covering(service, zi)) {
      if (g.share === 0) continue
      const r = groupOut(g)
      const f = g.share / 100
      r.served_kwh += kwh * f
      for (let h = 0; h < H; h++) r.fuel_w[h] += (w[h] * f) / g.eff!
    }
  }
  for (const d of demand) serve(d.service, d.zi, d.w, d.kwh)
  for (const d of dhwDemand) serve('dhw', d.zi, d.w, d.kwh)
  checkServed([...out.values()], readBuildingHeatingKwh(results), readBuildingCoolingKwh(results), dhwNeeded)
  if (dhwDemand.length && pumpW > 0) ungrouped.push({ end_use: 'dhw_circulation', zone_id: null, entry_id: null, kwh: (pumpW * H) / 1000, w: new Float64Array(H).fill(pumpW) })

  // Lighting, small power, auxiliary: the gains' electricity, split by share × control factor.
  const THIN: [GainKind, EndUse][] = [['lighting', 'lighting'], ['equipment', 'small_power'], ['auxiliary', 'auxiliary']]
  doc.zones.forEach((zone, zi) => {
    const zg = gains[zi]
    if (!zg) return
    for (const [kind, service] of THIN) {
      const e = new Float64Array(H)
      for (const g of zg.gains) if (g.kind === kind && g.electric_w) for (let h = 0; h < H; h++) e[h] += g.electric_w[h]
      const kwh = sum(e) / 1000
      if (!(kwh > 0)) continue
      const gs = covering(service, zi)
      const weights = gs.map((g) => (g.share / 100) * (g.cf ?? 1))  // null only with one group, where it cancels
      const wt = weights.reduce((a, b) => a + b, 0)
      if (wt > 0) {
        gs.forEach((g, k) => {
          if (weights[k] === 0) return
          const r = groupOut(g)
          const f = weights[k] / wt
          r.served_kwh += kwh * f
          for (let h = 0; h < H; h++) r.fuel_w[h] += e[h] * f
        })
      } else ungrouped.push({ end_use: service, zone_id: zone.id, entry_id: null, kwh, w: e })
    }
  })

  // ── Totals ───────────────────────────────────────────────────────────────────────────────────────────────────
  const groupsOut = [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => { r.fuel_kwh = sum(r.fuel_w) / 1000; return r })
  const by_fuel = Object.fromEntries(FUELS.map((f) => [f, 0])) as Record<Fuel, number>
  const lines = new Map<string, EndUseLine>()
  const add = (end_use: EndUse, fuel: Fuel, kwh: number) => {
    const k = `${end_use}|${fuel}`
    const l = lines.get(k) ?? { end_use, fuel, kwh: 0 }
    l.kwh += kwh
    lines.set(k, l)
    by_fuel[fuel] += kwh
  }
  const electricity_w = new Float64Array(H)
  for (const r of groupsOut) {
    add(r.service, r.fuel, r.fuel_kwh)
    if (r.fuel === 'electricity') for (let h = 0; h < H; h++) electricity_w[h] += r.fuel_w[h]
  }
  for (const u of ungrouped) {
    add(u.end_use, 'electricity', u.kwh)
    for (let h = 0; h < H; h++) electricity_w[h] += u.w[h]
  }
  const end_uses = [...lines.values()].sort((a, b) => END_USES.indexOf(a.end_use) - END_USES.indexOf(b.end_use) || FUELS.indexOf(a.fuel) - FUELS.indexOf(b.fuel))
  return {
    ok: true,
    systems: {
      groups: groupsOut, ungrouped, end_uses, by_fuel, electricity_w, dhw: dhwInfo, zone_demand, floor_m2, not_modelled,
    },
  }
}
