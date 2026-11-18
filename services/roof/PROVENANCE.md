# The roof service: copied from decodED

Copied from nza-decoded @ e5174c5 (services/roof/) on 2026-11-17, every file unchanged. **Diverged: no.**
Brief 123 (Linzie, 17 Nov 10:47: "have a look at the decodED roof service because I think it's already
done the work for us. Bring that in if it works. Don't start again from scratch").

Re-port by copying the folder again from decodED (`git archive <sha> services/roof | tar -x`), never by
hand-editing here; update the sha above. A change needed by NZA Sim is made in decodED first.

## What NZA Sim uses
- `POST /roof/construct-batch`: a block's footprint (local metres) and roof recipe in, its roof faces out
  (flat, mono, gable, hip and decodED's other shapes on rectangles; gable and hip on any outline through
  CGAL's straight skeleton, valleys included). NZA Sim's backend calls it (`api/routers/roof.py`); the
  browser never does.
- The `/roofer/*` routes (decodED's measured roofs from LiDAR) come along with the copy and are unused.

## Licence boundary
CGAL is GPL-3. It stays in this service, a separate process on the machine, started by NZA Sim's backend
(`api/roof_launcher.py`) on `127.0.0.1:8009` (decodED's own copy uses 8008). Nothing from it reaches a
browser or the frontend build. This is decodED's rule (Brief 20 D3) and it holds here too.

## Running it
NZA Sim's backend starts it on startup when a `roof` conda env exists (the same env decodED uses:
`conda env create -f services/roof/environment.yml`, once). Without the env, or with `ROOF_AUTOSTART=0`,
NZA Sim carries on: rectangular blocks are roofed in the browser (`frontend/src/sim2/geometry/roof.ts`,
checked against this service's numbers), and any other outline keeps a flat roof and says why.

## Checked (17 Nov 2026, Linux container, CGAL 5.6 from Ubuntu, not the env's pinned 6.2)
147 of its tests pass, 8 skipped. One fails, and only because it asserts the CGAL version starts "6.". For
that build, skel.cpp needed `std::shared_ptr` read as `boost::shared_ptr`, which CGAL 5.6 returns. The copy
here is unchanged, because the pinned env has CGAL 6.2.
