/**
 * decodED's look, for NZA Sim's 3D (Linzie, 25 Nov 2026: decodED's twin of the RWGC clubhouse, "Yes perfect!").
 *
 * Outside, a sketch, not a render: every face unlit and off-white in three tones by the way it points (roofs and
 * up-facing faces ×1.0, walls facing the sun's side ×0.87, walls facing away ×0.75), then two inks drawn over the
 * picture (Ink.tsx). Windows sit back in the wall with a white sill and a mullion about every 1.2 m; glass pale;
 * doors a soft sage. Inside, decodED's inside viewer: white walls cut at 1.5 m, a pale slab, each room in its decodED
 * room type's colour, its name and m² on a label (a dot where names would crowd), the other floors faint outlines.
 *
 * The numbers are decodED's own (nza-decoded: twin/ui/tokens.ts `tones`, `outline`, `crease`, `outlinePx`,
 * `creasePx`; twin/app/detailed/mesh.ts DETAIL_LOOK; twin/app/inside/scene.ts; twin/app/floor/model.ts ROOM_TYPES;
 * twin/app/detailed/insideView.ts room types from names). Drawing only: nothing here reaches the model or the run.
 */
import * as THREE from 'three'

export const LOOK = {
  /** The building's faces (decodED's `site`). */
  face: '#F7F7F4',
  tones: { roof: 1, sunlit: 0.87, shaded: 0.75 },
  /** Where the sun's side is, for the wall tones only (decodED's light `from`, its ground plane used). */
  sun: [68, 181, 51] as [number, number, number],
  /** The thick ink, only where the building meets what is behind it (background or ground). */
  outline: '#646A68',
  outlinePx: 1.75,
  /** The thin ink, where faces turn or depth jumps within the building. */
  crease: '#939994',
  creasePx: 0.85,
  /** Slab between storeys, and the outside wall. */
  slab: 0.22,
  outerT: 0.3,
  /** How far a pane sits back from the wall's middle line. */
  reveal: 0.11,
  glass: '#B9CBD6',
  door: '#A9BDB6',
  frame: '#FFFFFF',
  /** About one mullion per this many metres of window. */
  mullionEvery: 1.2,
  /** The ground the building stands on, and the page behind it. */
  ground: '#E9ECEA',
  page: '#F3F5F4',
} as const

export const INSIDE = {
  wall: '#FBFAF7',
  outerWall: '#FFFFFF',
  wallT: 0.18,
  /** The walls are cut here (3D, one floor). */
  cut: 1.5,
  /** Laid flat, with every floor apart. */
  flat: 0.12,
  slab: '#E3E7E5',
  slabT: 0.22,
  ghost: '#235546',
  ghostOpacity: 0.13,
  /** The faint lines joining the floors' corners with every floor apart. */
  lines: 0.2,
  chosen: '#E28F2C',
  page: '#F3F5F4',
} as const

/** sRGB multipliers, as written, into the linear factors the shader multiplies by. */
const linear = (f: number) => Math.pow(Math.max(0, f), 2.2)

const toneCache = new Map<string, THREE.MeshBasicMaterial>()
/**
 * An unlit material in `colour`, toned by the way each face points (decodED's twin/render/modules/buildings/tones.js,
 * without its storey lines): a face pointing up ×roof, a wall facing the sun's side ×sunlit, one facing away ×shaded.
 * The tone depends on the face, never on where the camera stands. One shared material per colour and option set.
 */
