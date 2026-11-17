/**
 * Brief 105 Part 4: the run seam's library. Resolves each `construction_ref.key` a model document uses to the
 * library body the engine needs (its layers, or its U and g for glazing).
 *
 * The bodies come from `constructions.json` (scripts/sim2_run_constructions.mjs, the committed Brief 102 export,
 * whole). Library bodies carry their layers as an EnergyPlus fragment (`epjson`: Material, Material:NoMass and a
 * Construction listing them outside first; glazing as WindowMaterial:SimpleGlazingSystem with U and g on the body).
 * `bodyFromLibrary` turns that into the engine's `layers`; it is checked against the Bridgewater fixture's layers,
 * which came from today's database, value for value (__tests__/library.test.ts).
 *
 * Nothing is assumed: a key that is still `unassigned:*`, a key the library does not have, or a body whose hash is
 * not the one the document pinned, is a missing input with a plain-words reason, and the run does not happen.
 */
import type { ConstructionBody, Layer } from '../../thermal/engine/elements'
import type { ModelDocument } from '../../thermal/schema/model'
import snap from './constructions.json'

export interface Missing {
  /** Where in the model document the input is missing, as the schema names it. */
  path: string
  /** What the person needs to do, in plain words. */
  what: string
}

type Obj = Record<string, any>
/** `draft`: the display name of an item drafted for review and not yet in Chris's library (library_additions.json). */
export interface LibraryItem { key: string; body_hash: string; body: Obj; draft?: string }

export const CONSTRUCTIONS: LibraryItem[] = (snap as { constructions: LibraryItem[] }).constructions
export const LIBRARY_SOURCE = { source: (snap as Obj).source as string, source_sha256: (snap as Obj).source_sha256 as string, exported_at: (snap as Obj).exported_at as string }

export class LibraryBodyError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'LibraryBodyError' }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A library construction body (Brief 102 shape, with `epjson`) as the engine's ConstructionBody. */
export function bodyFromLibrary(body: Obj, path = 'body'): ConstructionBody {
  const out: ConstructionBody = { name: body.name, u_value_W_per_m2K: num(body.u_value_W_per_m2K), g_value: num(body.g_value) }
  if (body.y_factor !== undefined) out.y_factor = num(body.y_factor)
  const ep = body.epjson
  if (body.type === 'glazing') {
    out.layers = []
    return out
  }
  if (!ep || typeof ep !== 'object') throw new LibraryBodyError('has no epjson layers', `${path}.epjson`)
  const cons = Object.values((ep.Construction ?? {}) as Record<string, Obj>)
  if (cons.length !== 1) throw new LibraryBodyError(`expected one Construction, found ${cons.length}`, `${path}.epjson.Construction`)
  const c = cons[0]
  const names: string[] = []
  if (typeof c.outside_layer !== 'string') throw new LibraryBodyError('has no outside_layer', `${path}.epjson.Construction`)
  names.push(c.outside_layer)
  for (let i = 2; c[`layer_${i}`] !== undefined; i++) names.push(c[`layer_${i}`])
  const extra = Object.keys(c).filter((k) => k !== 'outside_layer' && !/^layer_\d+$/.test(k))
  if (extra.length) throw new LibraryBodyError(`unknown fields ${extra.join(', ')}`, `${path}.epjson.Construction`)
  if (Object.keys(c).length !== names.length) throw new LibraryBodyError('layer numbers are not consecutive from layer_2', `${path}.epjson.Construction`)
  const mat = (ep.Material ?? {}) as Record<string, Obj>
  const nomass = (ep['Material:NoMass'] ?? {}) as Record<string, Obj>
  out.layers = names.map((n, i): Layer => {
    const p = `${path}.epjson.Construction.${i === 0 ? 'outside_layer' : `layer_${i + 1}`}`
    if (mat[n]) {
      const m = mat[n]
      return { name: n, kind: 'Material', thickness: m.thickness, conductivity: m.conductivity, density: m.density, specific_heat: m.specific_heat } as Layer
    }
    if (nomass[n]) return { name: n, kind: 'Material:NoMass', thermal_resistance: nomass[n].thermal_resistance } as Layer
    throw new LibraryBodyError(`layer "${n}" is not a Material or Material:NoMass in the fragment`, p)
  })
  return out
}

const KIND_WORDS: Record<string, string> = {
  external_wall: 'outside wall', glazing: 'window', external_door: 'door', roof: 'roof', ground_floor: 'ground floor',
}
const SURFACE_WORDS: Record<string, string> = {
  wall: 'outside wall', glazing: 'window', roof: 'roof', ground: 'ground floor', floor: 'floor', ceiling: 'ceiling',
  partition: 'wall between zones', internal_mass: 'internal mass',
}

/**
 * The library the engine needs for this document, keyed by construction key, or what is missing. Every surface's key
 * must name a library construction, the document must pin its body hash (`library_refs`, Brief 106 P1), and the
 * library's body must be that one.
 */
export function resolveConstructions(doc: ModelDocument, items: readonly LibraryItem[] = CONSTRUCTIONS): { library: Record<string, ConstructionBody>; missing: Missing[]; drafts: string[] } {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const pinned = new Map(doc.library_refs.filter((r) => r.kind === 'construction').map((r) => [r.key, r.body_hash]))
  const library: Record<string, ConstructionBody> = {}
  const missing: Missing[] = []
  const said = new Set<string>()
  const drafts: string[] = []
  // Brief 124: a finish on an inside face is a library construction too, pinned and resolved the same way.
  const refs = doc.surfaces.flatMap((s, i) => [
    { s, key: s.construction_ref.key, path: `surfaces[${i}].construction_ref.key` },
    ...(s.inside_finish ? [{ s, key: s.inside_finish.key, path: `surfaces[${i}].inside_finish.key` }] : []),
    ...(s.inside_finish_b ? [{ s, key: s.inside_finish_b.key, path: `surfaces[${i}].inside_finish_b.key` }] : []),
  ])
  refs.forEach(({ s, key, path }) => {
    if (key.startsWith('unassigned:')) {
      const what = KIND_WORDS[key.split(':')[1]] ?? SURFACE_WORDS[s.kind] ?? s.kind
      const k = `unassigned|${key}`
      if (!said.has(k)) { said.add(k); missing.push({ path, what: `Choose a construction for the ${what}.` }) }
      return
    }
    if (library[key]) return
    const item = byKey.get(key)
    if (!item) {
      if (!said.has(key)) { said.add(key); missing.push({ path, what: `The construction "${key}" is not in the library.` }) }
      return
    }
    const pin = pinned.get(key)
    if (!pin) {
      // Brief 106 P1 (review F6): a run uses only a construction whose version the document records.
      if (!said.has(key)) { said.add(key); missing.push({ path, what: `Choose the construction "${key}" again, so the version used is recorded.` }) }
      return
    }
    if (pin !== item.body_hash) {
      if (!said.has(key)) { said.add(key); missing.push({ path, what: `The construction "${key}" has changed in the library since it was chosen. Choose it again.` }) }
      return
    }
    if (item.draft) drafts.push(item.draft)
    try { library[key] = bodyFromLibrary(item.body, `library.${key}`) } catch (e) {
      if (!(e instanceof LibraryBodyError)) throw e
      missing.push({ path, what: `The library's "${key}" cannot be read (${e.message}).` })
    }
  })
  return { library, missing, drafts }
}
