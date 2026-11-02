import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { BridgeDesign, DesignMember, Vec2 } from '../core/types'
import { MATERIALS } from '../structural/materials'
import type { AnalyzeResult } from '../core/types'

const HALF_WIDTH = 0.52

export interface DebrisPiece {
  mesh: Mesh
  velocity: Vector3
  spin: Vector3
  life: number
  inWater: boolean
}

/**
 * Renders the bridge as a pair of side trusses with cross-ties, so the model has
 * real depth even though the structural solve happens in one vertical plane
 * (the deck is a matched pair, each carrying half the vehicle — see STRUCTURAL.md).
 */
export class BridgeView {
  private scene: Scene
  private root: TransformNode
  private memberMeshes = new Map<string, Mesh[]>()
  private jointMeshes = new Map<string, Mesh>()
  private materials = new Map<string, StandardMaterial>()
  private stressMaterials: StandardMaterial[] = []
  private jointsRoot: TransformNode
  private membersRoot: TransformNode
  private debris: DebrisPiece[] = []
  private debrisRoot: TransformNode
  private stressOn = false
  private lengths = new Map<string, number>()

  constructor(scene: Scene) {
    this.scene = scene
    this.root = new TransformNode('bridge', scene)
    this.jointsRoot = new TransformNode('joints', scene)
    this.jointsRoot.parent = this.root
    this.membersRoot = new TransformNode('members', scene)
    this.membersRoot.parent = this.root
    this.debrisRoot = new TransformNode('debris', scene)

    const gradient = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']
    this.stressMaterials = gradient.map((hex) => {
      const mat = new StandardMaterial(`stress-${hex}`, scene)
      mat.diffuseColor = Color3.FromHexString(hex)
      mat.emissiveColor = Color3.FromHexString(hex).scale(0.35)
      mat.specularColor = new Color3(0.2, 0.2, 0.2)
      return mat
    })
  }

  private materialFor(id: string): StandardMaterial {
    const cached = this.materials.get(id)
    if (cached) return cached
    const spec = MATERIALS[id as keyof typeof MATERIALS]
    const mat = new StandardMaterial(`mat-${id}`, this.scene)
    mat.diffuseColor = Color3.FromHexString(spec.color)
    mat.specularColor = new Color3(0.18, 0.18, 0.18)
    mat.emissiveColor = Color3.FromHexString(spec.accent).scale(0.06)
    this.materials.set(id, mat)
    return mat
  }

  clear(): void {
    for (const meshes of this.memberMeshes.values()) for (const mesh of meshes) mesh.dispose()
    for (const mesh of this.jointMeshes.values()) mesh.dispose()
    this.memberMeshes.clear()
    this.jointMeshes.clear()
    for (const piece of this.debris) piece.mesh.dispose()
    this.debris = []
  }

  /** Re-create geometry for a design. Cheap enough to call on every edit. */
  rebuild(design: BridgeDesign, level: { anchors: { x: number; y: number }[] }): void {
    this.clear()
    void level

    for (const node of design.nodes) {
      const size = node.anchor ? 0.34 : 0.18
      const joint = MeshBuilder.CreateSphere(`joint-${node.id}`, { diameter: size, segments: 8 }, this.scene)
      joint.position = new Vector3(node.x, node.y, 0)
      joint.material = this.materialFor('steel')
      joint.parent = this.jointsRoot
      joint.isPickable = false
      this.jointMeshes.set(node.id, joint)
    }

    for (const member of design.members) this.createMember(design, member)
    this.applyDeformation(design, null)
  }

  private createMember(design: BridgeDesign, member: DesignMember): void {
    const a = design.nodes.find((node) => node.id === member.a)
    const b = design.nodes.find((node) => node.id === member.b)
    if (!a || !b) return
    const spec = MATERIALS[member.material]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 1e-4) return
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const meshes: Mesh[] = []

