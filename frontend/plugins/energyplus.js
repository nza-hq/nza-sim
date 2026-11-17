/**
 * Brief 123: "Run in EnergyPlus" on the computer NZA Sim runs on. The Vite dev server answers
 *
 *   GET  /api/sim2/energyplus/status    { available, version, message }
 *   POST /api/sim2/energyplus/runs      { epjson, schedules_csv, epw }  →  { id }
 *   GET  /api/sim2/energyplus/runs/:id  { state: running | done | failed, elapsed_s, result?, error? }
 *
 * One run at a time (a second waits its turn); each in its own folder under the system's temp folder. The runner
 * itself (energyplusRunner.js) is plain Node, so a server can mount the same three routes later.
 */
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { findEnergyPlus, runEnergyPlus } from './energyplusRunner.js'

const BASE = '/api/sim2/energyplus'
const MAX_BODY = 40 * 1024 * 1024

export default function energyplus() {
  const jobs = new Map()
  let queue = Promise.resolve()
  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('The model is too large to send.')); req.destroy() } else parts.push(c) })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
  const middleware = async (req, res, next) => {
    const url = (req.url || '').split('?')[0]
    if (!url.startsWith(BASE)) return next()
    try {
      if (req.method === 'GET' && url === `${BASE}/status`) {
        const ep = findEnergyPlus()
        return send(res, 200, ep
          ? { available: true, version: ep.version, message: null }
          : { available: false, version: null, message: 'EnergyPlus is not installed on the computer running NZA Sim.' })
      }
      if (req.method === 'POST' && url === `${BASE}/runs`) {
        const body = JSON.parse(await readBody(req))
        if (!body || typeof body.epjson !== 'object' || typeof body.schedules_csv !== 'string' || typeof body.epw !== 'string') return send(res, 400, { error: 'Expected { epjson, schedules_csv, epw }.' })
        const id = randomUUID()
        const job = { state: 'running', t0: Date.now(), result: null, error: null }
        jobs.set(id, job)
        // Keep the last few only.
        if (jobs.size > 20) jobs.delete(jobs.keys().next().value)
        queue = queue.then(() => runEnergyPlus(body, path.join(os.tmpdir(), 'nza-sim-ep', id))
          .then((r) => { job.state = 'done'; job.result = r }, (e) => { job.state = 'failed'; job.error = e.message }))
        return send(res, 202, { id })
      }
      const m = /^\/api\/sim2\/energyplus\/runs\/([\w-]+)$/.exec(url)
      if (req.method === 'GET' && m) {
        const job = jobs.get(m[1])
        if (!job) return send(res, 404, { error: 'No such run.' })
        return send(res, 200, { state: job.state, elapsed_s: (Date.now() - job.t0) / 1000, result: job.result ?? undefined, error: job.error ?? undefined })
      }
      return send(res, 404, { error: 'Unknown EnergyPlus route.' })
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }
  return {
    name: 'nza-sim-energyplus',
    // Added before Vite's own middlewares, so it answers ahead of the /api proxy.
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
