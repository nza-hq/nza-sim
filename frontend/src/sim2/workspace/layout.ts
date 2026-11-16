/** The workspace's pane widths and centre tab, remembered per browser the way Building remembers its own
 * (BuildingDefinition.jsx loadLayoutPrefs): clamped on read, one localStorage key. */
export const MODEL_LAYOUT_KEY = 'nza-model-layout'
export const LEFT = { def: 300, min: 220, max: 440 }
export const RIGHT = { def: 380, min: 320, max: 520 }
export const MODEL_CENTRE_TABS = [
  { id: 'drawing', label: 'Drawing' },
  { id: 'heat-flow', label: 'Heat flow' },
] as const
export type CentreTab = (typeof MODEL_CENTRE_TABS)[number]['id']
export type Layout = { left: number; right: number; centre: CentreTab }

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function loadLayout(): Layout {
  try {
    const s = JSON.parse(localStorage.getItem(MODEL_LAYOUT_KEY) ?? 'null')
    if (s && typeof s === 'object') {
      return {
        left: clamp(Number(s.left) || LEFT.def, LEFT.min, LEFT.max),
        right: clamp(Number(s.right) || RIGHT.def, RIGHT.min, RIGHT.max),
        centre: MODEL_CENTRE_TABS.some((t) => t.id === s.centre) ? s.centre : 'drawing',
      }
    }
  } catch { /* private window or blocked storage: defaults */ }
  return { left: LEFT.def, right: RIGHT.def, centre: 'drawing' }
}
export function saveLayout(l: Layout) {
  try { localStorage.setItem(MODEL_LAYOUT_KEY, JSON.stringify(l)) } catch { /* not remembered, still works */ }
}
