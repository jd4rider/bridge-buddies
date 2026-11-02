import { Color4, Matrix, PointerEventTypes, Vector3 } from '@babylonjs/core'
import type { BridgeDesign, LevelSpec, MaterialId, Tool, Vec2, VehicleSpec } from '../core/types'
import type { FrameLoad } from '../structural/frame'
import {
  addMember,
  cloneDesign,
  designCost,
  emptyDesign,
  memberAtPoint,
  removeMember,
  validateDesign,
} from '../bridge/design'
import { analyze, GRAVITY } from '../structural/analyze'
import { axleLoads, deckChain, type DeckChain } from '../structural/crossing'
import { generateLevel, levelForDate, worldOf } from '../levels/generator'
import { Stage } from '../render/stage'
import { TruckView, waterYFor } from '../render/truck'
import { Hud } from '../ui/hud'
import { audio } from '../audio'
import { VEHICLES } from '../vehicles/catalog'
import {
  dailyKey,
  levelKey,
  loadSave,
  persist,
  recordResult,
  starsFor,
  type SaveData,
} from '../save'

type Mode = 'menu' | 'build' | 'test' | 'done'

export class BridgeApp {
  private stage: Stage
  private hud: Hud
  private canvas: HTMLCanvasElement
  private level: LevelSpec
  private design: BridgeDesign
  private history: BridgeDesign[] = []
  private future: BridgeDesign[] = []
  private tool: Tool = 'deck'
  private material: MaterialId = 'wood'
  private mode: Mode = 'menu'
  private pending: Vec2 | null = null
  private dragStart: Vec2 | null = null
  private broken = new Set<string>()
  private chain: DeckChain | null = null
  private truck: TruckView | null = null
  private convoy: string[] = []
  private convoyIndex = 0
  private vehicleS = 0
  private analysis = analyze(emptyDesign([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.5))
  private savedDesign: BridgeDesign | null = null
  private fallTimer = 0
  private menuTimer = 0
  private resultShown = false
  private sandbox = false
  private daily = false
  private lastFrame = 0
  private solveTimer = 0
  private pendingMarker: import('@babylonjs/core').Mesh | null = null
  private save: SaveData

  constructor(root: HTMLElement) {
    this.save = loadSave()
    this.canvas = root.querySelector('#scene') as HTMLCanvasElement
    this.stage = new Stage(this.canvas)
    this.stage.setReducedMotion(!this.save.settings.motion)
    void this.stage.initPhysics()
    audio.setEnabled(this.save.settings.sound)

    this.level = generateLevel(this.save.lastLevel)
    this.design = cloneDesign(this.level.reference)
    this.material = this.level.materials[0] ?? 'wood'

    this.hud = new Hud(root.querySelector('#ui') as HTMLElement, this.handlers(), this.save)
    this.installInput()
    this.showMenu()

    this.stage.engine.runRenderLoop(() => {
      const now = performance.now()
      const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0.016
      this.lastFrame = now
      this.frame(dt)
      this.stage.scene.render()
    })
    window.addEventListener('resize', () => this.stage.engine.resize())
    this.exposeDebugApi()
  }

  /**
   * A read-only projection helper for the browser smoke test. Enabled with
   * ?debug so a player never gets it: it cannot place members or change state,
   * it only answers "where on screen is this world point?".
   */
  private exposeDebugApi(): void {
    if (!new URLSearchParams(window.location.search).has('debug')) return
    const api = {
      info: () => ({
        id: this.level.id,
        gap: this.level.gap,
        rightDeckY: this.level.rightDeckY,
        grid: this.level.grid,
        budget: this.level.budget,
        anchors: this.level.anchors,
        zone: this.level.zone,
      }),
      physics: () => this.stage.scene.isPhysicsEnabled(),
      project: (x: number, y: number) => {
        const engine = this.stage.engine
        const screen = Vector3.Project(
          new Vector3(x, y, 0),
          Matrix.IdentityReadOnly,
          this.stage.scene.getTransformMatrix(),
          this.stage.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
        )
        const rect = this.canvas.getBoundingClientRect()
        return {
          x: rect.left + (screen.x / engine.getRenderWidth()) * rect.width,
          y: rect.top + (screen.y / engine.getRenderHeight()) * rect.height,
        }
      },
    }
    ;(window as unknown as { __bb?: typeof api }).__bb = api
  }

  private handlers() {
    return {
      onContinue: () => this.startJourney(this.save.lastLevel),
      onPlay: () => this.startJourney(1),
      onWorlds: () => this.hud.show('worlds'),
      onWorld: (world: number) => this.hud.showLevels(world),
      onBack: () => this.back(),
      onLevel: (index: number) => this.startJourney(index),
      onDaily: () => this.startDaily(),
      onSandbox: () => this.startSandbox(),
      onSettings: () => this.hud.show('settings'),
      onTool: (tool: Tool) => this.setTool(tool),
      onMaterial: (material: MaterialId) => this.setMaterial(material),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onReset: () => this.reset(),
      onTest: () => (this.mode === 'test' ? this.stopTest() : this.beginTest()),
      onToggleSound: (value: boolean) => this.toggleSetting('sound', value),
      onToggleMotion: (value: boolean) => this.toggleSetting('motion', value),
      onToggleStress: (value: boolean) => this.toggleSetting('stress', value),
      onRetry: () => this.retry(),
      onNext: () => this.nextLevel(),
      onPickWorldFor: () => {
        this.hud.hideResult()
        this.hud.show('worlds')
      },
    }
  }

  private toggleSetting(key: 'sound' | 'motion' | 'stress', value: boolean): void {
    this.save.settings[key] = value
    persist(this.save)
    if (key === 'sound') audio.setEnabled(value)
    if (key === 'motion') this.stage.setReducedMotion(!value)
  }

  private back(): void {
    if (this.mode === 'test') this.stopTest()
    if (this.mode === 'build' || this.mode === 'done') {
      this.hud.hideResult()
      this.mode = 'menu'
      this.showMenu()
      return
    }
    this.hud.show('menu')
    this.mode = 'menu'
  }

  private showMenu(): void {
    this.mode = 'menu'
    this.hud.show('menu')
    const demo = generateLevel(40)
    this.level = demo
    this.design = cloneDesign(demo.reference)
    this.sandbox = false
    this.daily = false
    this.stage.setWorld(demo, worldOf(demo))
    this.stage.frameLevel(demo)
    // The menu wants the diorama in view behind the buttons, not a wide shot of sky.
    this.stage.camera.alpha = -Math.PI / 2 + 0.4
    this.stage.camera.beta = 1.13
    this.stage.camera.radius = Math.max(10, demo.gap * 1.4 + 5.5)
    this.stage.camera.target = new Vector3(demo.gap * 0.5, 0.7, 0)
    this.chain = deckChain(this.design, demo.gap, demo.rightDeckY)
    this.rebuild()
    this.spawnTruck(VEHICLES[demo.vehicle])
    this.vehicleS = 0
    this.menuTimer = 0
  }

  private startJourney(index: number): void {
    audio.unlock()
    this.level = generateLevel(index)
    this.sandbox = false
    this.daily = false
    this.hud.hideResult()
    this.hud.show('play')
    this.stage.setWorld(this.level, worldOf(this.level))
    this.stage.frameLevel(this.level)
    this.savedDesign = null
    this.design =
      this.level.objective === 'repair'
        ? this.damagedReference()
        : emptyDesign(this.level.anchors, this.level.grid)
    this.history = []
    this.future = []
    this.broken.clear()
    this.mode = 'build'
    this.resultShown = false
    this.pending = null
    this.material = this.level.materials[0] ?? 'wood'
    this.tool = 'deck'
    this.save.lastLevel = index
    persist(this.save)
    this.rebuild()
    this.hud.setTools(this.level.materials, this.tool, this.material)
  }

  /** Repair levels start from the reference with a few members missing. */
  private damagedReference(): BridgeDesign {
    const design = cloneDesign(this.level.reference)
    const removable = design.members.filter((member) => member.kind !== 'deck')
    for (let i = 0; i < 3 && removable.length > 0; i++) {
      const pick = removable[(i * 7 + 3) % removable.length]
      design.members = design.members.filter((member) => member.id !== pick.id)
    }
    return design
  }

  private startDaily(): void {
    audio.unlock()
    this.level = levelForDate(new Date())
    this.daily = true
    this.sandbox = false
    this.hud.hideResult()
    this.hud.show('play')
    this.stage.setWorld(this.level, worldOf(this.level))
    this.stage.frameLevel(this.level)
    this.design = emptyDesign(this.level.anchors, this.level.grid)
    this.history = []
    this.future = []
    this.broken.clear()
    this.mode = 'build'
    this.resultShown = false
    this.material = this.level.materials[0] ?? 'wood'
    this.tool = 'deck'
    this.rebuild()
    this.hud.setTools(this.level.materials, this.tool, this.material)
  }

  private startSandbox(): void {
    audio.unlock()
    this.sandbox = true
    this.daily = false
    this.level = generateLevel(1000)
    this.level.budget = 99999
    this.level.twoStarBudget = 99999
    this.level.threeStarBudget = 99999
    this.level.objective = 'cross'
    this.hud.hideResult()
    this.hud.show('play')
    this.stage.setWorld(this.level, worldOf(this.level))
    this.stage.frameLevel(this.level)
    this.design = this.save.sandbox
      ? cloneDesign(this.save.sandbox)
      : emptyDesign(this.level.anchors, this.level.grid)
    this.history = []
    this.future = []
    this.broken.clear()
    this.mode = 'build'
    this.resultShown = false
    this.material = this.level.materials[0] ?? 'wood'
    this.tool = 'deck'
    this.rebuild()
    this.hud.setTools(this.level.materials, this.tool, this.material)
  }

  private updateHeader(): void {
    const cost = designCost(this.design)
    const stars = this.sandbox || this.daily ? 0 : starsFor(this.save, this.level.index)
    this.hud.setLevel(this.level, worldOf(this.level).name, cost, stars)
    this.hud.setCost(cost, this.level)
    this.hud.setStarsHint(cost, this.level)
    this.hud.setUndoRedo(this.history.length > 0, this.future.length > 0)
  }

  private rebuild(): void {
    this.stage.bridge.rebuild(this.design, this.level)
    this.stage.bridge.setDesign(this.design)
    this.updateHeader()
  }

  private setTool(tool: Tool): void {
    if (this.mode !== 'build') return
    this.tool = tool
    this.pending = null
    this.clearPendingMarker()
    this.hud.setTools(this.level.materials, tool, this.material)
    if (tool === 'inspect') {
      this.stage.camera.attachControl(this.canvas, true)
      this.hud.toast('Drag to orbit, pinch to zoom. Pick a tool to build again.')
    } else {
      this.stage.camera.detachControl()
    }
  }

  private setMaterial(material: MaterialId): void {
    this.material = material
    if (this.tool === 'cable') this.tool = 'beam'
    this.hud.setTools(this.level.materials, this.tool, this.material)
  }

  private pushHistory(previous: BridgeDesign): void {
    this.history.push(previous)
    if (this.history.length > 80) this.history.shift()
    this.future = []
  }

  private undo(): void {
    const previous = this.history.pop()
    if (!previous) return
    this.future.push(cloneDesign(this.design))
    this.design = previous
    this.broken.clear()
    this.rebuild()
    audio.play('tap')
  }

  private redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.history.push(cloneDesign(this.design))
    this.design = next
    this.broken.clear()
    this.rebuild()
    audio.play('tap')
  }

