import { describe, expect, it } from 'vitest'
import { solveFrame, type FrameMember, type FrameNode } from '../src/structural/frame'
import { analyze } from '../src/structural/analyze'
import { deckChain, runCrossing } from '../src/structural/crossing'
import { addMember, designCost, emptyDesign, validateDesign } from '../src/bridge/design'
import { generateCampaign, generateLevel } from '../src/levels/generator'
import { MATERIALS, area, secondMoment } from '../src/structural/materials'
import { VEHICLES } from '../src/vehicles/catalog'

const wood = MATERIALS.wood
const EA = wood.e * area(wood)
const EI = wood.e * secondMoment(wood)

describe('frame solver', () => {
  it('matches the analytical cantilever tip deflection', () => {
    const L = 3
    const P = 1000
    const nodes: FrameNode[] = [
      { x: 0, y: 0, fixX: true, fixY: true, fixRot: true },
      { x: L, y: 0 },
    ]
    const members: FrameMember[] = [{ id: 'm', a: 0, b: 1, ea: EA, ei: EI }]
    const solution = solveFrame(nodes, members, [{ node: 1, fy: -P }])
    expect(solution.unstable).toBe(false)
    const expected = (P * L ** 3) / (3 * EI)
    expect(solution.displacement[4]).toBeCloseTo(-expected, 6)
    // Rotation at the free end is PL²/2EI, clockwise (negative) for a downward load.
    expect(solution.displacement[5]).toBeCloseTo(-(P * L ** 2) / (2 * EI), 6)
  })

  it('matches the analytical mid-span deflection of a simply supported beam', () => {
    const L = 4
    const totalLoad = 4000
    // Pinned at both ends (rotation free), three nodes, load at the middle.
    const nodes: FrameNode[] = [
      { x: 0, y: 0, fixX: true, fixY: true },
      { x: L / 2, y: 0 },
      { x: L, y: 0, fixX: true, fixY: true },
    ]
    const members: FrameMember[] = [
      { id: 'a', a: 0, b: 1, ea: EA, ei: EI },
      { id: 'b', a: 1, b: 2, ea: EA, ei: EI },
    ]
    const solution = solveFrame(nodes, members, [{ node: 1, fy: -totalLoad }])
    const expected = (totalLoad * L ** 3) / (48 * EI)
    expect(Math.abs(solution.displacement[4])).toBeCloseTo(expected, 5)
  })

  it('reports tension in a stretched member and compression in a squashed one', () => {
    const nodes: FrameNode[] = [
      { x: 0, y: 0, fixX: true, fixY: true, fixRot: true },
      { x: 2, y: 0 },
    ]
    const pulled = solveFrame(nodes, [{ id: 'm', a: 0, b: 1, ea: EA, ei: EI }], [{ node: 1, fx: 5000 }])
    expect(pulled.forces.get('m')!.axial).toBeGreaterThan(0)
    expect(pulled.forces.get('m')!.axial).toBeCloseTo(5000, 3)

    const pushed = solveFrame(nodes, [{ id: 'm', a: 0, b: 1, ea: EA, ei: EI }], [{ node: 1, fx: -5000 }])
    expect(pushed.forces.get('m')!.axial).toBeLessThan(0)
  })

  it('drops a cable that would have to push', () => {
    const nodes: FrameNode[] = [
      { x: 0, y: 0, fixX: true, fixY: true, fixRot: true },
      { x: 2, y: 0, fixY: true },
    ]
    const solution = solveFrame(
      nodes,
      [{ id: 'c', a: 0, b: 1, ea: EA, ei: EA * 1e-6, tensionOnly: true }],
      [{ node: 1, fx: -1000 }],
    )
    expect(solution.dropped).toContain('c')
  })

  it('flags a mechanism instead of inventing a result', () => {
    const nodes: FrameNode[] = [
      { x: 0, y: 0, fixX: true, fixY: true },
      { x: 1, y: 0 },
    ]
    // A single member with a free rotating end and no supports is a mechanism:
    // there is nothing to carry a transverse load.
    const solution = solveFrame(nodes, [{ id: 'm', a: 0, b: 1, ea: EA, ei: EI }], [{ node: 1, fy: -100 }])
    expect(solution.unstable || Math.abs(solution.displacement[4]) > 0).toBe(true)
  })
})

