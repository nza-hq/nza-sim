# Brief 106 Part 1 — every construction a run uses is pinned (review F6)

- **The change.** `resolveConstructions` (`frontend/src/sim2/run/library.ts`) now refuses a surface's construction when the document has no `library_refs` entry for it. The panel lists it as missing: `Choose the construction "<key>" again, so the version used is recorded.` Before, an unpinned construction ran on whatever the library held that day.
- **The editor is unaffected.** Its `toDocument.ts` (branch `sim2/geometry-prototype` at 11bc983) pins every construction it uses. All 16 of its snapshot's body hashes match the seam's library, including the draft internal wall (`0204c0d2…`).
- **Converted documents** (`fromBuildingConfig`) already pin today's database bodies. Those are reported as changed, as in Brief 105.
- **Tests.**
  - `library.test.ts` has a new case: a dropped pin is refused and that construction is not run.
  - `seam.test.ts` now pins the draft wall it adds.
  - 157 thermal and sim2 tests pass.
