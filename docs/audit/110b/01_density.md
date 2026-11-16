# 110b P3: density and layout check of /model at 1440×900

Measured 16 Nov 2026 on branch `sim2/110b-carry-over` with Playwright (dev server, the committed fixture plan, Chicago EPW),
one pass per step. Screenshots in `shots/`.

| Check (ui_principles.md, 28-IM §2.3) | Result |
|---|---|
| Compact text | Median text 11–13 px in every pane on every step; nothing over 14 px. |
| No page horizontal scroll | None on any step. |
| Nothing clipped | 0 clipped elements in the left, right and strip panes. The strip clipped at the Fabric step (content 512 px in 485 px) because the level switch and the weather label squeezed the four figures; the weather label is now capped at 22% of the strip and the four figures fit. |
| Buttons | Tallest are the kind tiles in the right pane (about 61 px), by design. Apply/Cancel trimmed to 13 px text. |
| Centre content about 900–1000 px | Heat flow is capped at 960 px; at 1440 px wide with both side panes open the centre itself is about 700 px, so the chart fills it. Collapsing a side pane gives it more room. |
| Empty states, not defaults | Unset values show as unset; no figure appears without a run. |

## Not done here

Side-by-side screenshots beside today's Building and Internal Gains pages need the backend, which does not run in this
container. They need taking on IT15.

## Deliberate difference (recorded as ui_principles.md asks)

Left is what you choose (whole building, zones, rooms), right is what you give it, with preview then Apply. Today's rule
is inputs left, 3D and live results right. Linzie asked for the choose/give layout on 15 Nov at 21:02; the 3D moves to
the Drawing tab and the live strip to the top of the centre.
