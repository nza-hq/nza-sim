/**
 * Canonical JSON and SHA-256 for Simulate v2 (Brief 102 Part 1).
 *
 * canonicalJSON(value) is the one serialisation every hash is taken over:
 *   - object keys sorted by UTF-16 code unit order (Array.prototype.sort default), at every depth;
 *   - object properties whose value is `undefined` are dropped (as JSON.stringify drops them);
 *   - numbers: -0 becomes 0; NaN and ±Infinity throw (they have no JSON form and would hash silently as null);
 *     every other number prints as JavaScript's shortest round-trip form (no trailing zeros, no "1.50");
 *   - strings, booleans and null as JSON.stringify prints them;
 *   - anything else (undefined inside an array, functions, symbols, bigint, Date, Map, class instances) throws
 *     with the path, so a document can never hash differently from what is stored.
 *
 * sha256Hex uses Web Crypto (globalThis.crypto.subtle), which exists in every supported browser and in Node 18+.
 * One implementation serves both, so the browser and Node cannot disagree (Part 0 divergence 9: the brief asked
 * for two implementations; one is strictly safer).
 */

export class CanonicalJSONError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || '<root>'}`)
    this.name = 'CanonicalJSONError'
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number': {
      if (!Number.isFinite(value)) throw new CanonicalJSONError(`non-finite number ${value}`, path)
      return Object.is(value, -0) ? '0' : JSON.stringify(value)
    }
    case 'object': {
      if (Array.isArray(value)) {
        const parts = value.map((item, i) => {
          if (item === undefined) throw new CanonicalJSONError('undefined inside an array', `${path}[${i}]`)
          return encode(item, `${path}[${i}]`)
        })
        return `[${parts.join(',')}]`
      }
      if (!isPlainObject(value)) {
        throw new CanonicalJSONError(`not a plain object (${Object.prototype.toString.call(value)})`, path)
      }
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
      const parts = keys.map((k) => `${JSON.stringify(k)}:${encode(value[k], path ? `${path}.${k}` : k)}`)
      return `{${parts.join(',')}}`
    }
    default:
      throw new CanonicalJSONError(`cannot serialise a ${typeof value}`, path)
  }
}

/** The canonical JSON text of `value`. Throws CanonicalJSONError (with the path) on anything JSON cannot hold. */
export function canonicalJSON(value: unknown): string {
  return encode(value, '')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error('Web Crypto (crypto.subtle) is not available: needs a secure context in the browser or Node 18+')
  return s
}

/** Lower-case hex SHA-256 of raw bytes (an EPW file, for example). */
export async function sha256HexBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await subtle().digest('SHA-256', bytes))
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(text))
}
