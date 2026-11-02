import type {
  BridgeDesign,
  LevelSpec,
  MaterialId,
  ValidationRecord,
  Vec2,
  VehicleId,
} from '../core/types'
import { emptyDesign, designCost } from '../bridge/design'
import { WORLDS, worldById, type WorldSpec } from './worlds'
import { VEHICLES } from '../vehicles/catalog'

function VEHICLE_MASS(id: VehicleId): number {
  const spec = VEHICLES[id]
  return spec.mass + spec.cargo
}

/** Deterministic RNG so a seed always builds the same crossing. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const NAMES = [
  'Willow',
  'Millbrook',
  'Alder',
  'Fern',
  'Pebble',
  'Bramble',
  'Copper',
  'Lark',
  'Mossy',
  'Hazel',
  'Rookery',
  'Tansy',
  'Clover',
  'Thistle',
  'Heron',
  'Foxglove',
  'Maple',
  'Sorrel',
  'Quarry',
  'Cobble',
]

const SUFFIX = ['Crossing', 'Span', 'Bridge', 'Ford', 'Reach', 'Passage', 'Trail', 'Way']

const UNKNOWN: ValidationRecord = {
  status: 'UNKNOWN',
  maxUtilization: 0,
  maxDeflection: 0,
  referenceCost: 0,
  sweep: 0,
  notes: [],
}

const DECK_SPACING = 1

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step
}

/**
 * The generator's own solution for a level: a straight deck carried by a Warren
 * truss underneath, with a concrete pier when the river offers a rock to stand
 * on. This is what gets validated, and it is what the level's budget is derived
 * from, so a level can never ship with a budget that cannot buy a working
 * bridge.
 */
export function buildReference(
  gap: number,
  rightY: number,
  anchors: Vec2[],
  materials: MaterialId[],
  structureMaterial: MaterialId,
  depthOverride?: number,
): BridgeDesign {
  const design = emptyDesign(anchors, 0.5)
  const left = design.nodes[0]
  const right = design.nodes[1]

  const segments = Math.max(3, Math.round(gap / DECK_SPACING))
  const deckNodes: string[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    if (i === 0) {
      deckNodes.push(left.id)
      continue
    }
    if (i === segments) {
      deckNodes.push(right.id)
      continue
    }
    const id = `d${i}`
    design.nodes.push({
      id,
      x: quantize(t * gap, 0.25),
      y: quantize(rightY * t, 0.25),
      anchor: false,
    })
    deckNodes.push(id)
  }

  for (let i = 0; i < segments; i++) {
    design.members.push({
      id: `dk${i}`,
      a: deckNodes[i],
      b: deckNodes[i + 1],
      material: structureMaterial,
      kind: 'deck',
    })
  }

  const depth = depthOverride ?? Math.min(2.8, 1.1 + gap * 0.06)
  const bottomNodes: string[] = []
  for (let i = 0; i < segments; i++) {
    const a = design.nodes.find((node) => node.id === deckNodes[i])!
    const b = design.nodes.find((node) => node.id === deckNodes[i + 1])!
    const id = `b${i}`
    design.nodes.push({
      id,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2 - depth,
      anchor: false,
    })
    bottomNodes.push(id)
  }

  for (let i = 0; i < segments; i++) {
    design.members.push({ id: `up${i}`, a: deckNodes[i], b: bottomNodes[i], material: structureMaterial, kind: 'beam' })
    design.members.push({ id: `dn${i}`, a: deckNodes[i + 1], b: bottomNodes[i], material: structureMaterial, kind: 'beam' })
    if (i > 0) {
      design.members.push({ id: `bt${i}`, a: bottomNodes[i - 1], b: bottomNodes[i], material: structureMaterial, kind: 'beam' })
    }
  }

  // The mid-river rock is left as an *optional* footing for the player. The
  // reference deliberately does not lean on it: a short strut into a rigid
  // anchor behaves as a cantilever and soaks up the truss's bending moment,
  // which made the pier — not the bridge — decide the level. A clear span keeps
  // the validation honest and makes a mid-river pier a clever player choice.
  void materials

  return design
}

const STRUCTURE_ORDER: MaterialId[] = ['wood', 'reinforced', 'aluminium', 'steel']

/**
 * Size the reference to its actual job. A 16 t loco over 12 m needs steel; a
 * hatchback over 5 m does not, and buying steel for it would inflate the budget
 * and make the level's stars meaningless.
 */
