# Brief 102 Part 4 (Supabase side) — sign-in configuration on NZA Sim (dev)

Set 14 Nov 2026 by Claude Chat in the dashboard for `jbjxduathkklruvbmeho`. The frontend half of Part 4 is
Linzie's agent's commit; this file records what the project is set to and what it is not.

## Settings as they stand

| Setting | Value | Where |
|---|---|---|
| Allow new users to sign up | on | Authentication › Sign In / Providers |
| Allow anonymous sign-ins | **off** (no anonymous callers, as `caller_id()` assumes) | same |
| Confirm email | on | same |
| Email provider | on; magic links and email OTP on | same › Email |
| Email OTP length | **6** (was 8) | same › Email |
| Email OTP expiry | 3600 s | same › Email |
| Site URL | `http://localhost:5176` | Authentication › URL Configuration |
| Redirect URLs | `http://localhost:5176/**` | same |
| Data API | on; schemas `public`, `extensions`; automatic table exposure **off**; automatic RLS on | Integrations › Data API |
| Project URL | `https://jbjxduathkklruvbmeho.supabase.co` | |
| Publishable (anon) key | `sb_publishable_4UFmPKa_wEsndBbhHfYGZA_J3BTKYo_` (public by design: RLS on every table, nothing granted to anon) | Settings › API Keys |
| Secret key | exists in the dashboard; **never copied**, never in this repo, a laptop `.env`, a log or Notion | |

## Checked from a browser with the publishable key (what a visitor can and cannot do)

| Call | Result |
|---|---|
| `POST /rest/v1/rpc/my_access` as anon | 401 `permission denied for function my_access` (correct) |
| `GET /rest/v1/organisations` as anon | 401 `permission denied for table organisations` (correct) |
| `POST /rest/v1/rpc/accept_invitation_token` as anon with a bad token | 401 `this invitation is not valid` (the function runs, validates only; correct) |
| `GET /auth/v1/settings` | 200, `email: true`, `anonymous_users: false` |

The dashboard's "0 of 11 tables exposed" counts grants to `anon`; the tables are reachable by `authenticated`
through RLS, which the calls above and the Part 2 checks confirm.

## What the agent's Part 4 UI needs to know

- **The default email cannot carry the 6-digit code.** Supabase's built-in email templates are read-only until a
  custom SMTP is configured; the default Magic Link email contains the sign-in link only, not `{{ .Token }}`.
  The agent's `AuthGate.tsx` (commit 462f24f) uses the **link** (`signInWithOtp` with `emailRedirectTo`), so it
  matches the project as configured and nothing is blocked. The "6-digit code" in the handover message was a
  slip; a code-entry UI would need custom SMTP first.
- **Custom SMTP is a prerequisite for the prod project anyway** (the built-in sender is rate-limited to a handful
  of emails an hour and sends from a shared Supabase address). Decision for Chris: Resend (free tier, verified
  sending subdomain of thenza.co.uk, one API key held in the Supabase dashboard, not in the repo) or Microsoft 365
  SMTP (needs SMTP AUTH enabled on the mailbox). Once SMTP is on, the template gains
  `Your code is {{ .Token }}` beside the link and the code UI works.
- `nza_team` is empty. After Chris's first real sign-in, run in the SQL editor:
  `insert into public.nza_team (user_id) select id from auth.users where email = '<chris's email>';`
  Until then `is_nza_team()` is false for everyone and global library writes (Part 3 `--apply`) are refused.
- The Vercel domain is not in Redirect URLs yet; add `https://<domain>/**` when there is one.

## Local `.env` (frontend/.env, gitignored; names in frontend/.env.example)

```
VITE_NZASIM_SUPABASE_URL=https://jbjxduathkklruvbmeho.supabase.co
VITE_NZASIM_SUPABASE_ANON_KEY=sb_publishable_4UFmPKa_wEsndBbhHfYGZA_J3BTKYo_
```

Both values also go in Bitwarden org "NZA" under "nza-sim (dev) Supabase" so the next machine has them.
