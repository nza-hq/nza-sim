/**
 * Sign-in for NZA Sim's own identity (Brief 102 Part 4).
 *
 * Env unset: renders its children and nothing else, so today's tool is unchanged.
 * Env set: email magic link → (no organisation) create one or accept an invitation → the app, with the current
 * organisation in AuthContext and in the top bar (OrgBadge). Invitations are links `…/?invite=<token>`; the token
 * survives the magic-link round trip in sessionStorage and is accepted once signed in.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { authConfigured, explain, getSupabase, type Access } from './supabase'

type Org = Access['orgs'][number]
interface AuthState {
  supabase: SupabaseClient
  session: Session
  access: Access
  org: Org
  setOrgId: (id: string) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
/** The signed-in user and current organisation; null when sign-in is not configured (today's tool). */
export const useAuth = () => useContext(AuthContext)

const ORG_KEY = 'nzasim.current_org'
const INVITE_KEY = 'nzasim.pending_invite'
const store = {
  get(s: Storage | undefined, k: string) { try { return s?.getItem(k) ?? null } catch { return null } },
  set(s: Storage | undefined, k: string, v: string | null) {
    try { if (v == null) s?.removeItem(k); else s?.setItem(k, v) } catch { /* storage blocked: fine */ }
  },
}
const local = () => (typeof window === 'undefined' ? undefined : window.localStorage)
const sess = () => (typeof window === 'undefined' ? undefined : window.sessionStorage)

/** Keeps an `?invite=` token across the sign-in redirect, and strips it from the address bar. */
function captureInvite() {
  const u = new URL(window.location.href)
  const t = u.searchParams.get('invite')
  if (t) {
    store.set(sess(), INVITE_KEY, t)
    u.searchParams.delete('invite')
    window.history.replaceState(null, '', u.toString())
  }
}

export default function AuthGate({ children }: { children: ReactNode }) {
  if (!authConfigured) return <>{children}</>
  return <Gate>{children}</Gate>
}

function Gate({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [access, setAccess] = useState<Access | null>(null)
  const [orgId, setOrgIdState] = useState<string | null>(() => store.get(local(), ORG_KEY))
  const [error, setError] = useState<string | null>(null)
  const inviteTried = useRef(false)

  useEffect(() => {
    captureInvite()
    let unsub: (() => void) | undefined
    getSupabase()!.then((sb) => {
      setSupabase(sb)
      sb.auth.getSession().then(({ data }) => setSession(data.session))
      unsub = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription.unsubscribe
    }, (e) => setError(String(e)))
    return () => unsub?.()
  }, [])

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data, error: err } = await supabase.rpc('my_access')
    if (err) { setError(explain(err)); return }
    setAccess(data as Access)
  }, [supabase])

  useEffect(() => {
    if (!supabase || !session) { setAccess(null); return }
    ;(async () => {
      const token = store.get(sess(), INVITE_KEY)
      if (token && !inviteTried.current) {
        inviteTried.current = true
        const { data, error: err } = await supabase.rpc('accept_invitation_token', { p_token: token })
        store.set(sess(), INVITE_KEY, null)
        if (err) setError(explain(err))
        else if (typeof data === 'string') { store.set(local(), ORG_KEY, data); setOrgIdState(data) }
      }
      await refresh()
    })()
  }, [supabase, session, refresh])

  const setOrgId = useCallback((id: string) => { store.set(local(), ORG_KEY, id); setOrgIdState(id) }, [])
  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
    setAccess(null)
    setError(null)
  }, [supabase])

  // Brief 103 P1 (QA L3): a failed load or a failed my_access is never a dead end: Retry, and Sign out once signed in.
  if (!supabase && error) {
    return <Screen><Err text={error} /><button className={primary} onClick={() => window.location.reload()}>Retry</button></Screen>
  }
  if (!supabase || session === undefined || (session && !access && !error)) return <Screen><p className="text-caption text-mid-grey">Loading…</p></Screen>
  if (!session) return <SignIn supabase={supabase} />
  if (!access) {
    return (
      <Screen>
        <Err text={error} />
        <button className={primary} onClick={async () => { setError(null); await refresh() }}>Retry</button>
        <button className={secondary} onClick={signOut}>Sign out</button>
      </Screen>
    )
  }
  if (access.orgs.length === 0) {
    return <Onboarding supabase={supabase} email={session.user.email ?? ''} error={error} onDone={async (id) => { setError(null); if (id) setOrgId(id); await refresh() }} onSignOut={signOut} />
  }
  const org = access.orgs.find((o) => o.id === orgId) ?? access.orgs[0]
  return (
    <AuthContext.Provider value={{ supabase, session, access, org, setOrgId, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Screens ─────────────────────────────────────────────────────────────────────────────────────

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-off-white px-4">
      <div className="w-full max-w-sm bg-white border border-light-grey rounded-lg shadow-sm p-6">
        <p className="text-xxs uppercase tracking-wide text-mid-grey mb-1">NZA Simulate</p>
        {children}
      </div>
    </div>
  )
}

function Err({ text }: { text: string | null }) {
  return text ? <p role="alert" className="text-caption text-coral mt-3">{text}</p> : null
}

const input = 'w-full border border-light-grey rounded px-2 py-1.5 text-caption text-navy focus:outline-none focus:border-navy'
const primary = 'w-full mt-3 px-3 py-1.5 rounded bg-navy text-white text-caption font-medium disabled:opacity-50'
const secondary = 'w-full mt-2 px-3 py-1.5 rounded border border-light-grey text-navy text-caption hover:border-navy'

function SignIn({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
  }
  return (
    <Screen>
      <h1 className="text-h3 text-navy font-semibold mb-3">Sign in</h1>
      {sent ? (
        <p className="text-caption text-navy">We have emailed a sign-in link to <strong>{email.trim()}</strong>. Open it in this browser (the link only works where you asked for it).</p>
      ) : (
        <form onSubmit={send}>
          <label className="block text-caption text-mid-grey mb-1" htmlFor="nzasim-email">Email</label>
          <input id="nzasim-email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className={primary} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          <Err text={err} />
        </form>
      )}
    </Screen>
  )
}

/** Accepts a bare token or a whole `…?invite=<token>` link. */
function tokenFrom(text: string): string {
  const t = text.trim()
  try { return new URL(t).searchParams.get('invite') ?? t } catch { return t }
}

function Onboarding({ supabase, email, error, onDone, onSignOut }: {
  supabase: SupabaseClient; email: string; error: string | null
  onDone: (orgId: string | null) => Promise<void>; onSignOut: () => Promise<void>
}) {
  const [mode, setMode] = useState<'choose' | 'create' | 'invite'>('choose')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(error)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { data, error: rpcErr } = mode === 'create'
      ? await supabase.rpc('create_organisation', { p_name: value.trim() })
      : await supabase.rpc('accept_invitation_token', { p_token: tokenFrom(value) })
    setBusy(false)
    if (rpcErr) setErr(explain(rpcErr)); else await onDone(typeof data === 'string' ? data : null)
  }
  return (
    <Screen>
      <h1 className="text-h3 text-navy font-semibold mb-1">Welcome</h1>
      <p className="text-caption text-mid-grey mb-3">Signed in as {email}. You are not in an organisation yet.</p>
      {mode === 'choose' ? (
        <>
          <button className={primary} onClick={() => setMode('create')}>Create your organisation</button>
          <button className={secondary} onClick={() => setMode('invite')}>I have an invitation</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="block text-caption text-mid-grey mb-1" htmlFor="nzasim-onb">
            {mode === 'create' ? 'Organisation name' : 'Invitation link or code'}
          </label>
          <input id="nzasim-onb" className={input} required value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className={primary} disabled={busy || !value.trim()}>
            {busy ? 'Working…' : mode === 'create' ? 'Create organisation' : 'Join'}
          </button>
          <button type="button" className={secondary} onClick={() => { setMode('choose'); setValue(''); setErr(null) }}>Back</button>
        </form>
      )}
      <Err text={err} />
      <button className="mt-4 text-xxs text-mid-grey hover:text-navy underline" onClick={onSignOut}>Sign out</button>
    </Screen>
  )
}

