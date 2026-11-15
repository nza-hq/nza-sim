// Brief 103 Part 2 gate: the engine's parseEpw against the backend's parse_epw (api/routers/weather.py), value for value,
// on the anchor EPW. Runs the backend function itself (lifted from the file with Python's ast, so FastAPI need not be
// installed) and compares every array it returns. Run from frontend/:  npx vite-node ../scripts/103_epw_parity.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { parseEpw } from '../frontend/src/thermal/engine/index.ts'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const EPW = process.argv[2] ?? `${REPO}/data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`
const py = `
import ast, hashlib, json, sys
from pathlib import Path
src = Path(sys.argv[1]).read_text()
fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == 'parse_epw')
ns = {'Path': Path, 'hashlib': hashlib}
exec(compile(ast.Module(body=[fn], type_ignores=[]), 'parse_epw', 'exec'), ns)
json.dump(ns['parse_epw'](Path(sys.argv[2])), sys.stdout)
`
const backend = JSON.parse(execFileSync('python3', ['-I', '-c', py, `${REPO}/api/routers/weather.py`, EPW], { encoding: 'utf8', maxBuffer: 64 << 20 }))
const w = await parseEpw(new Uint8Array(fs.readFileSync(EPW)))
const pairs = [['temperature', 'dry_bulb'], ['direct_normal', 'direct_normal'], ['diffuse_horizontal', 'diffuse_horizontal'],
  ['wind_speed', 'wind_speed'], ['month', 'month'], ['day', 'day'], ['hour', 'hour']]
let bad = 0
console.log(`EPW ${EPW.split('/').pop()}`)
console.log(`rows: backend ${backend.count}, engine ${w.hours.count}`)
for (const [b, e] of pairs) {
  let diff = 0
  for (let i = 0; i < backend.count; i++) if (backend[b][i] !== w.hours[e][i]) diff++
  if (diff) bad++
  console.log(`${b.padEnd(20)} -> ${e.padEnd(20)} ${diff === 0 ? 'identical' : `${diff} differ`}`)
}
const lat = backend.location.latitude === w.header.latitude && backend.location.longitude === w.header.longitude
console.log(`latitude/longitude: ${lat ? 'identical' : 'DIFFER'} (${w.header.latitude}, ${w.header.longitude})`)
console.log(`sha256: backend ${backend.file_sha256}, engine ${w.sha256}: ${backend.file_sha256 === w.sha256 ? 'identical' : 'DIFFER'}`)
if (bad || !lat || backend.file_sha256 !== w.sha256 || backend.count !== w.hours.count) { console.log('FAIL'); process.exit(1) }
console.log('PASS: value for value')