    if (member.kind === 'deck') {
      const plank = MeshBuilder.CreateBox(
        `deck-${member.id}`,
        { width: length, height: 0.14, depth: HALF_WIDTH * 2 + 0.16 },
        this.scene,
      )
      plank.material = this.materialFor(member.material)
      plank.parent = this.membersRoot
      plank.isPickable = true
      plank.metadata = { memberId: member.id }
      meshes.push(plank)
    } else {
      const thickness = member.kind === 'cable' ? 0.05 : Math.min(0.2, spec.width)
      for (const side of [-1, 1]) {
        const beam = MeshBuilder.CreateBox(
          `beam-${member.id}-${side}`,
          { width: length, height: thickness, depth: thickness },
          this.scene,
        )
        beam.material = this.materialFor(member.material)
        beam.parent = this.membersRoot
        beam.isPickable = true
        beam.metadata = { memberId: member.id }
        beam.position.z = side * HALF_WIDTH
        beam.rotation.z = angle
        meshes.push(beam)
      }
      // Cross-tie so the pair reads as one 3D structure.
      const tie = MeshBuilder.CreateBox(
        `tie-${member.id}`,
        { width: 0.07, height: 0.07, depth: HALF_WIDTH * 2 },
        this.scene,
      )
      tie.material = this.materialFor(member.material)
      tie.parent = this.membersRoot
      tie.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0)
      tie.rotation.z = angle
      meshes.push(tie)
    }

    meshes[0].position.x = (a.x + b.x) / 2
    meshes[0].position.y = (a.y + b.y) / 2
    if (meshes.length > 1) {
      meshes[0].rotation.z = angle
    }
    this.memberMeshes.set(member.id, meshes)
    this.lengths.set(member.id, length)
    this.updateMemberTransform(member.id, design, null)
  }

  /** Move every member to the deflected node positions. */
  applyDeformation(design: BridgeDesign, deflections: Map<string, Vec2> | null): void {
    for (const member of design.members) this.updateMemberTransform(member.id, design, deflections)
    for (const node of design.nodes) {
      const mesh = this.jointMeshes.get(node.id)
      if (!mesh) continue
      const offset = deflections?.get(node.id)
      mesh.position.x = node.x + (offset?.x ?? 0)
      mesh.position.y = node.y + (offset?.y ?? 0)
    }
  }

  private updateMemberTransform(
    memberId: string,
    design: BridgeDesign,
    deflections: Map<string, Vec2> | null,
  ): void {
    const member = design.members.find((candidate) => candidate.id === memberId)
    const meshes = this.memberMeshes.get(memberId)
    if (!member || !meshes) return
    const a = design.nodes.find((node) => node.id === member.a)
    const b = design.nodes.find((node) => node.id === member.b)
    if (!a || !b) return
    const da = deflections?.get(a.id)
    const db = deflections?.get(b.id)
    const ax = a.x + (da?.x ?? 0)
    const ay = a.y + (da?.y ?? 0)
    const bx = b.x + (db?.x ?? 0)
    const by = b.y + (db?.y ?? 0)
    const angle = Math.atan2(by - ay, bx - ax)
    const length = Math.hypot(bx - ax, by - ay)

    const original = this.lengths.get(memberId) ?? length
    const stretch = Math.max(0.2, length / Math.max(1e-6, original))
    if (member.kind === 'deck') {
      const mesh = meshes[0]
      mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0)
      mesh.rotation.z = angle
      mesh.scaling.x = stretch
    } else {
      for (let i = 0; i < 2; i++) {
        const mesh = meshes[i]
        if (!mesh) continue
        mesh.position.x = (ax + bx) / 2
        mesh.position.y = (ay + by) / 2
        mesh.rotation.z = angle
        mesh.scaling.x = stretch
      }
      const tie = meshes[2]
      if (tie) {
        tie.position.set((ax + bx) / 2, (ay + by) / 2, 0)
        tie.rotation.z = angle
      }
    }
  }

  /** Colour members by utilisation, or restore their material colours. */
  showStress(result: AnalyzeResult | null): void {
    this.stressOn = result !== null
    for (const [memberId, meshes] of this.memberMeshes) {
      if (!result) {
        const member = this.lastDesign?.members.find((c) => c.id === memberId)
        for (const mesh of meshes) mesh.material = this.materialFor(member?.material ?? 'wood')
        continue
      }
      const entry = result.members.get(memberId)
      const util = entry?.utilization ?? 0
      // A healthy truss sits near 50%, so green has to mean "working normally";
      // blue is reserved for members that are barely loaded at all.
      const index = util < 0.2 ? 0 : util < 0.55 ? 1 : util < 0.75 ? 2 : util < 0.95 ? 3 : 4
      for (const mesh of meshes) mesh.material = this.stressMaterials[index]
    }
  }

  private lastDesign: BridgeDesign | null = null

  setDesign(design: BridgeDesign): void {
    this.lastDesign = design
  }

  /** Snap a member and throw its pieces into the river. */
  breakMember(design: BridgeDesign, memberId: string): void {
    const meshes = this.memberMeshes.get(memberId)
    const member = design.members.find((candidate) => candidate.id === memberId)
    if (!meshes || !member) return
    for (const mesh of meshes) {
      mesh.isVisible = false
      const clone = mesh.clone(`debris-${mesh.name}-${Math.random().toString(36).slice(2, 6)}`)
      if (!clone) continue
      clone.isVisible = true
      clone.setParent(this.debrisRoot)
      clone.isPickable = false
      this.debris.push({
        mesh: clone,
        velocity: new Vector3((Math.random() - 0.5) * 2.4, -1 - Math.random(), (Math.random() - 0.5) * 1.6),
        spin: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 4),
        life: 5.5,
        inWater: false,
      })
    }
    this.memberMeshes.delete(memberId)
  }

  updateDebris(dt: number, waterY: number): number {
    let splashes = 0
    for (const piece of this.debris) {
      piece.life -= dt
      if (piece.life <= 0) {
        piece.mesh.dispose()
        continue
      }
      if (!piece.inWater) {
        piece.velocity.y -= 9.81 * dt
        piece.mesh.position.addInPlace(piece.velocity.scale(dt))
        piece.mesh.rotation.x += piece.spin.x * dt
        piece.mesh.rotation.y += piece.spin.y * dt
        piece.mesh.rotation.z += piece.spin.z * dt
        if (piece.mesh.position.y < waterY) {
          piece.inWater = true
          piece.velocity.scaleInPlace(0.12)
          piece.velocity.y = 0
          piece.spin.scaleInPlace(0.1)
          splashes += 1
        }
      } else {
        // Bob on the surface and drift downstream.
        piece.mesh.position.y += (waterY - piece.mesh.position.y) * Math.min(1, dt * 4)
        piece.mesh.position.x += dt * 0.35
        piece.mesh.rotation.x += piece.spin.x * dt * 0.3
      }
    }
    this.debris = this.debris.filter((piece) => piece.life > 0)
    return splashes
  }

  clearDebris(): void {
    for (const piece of this.debris) piece.mesh.dispose()
    this.debris = []
  }

  get stressVisible(): boolean {
    return this.stressOn
  }
}
