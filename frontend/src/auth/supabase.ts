/**
 * NZA Sim's own Supabase project (Brief 102 Part 4). Never decodED's.
 *
 * The client exists only when both env values are set (frontend/.env, values in Bitwarden "NZA"). With either
 * unset, `authConfigured` is false, nothing is imported or fetched, and the app runs exactly as before.
 * The anon key is public by design: every table has RLS and all writes go through security-definer functions
 * (supabase/README.md). There is no service-role key anywhere in the frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const URL_ = import.meta.env.VITE_NZASIM_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_NZASIM_SUPABASE_ANON_KEY as string | undefined

export const authConfigured = Boolean(URL_ && KEY)

let client: Promise<SupabaseClient> | null = null

/** The client, created once; loaded on demand so the library is not in the bundle's first chunk. Null when unset. */
export function getSupabase(): Promise<SupabaseClient> | null {
  if (!authConfigured) return null
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_ as string, KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }),
  )
  return client
}

/** What `my_access()` returns (supabase/migrations/0001_tenancy.sql). */
export interface Access {
  signed_in: boolean
  nza_team: boolean
  orgs: { id: string; name: string; role: 'admin' | 'editor' | 'viewer' }[]
}

/** Turns a PostgREST error into one sentence (error codes from the migrations). */
export function explain(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return 'Something went wrong.'
  if (err.code === '42501') return err.message || 'You are not allowed to do that.'
  if (err.code === 'P0002') return 'Not found.'
  return err.message || 'Something went wrong.'
}
