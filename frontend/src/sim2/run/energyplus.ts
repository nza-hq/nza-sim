/**
 * Brief 123: the third tier, "Run in EnergyPlus" (Linzie 17 Nov 10:27: "Instant, 15 minutes, then Energy+").
 *
 *   energyPlusInput(doc, results, deps)  → the EnergyPlus input for the document the hourly run just ran
 *   runInEnergyPlus(input, epw)          → EnergyPlus's hourly results, from the runner (plugins/energyplus.js)
 *   energyPlusSummary(...)               → those results in the shape the panel shows beside the hourly run's
 *
 * EnergyPlus gives each room's heating and cooling and its temperatures (Rule 7: what EnergyPlus can produce is read
 * from EnergyPlus). Energy (fuel and electricity) comes from those loads through the systems' stated efficiencies, by
 * the same conversion as the hourly run (energyOf → runSystems), so the two columns differ only by the physics; that is
 * stated with the numbers. This result is its own (Rule 11): it is never merged with the hourly run's Summary.
 */
import { toEnergyPlus, EnergyPlusInputError, EP_STEPS_PER_HOUR, type EnergyPlusInput } from '../../thermal/energyplus/toEnergyPlus'
import { UNMET_K, zoneSetpointHours, ModelError } from '../../thermal/engine/model'
import type { ModelResults } from '../../thermal/engine/results'
import type { ModelDocument } from '../../thermal/schema/model'
import { CONSTRUCTIONS, type LibraryItem, type Missing } from './library'
import { energyOf, levelDocument, monthly, preflight, readRunDocument, type Level, type Monthly, type Summary } from './seam'
import type { WeatherChoice } from './weather'

export const ENERGYPLUS_LABEL = 'EnergyPlus'

export type EnergyPlusPrepared =
  | { ok: true; doc: ModelDocument; input: EnergyPlusInput }
  | { ok: false; missing: Missing[] }

/** The input for the document as the hourly run ran it (same level, same weather, same constructions). */
export function energyPlusInput(
  input: unknown, results: ModelResults,
  deps: { weather: WeatherChoice | null; constructions?: readonly LibraryItem[]; level?: Level; fabric_heat_c?: number | null },
): EnergyPlusPrepared {
  const read = readRunDocument(input)
  if (!read.ok) return read
  const level = deps.level ?? 'systems'
  const doc = levelDocument(read.doc, level, level === 'fabric' ? deps.fabric_heat_c ?? null : null)
  const pre = preflight(doc, deps.weather, deps.constructions ?? CONSTRUCTIONS)
  if (pre.missing.length) return { ok: false, missing: pre.missing }
  try {
    return { ok: true, doc, input: toEnergyPlus(doc, deps.weather!.weather, pre.library, results) }
  } catch (e) {
    if (e instanceof EnergyPlusInputError || e instanceof ModelError) return { ok: false, missing: [{ path: e.path, what: e.message.slice(e.path.length + 2).replace(/^./, (c) => c.toUpperCase()) + '.' }] }
    throw e
  }
}

/** What the runner returns (plugins/energyplusRunner.js). Hourly arrays of 8,760, Wh per hour and °C. */
export interface EnergyPlusOutput {
  version: string
  run_s: number
  warnings: number
  severe: number
  severe_text: string[]
  zones: Record<string, { heating_wh?: number[]; cooling_wh?: number[]; air_c?: number[]; operative_c?: number[] }>
}

export interface EnergyPlusZone {
  id: string; name: string; floor_m2: number
  heating_kwh: number; cooling_kwh: number; peak_heating_w: number; peak_cooling_w: number
  /** Hours in use more than UNMET_K below the heating (above the cooling) setpoint, by EnergyPlus's air temperature; null: not heated (cooled). */
  unmet_heating_hours_in_use: number | null
  unmet_cooling_hours_in_use: number | null
  min_air_c: number; max_air_c: number
  monthly: Monthly
}

export interface EnergyPlusSummary {
  label: typeof ENERGYPLUS_LABEL
  version: string
  steps_per_hour: number
  run_s: number
  warnings: number
  severe: number
  severe_text: string[]
  building: { floor_m2: number; heating_kwh: number; cooling_kwh: number; peak_heating_w: number; peak_cooling_w: number; monthly: Monthly }
  zones: EnergyPlusZone[]
  /** From EnergyPlus's room loads through the stated efficiencies (see the file's header); null when the run had no systems. */
  energy: Summary['energy']
  /** How the model was carried (toEnergyPlus notes). */
  notes: string[]
}

/**
 * EnergyPlus's results beside the hourly run's. `ours` is the hourly run the input was built from: its conductances
 * and plants are its own; only each zone's hourly heating, cooling and temperatures are replaced by EnergyPlus's, so
 * energyOf reads EnergyPlus's loads through the one conversion.
 */
