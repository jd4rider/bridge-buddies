import type { LevelSpec, MaterialId, Tool } from '../core/types'
import { MATERIALS } from '../structural/materials'
import { WORLDS } from '../levels/worlds'
import { VEHICLES } from '../vehicles/catalog'
import type { SaveData } from '../save'
import { completedInWorld, starsFor, worldUnlocked } from '../save'

export type Screen = 'menu' | 'worlds' | 'levels' | 'settings' | 'play'

export interface HudHandlers {
  onContinue(): void
  onPlay(): void
  onWorlds(): void
  onWorld(world: number): void
  onBack(): void
  onLevel(index: number): void
  onDaily(): void
  onSandbox(): void
  onSettings(): void
  onTool(tool: Tool): void
  onMaterial(material: MaterialId): void
  onUndo(): void
  onRedo(): void
  onReset(): void
  onTest(): void
  onToggleSound(value: boolean): void
  onToggleMotion(value: boolean): void
  onToggleStress(value: boolean): void
  onRetry(): void
  onNext(): void
  onPickWorldFor(): void
}

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'deck', label: 'Road', icon: '🛤️' },
  { id: 'beam', label: 'Beam', icon: '🔩' },
  { id: 'cable', label: 'Cable', icon: '🪢' },
  { id: 'erase', label: 'Erase', icon: '🧽' },
  { id: 'inspect', label: 'Look', icon: '🎥' },
]

function starsMarkup(stars: number, max = 3): string {
  let markup = ''
  for (let i = 0; i < max; i++) markup += `<span class="star${i < stars ? ' on' : ''}">★</span>`
  return markup
}

export class Hud {
  private root: HTMLElement
  private handlers: HudHandlers
  private screens: HTMLElement
  private chrome: HTMLElement
  private topbar: HTMLElement
  private toastEl: HTMLElement
  private resultEl: HTMLElement
  private levelTitle: HTMLElement
  private levelSub: HTMLElement
  private objectiveEl: HTMLElement
  private budgetEl: HTMLElement
  private costEl: HTMLElement
  private starsEl: HTMLElement
  private materialRow: HTMLElement
  private toolRow: HTMLElement
  private testButton: HTMLButtonElement
  private undoButton: HTMLButtonElement
  private redoButton: HTMLButtonElement
  private currentScreen: Screen = 'menu'
  private currentWorld = 1
  private save: SaveData
  private toastHandle: number | null = null

  constructor(root: HTMLElement, handlers: HudHandlers, save: SaveData) {
    this.root = root
    this.handlers = handlers
    this.save = save
    this.root.innerHTML = `
      <header id="topbar" class="hidden">
        <button id="top-back" class="icon-button" aria-label="Back">‹</button>
        <div class="titles">
          <strong id="level-title">Level</strong>
          <span id="level-sub">World</span>
        </div>
        <div class="budget">
          <span id="budget-money">0</span>
          <span class="stars" id="level-stars"></span>
        </div>
      </header>

      <footer id="toolbar" class="hidden">
        <div class="objective" id="objective">Build a bridge.</div>
        <div class="cost-line">
          <span id="cost">Cost 0</span>
        </div>
        <div class="materials" id="materials"></div>
        <div class="tools" id="tools"></div>
        <div class="actions">
          <button id="undo" class="ghost" aria-label="Undo">↶</button>
          <button id="redo" class="ghost" aria-label="Redo">↷</button>
          <button id="reset" class="ghost" aria-label="Reset">Reset</button>
          <button id="test" class="primary">TEST</button>
        </div>
      </footer>

      <div id="screens"></div>
      <div id="toast" role="status"></div>
      <div id="result" class="hidden" role="dialog" aria-live="polite"></div>
    `

    this.screens = this.root.querySelector('#screens')!
    this.chrome = this.root.querySelector('#toolbar')!
    this.topbar = this.root.querySelector('#topbar')!
    this.toastEl = this.root.querySelector('#toast')!
    this.resultEl = this.root.querySelector('#result')!
    this.levelTitle = this.root.querySelector('#level-title')!
    this.levelSub = this.root.querySelector('#level-sub')!
    this.objectiveEl = this.root.querySelector('#objective')!
    this.budgetEl = this.root.querySelector('#budget-money')!
    this.costEl = this.root.querySelector('#cost')!
    this.starsEl = this.root.querySelector('#level-stars')!
    this.materialRow = this.root.querySelector('#materials')!
    this.toolRow = this.root.querySelector('#tools')!
    this.testButton = this.root.querySelector('#test')!
    this.undoButton = this.root.querySelector('#undo')!
    this.redoButton = this.root.querySelector('#redo')!

    this.toolRow.innerHTML = TOOLS.map(
      (tool) =>
        `<button class="tool" data-tool="${tool.id}" aria-label="${tool.label}"><span>${tool.icon}</span>${tool.label}</button>`,
    ).join('')

    this.bind()
  }

