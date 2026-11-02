import type { BridgeDesign } from './core/types'

export interface LevelResult {
  stars: number
  cost: number
}

export interface Settings {
  sound: boolean
  motion: boolean
  stress: boolean
}

export interface SaveData {
  version: 1
  results: Record<string, LevelResult>
  lastLevel: number
  settings: Settings
  sandbox: BridgeDesign | null
}

const KEY = 'bridge-buddies-save-v1'

export function freshSave(): SaveData {
  return {
    version: 1,
    results: {},
    lastLevel: 1,
    settings: { sound: true, motion: true, stress: true },
    sandbox: null,
  }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return freshSave()
    const parsed = JSON.parse(raw) as Partial<SaveData>
    if (!parsed || parsed.version !== 1) return freshSave()
    return {
      version: 1,
      results: parsed.results ?? {},
      lastLevel: Math.max(1, Math.min(1000, parsed.lastLevel ?? 1)),
      settings: { ...freshSave().settings, ...(parsed.settings ?? {}) },
      sandbox: parsed.sandbox ?? null,
    }
  } catch {
    // A corrupted save must never stop the game from loading.
    return freshSave()
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save))
  } catch {
    // Private mode or a full quota: the session still plays.
  }
}

export function levelKey(index: number): string {
  return `level-${index}`
}

export function dailyKey(date: Date): string {
  return `daily-${date.toISOString().slice(0, 10)}`
}

export function recordResult(save: SaveData, key: string, stars: number, cost: number): void {
  const previous = save.results[key]
  save.results[key] = {
    stars: Math.max(stars, previous?.stars ?? 0),
    cost: previous ? Math.min(previous.cost || Number.POSITIVE_INFINITY, cost) : cost,
  }
  persist(save)
}

export function starsFor(save: SaveData, index: number): number {
  return save.results[levelKey(index)]?.stars ?? 0
}

export function starsInWorld(save: SaveData, world: number): number {
  let total = 0
  const first = (world - 1) * 50 + 1
  for (let index = first; index < first + 50; index++) total += starsFor(save, index)
  return total
}

export function completedInWorld(save: SaveData, world: number): number {
  let done = 0
  const first = (world - 1) * 50 + 1
  for (let index = first; index < first + 50; index++) if (starsFor(save, index) > 0) done += 1
  return done
}

export function totalStars(save: SaveData): number {
  return Object.values(save.results).reduce((sum, result) => sum + result.stars, 0)
}

/** Worlds unlock at a gentle pace: half of the previous world solved. */
export function worldUnlocked(save: SaveData, world: number): boolean {
  if (world <= 1) return true
  return completedInWorld(save, world - 1) >= 25
}
