import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HavokPlugin,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { LevelSpec } from '../core/types'
import type { WorldSpec } from '../levels/worlds'
import { mulberry32, hashString } from '../levels/generator'
import { BridgeView } from './bridge'
import HavokPhysics from '@babylonjs/havok'
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'

function color(hex: string): Color3 {
  return Color3.FromHexString(hex)
}

function material(scene: Scene, name: string, hex: string, rough = 0.9): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = color(hex)
  mat.specularColor = new Color3(rough, rough, rough)
  return mat
}

/**
 * The diorama: sky, banks, water, trees and clouds. Everything here is a
 * miniature model, so the palette and scale come from the world definition.
 */
export class Stage {
  readonly engine: Engine
  readonly scene: Scene
  readonly camera: ArcRotateCamera
  readonly sun: DirectionalLight
  readonly shadows: ShadowGenerator
  readonly bridge: BridgeView
  private envSeed: string | null = null
  private physicsTried = false
  private extras: TransformNode[] = []
  private waterTexture: DynamicTexture | null = null
  private reducedMotion = false

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    this.scene = new Scene(this.engine)
    this.scene.clearColor = Color4.FromHexString('#bfe6f7ff')

    this.camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      1.16,
      22,
      new Vector3(0, 0, 0),
      this.scene,
    )
    this.camera.fov = 0.82
    this.camera.lowerBetaLimit = 0.35
    this.camera.upperBetaLimit = 1.52
    this.camera.lowerRadiusLimit = 8
    this.camera.upperRadiusLimit = 70
    this.camera.wheelPrecision = 30
    this.camera.pinchPrecision = 60
    this.camera.panningSensibility = 0
    this.camera.minZ = 0.1

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), this.scene)
    hemi.intensity = 0.42
    hemi.groundColor = new Color3(0.34, 0.38, 0.33)

    this.sun = new DirectionalLight('sun', new Vector3(-0.55, -1, 0.35), this.scene)
    this.sun.position = new Vector3(12, 24, -12)
    this.sun.intensity = 0.82
    this.shadows = new ShadowGenerator(1024, this.sun)
    this.shadows.useBlurExponentialShadowMap = true
    this.shadows.blurKernel = 24
    this.shadows.darkness = 0.35

    this.bridge = new BridgeView(this.scene)

    window.addEventListener('resize', () => this.engine.resize())
  }

  /**
   * Bring up Havok. Debris is simulated by the real engine; the bridge itself is
   * frame-solved and the vehicle is kinematic on the solved deck (see
   * STRUCTURAL.md for why those two stay custom). Failure is non-fatal: the
   * debris falls back to the deterministic integrator.
   */
  async initPhysics(): Promise<boolean> {
    if (this.scene.isPhysicsEnabled()) return true
    if (this.physicsTried) return false
    this.physicsTried = true
    try {
      const havok = await HavokPhysics({ locateFile: () => havokWasmUrl })
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok))
      return true
    } catch (error) {
      console.warn('[bridge-buddies] Havok unavailable, using the fallback debris integrator.', error)
      return false
    }
  }

  /** A small glowing ball used to show the first point of a pending member. */
  createMarker(position: Vector3): Mesh {
    const marker = MeshBuilder.CreateSphere('pending-marker', { diameter: 0.26, segments: 10 }, this.scene)
    marker.position.copyFrom(position)
    const mat = new StandardMaterial('pending-mat', this.scene)
    mat.emissiveColor = color('#ffd166')
    mat.diffuseColor = color('#ffd166')
    mat.disableLighting = true
    marker.material = mat
    marker.isPickable = false
    return marker
  }

  highlightColour(mesh: Mesh, _colour: Color4): void {
    if (mesh.material) mesh.material.alpha = 0.95
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    this.shadows.useBlurExponentialShadowMap = !value
  }

  setWorld(level: LevelSpec, world: WorldSpec): void {
    if (this.envSeed !== level.seed) {
      this.buildEnvironment(level, world)
      this.envSeed = level.seed
    }
    this.scene.clearColor = Color4.FromHexString(`${world.sky}ff`)
    this.scene.fogMode = Scene.FOGMODE_EXP2
    this.scene.fogColor = color(world.fog)
    this.scene.fogDensity = 0.0055
  }

  private clearEnvironment(): void {
    for (const node of this.extras) node.dispose(false, true)
    this.extras = []
    this.waterTexture = null
  }

  private buildEnvironment(level: LevelSpec, world: WorldSpec): void {
    this.clearEnvironment()
    const scene = this.scene
    const random = mulberry32(hashString(`env-${level.seed}`))
    const group = new TransformNode('environment', scene)
    this.extras.push(group)

    const groundMat = material(scene, `ground-${world.id}`, world.ground)
    const darkMat = material(scene, `grounddark-${world.id}`, world.groundDark)
    const rockMat = material(scene, `rock-${world.id}`, world.rock)

    // Banks. The left bank's top is y = 0, the right bank's top is rightDeckY.
    const bankLeft = MeshBuilder.CreateBox('bank-left', { width: 12, height: 9, depth: 17 }, scene)
    bankLeft.position = new Vector3(-6, -4.5, 0)
    bankLeft.material = darkMat
    bankLeft.parent = group
    bankLeft.receiveShadows = true

    const bankRight = MeshBuilder.CreateBox('bank-right', { width: 12, height: 9, depth: 17 }, scene)
    bankRight.position = new Vector3(level.gap + 6, level.rightDeckY - 4.5, 0)
    bankRight.material = darkMat
    bankRight.parent = group
    bankRight.receiveShadows = true

    const lipLeft = MeshBuilder.CreateBox('lip-left', { width: 12.2, height: 0.5, depth: 17.2 }, scene)
    lipLeft.position = new Vector3(-6, -0.02, 0)
    lipLeft.material = groundMat
    lipLeft.parent = group

    const lipRight = MeshBuilder.CreateBox('lip-right', { width: 12.2, height: 0.5, depth: 17.2 }, scene)
    lipRight.position = new Vector3(level.gap + 6, level.rightDeckY - 0.02, 0)
    lipRight.material = groundMat
    lipRight.parent = group

    // Water. A scrolling procedural texture is cheap and reads as moving water.
    const water = MeshBuilder.CreateGround('water', { width: 90, height: 30 }, scene)
    water.position = new Vector3(level.gap / 2, Math.min(-2.4, Math.min(0, level.rightDeckY) - 1.6), 0)
    water.material = this.waterMaterial(world)
    water.parent = group

    // Shore rocks and bushes, placed deterministically.
    for (let i = 0; i < 16; i++) {
      const onLeft = i % 2 === 0
      const x = onLeft ? -1.2 - random() * 6 : level.gap + 1.2 + random() * 6
      const y = (onLeft ? 0 : level.rightDeckY) + 0.1
      const size = 0.3 + random() * 0.5
      const rock = MeshBuilder.CreateSphere(`rock-${i}`, { diameter: size, segments: 6 }, scene)
      rock.position = new Vector3(x, y, -4 + random() * 8)
      rock.scaling.y = 0.7
      rock.material = rockMat
      rock.parent = group
    }

    const foliageMat = material(scene, `foliage-${world.id}`, world.foliage)
    const trunkMat = material(scene, `trunk-${world.id}`, '#7a5230')
    for (let i = 0; i < 22; i++) {
      const onLeft = i % 2 === 0
      const x = onLeft ? -2 - random() * 9 : level.gap + 2 + random() * 9
      const base = (onLeft ? 0 : level.rightDeckY) + 0.1
      const height = 1.4 + random() * 1.6
      const tree = new TransformNode(`tree-${i}`, scene)
      tree.parent = group
      tree.position = new Vector3(x, base, -7 + random() * 14)

      const trunk = MeshBuilder.CreateCylinder(
        `trunk-${i}`,
        { height: height * 0.5, diameter: 0.14, tessellation: 6 },
        scene,
      )
      trunk.position = new Vector3(0, height * 0.25, 0)
      trunk.material = trunkMat
      trunk.parent = tree

      const crown = MeshBuilder.CreateCylinder(
        `crown-${i}`,
        { height: height, diameterTop: 0.05, diameterBottom: height * 0.6, tessellation: 7 },
        scene,
      )
      crown.position = new Vector3(0, height * 0.6, 0)
      crown.material = foliageMat
      crown.parent = tree
    }

    // A few clouds, all one mesh so they can drift cheaply.
    const clouds = new TransformNode('clouds', scene)
    clouds.parent = group
    for (let i = 0; i < 9; i++) {
      const puff = MeshBuilder.CreateSphere(`cloud-${i}`, { diameter: 1.6 + random() * 2.4, segments: 6 }, scene)
      puff.position = new Vector3(-16 + random() * (level.gap + 32), 6 + random() * 3, 15 + random() * 9)
      puff.scaling.y = 0.45
      puff.material = material(scene, 'cloudmat', world.horizon, 0)
      puff.parent = clouds
      puff.isPickable = false
    }
    this.cloudsRoot = clouds
  }

  private cloudsRoot: TransformNode | null = null

  private waterMaterial(world: WorldSpec): StandardMaterial {
    const scene = this.scene
    const size = 256
    const texture = new DynamicTexture(`watertex-${world.id}`, { width: size, height: size }, scene, false)
    const context = texture.getContext()
    context.fillStyle = world.water
    context.fillRect(0, 0, size, size)
    // Soft diagonal bands read as a slow current once they scroll.
    for (let i = 0; i < 22; i++) {
      context.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.10)'
      context.lineWidth = 1 + (i % 4)
      context.beginPath()
      const y = (i / 22) * size
      context.moveTo(0, y)
      for (let x = 0; x <= size; x += 16) {
        context.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 5)
      }
      context.stroke()
    }
    texture.update()
    texture.wrapU = Texture.WRAP_ADDRESSMODE
    texture.wrapV = Texture.WRAP_ADDRESSMODE
    this.waterTexture = texture

    const mat = new StandardMaterial(`watermat-${world.id}`, scene)
    mat.diffuseTexture = texture
    mat.diffuseColor = color(world.water).scale(1.15)
    mat.specularColor = new Color3(0.5, 0.6, 0.65)
    mat.specularPower = 64
    mat.alpha = 0.94
    return mat
  }

  /** Frame the crossing so the whole deck is visible in portrait or landscape. */
  frameLevel(level: LevelSpec): void {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight())
    const portrait = aspect < 1.05
    const fov = portrait ? 1.0 : 0.86
    this.camera.fov = fov
    // Fit the span across the narrow axis: in portrait that is the horizontal
    // field of view, which is where a wide bridge actually overflows.
    const span = level.gap + 2.6
    const radius = span / (2 * Math.tan(fov / 2) * Math.max(0.42, aspect))
    this.camera.alpha = -Math.PI / 2
    this.camera.beta = 1.02
    this.camera.radius = Math.min(70, Math.max(9, radius))
    this.camera.target = new Vector3(level.gap / 2, level.rightDeckY * 0.5 + 0.3, 0)
  }

  frameMenu(): void {
    this.camera.target = new Vector3(0, 0.6, 0)
    this.camera.radius = 17
  }

  update(dt: number): void {
    if (this.reducedMotion) return
    if (this.waterTexture) {
      this.waterTexture.uOffset = (this.waterTexture.uOffset + dt * 0.012) % 1
      this.waterTexture.vOffset = (this.waterTexture.vOffset + dt * 0.004) % 1
    }
    if (this.cloudsRoot) {
      this.cloudsRoot.position.x += dt * 0.18
      if (this.cloudsRoot.position.x > 26) this.cloudsRoot.position.x = -26
    }
  }
}
