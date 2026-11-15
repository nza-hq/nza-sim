/**
 * Dense LU factorisation with partial pivoting, for the zone's node matrix (Brief 103 decision 7: factorise once per
 * run, rebuild only the right-hand side each hour). Row-major Float64Array, n of order 50 for one zone.
 */
export interface LU { n: number; lu: Float64Array; piv: Int32Array }

export function luFactor(a: Float64Array, n: number): LU {
  const lu = Float64Array.from(a)
  const piv = new Int32Array(n)
  for (let i = 0; i < n; i++) piv[i] = i
  for (let k = 0; k < n; k++) {
    let p = k, max = Math.abs(lu[k * n + k])
    for (let i = k + 1; i < n; i++) { const v = Math.abs(lu[i * n + k]); if (v > max) { max = v; p = i } }
    if (!(max > 0)) throw new Error(`zone matrix is singular at node ${k}: a node with no path to any boundary`)
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = lu[k * n + j]; lu[k * n + j] = lu[p * n + j]; lu[p * n + j] = t }
      const t = piv[k]; piv[k] = piv[p]; piv[p] = t
    }
    const d = lu[k * n + k]
    for (let i = k + 1; i < n; i++) {
      const f = (lu[i * n + k] /= d)
      if (f !== 0) for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j]
    }
  }
  return { n, lu, piv }
}

/** Solves A·x = b into `x` (which may not alias `b`). */
export function luSolve(f: LU, b: Float64Array, x: Float64Array): Float64Array {
  const { n, lu, piv } = f
  for (let i = 0; i < n; i++) {
    let s = b[piv[i]]
    for (let j = 0; j < i; j++) s -= lu[i * n + j] * x[j]
    x[i] = s
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * x[j]
    x[i] = s / lu[i * n + i]
  }
  return x
}
