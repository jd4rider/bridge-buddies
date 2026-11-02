/**
 * A small 2D frame finite-element solver.
 *
 * Each node has three degrees of freedom (u, v, rotation). Each member is an
 * Euler-Bernoulli frame element, so it carries axial force *and* bending moment.
 * That matters: a chain of axial-only truss elements has no stiffness against a
 * downward load on a straight line, which is precisely the load a truck applies
 * to a bridge deck.
 *
 * The formulation is the textbook one. Element stiffness in local coordinates:
 *
 *      [  EA/L    0        0      -EA/L    0        0     ]
 *      [  0    12EI/L³   6EI/L²     0   -12EI/L³   6EI/L²  ]
 *      [  0     6EI/L²   4EI/L      0    -6EI/L²   2EI/L   ]
 *      [ -EA/L   0        0       EA/L    0        0     ]
 *      [  0   -12EI/L³  -6EI/L²     0    12EI/L³  -6EI/L²  ]
 *      [  0     6EI/L²   2EI/L      0    -6EI/L²   4EI/L   ]
 *
 * then K_global = Tᵀ k T with T the direction cosine matrix.
 */

export interface FrameNode {
  x: number
  y: number
  fixX?: boolean
  fixY?: boolean
  fixRot?: boolean
  /** Mass lumped at the node, kg (member self-weight is added separately). */
  mass?: number
}

export interface FrameMember {
  id: string
  a: number
  b: number
  ea: number
  ei: number
  /** Tension-only members are dropped from the solve if they come out in compression. */
  tensionOnly?: boolean
}

export interface FrameLoad {
  node: number
  fx?: number
  fy?: number
  mz?: number
}

export interface FrameMemberForce {
  /** Axial force, positive in tension. */
  axial: number
  /** End moments, newton-metres. */
  m1: number
  m2: number
}

export interface FrameSolution {
  displacement: Float64Array
  forces: Map<string, FrameMemberForce>
  unstable: boolean
  /** Largest translation of any node, metres. */
  maxTranslation: number
  /** Members that the tension-only pass removed. */
  dropped: string[]
}

/** Solve a dense symmetric system with partial pivoting. Returns null if singular. */
export function solveLinear(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const scale = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let peak = 0
    for (let j = 0; j < n; j++) peak = Math.max(peak, Math.abs(a[i * n + j]))
    scale[i] = peak > 0 ? peak : 1
  }

  for (let col = 0; col < n; col++) {
    // Pivot on the largest scaled entry in this column.
    let pivotRow = col
    let best = 0
    for (let row = col; row < n; row++) {
      const value = Math.abs(a[row * n + col]) / scale[row]
      if (value > best) {
        best = value
        pivotRow = row
      }
    }
    if (best < 1e-10) return null

    if (pivotRow !== col) {
      for (let j = 0; j < n; j++) {
        const tmp = a[col * n + j]
        a[col * n + j] = a[pivotRow * n + j]
        a[pivotRow * n + j] = tmp
      }
      const tmpB = b[col]
      b[col] = b[pivotRow]
      b[pivotRow] = tmpB
      const tmpS = scale[col]
      scale[col] = scale[pivotRow]
      scale[pivotRow] = tmpS
    }

    const pivot = a[col * n + col]
    for (let row = col + 1; row < n; row++) {
      const factor = a[row * n + col] / pivot
      if (factor === 0) continue
      a[row * n + col] = 0
      for (let j = col + 1; j < n; j++) a[row * n + j] -= factor * a[col * n + j]
      b[row] -= factor * b[col]
    }
  }

  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row]
    for (let j = row + 1; j < n; j++) sum -= a[row * n + j] * x[j]
    x[row] = sum / a[row * n + row]
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i])) return null
  }
  return x
}

function frameElementStiffness(
  ea: number,
  ei: number,
  length: number,
  cos: number,
  sin: number,
): number[] {
  const l2 = length * length
  const l3 = l2 * length
  const ea_l = ea / length
  const b12 = (12 * ei) / l3
  const b6 = (6 * ei) / l2
  const b4 = (4 * ei) / length
  const b2 = (2 * ei) / length

  // Local stiffness matrix, row-major.
  const k = [
    ea_l, 0, 0, -ea_l, 0, 0,
    0, b12, b6, 0, -b12, b6,
    0, b6, b4, 0, -b6, b2,
    -ea_l, 0, 0, ea_l, 0, 0,
    0, -b12, -b6, 0, b12, -b6,
    0, b6, b2, 0, -b6, b4,
  ]

  // T (local = T · global) for both nodes.
  const t = [
    cos, sin, 0, 0, 0, 0,
    -sin, cos, 0, 0, 0, 0,
    0, 0, 1, 0, 0, 0,
    0, 0, 0, cos, sin, 0,
    0, 0, 0, -sin, cos, 0,
    0, 0, 0, 0, 0, 1,
  ]

  // kg = Tᵀ k T
  const kt = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let sum = 0
      for (let m = 0; m < 6; m++) sum += k[i * 6 + m] * t[m * 6 + j]
      kt[i * 6 + j] = sum
    }
  }
  const kg = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let sum = 0
      for (let m = 0; m < 6; m++) sum += t[m * 6 + i] * kt[m * 6 + j]
      kg[i * 6 + j] = sum
    }
  }
  return kg
}

interface ElementSolution {
  forces: FrameMemberForce
}

