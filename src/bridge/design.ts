import type { BridgeDesign, DesignMember, DesignNode, LevelSpec, MaterialId, MemberKind } from '../core/types'
import { MATERIALS } from '../structural/materials'
import { deckChain } from '../structural/crossing'

/** Longest single member the builders can supply, in metres. */
export const MAX_MEMBER_LENGTH = 2.5
export const MIN_MEMBER_LENGTH = 0.18

export function cloneDesign(design: BridgeDesign): BridgeDesign {
  return {
    nodes: design.nodes.map((node) => ({ ...node })),
    members: design.members.map((member) => ({ ...member })),
  }
}

export function nodeById(design: BridgeDesign, id: string): DesignNode | undefined {
  return design.nodes.find((node) => node.id === id)
}

export function memberLength(design: BridgeDesign, member: DesignMember): number {
  const a = nodeById(design, member.a)
  const b = nodeById(design, member.b)
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function designCost(design: BridgeDesign): number {
  let total = 0
  for (const member of design.members) {
    total += memberLength(design, member) * MATERIALS[member.material].costPerMetre
  }
  return total
}

/** Members joining the same two points, ignoring order. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function hasMember(design: BridgeDesign, a: string, b: string): boolean {
  const key = pairKey(a, b)
  return design.members.some((member) => pairKey(member.a, member.b) === key)
}

let counter = 0

export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${counter.toString(36)}`
}

/** A stable id for a grid point, so the same spot always maps to one node. */
export function gridNodeId(x: number, y: number, grid: number): string {
  const gx = Math.round(x / grid)
  const gy = Math.round(y / grid)
  return `g${gx}_${gy}`
}

export interface AddMemberResult {
  design: BridgeDesign
  error: string | null
}

/**
 * Place a member between two points, creating grid nodes as needed. Refuses
 * duplicates, over-long members, points outside the build zone and members the
 * level's material list does not allow.
 */
export function addMember(
  source: BridgeDesign,
  level: Pick<LevelSpec, 'zone' | 'grid' | 'materials'>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  material: MaterialId,
  kind: MemberKind,
): AddMemberResult {
  const design = cloneDesign(source)
  const grid = level.grid
  const snap = (value: number) => Math.round(value / grid) * grid

  if (!level.materials.includes(material)) {
    return { design: source, error: `${MATERIALS[material].name} is not available on this level.` }
  }

  const a = snapPoint(design, from, level, gridNodeId(snap(from.x), snap(from.y), grid))
  const b = snapPoint(design, to, level, gridNodeId(snap(to.x), snap(to.y), grid))
  if (!a || !b) return { design: source, error: 'That point is outside the build area.' }
  if (a.id === b.id) return { design: source, error: 'Pick a second point.' }

  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < MIN_MEMBER_LENGTH) return { design: source, error: 'Those points are too close.' }
  if (length > MAX_MEMBER_LENGTH + 1e-6) {
    return { design: source, error: `One member can span at most ${MAX_MEMBER_LENGTH} m.` }
  }
  if (hasMember(design, a.id, b.id)) {
    return { design: source, error: 'There is already a member here.' }
  }

  design.members.push({ id: newId('m'), a: a.id, b: b.id, material, kind })
  return { design, error: null }
}

function snapPoint(
  design: BridgeDesign,
  point: { x: number; y: number },
  level: Pick<LevelSpec, 'zone' | 'grid'>,
  id: string,
): DesignNode | null {
  // Reuse an existing node when the snapped point lands on one.
  const existing = design.nodes.find((node) => node.id === id)
  if (existing) return existing

  // Anchors sit at exact level positions, which may be off-grid.
  const nearestAnchor = design.nodes.find(
    (node) =>
      node.anchor &&
      Math.hypot(node.x - point.x, node.y - point.y) <= level.grid * 0.45,
  )
  if (nearestAnchor) return nearestAnchor

  const x = Math.round(point.x / level.grid) * level.grid
  const y = Math.round(point.y / level.grid) * level.grid
  const epsilon = 0.001
  if (
    x < level.zone.xMin - epsilon ||
    x > level.zone.xMax + epsilon ||
    y < level.zone.yMin - epsilon ||
    y > level.zone.yMax + epsilon
  ) {
    return null
  }
  const node: DesignNode = { id, x, y, anchor: false }
  design.nodes.push(node)
  return node
}

export function removeMember(design: BridgeDesign, memberId: string): BridgeDesign {
  const next = cloneDesign(design)
  next.members = next.members.filter((member) => member.id !== memberId)
  pruneNodes(next)
  return next
}

/** Drop player nodes that no longer carry a member; anchors always stay. */
export function pruneNodes(design: BridgeDesign): void {
  const used = new Set<string>()
  for (const member of design.members) {
    used.add(member.a)
    used.add(member.b)
  }
  design.nodes = design.nodes.filter((node) => node.anchor || used.has(node.id))
}

export function emptyDesign(anchors: { x: number; y: number }[], _grid: number): BridgeDesign {
  return {
    nodes: anchors.map((anchor, i) => ({
      id: `A${i}`,
      x: anchor.x,
      y: anchor.y,
      anchor: true,
    })),
    members: [],
  }
}

export interface DesignProblem {
  kind: 'over-budget' | 'no-deck' | 'too-long' | 'detached'
  message: string
}

export function validateDesign(design: BridgeDesign, level: LevelSpec): DesignProblem[] {
  const problems: DesignProblem[] = []
  const cost = designCost(design)
  if (cost > level.budget + 0.01) {
    problems.push({
      kind: 'over-budget',
      message: `That costs ${Math.round(cost)}, over the ${level.budget} budget.`,
    })
  }
  if (design.members.length === 0) {
    problems.push({ kind: 'no-deck', message: 'Nothing built yet.' })
    return problems
  }
  const chain = deckChain(design, level.gap, level.rightDeckY)
  if (!chain) {
    problems.push({ kind: 'no-deck', message: 'The road deck does not reach the far bank.' })
  }
  return problems
}

/** Which member sits under a world-space point, for tap-to-erase. */
export function memberAtPoint(
  design: BridgeDesign,
  point: { x: number; y: number },
  tolerance: number,
): DesignMember | null {
  let best: DesignMember | null = null
  let bestDistance = tolerance
  for (const member of design.members) {
    const a = nodeById(design, member.a)
    const b = nodeById(design, member.b)
    if (!a || !b) continue
    const distance = distanceToSegment(point, a, b)
    if (distance < bestDistance) {
      bestDistance = distance
      best = member
    }
  }
  return best
}

function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-9) return Math.hypot(point.x - a.x, point.y - a.y)
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return Math.hypot(point.x - x, point.y - y)
}