  private reset(): void {
    this.stopTest(true)
    this.pushHistory(cloneDesign(this.design))
    this.design =
      this.level.objective === 'repair'
        ? this.damagedReference()
        : emptyDesign(this.level.anchors, this.level.grid)
    this.broken.clear()
    this.rebuild()
    audio.play('tap')
  }

  private retry(): void {
    this.hud.hideResult()
    this.stopTest(true)
    this.design = emptyDesign(this.level.anchors, this.level.grid)
    this.history = []
    this.future = []
    this.broken.clear()
    this.rebuild()
    this.mode = 'build'
    this.hud.show('play')
    this.resultShown = false
    this.stage.frameLevel(this.level)
    this.hud.setTools(this.level.materials, this.tool, this.material)
  }

  private nextLevel(): void {
    this.hud.hideResult()
    this.startJourney(Math.min(1000, this.level.index + 1))
  }

  private installInput(): void {
    this.stage.scene.onPointerObservable.add((info) => {
      if (this.mode !== 'build') return
      const point = this.pickPoint()
      if (!point) return
      if (info.type === PointerEventTypes.POINTERDOWN) {
        this.dragStart = point
      } else if (info.type === PointerEventTypes.POINTERUP) {
        const start = this.dragStart
        this.dragStart = null
        if (!start) return
        const dragged = Math.hypot(point.x - start.x, point.y - start.y) > 0.45
        this.handleTap(point, dragged ? start : null)
      }
    })
  }

