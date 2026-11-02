/**
 * Shared data model. Nothing in this file (or anywhere under src/structural,
 * src/bridge or src/levels) may import Babylon: the puzzle and its physics are
 * plain numbers so the same code runs in the renderer, in the level validator
 * and in the tests.
 */

export interface Vec2 {
  x: number
  y: number
}

export type MaterialId = 'wood' | 'reinforced' | 'steel' | 'aluminium' | 'cable' | 'concrete'

/** What a member is for, which decides how it is rendered and loaded. */
export type MemberKind = 'beam' | 'deck' | 'cable'

export type Tool = 'beam' | 'cable' | 'deck' | 'erase' | 'inspect'

export interface MaterialSpec {
  id: MaterialId
  name: string
  /** Short label used on the toolbar. */
  short: string
  /** Young's modulus in pascals. */
  e: number
  /** Beam depth is derived from the section, kept square for beams. */
  width: number
  height: number
  /** Mass density in kg/m³, used for the member's own weight. */
  density: number
  /** Ultimate axial stress in pascals (compression uses buckling as well). */
  axialStrength: number
  /** Ultimate bending stress in pascals. */
  bendingStrength: number
  /** Cost per metre of member. */
  costPerMetre: number
  /** Tension-only members (ropes and cables). */
  tensionOnly: boolean
  /** Rendered colour, hex string. */
  color: string
  /** Emissive-ish accent for the miniature look. */
  accent: string
  blurb: string
}

export interface DesignNode {
  id: string
  x: number
  y: number
  /** Anchors are supplied by the level: immovable, fully fixed, and free. */
  anchor: boolean
}

export interface DesignMember {
  id: string
  a: string
  b: string
  material: MaterialId
  kind: MemberKind
}

/** The whole player-editable bridge. Serializable, no rendering data. */
export interface BridgeDesign {
  nodes: DesignNode[]
  members: DesignMember[]
}

export type VehicleId =
  | 'pickup'
  | 'hatchback'
  | 'bus'
  | 'tractor'
  | 'icecream'
  | 'firetruck'
  | 'dump'
  | 'cargo'
  | 'train'
  | 'transporter'

export interface VehicleSpec {
  id: VehicleId
  name: string
  /** Kerb mass in kg. */
  mass: number
  /** Wheelbase in world units (1 unit = 1 m). */
  wheelbase: number
  /** Body length in world units. */
  length: number
  /** Cruising speed in m/s across a healthy bridge. */
  speed: number
  color: string
  accent: string
  /** Load carried on top, in kg. */
  cargo: number
  blurb: string
}

export type ObjectiveKind = 'cross' | 'budget' | 'heavy' | 'convoy' | 'repair' | 'wind'

export interface LevelSpec {
  id: string
  /** 1-based world number, 1..20. */
  world: number
  /** 1-based level number inside its world, 1..50. */
  local: number
  /** 1-based number in the whole campaign, 1..1000. */
  index: number
  seed: string
  name: string
  difficulty: number
  /** Horizontal gap between the inner faces of the two banks. */
  gap: number
  /** Height of the left and right road approaches (world y). */
  leftDeckY: number
  rightDeckY: number
  /** Fixed anchor nodes available for building. */
  anchors: Vec2[]
  /** Rectangular region the player may build in. */
  zone: { xMin: number; xMax: number; yMin: number; yMax: number }
  /** Snap spacing for build points, in world units. */
  grid: number
  budget: number
  twoStarBudget: number
  threeStarBudget: number
  vehicle: VehicleId
  /** Vehicles that must cross in order, for convoy levels. */
  convoy: VehicleId[]
  materials: MaterialId[]
  objective: ObjectiveKind
  /** Lateral wind in m/s, positive blows toward -x. */
  wind: number
  /** The generator's proven bridge for this level. */
  reference: BridgeDesign
  /** Validation record, filled by the campaign check. */
  validation: ValidationRecord
}

export type ValidationStatus = 'VERIFIED' | 'REJECTED' | 'UNKNOWN'

export interface ValidationRecord {
  status: ValidationStatus
  /** Worst member utilisation seen while the reference vehicle crossed. */
  maxUtilization: number
  /** Largest deck deflection in metres. */
  maxDeflection: number
  /** Cost of the reference bridge. */
  referenceCost: number
  /** Number of load positions sampled during the sweep. */
  sweep: number
  notes: string[]
}

export interface AnalyzeMemberResult {
  id: string
  /** Axial force in newtons, positive in tension. */
  axial: number
  /** Largest absolute end moment in newton-metres. */
  moment: number
  /** Peak axial stress plus peak bending stress, as a fraction of capacity. */
  utilization: number
  /** Which limit the member reached first. */
  mode: 'tension' | 'compression' | 'bending' | 'buckling' | 'none'
}

export interface AnalyzeResult {
  ok: boolean
  /** True when the stiffness matrix has no stable solution. */
  unstable: boolean
  members: Map<string, AnalyzeMemberResult>
  /** Vertical displacement per node id, in metres (negative is downward). */
  deflections: Map<string, Vec2>
  maxUtilization: number
  maxDeflection: number
  /** Id of the member closest to failing. */
  worstMember: string | null
}
