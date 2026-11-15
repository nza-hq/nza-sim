/**
 * Sparse LU without pivoting, for the network's interface matrix (Brief 104 Part 6, decision 6).
 *
 * The matrix is a heat-conduction network's: symmetric, with every diagonal at least the sum of its row's
 * off-diagonals (the capacities make most rows strictly so), so elimination needs no pivoting and keeps the pattern
 * symmetric. The caller gives an elimination order (faces first, zone air and radiant nodes last), which keeps the
 * fill to the coupling between zones. Factorised once per run; each hour is a forward and a back substitution.
 */
export interface SparseLU {
  n: number
  /** order[i]: the original index of the i-th node eliminated. */
  order: Int32Array
  Lp: Int32Array; Li: Int32Array; Lx: Float64Array
  Up: Int32Array; Ui: Int32Array; Ux: Float64Array
  D: Float64Array
  work: Float64Array
}

export class SparseError extends Error {
  constructor(message: string) { super(message); this.name = 'SparseError' }
}

/** `rows[i]` maps column → value in the original numbering. */
export function sparseLuFactor(n: number, rows: Map<number, number>[], order: ArrayLike<number>): SparseLU {
  if (order.length !== n) throw new SparseError(`the elimination order lists ${order.length} of ${n} nodes`)
  const pos = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const o = order[i]
    if (!(o >= 0 && o < n) || pos[o] !== -1) throw new SparseError(`the elimination order is not a permutation (node ${o})`)
    pos[o] = i
  }
  const R: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (let i = 0; i < n; i++) for (const [j, v] of rows[i]) if (v !== 0) R[pos[i]].set(pos[j], v)
  const L: number[][] = Array.from({ length: n }, () => [])
  const Ucols: number[][] = [], Uvals: number[][] = []
  const D = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const rk = R[k]
    const d = rk.get(k)
    if (!(d !== undefined && Math.abs(d) > 0)) throw new SparseError(`the network is singular at node ${order[k]}: a node with no path to any boundary`)
    D[k] = d
    const js: number[] = [], vs: number[] = []
    for (const [j, v] of rk) {
      if (j > k) { js.push(j); vs.push(v) } else if (j < k) throw new SparseError('the network matrix is not structurally symmetric')
    }
    Ucols.push(js); Uvals.push(vs)
    for (const i of js) {
      const ri = R[i]
      const a = ri.get(k)
      if (a === undefined) throw new SparseError('the network matrix is not structurally symmetric')
      ri.delete(k)
      const f = a / d
      L[i].push(k, f)
      for (let q = 0; q < js.length; q++) { const j = js[q]; ri.set(j, (ri.get(j) ?? 0) - f * vs[q]) }
    }
    R[k] = new Map()  // done: free it
  }
  const csr = (cols: number[][], vals: number[][] | null) => {
    const p = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + (vals ? cols[i].length : cols[i].length / 2)
    const ix = new Int32Array(p[n]), x = new Float64Array(p[n])
    for (let i = 0; i < n; i++) {
      if (vals) cols[i].forEach((c, q) => { ix[p[i] + q] = c; x[p[i] + q] = vals[i][q] })
      else for (let q = 0; q < cols[i].length / 2; q++) { ix[p[i] + q] = cols[i][2 * q]; x[p[i] + q] = cols[i][2 * q + 1] }
    }
    return { p, ix, x }
  }
  const l = csr(L, null), u = csr(Ucols, Uvals)
  return { n, order: Int32Array.from(order), Lp: l.p, Li: l.ix, Lx: l.x, Up: u.p, Ui: u.ix, Ux: u.x, D, work: new Float64Array(n) }
}

/** Solves A·x = b into `x` (original numbering; `x` may alias `b`). */
export function sparseLuSolve(f: SparseLU, b: ArrayLike<number>, x: Float64Array): Float64Array {
  const { n, order, Lp, Li, Lx, Up, Ui, Ux, D, work: y } = f
  for (let i = 0; i < n; i++) {
    let s = b[order[i]]
    for (let q = Lp[i]; q < Lp[i + 1]; q++) s -= Lx[q] * y[Li[q]]
    y[i] = s
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let q = Up[i]; q < Up[i + 1]; q++) s -= Ux[q] * y[Ui[q]]
    y[i] = s / D[i]
  }
  for (let i = 0; i < n; i++) x[order[i]] = y[i]
  return x
}