function memberForces(
  member: FrameMember,
  nodes: FrameNode[],
  displacement: Float64Array,
): ElementSolution & { length: number; cos: number; sin: number } {
  const na = nodes[member.a]
  const nb = nodes[member.b]
  const dx = nb.x - na.x
  const dy = nb.y - na.y
  const length = Math.hypot(dx, dy) || 1e-6
  const cos = dx / length
  const sin = dy / length

  const ua = displacement[member.a * 3]
  const va = displacement[member.a * 3 + 1]
  const ra = displacement[member.a * 3 + 2]
  const ub = displacement[member.b * 3]
  const vb = displacement[member.b * 3 + 1]
  const rb = displacement[member.b * 3 + 2]

  // Local displacements.
  const u1 = cos * ua + sin * va
  const v1 = -sin * ua + cos * va
  const u2 = cos * ub + sin * vb
  const v2 = -sin * ub + cos * vb

  const l2 = length * length
  const ea_l = member.ea / length
  const b6 = (6 * member.ei) / l2
  const b4 = (4 * member.ei) / length
  const b2 = (2 * member.ei) / length

  const f0 = ea_l * (u1 - u2)
  const f2 = b6 * v1 + b4 * ra - b6 * v2 + b2 * rb
  const f5 = b6 * v1 + b2 * ra - b6 * v2 + b4 * rb

  return {
    forces: {
      // f0 is the force the member exerts on node a along its own axis; the
      // axial force is the opposite sign, so extension reads as tension.
      axial: -f0,
      m1: f2,
      m2: f5,
    },
    length,
    cos,
    sin,
  }
}

/**
 * Solve the frame for a set of nodal loads.
 *
 * Tension-only members are handled by a short fixed-point pass: solve, drop any
 * cable found in compression, solve again. Three passes is plenty at this scale.
 */
export function solveFrame(
  nodes: FrameNode[],
  members: FrameMember[],
  loads: FrameLoad[],
): FrameSolution {
  let active = members.slice()
  const dropped: string[] = []

  for (let pass = 0; pass < 4; pass++) {
    const result = solveOnce(nodes, active, loads)
    if (result.unstable) {
      return { ...result, dropped }
    }
    const compressed = active.filter((m) => {
      if (!m.tensionOnly) return false
      const force = result.forces.get(m.id)
      return force ? force.axial < -1e-3 : false
    })
    if (compressed.length === 0) return { ...result, dropped }
    const remove = new Set(compressed.map((m) => m.id))
    for (const id of remove) dropped.push(id)
    active = active.filter((m) => !remove.has(m.id))
  }

  const result = solveOnce(nodes, active, loads)
  return { ...result, dropped }
}

function solveOnce(nodes: FrameNode[], members: FrameMember[], loads: FrameLoad[]): FrameSolution {
  const dof = nodes.length * 3
  const stiffness = new Float64Array(dof * dof)
  const rhs = new Float64Array(dof)

  const elements = members.map((member) => {
    const na = nodes[member.a]
    const nb = nodes[member.b]
    const dx = nb.x - na.x
    const dy = nb.y - na.y
    const length = Math.hypot(dx, dy)
    return { member, length, cos: length > 1e-9 ? dx / length : 1, sin: length > 1e-9 ? dy / length : 0 }
  })

  for (const element of elements) {
    if (element.length < 1e-6) continue
    const kg = frameElementStiffness(
      element.member.ea,
      element.member.ei,
      element.length,
      element.cos,
      element.sin,
    )
    const map = [
      element.member.a * 3,
      element.member.a * 3 + 1,
      element.member.a * 3 + 2,
      element.member.b * 3,
      element.member.b * 3 + 1,
      element.member.b * 3 + 2,
    ]
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        stiffness[map[i] * dof + map[j]] += kg[i * 6 + j]
      }
    }
  }

  for (const load of loads) {
    if (load.fx) rhs[load.node * 3] += load.fx
    if (load.fy) rhs[load.node * 3 + 1] += load.fy
    if (load.mz) rhs[load.node * 3 + 2] += load.mz
  }

  // Constrain fixed degrees of freedom by elimination.
  const free: number[] = []
  const isFree = new Uint8Array(dof)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node.fixX) {
      free.push(i * 3)
      isFree[i * 3] = 1
    }
    if (!node.fixY) {
      free.push(i * 3 + 1)
      isFree[i * 3 + 1] = 1
    }
    if (!node.fixRot) {
      free.push(i * 3 + 2)
      isFree[i * 3 + 2] = 1
    }
  }

  const displacement = new Float64Array(dof)
  if (free.length === 0) {
    return {
      displacement,
      forces: new Map(),
      unstable: false,
      maxTranslation: 0,
      dropped: [],
    }
  }

  const n = free.length
  const a = new Float64Array(n * n)
  const b = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    b[i] = rhs[free[i]]
    for (let j = 0; j < n; j++) a[i * n + j] = stiffness[free[i] * dof + free[j]]
  }

  const solved = solveLinear(a, b, n)
  if (!solved) {
    return {
      displacement,
      forces: new Map(),
      unstable: true,
      maxTranslation: Number.POSITIVE_INFINITY,
      dropped: [],
    }
  }
  for (let i = 0; i < n; i++) displacement[free[i]] = solved[i]

  let maxTranslation = 0
  for (let i = 0; i < nodes.length; i++) {
    maxTranslation = Math.max(
      maxTranslation,
      Math.hypot(displacement[i * 3], displacement[i * 3 + 1]),
    )
  }
  if (!Number.isFinite(maxTranslation)) {
    return {
      displacement,
      forces: new Map(),
      unstable: true,
      maxTranslation: Number.POSITIVE_INFINITY,
      dropped: [],
    }
  }

  const forces = new Map<string, FrameMemberForce>()
  for (const element of elements) {
    if (element.length < 1e-6) continue
    const solvedMember = memberForces(element.member, nodes, displacement)
    forces.set(element.member.id, solvedMember.forces)
  }

  return { displacement, forces, unstable: false, maxTranslation, dropped: [] }
}