  private pickPoint(): Vec2 | null {
    const scene = this.stage.scene
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, this.stage.camera)
    if (Math.abs(ray.direction.z) < 1e-5) return null
    const t = -ray.origin.z / ray.direction.z
    if (t < 0) return null
    const point = ray.origin.add(ray.direction.scale(t))
    return { x: point.x, y: point.y }
  }

  private handleTap(point: Vec2, dragFrom: Vec2 | null): void {
    if (this.tool === 'inspect') return

    if (this.tool === 'erase') {
      const member = memberAtPoint(this.design, point, 0.4)
      if (!member) {
        this.hud.toast('Tap a member to remove it.')
        return
      }
      const previous = cloneDesign(this.design)
      this.design = removeMember(this.design, member.id)
      this.pushHistory(previous)
      this.rebuild()
      audio.play('tap')
      return
    }

    const from = dragFrom ?? this.pending
    if (!from) {
      this.pending = { x: point.x, y: point.y }
      this.showPendingMarker(point)
      audio.play('tap')
      return
    }
    if (Math.hypot(point.x - from.x, point.y - from.y) < 0.25) {
      this.pending = null
      this.clearPendingMarker()
      return
    }

    const material: MaterialId = this.tool === 'cable' ? 'cable' : this.material
    const kind = this.tool === 'deck' ? 'deck' : this.tool === 'cable' ? 'cable' : 'beam'
    const previous = cloneDesign(this.design)
    const result = addMember(this.design, this.level, from, point, material, kind)
    this.pending = null
    this.clearPendingMarker()
    if (result.error) {
      this.hud.toast(result.error)
      return
    }
    this.design = result.design
    this.pushHistory(previous)
    this.rebuild()
    audio.play('place')
  }

  private showPendingMarker(point: Vec2): void {
    this.clearPendingMarker()
    const marker = this.stage.scene.getMeshByName('pending-marker')
    if (marker) return
    const dot = this.stage.scene.getEngine().getRenderingCanvas()
    void dot
    const snapped = {
      x: Math.round(point.x / this.level.grid) * this.level.grid,
      y: Math.round(point.y / this.level.grid) * this.level.grid,
    }
    const mesh = this.stage.createMarker(new Vector3(snapped.x, snapped.y, 0))
    this.pendingMarker = mesh
    this.stage.highlightColour(mesh, Color4.FromHexString('#ffd166ff'))
  }

  private clearPendingMarker(): void {
    this.pendingMarker?.dispose()
    this.pendingMarker = null
  }

  private frame(dt: number): void {
    this.stage.update(dt)
    const splashes = this.stage.bridge.updateDebris(dt, waterYFor(this.level))
    if (splashes > 0) audio.play('splash')

    if (this.mode === 'menu') this.animateMenu(dt)
    else if (this.mode === 'test') this.animateTest(dt)
  }

  private animateMenu(dt: number): void {
    if (!this.truck || !this.chain) return
    this.menuTimer += dt
    this.vehicleS += 1.8 * dt
    if (this.vehicleS > this.chain.length + 2) {
      this.vehicleS = 0
      this.stage.bridge.rebuild(this.design, this.level)
      this.stage.bridge.setDesign(this.design)
    }
    const point = this.deckPoint(this.chain, this.vehicleS, null)
    if (point) {
      this.truck.place(point.x, point.y, 0, point.pitch)
      this.truck.spinWheels(this.vehicleS)
    }
    this.stage.camera.alpha = -Math.PI / 2 + Math.sin(this.menuTimer * 0.12) * 0.2
  }

  private deckPoint(
    chain: DeckChain,
    distance: number,
    deflections: Map<string, Vec2> | null,
  ): { x: number; y: number; pitch: number } | null {
    const find = (id: string) => this.design.nodes.find((node) => node.id === id)
    const clamped = Math.max(0, Math.min(chain.length, distance))
    for (let i = 1; i < chain.nodes.length; i++) {
      if (clamped <= chain.distances[i]) {
        const a = find(chain.nodes[i - 1])
        const b = find(chain.nodes[i])
        if (!a || !b) return null
        const da = deflections?.get(a.id)
        const db = deflections?.get(b.id)
        const ax = a.x + (da?.x ?? 0)
        const ay = a.y + (da?.y ?? 0)
        const bx = b.x + (db?.x ?? 0)
        const by = b.y + (db?.y ?? 0)
        const span = chain.distances[i] - chain.distances[i - 1] || 1
        const t = (clamped - chain.distances[i - 1]) / span
        return {
          x: ax + (bx - ax) * t,
          y: ay + (by - ay) * t,
          pitch: Math.atan2(by - ay, bx - ax),
        }
      }
    }
    return null
  }

  private activeDesign(): BridgeDesign {
    if (this.broken.size === 0) return this.design
    return {
      nodes: this.design.nodes,
      members: this.design.members.filter((member) => !this.broken.has(member.id)),
    }
  }

  private vehicleSpec(): VehicleSpec {
    const id = (this.convoy[this.convoyIndex] ?? this.level.vehicle) as keyof typeof VEHICLES
    return VEHICLES[id]
  }

  private testLoads(design: BridgeDesign, chain: DeckChain, s: number): FrameLoad[] {
    const spec = this.vehicleSpec()
    const loads = axleLoads(design, chain, s, spec.wheelbase, (spec.mass + spec.cargo) * GRAVITY * 0.5)
    if (this.level.wind > 0) {
      const windForce = 0.5 * 1.225 * this.level.wind * this.level.wind * 0.35
      design.nodes.forEach((node, index) => {
        if (!node.anchor) loads.push({ node: index, fx: -windForce })
      })
    }
    return loads
  }

  private beginTest(): void {
    audio.unlock()
    const problems = validateDesign(this.activeDesign(), this.level)
    const blocking = problems.filter((problem) => problem.kind !== 'over-budget')
    if (blocking.length > 0) {
      this.hud.toast(blocking[0].message)
      return
    }
    this.chain = deckChain(this.activeDesign(), this.level.gap, this.level.rightDeckY)
    if (!this.chain) {
      this.hud.toast('The road deck does not reach the far bank yet.')
      return
    }
    this.savedDesign = cloneDesign(this.design)
    this.broken.clear()
    this.convoy = this.level.convoy.length > 0 ? [...this.level.convoy] : [this.level.vehicle]
    this.convoyIndex = 0
    this.vehicleS = 0
    this.fallTimer = 0
    this.resultShown = false
    this.mode = 'test'
    this.stage.camera.detachControl()
    this.hud.setTesting(true)
    this.hud.hideResult()
    this.spawnTruck(this.vehicleSpec())
    this.solveTimer = 0
    this.analysis = analyze(this.activeDesign())
    this.stage.bridge.showStress(this.save.settings.stress ? this.analysis : null)
    audio.play('whoosh')
  }

  private stopTest(silent = false): void {
    if (this.mode !== 'test') return
    this.mode = 'build'
    this.hud.setTesting(false)
    this.broken.clear()
    if (this.savedDesign) {
      this.design = this.savedDesign
      this.savedDesign = null
    }
    this.rebuild()
    this.stage.bridge.showStress(null)
    this.truck?.setVisible(false)
    this.chain = null
    if (!silent) this.stage.frameLevel(this.level)
  }

  private spawnTruck(spec: VehicleSpec): void {
    this.truck?.dispose()
    this.truck = new TruckView(this.stage.scene, spec)
    this.truck.setVisible(false)
    if (!this.chain) this.chain = deckChain(this.design, this.level.gap, this.level.rightDeckY)
    if (this.chain) {
      const start = this.deckPoint(this.chain, 0.3, null)
      if (start) this.truck.place(start.x, start.y, 0, start.pitch)
    }
    this.truck.setVisible(true)
  }

  private animateTest(dt: number): void {
    const truck = this.truck
    if (!truck || !this.chain) return
    const spec = this.vehicleSpec()
    const design = this.activeDesign()

    if (this.fallTimer > 0) {
      this.fallTimer -= dt
      truck.fall(dt)
      if (this.fallTimer <= 0 && !this.resultShown) {
        this.fail('The bridge gave way under the load.')
      }
      return
    }

    this.vehicleS += spec.speed * dt
    this.solveTimer -= dt

    if (this.solveTimer <= 0) {
      this.solveTimer = 0.08
      const loads = this.testLoads(design, this.chain, Math.min(this.vehicleS, this.chain.length))
      this.analysis = analyze(design, { extraLoads: loads })
      this.stage.bridge.applyDeformation(this.design, this.analysis.deflections)
      if (this.save.settings.stress) this.stage.bridge.showStress(this.analysis)

      if (this.analysis.unstable || this.analysis.maxUtilization > 1) {
        const worst = this.analysis.worstMember
        if (worst && !this.broken.has(worst)) {
          this.broken.add(worst)
          this.stage.bridge.breakMember(this.design, worst)
          audio.play('snap')
          this.hud.toast('A member gave way — the load shifted to its neighbours.')
        }
        this.chain = deckChain(this.activeDesign(), this.level.gap, this.level.rightDeckY)
        if (!this.chain) {
          this.fallTimer = 1.3
          this.truck?.fall(dt)
          return
        }
      }
    }

    if (!this.chain) return
    const point = this.deckPoint(this.chain, this.vehicleS, this.analysis.deflections)
    if (point) {
      truck.place(point.x, point.y, 0, point.pitch)
      truck.spinWheels(this.vehicleS)
      this.stage.camera.target = Vector3.Lerp(
        this.stage.camera.target,
        new Vector3(point.x, point.y + 0.4, 0),
        0.05,
      )
    }

    if (this.vehicleS >= this.chain.length) {
      if (this.convoyIndex < this.convoy.length - 1) {
        this.convoyIndex += 1
        this.vehicleS = 0
        this.chain = deckChain(this.activeDesign(), this.level.gap, this.level.rightDeckY)
        this.spawnTruck(this.vehicleSpec())
        this.hud.toast('First one across. Here comes the next.')
      } else {
        this.win()
      }
    }
  }

  private fail(reason: string): void {
    if (this.resultShown) return
    this.resultShown = true
    this.mode = 'done'
    this.hud.setTesting(false)
    audio.play('lose')
    this.hud.showResult({
      won: false,
      stars: 0,
      cost: designCost(this.design),
      level: this.level,
      reason,
      nextIndex: null,
    })
    this.stage.bridge.showStress(this.analysis)
  }

  private win(): void {
    if (this.resultShown) return
    this.resultShown = true
    const cost = designCost(this.design)
    const stars = cost <= this.level.threeStarBudget ? 3 : cost <= this.level.twoStarBudget ? 2 : 1
    if (this.sandbox) {
      this.save.sandbox = cloneDesign(this.design)
      persist(this.save)
    } else {
      recordResult(this.save, this.daily ? dailyKey(new Date()) : levelKey(this.level.index), stars, cost)
    }
    this.hud.setSave(this.save)
    this.hud.refresh(this.save)
    audio.play('win')
    this.mode = 'done'
    this.hud.setTesting(false)
    this.truck?.celebrate(0.4)
    this.hud.showResult({
      won: true,
      stars,
      cost,
      level: this.level,
      reason: `The ${VEHICLES[this.level.vehicle].name} is safely across.`,
      nextIndex: this.sandbox ? null : Math.min(1000, this.level.index + 1),
    })
    this.updateHeader()
  }
}
