/**
 * Brief 112 Part 2, Rule 11: lux becomes W/m² in one place, thermal/engine/lighting.ts (`lightingWm2`). This fails if
 * any other source file (frontend/src and scripts/) does arithmetic on a lux or an efficacy instead of calling it.
 * Review F5: the check strips strings and comments and calls of lightingWm2, then looks for a lux or efficacy name
 * beside `*` or `/` on either side, so `lux * e / 100`, `(lux * eff) / 100` and `e * p.lux` are all caught.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../../..')
const HOME = 'frontend/src/thermal/engine/lighting.ts'
/** Allowed, and why: the P4 gate restates a stated W/m² as lux (the inverse, to test the path; docs/audit/112/04_gate.md). */
const ALLOWED = new Set(['scripts/112_gate.mts'])

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : files(p)
    return /\.(ts|tsx|js|jsx|mjs|mts)$/.test(e.name) ? [p] : []
  })
}
export function arithmeticOnLux(line: string): boolean {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
  const code = t
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$/, '')
    .replace(/lightingWm2\([^)]*\)/g, 'W')
  const name = String.raw`[\w.?!]*(?:lux|efficacy)\w*`
  return new RegExp(String.raw`${name}\)*\s*[*/](?![*/])|(?<![*/])[*/]\s*\(*\s*${name}`, 'i').test(code)
}

describe('Brief 112 P2: one derivation of lighting W/m²', () => {
  it('only lighting.ts turns lux and efficacy into W/m²', () => {
    const offenders: string[] = []
    for (const f of [...files(path.join(ROOT, 'frontend/src')), ...files(path.join(ROOT, 'scripts'))]) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/')
      if (rel === HOME || ALLOWED.has(rel)) continue
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (arithmeticOnLux(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`) })
    }
    expect(offenders).toEqual([])
  })
  it('the guard sees the arithmetic it is for (review F5 mutations), and not words or calls', () => {
    for (const line of ['const w = (p.lux / 100) * g.efficacy_w_m2_per_100lux', 'x = lux * e / 100', 'x = (lux * eff) / 100', 'x = lux * 0.01 * e', 'w = e * p.lux', 'lux * eff.efficacy']) {
      expect(arithmeticOnLux(line), line).toBe(true)
    }
    for (const line of ["what: 'its lighting level (lux), or W/m²'", 'act = lightingWm2(g.lux, eff.efficacy) * A * areaShare', '// lux ÷ 100 × efficacy', ' * lux ÷ 100']) {
      expect(arithmeticOnLux(line), line).toBe(false)
    }
  })
})
