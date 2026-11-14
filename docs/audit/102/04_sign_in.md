# Brief 102 Part 4: NZA Sim's own sign-in (code side)

## What landed

- `frontend/src/auth/supabase.ts`: the client from `VITE_NZASIM_SUPABASE_URL` / `VITE_NZASIM_SUPABASE_ANON_KEY`,
  created on first use and loaded with a dynamic import. With either unset, `authConfigured` is false and nothing is
  created or fetched.
- `frontend/src/auth/AuthGate.tsx`:
  - env unset → renders its children and nothing else;
  - not signed in → email magic link (PKCE, so the link works in the browser that asked for it);
  - signed in, no organisation → "Create your organisation" (`create_organisation`) or "I have an invitation" (link
    or code → `accept_invitation_token`);
  - signed in with organisations → the app, with `useAuth()` giving the session, `my_access()`, and the current
    organisation (remembered per browser);
  - an invitation link `…/?invite=<token>` is kept through the sign-in round trip, accepted once signed in, then
    removed from the address bar.
  - `OrgBadge` in the top bar: the organisation's name; a menu with the email and role, a switcher when there is
    more than one organisation, invitations for admins (`invite_member` returns a one-time link to send; the
    database sends no email), and sign out.
- `frontend/src/main.jsx`: `<AuthGate>` around `<App />`, nothing else.
- `frontend/src/components/layout/TopBar.jsx`: one line, `<OrgBadge />` after Pop Out. **Not in the brief's file
  list**, but the brief asks for the organisation's name in the top bar and this is the top bar. It renders `null`
  when sign-in is off.
- `frontend/package.json`: `@supabase/supabase-js` ^2.46.1. **Run `npm install` locally.**
- `frontend/.env.example`: the two names. `CLAUDE.md`: the new section "NZA Sim's own Supabase project".

## Evidence (this container; no real Supabase project reachable from here)

**Env unset, today's behaviour.** On ZZ TEST (seeded from the frozen fixture into a container-local scratch DB,
backend :8003, vite :5178), the Systems page shows **132.6 kWh/m²·yr** both before this change (`git stash`) and
after. The two 1440×900 screenshots are pixel-identical (no differing pixel). No request leaves localhost, and
the top bar has the same items. `npm run build` is clean.

**Env set, against a mocked Supabase** (Playwright intercepting every call to the project URL; the anon key and
calls checked in the log):
1. New email → "We have emailed a sign-in link" (`POST /auth/v1/otp`, PKCE challenge sent).
2. Signed in with no organisation → the welcome screen, not an error. "Create your organisation" → `create_organisation`
   → the app, with "Test Org Ltd" in the top bar.
3. Admin invites `viewer@example.com` as viewer → `invite_member` → the link `…/?invite=tok-viewer-123` shown;
   sign out → back to the sign-in screen (`/auth/v1/logout`).
4. Viewer opens the link → sign-in screen with the address bar already cleaned → signed in → `accept_invitation_token`
   with that token → the app, "Test Org Ltd", role viewer, **no invite form**.
5. No membership and a wrong code → "this invitation is not valid" shown in the form.
No page errors in any run.

## Still to do (with the real project)

- Chris's agent: auth settings on NZA Sim (dev): email magic link on; redirect URLs `http://localhost:5176/**`
  (and `http://localhost:5178/**` for the verification server, the Vercel domain later); the 6-digit code
  `{{ .Token }}` in the magic-link template for the seed script; add the NZA team users to `nza_team` after their
  first sign-in; hand over the two env values (Bitwarden "NZA").
- Then the brief's walkthrough for real: a brand-new email signs in, creates an organisation, invites a second
  email as viewer, signs out; the viewer joins. "The viewer cannot create a project" is enforced by
  `create_project` (`can_edit_org`) and becomes visible with Part 5's save button.
- Sign-up is open to any email (Supabase default). Every table needs a membership, so a stranger sees only the
  welcome screen. Restricting sign-ups is a project setting if wanted.