  private bind(): void {
    this.root.querySelector('#top-back')!.addEventListener('click', () => this.handlers.onBack())
    this.testButton.addEventListener('click', () => this.handlers.onTest())
    this.root.querySelector('#undo')!.addEventListener('click', () => this.handlers.onUndo())
    this.root.querySelector('#redo')!.addEventListener('click', () => this.handlers.onRedo())
    this.root.querySelector('#reset')!.addEventListener('click', () => this.handlers.onReset())

    this.toolRow.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]')
      if (button?.dataset.tool) this.handlers.onTool(button.dataset.tool as Tool)
    })
    this.materialRow.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-material]')
      if (target?.dataset.material) this.handlers.onMaterial(target.dataset.material as MaterialId)
    })
    this.screens.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
      if (!target) return
      switch (target.dataset.action) {
        case 'continue':
          this.handlers.onContinue()
          break
        case 'play':
          this.handlers.onPlay()
          break
        case 'worlds':
          this.handlers.onWorlds()
          break
        case 'daily':
          this.handlers.onDaily()
          break
        case 'sandbox':
          this.handlers.onSandbox()
          break
        case 'settings':
          this.handlers.onSettings()
          break
        case 'back':
          this.handlers.onBack()
          break
        case 'world':
          this.handlers.onWorld(Number(target.dataset.world))
          break
        case 'level':
          this.handlers.onLevel(Number(target.dataset.level))
          break
        default:
          break
      }
    })
    this.resultEl.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
      if (!target) return
      if (target.dataset.action === 'retry') this.handlers.onRetry()
      if (target.dataset.action === 'next') this.handlers.onNext()
      if (target.dataset.action === 'levels') this.handlers.onPickWorldFor()
    })
  }

  refresh(save: SaveData): void {
    this.save = save
    if (this.currentScreen === 'worlds') this.renderWorlds()
    if (this.currentScreen === 'levels') this.renderLevels(this.currentWorld)
  }

  show(screen: Screen): void {
    this.currentScreen = screen
    this.screens.classList.toggle('hidden', screen === 'play')
    this.chrome.classList.toggle('hidden', screen !== 'play')
    this.topbar.classList.toggle('hidden', screen !== 'play')
    if (screen === 'menu') this.renderMenu()
    if (screen === 'worlds') this.renderWorlds()
    if (screen === 'settings') this.renderSettings()
    if (screen === 'levels') this.renderLevels(this.currentWorld)
    if (screen === 'play') this.screens.innerHTML = ''
  }

  showLevels(world: number): void {
    this.currentWorld = world
    this.show('levels')
  }

  private renderMenu(): void {
    const stars = Object.values(this.save.results).reduce((sum, result) => sum + result.stars, 0)
    this.screens.innerHTML = `
      <section class="menu">
        <div class="logo">
          <h1>Bridge<span>Buddies</span></h1>
          <p>Build it. Test it. Get them across.</p>
        </div>
        <div class="menu-buttons">
          <button class="primary big" data-action="continue">CONTINUE <small>Level ${this.save.lastLevel}</small></button>
          <button class="secondary big" data-action="play">PLAY</button>
          <button class="secondary" data-action="worlds">Worlds</button>
          <button class="secondary" data-action="daily">Daily challenge</button>
          <button class="secondary" data-action="sandbox">Sandbox</button>
          <button class="ghost" data-action="settings">Settings</button>
        </div>
        <div class="menu-foot">
          <span class="stars">${starsMarkup(3)}</span>
          <span>${stars} stars · 1000 levels · 20 worlds</span>
        </div>
      </section>
    `
  }

  private renderWorlds(): void {
    this.screens.innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <button class="icon-button" data-action="back" aria-label="Back">‹</button>
          <h2>Worlds</h2>
          <span class="muted">${Object.keys(this.save.results).length} solved</span>
        </div>
        <div class="world-grid">
          ${WORLDS.map((world) => {
            const unlocked = worldUnlocked(this.save, world.id)
            const solved = completedInWorld(this.save, world.id)
            return `
              <button class="world-card${unlocked ? '' : ' locked'}" ${
                unlocked ? `data-action="world" data-world="${world.id}"` : 'disabled'
              }>
                <span class="swatch" style="background:linear-gradient(160deg,${world.sky},${world.groundDark})">
                  <span class="swatch-water" style="background:${world.water}"></span>
                </span>
                <span class="world-name">${world.name}</span>
                <span class="world-meta">${unlocked ? `${solved}/50 solved` : 'Finish 25 to unlock'}</span>
              </button>
            `
          }).join('')}
        </div>
      </section>
    `
  }

  private renderLevels(world: number): void {
    this.currentWorld = world
    const spec = WORLDS[world - 1]
    if (!spec) return
    const first = (world - 1) * 50 + 1
    let buttons = ''
    for (let i = 0; i < 50; i++) {
      const index = first + i
      const stars = starsFor(this.save, index)
      const previous = i === 0 ? 1 : starsFor(this.save, index - 1)
      const open = i === 0 || stars > 0 || previous > 0
      buttons += `
        <button class="level-chip${open ? '' : ' locked'}" ${
          open ? `data-action="level" data-level="${index}"` : 'disabled'
        } aria-label="Level ${i + 1}">
          <span class="chip-number">${i + 1}</span>
          <span class="chip-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
        </button>
      `
    }
    this.screens.innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <button class="icon-button" data-action="back" aria-label="Back">‹</button>
          <h2>${spec.name}</h2>
          <span class="muted">${completedInWorld(this.save, world)}/50</span>
        </div>
        <p class="muted small">${spec.mechanic}</p>
        <div class="level-grid">${buttons}</div>
      </section>
    `
  }

  private renderSettings(): void {
    this.screens.innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <button class="icon-button" data-action="back" aria-label="Back">‹</button>
          <h2>Settings</h2>
        </div>
        <label class="toggle"><input type="checkbox" id="t-sound" ${this.save.settings.sound ? 'checked' : ''}/> Sound</label>
        <label class="toggle"><input type="checkbox" id="t-motion" ${this.save.settings.motion ? 'checked' : ''}/> Ambient motion and drifting water</label>
        <label class="toggle"><input type="checkbox" id="t-stress" ${this.save.settings.stress ? 'checked' : ''}/> Stress colours while testing</label>
        <p class="muted small">Blue is relaxed, green is safe, amber is working, orange is near the limit, red is about to fail. Members that let go turn into debris.</p>
        <p class="muted small">Progress is saved in this browser only. No account, no ads, no timers.</p>
      </section>
    `
    this.screens.querySelector('#t-sound')!.addEventListener('change', (event) => {
      this.handlers.onToggleSound((event.target as HTMLInputElement).checked)
    })
    this.screens.querySelector('#t-motion')!.addEventListener('change', (event) => {
      this.handlers.onToggleMotion((event.target as HTMLInputElement).checked)
    })
    this.screens.querySelector('#t-stress')!.addEventListener('change', (event) => {
      this.handlers.onToggleStress((event.target as HTMLInputElement).checked)
    })
  }

  setLevel(level: LevelSpec, worldName: string, cost: number, stars: number): void {
    this.levelTitle.textContent = `Level ${level.local}`
    this.levelSub.textContent = `${worldName} · ${level.id}`
    this.budgetEl.textContent = `${Math.round(cost)} / ${level.budget}`
    this.starsEl.innerHTML = starsMarkup(stars)
    const vehicle = VEHICLES[level.vehicle]
    const tons = Math.round((vehicle.mass + vehicle.cargo) / 100) / 10
    this.objectiveEl.textContent =
      level.objective === 'convoy'
        ? `Convoy: bring both vehicles across`
        : level.objective === 'wind'
          ? `Cross in ${level.wind} m/s wind — ${tons} t`
          : level.objective === 'repair'
            ? `Repair the crossing for the ${vehicle.name}`
            : `Get the ${vehicle.name} (${tons} t) across`
    document.body.dataset.objective = level.objective
  }

  setCost(cost: number, level: LevelSpec): void {
    this.costEl.textContent = `Cost ${Math.round(cost)}`
    this.budgetEl.textContent = `${Math.round(cost)} / ${level.budget}`
    const over = cost > level.budget + 0.01
    this.costEl.classList.toggle('over', over)
    this.testButton.disabled = over
  }

  setStarsHint(cost: number, level: LevelSpec): void {
    const earned = cost <= level.threeStarBudget ? 3 : cost <= level.twoStarBudget ? 2 : 1
    this.starsEl.innerHTML = starsMarkup(earned)
  }

  setUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.undoButton.disabled = !canUndo
    this.redoButton.disabled = !canRedo
  }

  setTools(materials: MaterialId[], tool: Tool, material: MaterialId): void {
    this.materialRow.innerHTML = materials
      .map((id) => {
        const spec = MATERIALS[id]
        return `<button class="material${id === material ? ' active' : ''}" data-material="${id}" title="${spec.blurb}">
          <span class="dot" style="background:${spec.color}"></span>${spec.short}
          <small>${spec.costPerMetre}/m</small>
        </button>`
      })
      .join('')
    this.toolRow.querySelectorAll<HTMLButtonElement>('.tool').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === tool)
    })
  }

  setTesting(testing: boolean): void {
    this.testButton.textContent = testing ? 'STOP' : 'TEST'
    this.testButton.classList.toggle('testing', testing)
    this.chrome.classList.toggle('testing', testing)
  }

  toast(message: string): void {
    this.toastEl.textContent = message
    this.toastEl.classList.add('show')
    if (this.toastHandle) window.clearTimeout(this.toastHandle)
    this.toastHandle = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600)
  }

  showResult(options: {
    won: boolean
    stars: number
    cost: number
    level: LevelSpec
    reason: string
    nextIndex: number | null
  }): void {
    const { won, stars, cost, level, reason, nextIndex } = options
    this.resultEl.classList.remove('hidden')
    this.resultEl.innerHTML = `
      <div class="result-card ${won ? 'win' : 'fail'}">
        <h2>${won ? 'Across!' : 'Not quite'}</h2>
        <p class="reason">${reason}</p>
        ${won ? `<div class="result-stars">${starsMarkup(stars)}</div>` : ''}
        <p class="muted">Cost ${Math.round(cost)} of ${level.budget}${
          won ? ` · 2★ under ${level.twoStarBudget} · 3★ under ${level.threeStarBudget}` : ''
        }</p>
        <div class="result-actions">
          ${won && nextIndex !== null ? '<button class="primary" data-action="next">NEXT LEVEL</button>' : ''}
          <button class="secondary" data-action="retry">${won ? 'Rebuild' : 'Try again'}</button>
          <button class="ghost" data-action="levels">Levels</button>
        </div>
      </div>
    `
  }

  hideResult(): void {
    this.resultEl.classList.add('hidden')
    this.resultEl.innerHTML = ''
  }

  setSave(save: SaveData): void {
    this.save = save
  }
}