export function toneMaterial(colour: string, opts: { opacity?: number; side?: THREE.Side; flat?: boolean } = {}): THREE.MeshBasicMaterial {
  const op = opts.opacity ?? 1
  const side = opts.side ?? THREE.FrontSide
  const key = `${colour}|${op}|${side}|${opts.flat ? 1 : 0}`
  const hit = toneCache.get(key)
  if (hit) return hit
  const m = new THREE.MeshBasicMaterial({ color: colour, transparent: op < 1, opacity: op, depthWrite: op === 1, side })
  if (!opts.flat) {
    const s = new THREE.Vector2(LOOK.sun[0], LOOK.sun[2]).normalize()
    const uniforms = { uToneRoof: { value: linear(LOOK.tones.roof) }, uToneSun: { value: linear(LOOK.tones.sunlit) }, uToneShade: { value: linear(LOOK.tones.shaded) }, uSunXZ: { value: s } }
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vToneNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvToneNormal = inverseTransformDirection( normalMatrix * normal, viewMatrix );')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vToneNormal;\nuniform float uToneRoof;\nuniform float uToneSun;\nuniform float uToneShade;\nuniform vec2 uSunXZ;')
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            'vec3 tn = normalize( vToneNormal );',
            // A face seen from behind (double-sided roofs) takes the tone of the side seen.
            'if ( !gl_FrontFacing ) tn = -tn;',
            'float tone = tn.y > 0.5 ? uToneRoof : ( dot( normalize( tn.xz + vec2( 1e-5 ) ), uSunXZ ) > 0.0 ? uToneSun : uToneShade );',
            'diffuseColor.rgb *= tone;',
          ].join('\n'),
        )
    }
    m.customProgramCacheKey = () => 'nza-face-tones'
  }
  toneCache.set(key, m)
  return m
}

// ---- Room types (decodED's inside viewer) --------------------------------------------------------------------------

export type RoomType = 'classroom' | 'hall' | 'kitchen' | 'plant' | 'toilets' | 'office' | 'corridor' | 'lab' | 'library' | 'sports' | 'store' | 'staff' | 'other'

/** decodED's room types and their swatches (twin/app/floor/model.ts ROOM_TYPES). */
export const ROOM_TYPES: ReadonlyArray<{ key: RoomType; name: string; swatch: string }> = [
  { key: 'classroom', name: 'Classroom', swatch: '#8FB8A8' },
  { key: 'hall', name: 'Hall', swatch: '#B7A4CF' },
  { key: 'kitchen', name: 'Kitchen', swatch: '#E3B999' },
  { key: 'plant', name: 'Plant room', swatch: '#9AA3AD' },
  { key: 'toilets', name: 'Toilets', swatch: '#9CC3DA' },
  { key: 'office', name: 'Office', swatch: '#D5C68E' },
  { key: 'corridor', name: 'Corridor', swatch: '#D9D4CA' },
  { key: 'lab', name: 'Science lab', swatch: '#7FA7B6' },
  { key: 'library', name: 'Library', swatch: '#B9C98F' },
  { key: 'sports', name: 'Sports hall', swatch: '#A7B8D9' },
  { key: 'store', name: 'Store', swatch: '#C5B5A3' },
  { key: 'staff', name: 'Staff room', swatch: '#D7A9B4' },
  { key: 'other', name: 'Other', swatch: '#C9CCC6' },
]

/** decodED's nearest room type from a room's name (twin/app/detailed/insideView.ts), first match wins. */
const BY_NAME: Array<[RoomType, RegExp]> = [
  ['kitchen', /kitchen|fridge|freezer|servery/i],
  ['toilets', /\bwc\b|toilet|shower|changing|bathroom|washroom/i],
  ['plant', /plant|boiler|equipment|meter|tank/i],
  ['office', /office|admin|secretary|manager/i],
  ['staff', /staff|bedroom|flat/i],
  ['store', /stor|stock|cloak|cellar|bin/i],
  ['corridor', /corridor|stair|entrance|lobby|hall ?way|landing|lift|reception/i],
  ['hall', /dining|dinning|lounge|bar|function|hall|trophy|room \d/i],
  ['sports', /simulat|gym|sport|pro shop|golf/i],
  ['classroom', /class|teach|meeting|board/i],
]
export const roomTypeOf = (name: string): RoomType => BY_NAME.find(([, re]) => re.test(name))?.[0] ?? 'other'
export const roomTypeColour = (name: string): string => ROOM_TYPES.find((t) => t.key === roomTypeOf(name))!.swatch
