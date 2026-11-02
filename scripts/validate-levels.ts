/**
 * Campaign validation: builds every level, drives the generator's reference
 * bridge across it, and records what actually happened.
 *
 * This is the honest gate described in STRUCTURAL.md. A level is VERIFIED only
 * when its reference bridge connects both banks and survives the moving-load
 * sweep inside the structural limits. It is a structural check, not a full
 * dynamic vehicle simulation, and the report says so.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { designCost } from '../src/bridge/design'
import { generateCampaign } from '../src/levels/generator'
import { runCrossing } from '../src/structural/crossing'
import { VEHICLES } from '../src/vehicles/catalog'
import { worldById } from '../src/levels/worlds'

interface Record_ {
  id: string
  index: number
  world: number
  seed: string
  gap: number
  rightDeckY: number
  vehicle: string
  vehicleMass: number
  material: string
  budget: number
  referenceCost: number
  status: 'VERIFIED' | 'REJECTED' | 'UNKNOWN'
  maxUtilization: number
  maxDeflection: number
  maxSlope: number
  sweep: number
  notes: string[]
}

const started = Date.now()
const levels = generateCampaign()
const records: Record_[] = []
const failures: string[] = []

for (const level of levels) {
  const vehicle = VEHICLES[level.vehicle]
  const crossing = runCrossing(
    level.reference,
    level.gap,
    level.rightDeckY,
    vehicle.mass + vehicle.cargo,
    vehicle.wheelbase,
    { samples: 21 },
  )
  const cost = designCost(level.reference)
  const costOk = cost <= level.budget + 0.01
  const status: Record_['status'] = crossing.ok && costOk ? 'VERIFIED' : 'REJECTED'
  if (status === 'REJECTED') {
    failures.push(
      `${level.id} (${worldById(level.world).name} ${level.local}) gap ${level.gap} ${vehicle.id}: ${crossing.notes.join(' ')}${costOk ? '' : ` Over budget: ${cost.toFixed(0)} > ${level.budget}.`}`,
    )
  }
  const record: Record_ = {
    id: level.id,
    index: level.index,
    world: level.world,
    seed: level.seed,
    gap: level.gap,
    rightDeckY: level.rightDeckY,
    vehicle: level.vehicle,
    vehicleMass: vehicle.mass + vehicle.cargo,
    material: level.reference.members[0]?.material ?? 'wood',
    budget: level.budget,
    referenceCost: Math.round(cost * 10) / 10,
    status,
    maxUtilization: Math.round(crossing.maxUtilization * 1000) / 1000,
    maxDeflection: Math.round(crossing.maxDeflection * 1000) / 1000,
    maxSlope: Math.round(crossing.maxSlope * 1000) / 1000,
    sweep: crossing.samples,
    notes: crossing.notes,
  }
  records.push(record)
}

const verified = records.filter((record) => record.status === 'VERIFIED')
const utilisations = verified.map((record) => record.maxUtilization).sort((a, b) => a - b)
const deflections = verified.map((record) => record.maxDeflection).sort((a, b) => a - b)
const percentile = (list: number[], p: number) => (list.length ? list[Math.min(list.length - 1, Math.floor(list.length * p))] : 0)
const elapsed = Date.now() - started

const byWorld = new Map<number, { total: number; verified: number }>()
for (const record of records) {
  const entry = byWorld.get(record.world) ?? { total: 0, verified: 0 }
  entry.total += 1
  if (record.status === 'VERIFIED') entry.verified += 1
  byWorld.set(record.world, entry)
}

mkdirSync('reports', { recursive: true })
const report = {
  generator: 'bridge-buddies-gen-v1',
  solver: 'bb-frame-2d-v1',
  generatedAt: new Date().toISOString(),
  levels: records.length,
  verified: verified.length,
  rejected: records.length - verified.length,
  runtimeMs: elapsed,
  summary: {
    utilizationMedian: percentile(utilisations, 0.5),
    utilizationP95: percentile(utilisations, 0.95),
    utilizationMax: utilisations[utilisations.length - 1] ?? 0,
    deflectionMedian: percentile(deflections, 0.5),
    deflectionMax: deflections[deflections.length - 1] ?? 0,
    sweepSamples: 21,
    note:
      'Structural surrogate: quasi-static moving load on the reference bridge. Every level was solved at 21 vehicle positions with the real frame solver. This validates that a buildable design holds; it is not a dynamic vehicle simulation.',
  },
  worlds: WORLDS_REPORT(),
  records,
}
writeFileSync('reports/level-validation.json', JSON.stringify(report, null, 2))

function WORLDS_REPORT() {
  return [...byWorld.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([world, entry]) => ({
      world,
      name: worldById(world).name,
      levels: entry.total,
      verified: entry.verified,
    }))
}

console.log(`Campaign validation — ${records.length} levels in ${elapsed} ms`)
console.log(`  verified  ${verified.length}`)
console.log(`  rejected  ${records.length - verified.length}`)
if (utilisations.length) {
  console.log(
    `  utilisation  median ${percentile(utilisations, 0.5).toFixed(2)}  p95 ${percentile(utilisations, 0.95).toFixed(2)}  max ${percentile(utilisations, 1).toFixed(2)}`,
  )
  console.log(
    `  deflection   median ${percentile(deflections, 0.5).toFixed(3)} m  max ${percentile(deflections, 1).toFixed(3)} m`,
  )
}
for (const [world, entry] of [...byWorld.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  world ${String(world).padStart(2)} ${worldById(world).name.padEnd(28)} ${entry.verified}/${entry.total}`)
}
if (failures.length > 0) {
  console.error(`\n${failures.length} rejected levels:`)
  for (const failure of failures.slice(0, 25)) console.error(`  - ${failure}`)
  if (failures.length > 25) console.error(`  ... and ${failures.length - 25} more (see reports/level-validation.json)`)
  process.exit(1)
}
console.log('\nEvery level has a validated reference bridge.')
