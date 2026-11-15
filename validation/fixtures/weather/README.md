# Reference weather

`USA_CO_Denver.Intl.AP.725650_TMY3.mos` (sha256 `13f5a77b445b558dd162880a98e00ecaffe3bf567d88ca8581dfa88b589fbb48`)
is the Denver TMY3 file the ASHRAE 140 / BESTEST cases use, as distributed with the open LBNL Modelica Buildings
library (`Buildings/Resources/weatherdata/`, BSD-3-Clause licence). The underlying TMY3 data are NREL's public data
set (header: "NREL TMY Data Set (2008)").

It is committed so the BESTEST gate (`frontend/src/thermal/engine/__tests__/bestest.test.ts`) and its EnergyPlus twin
(`validation/energyplus/103_bestest_twin.py`) run from a fresh checkout, not only on a machine with a local `data/`
folder (Brief 103 independent review, finding 5).

The Bridgewater anchor EPW is not committed: it lives in `data/weather/current/` (gitignored, as every project
weather file). Its tests skip without it, say so, and fail instead when `NZA_REQUIRE_REFERENCE_DATA=1`.