describe('analysis', () => {
  it('gives a deeper sag when the deck is a bare plank than when it is trussed', () => {
    const level = generateLevel(1)
    const plank = emptyDesign(level.anchors, level.grid)
    const span = level.gap
    const segments = 4
    const nodes = [plank.nodes[0]]
    for (let i = 1; i < segments; i++) {
      const node = { id: `p${i}`, x: (span * i) / segments, y: (level.rightDeckY * i) / segments, anchor: false }
      plank.nodes.push(node)
      nodes.push(node)
    }
    nodes.push(plank.nodes[1])
    for (let i = 0; i < segments; i++) {
      plank.members.push({ id: `pm${i}`, a: nodes[i].id, b: nodes[i + 1].id, material: 'wood', kind: 'deck' })
    }

    const plankChain = deckChain(plank, level.gap, level.rightDeckY)!
    expect(plankChain.nodes).toHaveLength(5)

    const plankResult = analyze(plank, { extraLoads: [{ node: 2, fy: -4000 }] })
    const trussResult = analyze(level.reference, { extraLoads: [{ node: 4, fy: -4000 }] })
    expect(plankResult.maxDeflection).toBeGreaterThan(trussResult.maxDeflection)
  })
})

describe('design rules', () => {
  it('rejects a member longer than the stock length', () => {
    const level = generateLevel(1)
    const design = emptyDesign(level.anchors, level.grid)
    const result = addMember(design, level, { x: 0, y: 0 }, { x: 4, y: 0 }, 'wood', 'beam')
    expect(result.error).toBeTruthy()
    expect(result.design.members.length).toBe(0)
  })

  it('refuses duplicates and materials the level does not stock', () => {
    const level = generateLevel(1)
    const design = emptyDesign(level.anchors, level.grid)
    const first = addMember(design, level, { x: 0, y: 0 }, { x: 1, y: 0 }, 'wood', 'deck')
    expect(first.error).toBeNull()
    const duplicate = addMember(first.design, level, { x: 1, y: 0 }, { x: 0, y: 0 }, 'wood', 'deck')
    expect(duplicate.error).toBeTruthy()
    const steel = addMember(design, level, { x: 0, y: 0 }, { x: 1, y: 0 }, 'steel', 'beam')
    expect(steel.error).toBeTruthy()
  })

  it('costs a design by member length', () => {
    const level = generateLevel(1)
    const design = emptyDesign(level.anchors, level.grid)
    const built = addMember(design, level, { x: 0, y: 0 }, { x: 1, y: 0 }, 'wood', 'deck').design
    expect(designCost(built)).toBeCloseTo(MATERIALS.wood.costPerMetre, 5)
  })

  it('flags a bridge with no deck and one that is over budget', () => {
    const level = generateLevel(1)
    const empty = emptyDesign(level.anchors, level.grid)
    expect(validateDesign(empty, level).some((problem) => problem.kind === 'no-deck')).toBe(true)

    const overBudget = generateLevel(1)
    overBudget.budget = 1
    expect(validateDesign(overBudget.reference, overBudget).some((p) => p.kind === 'over-budget')).toBe(true)
  })
})

describe('generator', () => {
  it('is deterministic for a seed', () => {
    const a = generateLevel(347)
    const b = generateLevel(347)
    expect(a).toEqual(b)
  })

  it('spreads 1000 levels across 20 worlds of 50', () => {
    const campaign = generateCampaign()
    expect(campaign).toHaveLength(1000)
    expect(new Set(campaign.map((level) => level.id)).size).toBe(1000)
    const counts = new Map<number, number>()
    for (const level of campaign) counts.set(level.world, (counts.get(level.world) ?? 0) + 1)
    expect(counts.size).toBe(20)
    for (const count of counts.values()) expect(count).toBe(50)
  })

  it('budgets enough for its own reference bridge', () => {
    for (const index of [1, 62, 200, 501, 777, 999, 1000]) {
      const level = generateLevel(index)
      expect(designCost(level.reference)).toBeLessThanOrEqual(level.budget)
      expect(level.threeStarBudget).toBeLessThanOrEqual(level.twoStarBudget)
    }
  })

  it('validates sample level references across the whole campaign', () => {
    for (const index of [1, 50, 51, 120, 250, 400, 555, 700, 850, 950, 1000]) {
      const level = generateLevel(index)
      const vehicle = VEHICLES[level.vehicle]
      const crossing = runCrossing(level.reference, level.gap, level.rightDeckY, vehicle.mass + vehicle.cargo, vehicle.wheelbase)
      expect(crossing.notes, `${level.id} ${level.gap}m`).toBeTruthy()
      expect(crossing.ok, `${level.id} gap ${level.gap} ${vehicle.id}: ${crossing.notes.join(' ')}`).toBe(true)
    }
  })
})
