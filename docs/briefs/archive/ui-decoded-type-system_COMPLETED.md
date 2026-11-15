# UI — adopt decodED's type system — CLOSED 15 Nov 2026

**Asked by:** Linzie, 15 Nov 2026 00:38: "sort out the UI so it kind of matches decodED just in terms of font type
sizes … it's all a bit too big. Can we do a full design system review? … then apply it across."
This is the explicit go-ahead CLAUDE.md's "What not to touch: the design system" asks for.

**Scope:** visual only. No engine, schema, calculation or data-flow file changes. `frontend/plugins/engineFingerprint.js`
closure untouched, so `engine_version` is unchanged. Anchor `--fixture` = **133.2**, byte-identical output before and after.

## Findings (NZA Sim vs decodED)

| | NZA Sim before | decodED (`nza-hq/nza-decoded`) |
|---|---|---|
| Faces | Stolzl for everything (body, labels, tables, charts) | Stolzl display only · DM Sans UI/body · Inter figures |
| Size ramp | 12 tokens 8.8 → 20.8 px, **but none rendered** (see below): ~1,600 classes all fell back to one 11.6 px body size | micro 11 · small 13 · detail 14 · body 16 · h2 22 · title 32 |
| Hierarchy | flat: page titles (`text-caption`) the same size as labels; bold uppercase Stolzl everywhere | eyebrow 12 uppercase 600 ink-soft · title Stolzl 500 tight · body DM Sans · small print Inter |
| Charts | Stolzl 8–9 px ticks/tooltips | Inter 12–13 |
| Colours | Pablo palette (navy, magenta, teal) | Assembly: cream ground, ink #2A2A2A, green acts, orange selects, six data hues |
| Controls | 26–30 px inputs/buttons, 4–8 px radius | 36–44 px (touch-first story UI), radius 8 control / 12 panel |

**Root cause of "too big":** Tailwind v4 only makes `text-*` utilities from the `--text-*` theme namespace. NZA Sim's sizes
were declared as `--font-size-*` (the v3 habit), so `text-xxs` (1,214 uses), `text-caption` (268), `text-table`,
`text-section`, `text-heading`, `text-metric` … generated no CSS at all. Every one of those elements rendered at the
body size in Stolzl, a wide face, which is what made the app feel big and samey.

## What changed

1. `frontend/src/design-system/tokens.css` (new): the one type-and-token file. Faces (`--font-sans` DM Sans,
   `--font-display` Stolzl, `--font-figures` Inter), the ramp in the `--text-*` namespace under the **same class
   names** (so no component had to change), decodED's Assembly colours as opt-in utilities (`bg-surface`, `text-ink`,
   `bg-act`, `text-select` …), radius and motion. Old `--font-size-*` names kept as aliases. `tabular-nums` and the
   metric sizes use Inter; `text-heading` / `text-page-title` use Stolzl.
2. `frontend/src/index.css` imports it; its Pablo colour palette is unchanged; Stolzl kept as the display face.
3. `frontend/public/fonts/` (new): DM Sans + Inter woff2 and `fonts.css`, self-hosted (SIL OFL 1.1), copied from
   decodED's `public/fonts/gf/`; linked from `index.html`. Stolzl files stay local-only as before.
4. `frontend/src/data/chartTokens.js`: chart text Inter, ticks 8 → 10, tooltip 9 → 11, legend 8 → 10.
5. Six module page titles (Building, Systems ×2, Operation, Results, Roadmap) moved from `text-caption` to
   `text-heading` (Stolzl 18 px), as decodED titles its cards.

Deliberately **not** adopted: decodED's 36–56 px controls (made for a touch-first story; it would make NZA Sim bigger,
the opposite of the ask) and decodED's colours (a brand decision for Linzie; available as tokens for new work).

## Verification

- `npm run build` clean; `vitest` 17/17.
- Anchor: `node scripts/_brief93_anchor.mjs --fixture validation/fixtures/bridgewater_anchor_v2.yaml` → EUI 133.2,
  output md5 identical with and without this change.
- Browser at 1440×900, Bridgewater snapshot on an isolated scratch instance, Stolzl served as on IT15: Home,
  Information, Building, Systems, Gains, Results, Library, Interventions. Before/after in
  [`../../audit/ui-decoded-type/`](../../audit/ui-decoded-type/).

## For other work

The Simulate v2 prototypes (`frontend/src/sim2/…`) render inside the same app, so they get these tokens through
`index.css`. Use the utilities (`text-caption`, `font-display`, `tabular-nums`, `bg-surface`, `text-ink` …) or the CSS
variables (`var(--text-body)`, `var(--font-figures)`, `var(--color-act)`, `var(--radius-control)`), not literal sizes or font names.
