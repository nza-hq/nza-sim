/**
 * Brief 104 Part 6: the browser worker half of scripts/104_perf.mts. Bundled by that script; receives the documents,
 * the library and the EPW bytes, runs each case once untimed and then five times timed, and posts the times and totals.
 */
import { parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, runModel } from '../frontend/src/thermal/engine/index'

self.onmessage = async (ev: MessageEvent) => {
  const { cases, lib, epw, options } = ev.data
  const weather = await parseEpw(new Uint8Array(epw))
  const out: any[] = []
  for (const c of cases) {
    runModel(c.doc, weather, lib, options)
    const ms: number[] = []
    let r: any
    for (let i = 0; i < 5; i++) { const t = performance.now(); r = runModel(c.doc, weather, lib, options); ms.push(performance.now() - t) }
    out.push({ name: c.name, ms, heating_kwh: readBuildingHeatingKwh(r), cooling_kwh: readBuildingCoolingKwh(r), engine: r.engine, nodes: r.solver.nodes })
  }
  ;(self as any).postMessage(out)
}
