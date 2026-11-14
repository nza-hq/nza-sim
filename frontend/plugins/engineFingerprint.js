/**
 * Brief 102a Part 1: a content fingerprint of the instant engine, for the run key's engine_version.
 *
 * sha256 over the source of every file in the import closure of the engine's entry points (relative imports only,
 * followed transitively), each as "<path relative to frontend/>\0<bytes>", sorted by path. So any edit to the engine,
 * its helpers or the built-in system templates changes the fingerprint, and a stored run can never be served for
 * numbers a different engine would produce (QA H1).
 *
 * As a Vite plugin it serves `virtual:engine-fingerprint` and watches every file in the closure, so an edit under the
 * dev server (HMR) recomputes it. Pure Node (no Vite) callers use engineFingerprint() directly.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** What the instant engine run and its recorded summary depend on. */
export const ENGINE_ENTRIES = [
  'src/utils/instantCalc.js',
  'src/utils/solarCalc.js',
  'src/data/systemTemplatesLibrary.js',
  'src/utils/engineReads.js',
]

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.ts']

function resolve(from, spec, root) {
  const base = path.resolve(path.dirname(from), spec)
  for (const e of EXTS) {
    const p = base + e
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  throw new Error(`engine fingerprint: cannot resolve "${spec}" from ${path.relative(root, from)}`)
}

/** Every file in the closure, absolute paths, sorted. `root` is the frontend folder (a copy, in tests). */
export function engineFiles(root = FRONTEND) {
  const seen = new Set()
  const stack = ENGINE_ENTRIES.map((e) => path.join(root, e))
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (spec.startsWith('.')) stack.push(resolve(f, spec, root))
    }
  }
  return [...seen].sort()
}

/** { sha, files }: sha is the full sha256 hex. */
export function engineFingerprint(root = FRONTEND) {
  const files = engineFiles(root)
  const h = crypto.createHash('sha256')
  for (const f of files) {
    h.update(path.relative(root, f).split(path.sep).join('/'))
    h.update('\0')
    h.update(fs.readFileSync(f))
    h.update('\0')
  }
  return { sha: h.digest('hex'), files: files.map((f) => path.relative(root, f).split(path.sep).join('/')) }
}

const VIRTUAL = 'virtual:engine-fingerprint'
const RESOLVED = '\0' + VIRTUAL

export default function engineFingerprintPlugin() {
  let files = []
  return {
    name: 'nza-engine-fingerprint',
    resolveId(id) { return id === VIRTUAL ? RESOLVED : null },
    load(id) {
      if (id !== RESOLVED) return null
      const fp = engineFingerprint()
      files = fp.files.map((f) => path.join(FRONTEND, f))
      for (const f of files) this.addWatchFile(f)
      return `export const ENGINE_SHA = ${JSON.stringify(fp.sha)}\nexport const ENGINE_FILES = ${JSON.stringify(fp.files)}\n`
    },
    handleHotUpdate(ctx) {
      if (!files.includes(path.resolve(ctx.file))) return
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED)
      if (!mod) return
      ctx.server.moduleGraph.invalidateModule(mod)
      return [...ctx.modules, mod]
    },
  }
}
