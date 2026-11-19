/**
 * 19 Nov 2026 (Linzie: "how we input information before we run the model"): what one room asks for, from what its space
 * type states: its people at full occupancy, its fresh air and its lighting power. Shown on the room cards and beside the
 * inputs, so a stated rate can be checked against the room it lands in before the run.
 *
 * Each figure is worked out by the engine's own helper (`flowLs` for air, `lightingWm2` for lux), at the room's own floor
 * and people; the run works out the same for each zone. Nothing here is stored.
 */
import { flowLs } from '../../thermal/engine/ventilation'
import { lightingWm2 } from '../../thermal/engine/lighting'
import { freshAirOf } from './toDocument'
import { system } from '../library/library'
import { type Plan, type PlanRoom, type SpaceType, ringArea } from './plan'

export type RoomAsks = {
  area_m2: number
  /** People at full occupancy × occupancy rate (the run's design people); null when the space type counts none. */
  people: number | null
  /** Fresh air, l/s; null when not stated (`fresh_why` says why). */
  fresh_l_s: number | null
  fresh_why: string | null
  /** From the space type (true) or the ventilation system's own flow (plans before 19 Nov). */
  fresh_from_space: boolean
  /** Lighting while fully lit, W and W/m²; null when not stated (`light_why` says why). */
  light_w: number | null
  light_wm2: number | null
  light_how: string | null
}

export function roomPeople(sp: SpaceType | undefined, area_m2: number): number | null {
  if (!sp) return null
  const dens = sp.people_basis === 'per_room' ? sp.people_per_room : sp.people_per_m2
  if (dens == null || dens <= 0 || sp.occupancy_rate == null) return null
  return (sp.people_basis === 'per_room' ? dens : dens * area_m2) * sp.occupancy_rate
}

export function roomAsks(plan: Plan, room: PlanRoom): RoomAsks {
  const sp = plan.spaces.find((x) => x.id === room.space)
  const area_m2 = ringArea(room.ring)
  const people = roomPeople(sp, area_m2)
  const at = { area_m2, height_m: plan.storey_height_m, people: () => people ?? NaN }
  // Fresh air: the space type's, else the ventilation system's own flow (as the document writes it).
  let fresh_l_s: number | null = null, fresh_why: string | null = null, fresh_from_space = false
  const vent = plan.systems.find((y) => y.id === room.systems?.ventilation)
  const fa = freshAirOf(sp)
  if (fa) {
    fresh_from_space = true
    if (!fa.length) fresh_why = 'figure not typed'
    else if (fa.some((f) => f.basis === 'per_person') && people == null) fresh_why = 'needs people and the occupancy rate'
    else fresh_l_s = fa.reduce((t, f) => t + flowLs(f.rate, f.basis === 'per_room' ? 'constant' : f.basis, at), 0)
  } else if (vent?.flow != null) {
    const ty = system(vent.template)?.type
    fresh_l_s = flowLs(vent.flow, ty === 'mvhr' || ty === 'mev' ? 'per_m2' : 'ach', at)
  } else fresh_why = 'not stated'
  // Lighting: lux × the luminaires' efficacy, or a W/m² stated directly.
  let light_wm2: number | null = null, light_how: string | null = null
  const lum = plan.systems.find((y) => y.id === room.systems?.lighting)
  if (sp?.lux != null) {
    if (lum?.efficacy != null) { light_wm2 = lightingWm2(sp.lux, lum.efficacy); light_how = `${sp.lux} lux × ${lum.efficacy}` }
    else light_how = 'needs its luminaires\' efficacy'
  } else if (sp?.lighting_w_per_m2 != null) { light_wm2 = sp.lighting_w_per_m2; light_how = 'W/m² stated' }
  return { area_m2, people, fresh_l_s, fresh_why, fresh_from_space, light_w: light_wm2 != null ? light_wm2 * area_m2 : null, light_wm2, light_how }
}