function pickMaterial(world: WorldSpec, gap: number, loadKg: number): MaterialId {
  const usable = STRUCTURE_ORDER.filter((material) => world.materials.includes(material))
  if (usable.length === 0) return 'wood'
  const demand = loadKg * gap
  const target: MaterialId = demand > 60000 ? 'steel' : demand > 24000 ? 'reinforced' : 'wood'
  if (usable.includes(target)) return target
  return usable[usable.length - 1]
}

function objectiveFor(world: WorldSpec, local: number, vehicle: VehicleId): LevelSpec['objective'] {
  if (world.wind >= 5) return 'wind'
  if (local % 17 === 0) return 'convoy'
  if (local % 13 === 0) return 'repair'
  if (['dump', 'cargo', 'train', 'transporter', 'firetruck'].includes(vehicle)) return 'heavy'
  if (local % 7 === 0) return 'budget'
  return 'cross'
}

export function generateLevel(index: number): LevelSpec {
  const clamped = Math.max(1, Math.min(1000, Math.round(index)))
  const worldNumber = Math.floor((clamped - 1) / 50) + 1
  const local = ((clamped - 1) % 50) + 1
  const world = worldById(worldNumber)

  const seed = `bb-v1-${clamped}-w${world.id}`
  const random = mulberry32(hashString(seed))
  const progress = (local - 1) / 49

  const rawGap = world.gap[0] + (world.gap[1] - world.gap[0]) * progress + (random() - 0.5) * 0.4
  const gap = quantize(Math.max(3.5, rawGap), 0.5)
  const rightY = quantize((random() - 0.5) * 1.6, 0.25)

  const anchors: Vec2[] = [
    { x: 0, y: 0 },
    { x: gap, y: rightY },
  ]
  // A boulder in the river, on the longer spans, gives the player a footing.
  if (gap >= 9) {
    anchors.push({ x: quantize(gap / 2, 0.5), y: -2.75 })
  }

  const vehicle = world.vehicles[Math.floor(random() * world.vehicles.length) % world.vehicles.length]
  const loadKg = VEHICLE_MASS(vehicle)
  const convoy: VehicleId[] = []
  const objective = objectiveFor(world, local, vehicle)
  if (objective === 'convoy') {
    const second = world.vehicles[(world.vehicles.indexOf(vehicle) + 1) % world.vehicles.length]
    convoy.push(vehicle, second)
  }

  const structureMaterial = pickMaterial(world, gap, loadKg)
  // Deeper trusses carry heavy loads without spending more on chord material.
  const depth = Math.min(2.8, 0.85 + gap * 0.07 + loadKg / 12000)
  const reference = buildReference(gap, rightY, anchors, world.materials, structureMaterial, depth)
  const referenceCost = designCost(reference)

  const budget = Math.ceil((referenceCost * 1.4) / 10) * 10
  const twoStarBudget = Math.ceil((referenceCost * 1.12) / 10) * 10
  const threeStarBudget = Math.ceil((referenceCost * 1.02) / 10) * 10

  const zone = {
    xMin: -2,
    xMax: gap + 2,
    yMin: Math.min(0, rightY) - 3.6,
    yMax: Math.max(0, rightY) + 2.6,
  }

  const wind = world.wind === 0 ? 0 : Math.round(world.wind * (0.7 + random() * 0.6) * 10) / 10

  return {
    id: `bb-${String(clamped).padStart(4, '0')}`,
    world: world.id,
    local,
    index: clamped,
    seed,
    name: `${NAMES[Math.floor(random() * NAMES.length)]} ${SUFFIX[Math.floor(random() * SUFFIX.length)]}`,
    difficulty: Math.round((1 + (clamped - 1) / 999 * 9) * 10) / 10,
    gap,
    leftDeckY: 0,
    rightDeckY: rightY,
    anchors,
    zone,
    grid: 0.5,
    budget,
    twoStarBudget,
    threeStarBudget,
    vehicle,
    convoy,
    materials: world.materials,
    objective,
    wind,
    reference,
    validation: { ...UNKNOWN },
  }
}

export function generateCampaign(): LevelSpec[] {
  const levels: LevelSpec[] = []
  for (let index = 1; index <= 1000; index++) levels.push(generateLevel(index))
  return levels
}

/** The shared daily crossing, seeded from the UTC date. */
export function levelForDate(date: Date): LevelSpec {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000)
  const index = (hashString(`bb-daily-${day}`) % 1000) + 1
  return generateLevel(index)
}

export function worldOf(level: LevelSpec): WorldSpec {
  return worldById(level.world)
}

export const TOTAL_LEVELS = WORLDS.length * 50
