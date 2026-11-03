import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { VehicleSpec } from '../core/types'

/** Half the deck plank's thickness, in metres (see BridgeView.createMember). */
const DECK_HALF_THICKNESS = 0.07

/**
 * A buddy: rounded boxes and four wheels, built from primitives so there are no
 * downloaded models. It pitches with the deck and bounces on its springs.
 */
export class TruckView {
  readonly root: TransformNode
  private body: TransformNode
  private wheels: Mesh[] = []
  private wheelBase: number
  private bounce = 0
  private spec: VehicleSpec

  constructor(scene: Scene, spec: VehicleSpec) {
    this.spec = spec
    this.root = new TransformNode(`truck-${spec.id}`, scene)
    this.body = new TransformNode(`truckbody-${spec.id}`, scene)
    this.body.parent = this.root
    this.wheelBase = spec.wheelbase

    const paint = new StandardMaterial(`paint-${spec.id}`, scene)
    paint.diffuseColor = Color3.FromHexString(spec.color)
    paint.specularColor = new Color3(0.35, 0.35, 0.35)
    const accent = new StandardMaterial(`accent-${spec.id}`, scene)
    accent.diffuseColor = Color3.FromHexString(spec.accent)
    const glass = new StandardMaterial(`glass-${spec.id}`, scene)
    glass.diffuseColor = Color3.FromHexString('#c9ecf7')
    glass.specularColor = new Color3(0.8, 0.8, 0.8)
    const tyre = new StandardMaterial(`tyre-${spec.id}`, scene)
    tyre.diffuseColor = new Color3(0.12, 0.12, 0.14)

    const length = spec.length
    const width = 1.0
    const cabFraction = spec.id === 'bus' || spec.id === 'train' ? 0.86 : 0.62

    const cargo = MeshBuilder.CreateBox('cargo', { width: length * 0.56, height: 0.78, depth: width }, scene)
    cargo.position = new Vector3(-length * 0.16, 0.62, 0)
    cargo.material = paint
    cargo.parent = this.body

    const cab = MeshBuilder.CreateBox('cab', { width: length * (1 - cabFraction) + 0.1, height: 0.62, depth: width * 0.94 }, scene)
    cab.position = new Vector3(length * 0.32, 0.52, 0)
    cab.material = paint
    cab.parent = this.body

    const windscreen = MeshBuilder.CreateBox('glass', { width: 0.06, height: 0.32, depth: width * 0.8 }, scene)
    windscreen.position = new Vector3(length * 0.5 + 0.06, 0.62, 0)
    windscreen.material = glass
    windscreen.parent = this.body

    // Two friendly headlights, so the vehicle reads as a character.
    for (const side of [-1, 1]) {
      const lamp = MeshBuilder.CreateSphere(`lamp-${side}`, { diameter: 0.14, segments: 8 }, scene)
      lamp.position = new Vector3(length * 0.5 + 0.08, 0.46, side * 0.26)
      lamp.material = accent
      lamp.parent = this.body
    }

    const wheelGeometry = { diameter: 0.46, height: 0.18, tessellation: 14 }
    for (const side of [-1, 1]) {
      for (const axle of [-1, 1]) {
        const wheel = MeshBuilder.CreateCylinder(`wheel-${side}-${axle}`, wheelGeometry, scene)
        wheel.rotation.x = Math.PI / 2
        wheel.position = new Vector3((axle * this.wheelBase) / 2, 0.23, side * (width / 2 + 0.02))
        wheel.material = tyre
        wheel.parent = this.root
        this.wheels.push(wheel)
      }
    }

    this.root.scaling = new Vector3(0.95, 0.95, 0.95)
  }

  setVisible(value: boolean): void {
    this.root.setEnabled(value)
  }

  /**
   * Place the truck on the deck. `sag` is the downward deflection at its centre,
   * `pitch` the deck slope, and `distance` drives wheel rotation.
   */
  place(x: number, deckY: number, sag: number, pitch: number, z = 0): void {
    // The root origin is the bottom of the tyres, and the deck plank is centred
    // on the structural node line, so add half its thickness to ride on top.
    this.root.position.set(x, deckY - sag + DECK_HALF_THICKNESS, z)
    this.root.rotation.z = Math.max(-0.6, Math.min(0.6, pitch))
    this.bounce += 0.4
    this.body.position.y = Math.sin(this.bounce) * 0.012
  }

  /**
   * Wait on solid ground: level (no tilt, no bounce), before any bridge exists.
   * Without this the buddy would sit wherever the last mode left it.
   */
  park(x: number, groundY: number): void {
    this.root.position.set(x, groundY, 0)
    this.root.rotation.z = 0
    this.body.position.y = 0
  }

  spinWheels(distance: number): void {
    for (const wheel of this.wheels) wheel.rotation.y = distance / 0.23
  }

  fall(dt: number): void {
    this.root.position.y -= dt * 3
  }

  celebrate(t: number): void {
    this.body.rotation.z = Math.sin(t * 9) * 0.12
    this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.09
  }

  get mass(): number {
    return this.spec.mass + this.spec.cargo
  }

  dispose(): void {
    this.root.dispose(false, true)
  }
}

export function waterYFor(level: { rightDeckY: number }): number {
  return Math.min(-2.4, Math.min(0, level.rightDeckY) - 1.6)
}
