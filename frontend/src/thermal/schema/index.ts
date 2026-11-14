/** Simulate v2 model document: schemas, canonical hashing and today's-config converter (Brief 102 Part 1). */
export * from './model'
export * from './results'
export { canonicalJSON, CanonicalJSONError, sha256Hex, sha256HexBytes } from './canonical'
export { modelHash, libraryHash, weatherHash } from './hash'
export { fromBuildingConfig, ConversionError } from './fromBuildingConfig'
export type { ConverterInput, Conversion, TraceEntry } from './fromBuildingConfig'
