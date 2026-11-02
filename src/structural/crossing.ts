import type { BridgeDesign } from '../core/types'
import { analyze, GRAVITY } from './analyze'
import type { FrameLoad as Load } from './frame'

/**
 * The drive path: the chain of deck members from the left anchor to the right
 * anchor, walked in order. `null` when the deck does not actually connect,
 * which is an automatic failure (a truck cannot bridge a gap on faith).
 */
export interface DeckChain {
  nodes: string[]
  /** Cumulative distance from the start of the deck at each node. */
  distances: number[]
  length: number
}

export interface CrossingOptions {
  /** How many vehicle positions to sample. 21 is plenty for a 1 m mesh. */
  samples?: number
  /** Largest allowed downward deflection at any deck node, metres. */
  deflectionLimit?: number
  /** Largest allowed local deck slope, as a gradient. */
  slopeLimit?: number
}

export interface CrossingResult {
  ok: boolean
  /** Highest member utilisation seen at any sampled position. */
  maxUtilization: number
  maxDeflection: number
  maxSlope: number
  /** First position (metres along the deck) at which something would fail. */
  firstFailure: { position: number; memberId: string; utilization: number } | null
  /** Position at which the structure became a mechanism, if it did. */
  unstableAt: number | null
  notes: string[]
  samples: number
}

function anchorEnds(design: BridgeDesign, gap: number, rightY: number): [string, string] | null {
  const anchors = design.nodes.filter((node) => node.anchor)
  if (anchors.length < 2) return null
  const left = anchors.reduce((best, node) => (node.x < best.x ? node : best), anchors[0])
  const target = anchors.reduce(
    (best, node) =>
      Math.hypot(node.x - gap, node.y - rightY) < Math.hypot(best.x - gap, best.y - rightY)
        ? node
        : best,
    anchors[0],
  )
  if (left.id === target.id) return null
  return [left.id, target.id]
}

