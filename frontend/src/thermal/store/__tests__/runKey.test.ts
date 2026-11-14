/** Brief 102a Part 1: the run key names the engine source and the EPW bytes (QA H1). */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: plain JS module
import { ENGINE_ENTRIES, engineFingerprint } from '../../../../plugins/engineFingerprint.js'
import { ENGINE_SHA } from 'virtual:engine-fingerprint'
import { engineVersionFor, INSTANT_ENGINE_VERSION } from '../versions'

const FRONTEND = path.resolve(__dirname, '../../../..')

describe('engine fingerprint', () => {
  it('covers the engine, its helpers and the built-in system templates, and is stable', () => {
    const a = engineFingerprint()
    expect(engineFingerprint().sha).toBe(a.sha)
    for (const f of ['src/utils/instantCalc.js', 'src/utils/systemsEngine.js', 'src/utils/solarCalc.js',
      'src/data/systemTemplatesLibrary.js', 'src/utils/engineReads.js']) expect(a.files).toContain(f)
  })

  it('the Vite virtual module and the run key carry the same fingerprint', () => {
    expect(ENGINE_SHA).toBe(engineFingerprint().sha)
    expect(INSTANT_ENGINE_VERSION).toBe(`instant-1+${ENGINE_SHA.slice(0, 24)}`)
    expect(INSTANT_ENGINE_VERSION.length).toBeLessThanOrEqual(40) // runs.engine_version check
  })

  it('changes when any engine file changes, the templates included', () => {
    const { files, sha } = engineFingerprint()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-fp-'))
    try {
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true })
        fs.copyFileSync(path.join(FRONTEND, f), path.join(tmp, f))
      }
      expect(engineFingerprint(tmp).sha).toBe(sha)
      for (const f of ['src/data/systemTemplatesLibrary.js', 'src/utils/thermalMass.js']) {
        const p = path.join(tmp, f)
        const before = fs.readFileSync(p)
        fs.appendFileSync(p, '\n// edit\n')
        expect(engineFingerprint(tmp).sha).not.toBe(sha)
        fs.writeFileSync(p, before)
      }
      expect(engineFingerprint(tmp).sha).toBe(sha)
      expect(ENGINE_ENTRIES.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses a missing fingerprint rather than labelling a run with nothing', () => {
    expect(() => engineVersionFor('')).toThrow(/no engine fingerprint/)
    expect(() => engineVersionFor(undefined as unknown as string)).toThrow(/no engine fingerprint/)
  })
})
