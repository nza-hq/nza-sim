/**
 * The Monthly centre tab (Brief 110b row 3): today's diverging monthly chart (`shared/DivergingMonthlyChart`, imported, not
 * copied) fed by the run's own months. Cooling grows up from the axis, heating down, so the two seasons read against each
 * other. The months are the engine's hourly heating and cooling summed by month in the seam (`monthly`); nothing is worked
 * out here except the check that the twelve months add up to the year shown on Heat flow (Rule 9).
 */
import DivergingMonthlyChart from '../../components/shared/DivergingMonthlyChart.jsx'
import ChartTotalsBadge from '../../components/shared/ChartTotalsBadge.jsx'
import type { InstantEstimate, Summary } from './seam'

type Zone = Summary['zones'][number]
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function MonthlyDemand({ summary, zone }: { summary: Summary; zone: Zone | null }) {
  const m = zone ? zone.monthly : summary.building.monthly
  const year = zone ? { heat: zone.heating_kwh, cool: zone.cooling_kwh } : { heat: summary.building.heating_kwh, cool: summary.building.cooling_kwh }
  const floor = zone ? zone.floor_m2 : summary.building.floor_m2
  const heated = zone ? zone.heated : summary.zones.some((z) => z.heated)
  const cooled = zone ? zone.cooled : summary.zones.some((z) => z.cooled)
  const h = sum(m.heating_kwh), c = sum(m.cooling_kwh)
  const adds = Math.abs(h - year.heat) < 0.5 && Math.abs(c - year.cool) < 0.5
  return (
    <div className="rp-monthly">
      <div className="rp-monthly-head">
        <span>Heating and cooling demand by month <i>estimate</i></span>
        <span className="rp-monthly-badges">
          {heated && <ChartTotalsBadge label="Σ heating" value_kwh={h} gia_m2={floor} />}
          {cooled && <ChartTotalsBadge label="Σ cooling" value_kwh={c} gia_m2={floor} />}
        </span>
      </div>
      {!heated && !cooled ? (
        <p className="gl-hint">No room here has a heating or cooling temperature, so there is no demand to show by month.</p>
      ) : (
        <DivergingMonthlyChart
          gainsStacks={cooled ? [{ key: 'cooling', label: 'Cooling demand', color: '#3B82F6', values: m.cooling_kwh }] : []}
          lossesStacks={heated ? [{ key: 'heating', label: 'Heating demand', color: '#E8604C', values: m.heating_kwh }] : []}
          height={340}
          upLabel="↑"
          downLabel="↓"
          unit="kWh"
        />
      )}
      <p className="rp-monthly-foot">
        {adds ? 'The twelve months add up to the year on Heat flow.' : `The months add up to ${Math.round(h)} kWh heating and ${Math.round(c)} kWh cooling, not the year's ${Math.round(year.heat)} and ${Math.round(year.cool)}: please report this.`}
        {!heated && cooled ? ' No room here is heated.' : heated && !cooled ? ' No room here is cooled.' : ''}
      </p>
    </div>
  )
}

/** Brief 122: the monthly estimate (static)'s months, on Project, Shape and Fabric. Labelled as the static engine's (Rule 7). */
export function MonthlyEstimate({ estimate, zone }: { estimate: InstantEstimate; zone: InstantEstimate['zones'][number] | null }) {
  const m = zone ? zone.monthly : estimate.monthly
  const floor = zone ? zone.floor_m2 : estimate.building.floor_m2
  const h = sum(m.heating_kwh), c = sum(m.cooling_kwh)
  return (
    <div className="rp-monthly">
      <div className="rp-monthly-head">
        <span>Heating and cooling demand by month <i>{estimate.label}</i></span>
        <span className="rp-monthly-badges">
          <ChartTotalsBadge label="Σ heating" value_kwh={h} gia_m2={floor} />
          {c > 0 && <ChartTotalsBadge label="Σ cooling" value_kwh={c} gia_m2={floor} />}
        </span>
      </div>
      <DivergingMonthlyChart
        gainsStacks={c > 0 ? [{ key: 'cooling', label: 'Cooling demand', color: '#3B82F6', values: m.cooling_kwh }] : []}
        lossesStacks={[{ key: 'heating', label: 'Heating demand', color: '#E8604C', values: m.heating_kwh }]}
        height={340}
        upLabel="↑"
        downLabel="↓"
        unit="kWh"
      />
      <p className="rp-monthly-foot">The monthly method, worked out as you edit. Run the full year (every 15 minutes, above) for the full calculation.</p>
    </div>
  )
}
