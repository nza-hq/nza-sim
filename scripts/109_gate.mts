/**
 * Brief 109: the hourly summaries and the setback gate (validation/energyplus/109_setback_spec.json), shared by the
 * Part 2 and Part 3 comparison scripts. The same definitions as 109_setback_referee.py's summarise.
 */
export function summarise(heat: ArrayLike<number>, t: ArrayLike<number>, sp: ArrayLike<number>, use: ArrayLike<number>, weekday: (d: number) => boolean, tol: number) {
  const wd = Array.from({ length: 365 }, (_, d) => d).filter(weekday)
  let unmet = 0, unmetUse = 0, mn = Infinity, mnUse = Infinity, tot = 0, peak = 0
  for (let h = 0; h < 8760; h++) {
    tot += heat[h]; peak = Math.max(peak, heat[h]); mn = Math.min(mn, t[h])
    if (use[h]) mnUse = Math.min(mnUse, t[h])
    if (t[h] < sp[h] - tol) { unmet++; if (use[h]) unmetUse++ }
  }
  const prof = Array.from({ length: 24 }, (_, i) => wd.reduce((s, d) => s + heat[d * 24 + i], 0) / wd.length)
  const morning = wd.reduce((s, d) => { let m = 0; for (let i = 0; i < 24; i++) m = Math.max(m, heat[d * 24 + i]); return s + m }, 0) / wd.length
  return { heat_mwh: tot / 1e6, peak_w: peak, unmet_hours: unmet, unmet_hours_in_use: unmetUse, min_c: mn, min_in_use_c: mnUse, weekday_morning_peak_w: morning, weekday_profile_w: prof }
}
export type Summary = ReturnType<typeof summarise>

/** The spec's gate, each line with its numbers. */
export function gate(e: Summary, p: Summary) {
  const dPeak = Math.max(...p.weekday_profile_w)
  const prof = Math.max(...e.weekday_profile_w.map((v, i) => Math.abs(v - p.weekday_profile_w[i]))) / dPeak
  const du = Math.abs(e.unmet_hours_in_use - p.unmet_hours_in_use)
  const lines = {
    heating_pct: +((e.heat_mwh / p.heat_mwh - 1) * 100).toFixed(1),
    morning_peak_pct: +((e.weekday_morning_peak_w / p.weekday_morning_peak_w - 1) * 100).toFixed(1),
    unmet_in_use_diff_h: e.unmet_hours_in_use - p.unmet_hours_in_use,
    min_in_use_diff_k: +(e.min_in_use_c - p.min_in_use_c).toFixed(2),
    profile_worst_pct_of_peak: +(prof * 100).toFixed(1),
  }
  const pass = {
    heating: Math.abs(lines.heating_pct) <= 10, morning_peak: Math.abs(lines.morning_peak_pct) <= 15,
    unmet_in_use: du <= 50 || du / Math.max(p.unmet_hours_in_use, 1) <= 0.2, min_in_use: Math.abs(lines.min_in_use_diff_k) <= 1, profile: prof <= 0.15,
  }
  return { ...lines, pass, all: Object.values(pass).every(Boolean) }
}
