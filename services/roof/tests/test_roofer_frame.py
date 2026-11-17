"""Brief 56 Part 2: decodED's lng/lat footprints land on the EA cloud's grid. The transform is pyproj's best operation
that actually answers (OSTN15 where its grid can be read, else the Helmert), tested on a sample point — never
assumed, after CI run 40480506060 returned infinities from a grid it could not fetch. Finham's site corner is
pinned to the Helmert's answer within 3 m (the OSTN15 answer differs from it by 0.7 m east, 1.8 m north: the very
offset Brief 39 measured between decodED's toBNG frame and roofer's, docs/audit/39/field-dictionary.md).
Skipped where the job's libraries are not installed."""

import math

import pytest

from roofer import deps_available, job

needs_deps = pytest.mark.skipif(not deps_available()[0], reason=f"roofer job deps missing: {deps_available()[1]}")

FINHAM = (-1.5262, 52.3802)
HELMERT = (432348.192, 275901.523)


@needs_deps
def test_transformer_gives_finite_bng_near_the_helmert_answer():
    t, frame = job._transformer(FINHAM)
    x, y = t.transform(*FINHAM)
    assert math.isfinite(x) and math.isfinite(y)
    assert abs(x - HELMERT[0]) < 3 and abs(y - HELMERT[1]) < 3, (x, y, frame)
    assert frame["operation"] and isinstance(frame["best_available"], bool) and isinstance(frame["skipped"], list)


@needs_deps
def test_to_en_rounds_and_refuses_non_finite():
    t, _ = job._transformer(FINHAM)
    ring = job._to_en(t, [FINHAM, (-1.5252, 52.3802), (-1.5252, 52.3812)])
    assert len(ring) == 3 and all(isinstance(v, float) for p in ring for v in p)

    class Inf:
        def transform(self, xs, ys):
            return [float("inf")] * len(xs), [0.0] * len(ys)

    with pytest.raises(RuntimeError, match="non-finite"):
        job._to_en(Inf(), [FINHAM])