/** Breadth-first walk along deck members, so a shortcut cannot skip a gap. */
export function deckChain(design: BridgeDesign, gap: number, rightY: number): DeckChain | null {
  const ends = anchorEnds(design, gap, rightY)
  if (!ends) return null
  const [start, goal] = ends
  const nodes = new Map(design.nodes.map((node) => [node.id, node]))
  const adjacency = new Map<string, string[]>()
  for (const member of design.members) {
    if (member.kind !== 'deck') continue
    if (!adjacency.has(member.a)) adjacency.set(member.a, [])
    if (!adjacency.has(member.b)) adjacency.set(member.b, [])
    adjacency.get(member.a)!.push(member.b)
    adjacency.get(member.b)!.push(member.a)
  }
  if (!adjacency.has(start) || !adjacency.has(goal)) return null

  const previous = new Map<string, string>()
  const queue = [start]
  const seen = new Set([start])
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === goal) break
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, current)
      queue.push(next)
    }
  }
  if (!seen.has(goal)) return null

  const path: string[] = [goal]
  let cursor = goal
  while (cursor !== start) {
    const prev = previous.get(cursor)
    if (!prev) return null
    path.unshift(prev)
    cursor = prev
  }

  const distances = [0]
  for (let i = 1; i < path.length; i++) {
    const a = nodes.get(path[i - 1])!
    const b = nodes.get(path[i])!
    distances.push(distances[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }

  return { nodes: path, distances, length: distances[distances.length - 1] }
}

/**
 * Turn a vehicle's weight into nodal loads at two axles. `weight` is already the
 * share taken by this structural plane: the deck is carried by a matched pair of
 * trusses, so the caller passes half the vehicle's weight.
 */
export function axleLoads(
  design: BridgeDesign,
  chain: DeckChain,
  position: number,
  wheelbase: number,
  weight: number,
): Load[] {
  const totals = new Map<string, number>()
  const axles = [position - wheelbase / 2, position + wheelbase / 2]
  for (const axle of axles) {
    const clamped = Math.max(0.001, Math.min(chain.length - 0.001, axle))
    let segment = chain.nodes.length - 2
    for (let i = 1; i < chain.nodes.length; i++) {
      if (clamped <= chain.distances[i]) {
        segment = i - 1
        break
      }
    }
    const a = chain.nodes[segment]
    const b = chain.nodes[segment + 1] ?? chain.nodes[segment]
    const span = (chain.distances[segment + 1] ?? chain.length) - chain.distances[segment] || 1
    const t = Math.max(0, Math.min(1, (clamped - chain.distances[segment]) / span))
    const halfWeight = weight / 2
    totals.set(a, (totals.get(a) ?? 0) + halfWeight * (1 - t))
    totals.set(b, (totals.get(b) ?? 0) + halfWeight * t)
  }

  const loads: Load[] = []
  for (const [id, fy] of totals) {
    const index = design.nodes.findIndex((node) => node.id === id)
    if (index < 0) continue
    loads.push({ node: index, fy: -fy })
  }
  return loads
}

/**
 * Quasi-static moving-load check: the vehicle is stepped across the deck and the
 * frame is re-solved at each position. This is the documented surrogate used to
 * validate the campaign (see STRUCTURAL.md) — it is not a dynamic vehicle
 * simulation, and a passing surrogate is labelled VERIFIED for the *structural*
 * check only.
 */
export function runCrossing(
  design: BridgeDesign,
  gap: number,
  rightY: number,
  vehicleMass: number,
  wheelbase: number,
  options: CrossingOptions = {},
): CrossingResult {
  const notes: string[] = []
  const chain = deckChain(design, gap, rightY)
  const samples = options.samples ?? 21
  const deflectionLimit = options.deflectionLimit ?? 0.4
  const slopeLimit = options.slopeLimit ?? 0.5

  if (!chain) {
    return {
      ok: false,
      maxUtilization: Number.POSITIVE_INFINITY,
      maxDeflection: Number.POSITIVE_INFINITY,
      maxSlope: Number.POSITIVE_INFINITY,
      firstFailure: null,
      unstableAt: null,
      notes: ['The deck does not connect one bank to the other.'],
      samples: 0,
    }
  }
  if (chain.length < 0.8) {
    return {
      ok: false,
      maxUtilization: 0,
      maxDeflection: 0,
      maxSlope: 0,
      firstFailure: null,
      unstableAt: null,
      notes: ['The deck is too short to hold a vehicle.'],
      samples: 0,
    }
  }

  const weight = vehicleMass * GRAVITY * 0.5
  let maxUtilization = 0
  let maxDeflection = 0
  let maxSlope = 0
  let firstFailure: CrossingResult['firstFailure'] = null
  let unstableAt: number | null = null

  const start = Math.min(0.5, chain.length / 2)
  const end = chain.length - Math.min(0.5, chain.length / 2)
  const positions: number[] = []
  for (let i = 0; i < samples; i++) {
    positions.push(samples === 1 ? chain.length / 2 : start + ((end - start) * i) / (samples - 1))
  }

  for (const position of positions) {
    const loads = axleLoads(design, chain, position, wheelbase, weight)
    const result = analyze(design, { extraLoads: loads })
    if (result.unstable) {
      unstableAt = position
      notes.push(`The structure becomes a mechanism with the vehicle at ${position.toFixed(1)} m.`)
      break
    }
    if (result.maxUtilization > maxUtilization) {
      maxUtilization = result.maxUtilization
      if (result.maxUtilization > 1 && !firstFailure) {
        firstFailure = {
          position,
          memberId: result.worstMember ?? '',
          utilization: result.maxUtilization,
        }
      }
    }

    // Deck shape under this load: the truck has to ride what it produced.
    let previous: { y: number } | null = null
    for (let i = 0; i < chain.nodes.length; i++) {
      const node = design.nodes.find((candidate) => candidate.id === chain.nodes[i])
      if (!node) continue
      const deflection = result.deflections.get(node.id)?.y ?? 0
      const sag = -deflection
      if (Number.isFinite(sag)) maxDeflection = Math.max(maxDeflection, sag)
      const original = node.y
      const deflected = original - sag
      if (previous) {
        const run = chain.distances[i] - chain.distances[i - 1] || 1
        const slope = Math.abs((deflected - previous.y) / run)
        maxSlope = Math.max(maxSlope, slope)
      }
      previous = { y: deflected }
    }
  }

  if (maxDeflection > deflectionLimit) {
    notes.push(
      `The deck sags ${maxDeflection.toFixed(2)} m, past the ${deflectionLimit.toFixed(2)} m the vehicle can climb.`,
    )
  }
  if (maxSlope > slopeLimit) {
    notes.push(`The deck slope reaches ${maxSlope.toFixed(2)}, too steep to drive.`)
  }
  if (firstFailure) {
    notes.push(
      `Member ${firstFailure.memberId} reaches ${Math.round(firstFailure.utilization * 100)}% of its capacity.`,
    )
  }
  if (notes.length === 0) notes.push('The bridge holds.')

  return {
    ok:
      unstableAt === null &&
      firstFailure === null &&
      maxDeflection <= deflectionLimit &&
      maxSlope <= slopeLimit,
    maxUtilization,
    maxDeflection,
    maxSlope,
    firstFailure,
    unstableAt,
    notes,
    samples: positions.length,
  }
}
