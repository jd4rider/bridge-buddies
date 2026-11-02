import type {
  AnalyzeMemberResult,
  AnalyzeResult,
  BridgeDesign,
  MaterialSpec,
  Vec2,
} from '../core/types'
import { MATERIALS, area, linearMass, secondMoment, sectionModulus } from './materials'
import { solveFrame, type FrameLoad, type FrameMember, type FrameNode } from './frame'

export const GRAVITY = 9.81

export interface AnalyzeOptions {
  /** Extra nodal loads such as the vehicle, in newtons. */
  extraLoads?: FrameLoad[]
  /** Include the members' own weight. On by default. */
  includeSelfWeight?: boolean
  /** Horizontal wind load per deck node, newtons (positive pushes toward -x). */
  windForce?: number
}

function specOf(id: BridgeDesign['members'][number]['material']): MaterialSpec {
  return MATERIALS[id]
}

/**
 * Build and solve the frame for a design. This is the single source of truth
 * for load, stress and deflection: the validator, the in-game test and the
 * collapse code all call it.
 */
export function analyze(design: BridgeDesign, options: AnalyzeOptions = {}): AnalyzeResult {
  const nodes: FrameNode[] = design.nodes.map((node) => ({
    x: node.x,
    y: node.y,
    fixX: node.anchor,
    fixY: node.anchor,
    fixRot: node.anchor,
  }))
  const indexById = new Map<string, number>()
  design.nodes.forEach((node, i) => indexById.set(node.id, i))

  const members: FrameMember[] = []
  const lengths = new Map<string, number>()
  for (const member of design.members) {
    const a = indexById.get(member.a)
    const b = indexById.get(member.b)
    if (a === undefined || b === undefined || a === b) continue
    const spec = specOf(member.material)
    const ia = secondMoment(spec)
    const length = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y)
    if (length < 1e-4) continue
    members.push({
      id: member.id,
      a,
      b,
      ea: spec.e * area(spec),
      // A cable has almost no bending stiffness. Keeping a small, finite value
      // rather than zero avoids a singular rotation degree of freedom.
      ei: spec.tensionOnly ? spec.e * area(spec) * 1e-6 : spec.e * ia,
      tensionOnly: spec.tensionOnly,
    })
    lengths.set(member.id, length)
  }

  const loads: FrameLoad[] = []
  if (options.includeSelfWeight !== false) {
    const reactions = new Map<number, number>()
    for (const member of design.members) {
      const a = indexById.get(member.a)
      const b = indexById.get(member.b)
      if (a === undefined || b === undefined) continue
      const spec = specOf(member.material)
      const weight = linearMass(spec) * (lengths.get(member.id) ?? 0) * GRAVITY
      reactions.set(a, (reactions.get(a) ?? 0) - weight / 2)
      reactions.set(b, (reactions.get(b) ?? 0) - weight / 2)
    }
    for (const [node, fy] of reactions) loads.push({ node, fy })
  }
  if (options.extraLoads) loads.push(...options.extraLoads)
  if (options.windForce) {
    for (const member of design.members) {
      const a = indexById.get(member.a)
      if (a === undefined) continue
      loads.push({ node: a, fx: options.windForce })
    }
  }

  const solution = solveFrame(nodes, members, loads)

  const memberResults = new Map<string, AnalyzeMemberResult>()
  let maxUtilization = 0
  let worstMember: string | null = null

  for (const member of design.members) {
    const frameMember = members.find((candidate) => candidate.id === member.id)
    const spec = specOf(member.material)
    const length = lengths.get(member.id) ?? 0
    if (!frameMember) {
      memberResults.set(member.id, {
        id: member.id,
        axial: 0,
        moment: 0,
        utilization: 0,
        mode: 'none',
      })
      continue
    }

    const force = solution.forces.get(member.id)
    const axial = force?.axial ?? 0
    const moment = Math.max(Math.abs(force?.m1 ?? 0), Math.abs(force?.m2 ?? 0))

    let utilization = 0
    let mode: AnalyzeMemberResult['mode'] = 'none'

    if (spec.tensionOnly) {
      // Cables are only ever in tension (compression-loaded ones were dropped
      // by the solver), and carry no moment.
      utilization = Math.max(0, axial) / (spec.axialStrength * area(spec))
      mode = 'tension'
    } else {
      const axialArea = area(spec)
      const axialCapacityTension = spec.axialStrength * axialArea
      const euler = (Math.PI ** 2 * spec.e * secondMoment(spec)) / (length * length)
      const compressionCap = Math.min(spec.axialStrength, euler / axialArea) * axialArea
      const axialUtil =
        axial >= 0 ? axial / axialCapacityTension : -axial / Math.max(1, compressionCap)
      const bendUtil = moment / (spec.bendingStrength * sectionModulus(spec))
      utilization = axialUtil + bendUtil
      if (bendUtil > axialUtil) mode = 'bending'
      else if (axial >= 0) mode = 'tension'
      else mode = euler / axialArea < spec.axialStrength ? 'buckling' : 'compression'
    }

    if (!Number.isFinite(utilization)) utilization = 99
    memberResults.set(member.id, { id: member.id, axial, moment, utilization, mode })
    if (utilization > maxUtilization) {
      maxUtilization = utilization
      worstMember = member.id
    }
  }

  const deflections = new Map<string, Vec2>()
  let maxDeflection = 0
  design.nodes.forEach((node, i) => {
    const ux = solution.displacement[i * 3] || 0
    const uy = solution.displacement[i * 3 + 1] || 0
    deflections.set(node.id, { x: ux, y: uy })
    if (Number.isFinite(uy)) maxDeflection = Math.max(maxDeflection, -uy)
  })

  if (solution.unstable) {
    return {
      ok: false,
      unstable: true,
      members: memberResults,
      deflections,
      maxUtilization: 99,
      maxDeflection: Number.POSITIVE_INFINITY,
      worstMember,
    }
  }

  return {
    ok: maxUtilization <= 1,
    unstable: false,
    members: memberResults,
    deflections,
    maxUtilization,
    maxDeflection,
    worstMember,
  }
}
