/**
 * Brief 112 Part 2, Rule 11: lux becomes W/m² in one place, thermal/engine/lighting.ts. This fails if any other source
 * file multiplies or divides by an efficacy, or divides lux by 100, instead of calling lightingWm2.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../../..')
const HOME = path.join('thermal', 'engine', 'lighting.ts')

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : files(p)
    return /\.(ts|tsx|js|jsx)$/.test(e.name) ? [p] : []
  })
}

describe('Brief 112 P2: one derivation of lighting W/m²', () => {
  it('only lighting.ts turns lux and efficacy into W/m²', () => {
    const arithmetic = [/efficacy\w*\s*[*/]/i, /[*/]\s*[\w.?!]*efficacy/i, /lux\w*\s*\/\s*100\b/i]
    const offenders: string[] = []
    for (const f of files(SRC)) {
      if (path.relative(SRC, f) === HOME) continue
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (arithmetic.some((re) => re.test(line))) offenders.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
  it('the guard sees the arithmetic it is for', () => {
    const arithmetic = [/efficacy\w*\s*[*/]/i, /[*/]\s*[\w.?!]*efficacy/i, /lux\w*\s*\/\s*100\b/i]
    for (const line of ['const w = (p.lux / 100) * g.efficacy_w_m2_per_100lux', 'x = efficacy * lux / 100', 'lux * eff.efficacy']) {
      expect(arithmetic.some((re) => re.test(line))).toBe(true)
    }
  })
})
