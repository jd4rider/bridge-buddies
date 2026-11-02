import type { MaterialId, MaterialSpec } from '../core/types'

/**
 * Material data. Units are SI throughout: metres, newtons, pascals, kg.
 * A member is a square-ish rolled section; `width` and `height` give the
 * cross-section used for axial area, second moment of area and section modulus.
 *
 * The strengths are deliberately game-tuned rather than laboratory values: they
 * sit where a tidy two-truss bridge is comfortable (roughly 30-60% utilisation)
 * and a bare plank across a long gap fails. STRUCTURAL.md documents this.
 */
export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  wood: {
    id: 'wood',
    name: 'Pine beam',
    short: 'Pine',
    e: 9.5e9,
    width: 0.16,
    height: 0.16,
    density: 550,
    axialStrength: 1100000,
    bendingStrength: 2200000,
    costPerMetre: 10,
    tensionOnly: false,
    color: '#c98a4b',
    accent: '#f0c392',
    blurb: 'Cheap and cheerful. Light, so it loads the bridge less than steel.',
  },
  reinforced: {
    id: 'reinforced',
    name: 'Laminated beam',
    short: 'Lam',
    e: 13e9,
    width: 0.18,
    height: 0.18,
    density: 620,
    axialStrength: 2600000,
    bendingStrength: 3400000,
    costPerMetre: 18,
    tensionOnly: false,
    color: '#d9a55f',
    accent: '#ffe0ab',
    blurb: 'Glued layers: stiffer than pine and noticeably harder to snap.',
  },
  steel: {
    id: 'steel',
    name: 'Steel beam',
    short: 'Steel',
    e: 200e9,
    width: 0.14,
    height: 0.2,
    density: 7850,
    axialStrength: 26000000,
    bendingStrength: 22000000,
    costPerMetre: 34,
    tensionOnly: false,
    color: '#8fa3b8',
    accent: '#dbe7f2',
    blurb: 'Very strong and very stiff, but its own weight is a real load.',
  },
  aluminium: {
    id: 'aluminium',
    name: 'Aluminium beam',
    short: 'Alu',
    e: 69e9,
    width: 0.18,
    height: 0.22,
    density: 2700,
    axialStrength: 17000000,
    bendingStrength: 16000000,
    costPerMetre: 26,
    tensionOnly: false,
    color: '#b8c6d1',
    accent: '#eef5fa',
    blurb: 'Almost as stiff as steel at a third of the weight. Pricier than pine.',
  },
  cable: {
    id: 'cable',
    name: 'Steel cable',
    short: 'Cable',
    e: 160e9,
    width: 0.05,
    height: 0.05,
    density: 7000,
    axialStrength: 40000000,
    bendingStrength: 0.001,
    costPerMetre: 22,
    tensionOnly: true,
    color: '#3f4a56',
    accent: '#93a4b5',
    blurb: 'Pulls, never pushes. Hang a deck from a tower and the load becomes tension.',
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete pier',
    short: 'Pier',
    e: 30e9,
    width: 0.36,
    height: 0.36,
    density: 2400,
    axialStrength: 4000000,
    bendingStrength: 600000,
    costPerMetre: 20,
    tensionOnly: false,
    color: '#cfcabd',
    accent: '#efeae0',
    blurb: 'Heavy and superb in compression. Use it as a pier, not as a long beam.',
  },
}

export const MATERIAL_LIST: MaterialSpec[] = Object.values(MATERIALS)

/** Second moment of area about the weak axis, m⁴. */
export function secondMoment(spec: MaterialSpec): number {
  return (spec.width * spec.height ** 3) / 12
}

/** Section modulus, m³. */
export function sectionModulus(spec: MaterialSpec): number {
  return (spec.width * spec.height ** 2) / 6
}

/** Cross-sectional area, m². */
export function area(spec: MaterialSpec): number {
  return spec.width * spec.height
}

/** Linear mass in kg/m. */
export function linearMass(spec: MaterialSpec): number {
  return area(spec) * spec.density
}
