import crypto from 'node:crypto'
import fs from 'node:fs'
import { parse as parseYaml } from '../../frontend/node_modules/yaml/dist/index.js'
import { addUser, client, psql } from './pgsb.mjs'
export const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
export const fx = parseYaml(fs.readFileSync(`${REPO}/validation/fixtures/bridgewater_anchor_v2.yaml`, 'utf8'))
export const EPW = fx.building_config.weather_file
export const EPW_SHA = crypto.createHash('sha256').update(fs.readFileSync(`${REPO}/data/weather/current/${EPW}`)).digest('hex')
export function reset() { execReset() }
import { execSync } from 'node:child_process'
function execReset() { execSync(`bash ${new URL('./reset.sh', import.meta.url).pathname}`, { stdio: 'ignore' }) }
let n = 0
export async function user(email) {
  const id = crypto.randomUUID(); addUser(id, email); return { id, email, sb: client({ id, email }) }
}
export async function org(u, name) {
  const { data, error } = await u.sb.rpc('create_organisation', { p_name: name }); if (error) throw error; return data
}
export let pass = 0, failn = 0
export function check(label, ok, detail = '') { ok ? pass++ : failn++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`) }
export function summary() { console.log(`\n${pass} passed, ${failn} failed`); process.exit(failn ? 1 : 0) }
export { psql }
