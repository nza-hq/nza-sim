/**
 * Thermal mass behind finishes (Linzie 17 Nov 2026): one concrete-frame office room, four slab finishes, through our
 * monthly (instant) and hourly (15-minute) engines. Spec: validation/energyplus/mass_finishes_spec.json.
 *
 * Run from frontend/:  npx vite-node ../scripts/mass_finishes.mts <epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build as buildRoom } from '../frontend/src/thermal/engine/__tests__/massRoom'
import { parseEpw, REFEREE_OPTIONS, runModel, type RunOptions } from '../frontend/src/thermal/engine/index'
import { runMonthly } from '../frontend/src/thermal/engine/monthly'

const root = path.resolve(__dirname, '..')
const SPEC = JSON.parse(readFileSync(path.join(root, 'validation/energyplus/mass_finishes_spec.json'), 'utf8'))
const [epwPath, outPath] = process.argv.slice(2)
const bytes = readFileSync(epwPath)
const weather = await parseEpw(bytes)

const HOURLY: RunOptions = { ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document', time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }
const build = (c: string, contents: number, conditioned: boolean) => buildRoom(SPEC, weather, path.basename(epwPath), c, contents, conditioned, { finishes: true })
const MONTHLY = { solar: REFEREE_OPTIONS.solar, glazing_solar: REFEREE_OPTIONS.glazing_solar ?? 'g_value', internal_gains: 'profiles' } as any

const out: Record<string, any> = { epw: path.basename(epwPath), epw_sha256: weather.sha256, cases: {} }
for (const c of Object.keys(SPEC.cases)) {
  const row: Record<string, any> = {}
  for (const contents of [0, 10_000, 250_000]) {
    const k = contents === 0 ? 'fabric_only' : contents === 10_000 ? 'contents_10k' : 'legacy_250k'
    const a = build(c, contents, true)
    const r = runModel(a.doc, weather, a.lib, HOURLY).zones[0]
    const m = runMonthly(a.doc, weather, a.lib, MONTHLY).zones[0] as any
    const f = build(c, contents, false)
    const fr = runModel(f.doc, weather, f.lib, HOURLY).zones[0]
    const t = Array.from(fr.hourly.theta_air_c)
    row[k] = {
      hourly: { heat_kwh: r.annual.heating_kwh, cool_kwh: r.annual.cooling_kwh, peak_cool_w: Math.max(...Array.from(r.hourly.cooling_w)) },
      monthly: { heat_kwh: m.heating_kwh, cool_kwh: m.cooling_kwh, c_m_mj_per_k: m.c_m_j_per_k / 1e6, tau_h: m.tau_h },
      free: { max_c: Math.max(...t), hours_over_26: t.filter((x) => x > 26).length, hours_over_28: t.filter((x) => x > 28).length },
    }
  }
  out.cases[c] = row
  console.log(c, JSON.stringify(row))
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
