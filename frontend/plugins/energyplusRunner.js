/**
 * Brief 123: runs EnergyPlus on an input the browser built (frontend/src/thermal/energyplus/toEnergyPlus.ts) and reads
 * back each zone's hourly heating, cooling and temperatures. Plain Node, no packages, so the same file serves the Vite
 * dev server's middleware (plugins/energyplus.js), the scripts, and a server later.
 *
 * EnergyPlus is found from ENERGYPLUS_DIR, else the usual install folders (C:\EnergyPlusV25-2-0 on IT15). The input's
 * Version is set to the installed EnergyPlus's own, so 25.2 and later both read it.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CANDIDATES = [
  'C:\\EnergyPlusV25-2-0', 'C:\\EnergyPlusV26-1-0', 'C:\\EnergyPlusV25-1-0',
  '/usr/local/EnergyPlus-25-2-0', '/usr/local/EnergyPlus-26-1-0', '/Applications/EnergyPlus-25-2-0', '/Applications/EnergyPlus-26-1-0',
]

let found = null
/** { bin, dir, version } of the EnergyPlus to use, or null when none is installed. */
export function findEnergyPlus() {
  if (found) return found
  const dirs = [process.env.ENERGYPLUS_DIR, ...CANDIDATES].filter(Boolean)
  for (const dir of dirs) {
    const bin = path.join(dir, process.platform === 'win32' ? 'energyplus.exe' : 'energyplus')
    if (!existsSync(bin)) continue
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    const m = /EnergyPlus, Version (\d+)\.(\d+)\.(\d+)/.exec(`${v.stdout}${v.stderr}`)
    if (!m) continue
    found = { bin, dir, version: `${m[1]}.${m[2]}.${m[3]}` }
    return found
  }
  return null
}

const count = (re, s) => (s.match(re) || []).length

/**
 * Runs one year. `input`: { epjson, schedules_csv, epw } (epw as text). Resolves to
 * { version, run_s, warnings, severe, zones: { [EP zone name]: { heating_wh, cooling_wh, air_c, operative_c } } },
 * hourly arrays of 8,760; rejects with the end of EnergyPlus's error file when it fails.
 */
export function runEnergyPlus(input, workDir, onStart) {
  const ep = findEnergyPlus()
  if (!ep) return Promise.reject(new Error('EnergyPlus is not installed on this computer (looked in ENERGYPLUS_DIR and C:\\EnergyPlusV25-2-0).'))
  mkdirSync(workDir, { recursive: true })
  const epjson = structuredClone(input.epjson)
  const [maj, min] = ep.version.split('.')
  epjson.Version = { 'Version 1': { version_identifier: `${maj}.${min}` } }
  writeFileSync(path.join(workDir, 'in.epJSON'), JSON.stringify(epjson))
  writeFileSync(path.join(workDir, 'schedules.csv'), input.schedules_csv)
  writeFileSync(path.join(workDir, 'weather.epw'), input.epw)
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const p = spawn(ep.bin, ['-w', 'weather.epw', '-d', '.', 'in.epJSON'], { cwd: workDir })
    onStart?.(p)
    let tail = ''
    p.stdout.on('data', (d) => { tail = (tail + d).slice(-4000) })
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-4000) })
    p.on('error', reject)
    p.on('close', (code) => {
      const errPath = path.join(workDir, 'eplusout.err')
      const err = existsSync(errPath) ? readFileSync(errPath, 'utf8') : tail
      const severe = count(/\*\* Severe {2}\*\*/g, err), fatal = count(/\*\* {2}Fatal {2}\*\*/g, err), warnings = count(/\*\* Warning \*\*/g, err)
      if (code !== 0 || fatal > 0) {
        const lines = err.split('\n').filter((l) => /Severe|Fatal|\*\*\s+~~~/.test(l)).slice(0, 30).join('\n')
        return reject(new Error(`EnergyPlus stopped (exit ${code}, ${severe} severe errors):\n${lines || err.slice(-3000)}`))
      }
      try {
        resolve({ version: ep.version, run_s: (Date.now() - t0) / 1000, warnings, severe, severe_text: severe ? err.split('\n').filter((l) => /Severe/.test(l)).slice(0, 10) : [], zones: readHourly(workDir) })
      } catch (e) { reject(e) }
    })
  })
}

const VARS = {
  'Zone Ideal Loads Supply Air Sensible Heating Energy': ['heating_wh', 1 / 3600],
  'Zone Ideal Loads Supply Air Sensible Cooling Energy': ['cooling_wh', 1 / 3600],
  'Zone Mean Air Temperature': ['air_c', 1],
  'Zone Operative Temperature': ['operative_c', 1],
}

/** eplusout_hourly.json (Output:JSON TimeSeries): Cols [{Variable: "KEY:Name"}], Rows [{"MM/DD HH:MM:SS": [values]}]. */
function readHourly(workDir) {
  const f = path.join(workDir, 'eplusout_hourly.json')
  if (!existsSync(f)) throw new Error('EnergyPlus wrote no hourly results (eplusout_hourly.json)')
  const j = JSON.parse(readFileSync(f, 'utf8'))
  const cols = j.Cols.map((c) => {
    const i = c.Variable.indexOf(':')
    let key = c.Variable.slice(0, i), name = c.Variable.slice(i + 1)
    // Ideal loads report under "<ZONE> IDEAL LOADS".
    key = key.replace(/ IDEAL LOADS$/i, '')
    return { key: key.toUpperCase(), def: VARS[name] }
  })
  const zones = {}
  const rows = j.Rows
  cols.forEach((c, k) => {
    if (!c.def) return
    const z = (zones[c.key] ??= {})
    const [field, scale] = c.def
    z[field] = rows.map((r) => { const v = Object.values(r)[0][k]; return Math.round(v * scale * 1000) / 1000 })
  })
  return zones
}
