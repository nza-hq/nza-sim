/** NZA's line icons (README.md here says where they come from). They draw in the colour of the text round them. */
import air from './fabric-air.svg?raw'
import bridge from './fabric-bridge.svg?raw'
import floor from './fabric-floor.svg?raw'
import openings from './fabric-openings.svg?raw'
import roof from './fabric-roof.svg?raw'
import wall from './fabric-wall.svg?raw'
import building from './building.svg?raw'
import person from './person.svg?raw'
import profile from './profile.svg?raw'
import rooms from './rooms.svg?raw'
import cooling from './system-cooling.svg?raw'
import dhw from './system-dhw.svg?raw'
import heating from './system-heating.svg?raw'
import boiler from './system-boiler.svg?raw'
import ventilation from './system-ventilation.svg?raw'
import lighting from './system-lighting.svg?raw'
import power from './system-power.svg?raw'

const ICONS = { air, bridge, floor, openings, roof, wall, building, person, profile, rooms, cooling, dhw, heating, boiler, ventilation, lighting, power } as const
export type IconName = keyof typeof ICONS

export default function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return <span className={`nz-icon${className ? ` ${className}` : ''}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
}