export function energyPlusSummary(doc: ModelDocument, ours: ModelResults, prepared: EnergyPlusInput, out: EnergyPlusOutput, weather: WeatherChoice, level: Level): EnergyPlusSummary {
  const H = weather.weather.hours.count
  const sp = zoneSetpointHours(doc, weather.weather.hours)
  const arr = (a: number[] | undefined, what: string, zone: string) => {
    if (!a || a.length !== H) throw new Error(`EnergyPlus returned no ${what} for ${zone}`)
    return Float64Array.from(a)
  }
  const zeros = () => new Float64Array(H)
  const zones: EnergyPlusZone[] = []
  const epZones = ours.zones.map((z, zi) => {
    const m = prepared.zones[zi]
    const r = out.zones[m.ep_name.toUpperCase()] ?? {}
    const conditioned = m.heated || m.cooled || r.heating_wh != null
    const heat = conditioned && r.heating_wh ? arr(r.heating_wh, 'heating', m.ep_name) : zeros()
    const cool = conditioned && r.cooling_wh ? arr(r.cooling_wh, 'cooling', m.ep_name) : zeros()
    const air = arr(r.air_c, 'air temperature', m.ep_name)
    const op = r.operative_c ? arr(r.operative_c, 'operative temperature', m.ep_name) : air
    const s = sp[zi], zone = doc.zones[zi]
    let uh = 0, uc = 0, hk = 0, ck = 0, ph = 0, pc = 0, lo = Infinity, hi = -Infinity
    for (let h = 0; h < H; h++) {
      hk += heat[h]; ck += cool[h]; ph = Math.max(ph, heat[h]); pc = Math.max(pc, cool[h]); lo = Math.min(lo, air[h]); hi = Math.max(hi, air[h])
      const use = s ? s.in_use[h] === 1 : true
      const hs = s ? s.hourly.heat_c[h] : zone.setpoints.heat_c ?? NaN
      const cs = s ? s.hourly.cool_c[h] : zone.setpoints.cool_c ?? NaN
      if (use && Number.isFinite(hs) && air[h] < hs - UNMET_K) uh++
      if (use && Number.isFinite(cs) && air[h] > cs + UNMET_K) uc++
    }
    zones.push({
      id: zone.id, name: zone.name, floor_m2: zone.area_m2, heating_kwh: hk / 1000, cooling_kwh: ck / 1000, peak_heating_w: ph, peak_cooling_w: pc,
      unmet_heating_hours_in_use: m.heated ? uh : null, unmet_cooling_hours_in_use: m.cooled ? uc : null, min_air_c: lo, max_air_c: hi,
      monthly: monthly(heat, cool),
    })
    return {
      ...z,
      hourly: { ...z.hourly, heating_w: heat, cooling_w: cool, theta_air_c: air, theta_operative_c: op },
      annual: { ...z.annual, heating_kwh: hk / 1000, cooling_kwh: ck / 1000, peak_heating_w: ph, peak_cooling_w: pc },
    }
  })
  const bh = zeros(), bc = zeros()
  for (const z of epZones) for (let h = 0; h < H; h++) { bh[h] += z.hourly.heating_w[h]; bc[h] += z.hourly.cooling_w[h] }
  const epResults: ModelResults = { ...ours, zones: epZones, plants: [] }
  return {
    label: ENERGYPLUS_LABEL, version: out.version, steps_per_hour: EP_STEPS_PER_HOUR, run_s: out.run_s, warnings: out.warnings, severe: out.severe, severe_text: out.severe_text,
    building: {
      floor_m2: doc.building.reported_floor_area_m2 ?? doc.zones.reduce((s, z) => s + z.area_m2, 0),
      heating_kwh: zones.reduce((s, z) => s + z.heating_kwh, 0), cooling_kwh: zones.reduce((s, z) => s + z.cooling_kwh, 0),
      peak_heating_w: bh.reduce((m, v) => Math.max(m, v), 0), peak_cooling_w: bc.reduce((m, v) => Math.max(m, v), 0), monthly: monthly(bh, bc),
    },
    zones,
    energy: level === 'systems' ? energyOf(doc, epResults, weather) : null,
    notes: prepared.notes,
  }
}

// ── The runner, over HTTP ─────────────────────────────────────────────────────────────────────────────────────────

export const ENERGYPLUS_API = '/api/sim2/energyplus'

export interface EnergyPlusStatus { available: boolean; version: string | null; message: string | null }

/** Whether this NZA Sim can run EnergyPlus (the runner is there and EnergyPlus is installed beside it). */
export async function energyPlusStatus(): Promise<EnergyPlusStatus> {
  try {
    const r = await fetch(`${ENERGYPLUS_API}/status`)
    if (!r.ok) return { available: false, version: null, message: 'This copy of NZA Sim has no EnergyPlus runner.' }
    return (await r.json()) as EnergyPlusStatus
  } catch {
    return { available: false, version: null, message: 'This copy of NZA Sim has no EnergyPlus runner.' }
  }
}

/** Starts a run and waits for it, reporting elapsed seconds. Rejects with EnergyPlus's own words when it fails. */
export async function runInEnergyPlus(input: EnergyPlusInput, epw: string, opts: { signal?: AbortSignal; onProgress?: (s: { state: string; elapsed_s: number }) => void } = {}): Promise<EnergyPlusOutput> {
  const start = await fetch(`${ENERGYPLUS_API}/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: opts.signal,
    body: JSON.stringify({ epjson: input.epjson, schedules_csv: input.schedules_csv, epw }),
  })
  if (!start.ok) throw new Error((await start.text()) || `The EnergyPlus runner refused the run (${start.status}).`)
  const { id } = (await start.json()) as { id: string }
  for (;;) {
    await new Promise((res) => setTimeout(res, 1000))
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const r = await fetch(`${ENERGYPLUS_API}/runs/${id}`, { signal: opts.signal })
    if (!r.ok) throw new Error(`The EnergyPlus runner lost the run (${r.status}).`)
    const s = (await r.json()) as { state: 'running' | 'done' | 'failed'; elapsed_s: number; result?: EnergyPlusOutput; error?: string }
    opts.onProgress?.({ state: s.state, elapsed_s: s.elapsed_s })
    if (s.state === 'done') return s.result!
    if (s.state === 'failed') throw new Error(s.error ?? 'EnergyPlus failed.')
  }
}
