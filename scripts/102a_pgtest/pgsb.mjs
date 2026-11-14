// A tiny supabase-js stand-in over psql, for testing versions.ts against the real migrations on a local Postgres.
// rpc() and from().select().eq().order().limit() only. Each call runs as role `authenticated` with the user's claims.
import { execFileSync } from 'node:child_process'
const lit = (v) => v === null || v === undefined ? 'NULL' : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''")}'`
export function psql(sql) {
  try {
    return { out: execFileSync('psql', ['-h', process.env.PGHOST ?? '/tmp', '-p', process.env.PGPORT ?? '54329', '-U', 'postgres', '-d', 't', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', '\\set VERBOSITY verbose', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(e.stderr ?? '')
    return { error: { code: m?.[1], message: m?.[2] ?? e.stderr } }
  }
}
export function client(user) {
  const claims = JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' })
  const run = (q) => psql(`begin; set local role authenticated; select set_config('request.jwt.claims', ${lit(claims)}, true); ${q}; commit;`)
  const lines = (out) => out.trim().split('\n').filter(Boolean)
  return {
    rpc: async (fn, args) => {
      const a = Object.entries(args ?? {}).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')
      const r = run(`select to_json(public.${fn}(${a}))`)
      if (r.error) return { data: null, error: r.error }
      return { data: JSON.parse(lines(r.out).pop()), error: null }
    },
    from: (table) => {
      const q = { cols: '*', where: [], order: '', limit: '' }
      const b = {
        select(c) { q.cols = c; return b },
        eq(c, v) { q.where.push(`${c} = ${lit(v)}`); return b },
        order(c, o) { q.order = ` order by ${c} ${o?.ascending === false ? 'desc' : 'asc'}`; return b },
        limit(n) { q.limit = ` limit ${n}`; return b },
        then(res, rej) {
          const w = q.where.length ? ` where ${q.where.join(' and ')}` : ''
          const r = run(`select coalesce(json_agg(t), '[]') from (select ${q.cols} from public.${table}${w}${q.order}${q.limit}) t`)
          return Promise.resolve(r.error ? { data: null, error: r.error } : { data: JSON.parse(lines(r.out).pop()), error: null }).then(res, rej)
        },
      }
      return b
    },
  }
}
export function addUser(id, email) { psql(`insert into auth.users (id, email) values ('${id}', '${email}') on conflict do nothing`) }
