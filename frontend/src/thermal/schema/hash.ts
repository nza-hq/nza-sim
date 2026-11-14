/**
 * The four hashes that key a run (Brief 102): (model_hash, engine_version, library_hash, weather_hash).
 * "Same inputs, same number, forever": a changed number must have one of these as its named cause.
 */
import { canonicalJSON, sha256Hex } from './canonical'
import type { LibraryRef, ModelDocument, WeatherRef } from './model'

/** sha256 of the canonical JSON of the whole model document. */
export async function modelHash(doc: ModelDocument): Promise<string> {
  return sha256Hex(canonicalJSON(doc))
}

function refKey(r: LibraryRef): string {
  return `${r.kind}\u0000${r.key}`
}

/**
 * sha256 over the library references, sorted by (kind, key) so their order in the document never matters.
 * Each reference carries `body_hash` (the item's own content hash), so a library item edited in place, without a
 * version bump, still changes the library hash.
 */
export async function libraryHash(refs: readonly LibraryRef[]): Promise<string> {
  const sorted = [...refs].sort((a, b) => (refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) {
    if (refKey(sorted[i]) === refKey(sorted[i - 1])) {
      throw new Error(`library_refs names ${sorted[i].kind} "${sorted[i].key}" twice`)
    }
  }
  return sha256Hex(canonicalJSON(sorted))
}

/**
 * For an EPW the weather hash IS the file's own sha256 (the bytes the engine reads), never its name.
 * A legacy reference (a file name only) hashes the reference itself: weaker, and flagged by `kind`.
 */
export async function weatherHash(ref: WeatherRef): Promise<string> {
  if (ref.kind === 'epw') return ref.file_hash
  return sha256Hex(canonicalJSON(ref))
}