// ─── Top bar ─────────────────────────────────────────────────────────────────────────────────────

/** The current organisation, a switcher, invitations (admins) and sign out. Renders nothing when sign-in is off. */
export function OrgBadge() {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'admin'>('viewer')
  const [link, setLink] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!auth) return null
  const { supabase, session, access, org, setOrgId, signOut } = auth
  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null); setLink(null)
    const { data, error } = await supabase.rpc('invite_member', { p_org: org.id, p_email: inviteEmail.trim(), p_role: inviteRole })
    if (error) setErr(explain(error))
    else setLink(`${window.location.origin}/?invite=${encodeURIComponent(String(data))}`)
  }
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Organisation (${org.role})`}
        className="flex items-center gap-1 px-2 py-1 rounded text-xxs border border-light-grey bg-white text-navy hover:border-navy"
      >
        <span className="font-medium">{org.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-light-grey rounded-lg shadow-lg z-50 p-2 text-xxs">
          <p className="px-1.5 py-1 text-mid-grey">{session.user.email} · {org.role}</p>
          {access.orgs.length > 1 && (
            <>
              <div className="h-px bg-light-grey my-1" />
              {access.orgs.map((o) => (
                <button key={o.id} onClick={() => { setOrgId(o.id); setOpen(false) }}
                  className="w-full text-left px-1.5 py-1.5 rounded hover:bg-off-white text-navy">
                  {o.id === org.id ? '● ' : ''}{o.name} <span className="text-mid-grey">({o.role})</span>
                </button>
              ))}
            </>
          )}
          {org.role === 'admin' && (
            <>
              <div className="h-px bg-light-grey my-1" />
              <form onSubmit={invite} className="px-1.5 py-1 space-y-1">
                <p className="text-navy font-medium">Invite someone</p>
                <input type="email" required placeholder="Email" aria-label="Invite email" className={input} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <div className="flex gap-1">
                  <select aria-label="Role" className={input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="submit" className="px-2 rounded bg-navy text-white">Invite</button>
                </div>
                {link && (
                  <p className="text-mid-grey break-all">Send them this link (it works once, for {inviteEmail.trim()}):<br /><span className="text-navy select-all">{link}</span></p>
                )}
                {err && <p role="alert" className="text-coral">{err}</p>}
              </form>
            </>
          )}
          <div className="h-px bg-light-grey my-1" />
          <button onClick={signOut} className="w-full text-left px-1.5 py-1.5 rounded hover:bg-off-white text-navy">Sign out</button>
        </div>
      )}
    </div>
  )
}
