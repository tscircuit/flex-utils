import type { AnyCircuitElement, CadComponent, PcbBoard } from "circuit-json"
import { createPcbFold, type PcbBendRecord, type PcbFold } from "./pcb-fold"
import type { Point3 } from "./types"

export type CadComponentWithFoldState = CadComponent & {
  is_on_folded_board?: boolean
}
const axes: Point3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
]

/** Right-handed intrinsic XYZ Euler angles in degrees, matching the viewer's
 * THREE.Euler(..., "XYZ"). Vectors apply Z, then Y, then X. */
export function rotateVector(v: Point3, degrees: Point3): Point3 {
  const [x, y, z] = [degrees.x, degrees.y, degrees.z].map(
    (a) => (a * Math.PI) / 180,
  ) as [number, number, number]
  const a = {
    x: Math.cos(z) * v.x - Math.sin(z) * v.y,
    y: Math.sin(z) * v.x + Math.cos(z) * v.y,
    z: v.z,
  }
  const b = {
    x: Math.cos(y) * a.x + Math.sin(y) * a.z,
    y: a.y,
    z: -Math.sin(y) * a.x + Math.cos(y) * a.z,
  }
  return {
    x: b.x,
    y: Math.cos(x) * b.y - Math.sin(x) * b.z,
    z: Math.sin(x) * b.y + Math.cos(x) * b.z,
  }
}
function rotationFromAxes([a, b, c]: Point3[]): Point3 {
  const y = Math.asin(Math.max(-1, Math.min(1, c!.x)))
  const regular = Math.abs(c!.x) < 1 - 1e-12
  return {
    x:
      ((regular ? Math.atan2(-c!.y, c!.z) : Math.atan2(b!.z, b!.y)) * 180) /
      Math.PI,
    y: (y * 180) / Math.PI,
    z: ((regular ? Math.atan2(-b!.x, a!.x) : 0) * 180) / Math.PI,
  }
}
export interface CadFoldContext {
  fold: PcbFold
  boardCenter: { x: number; y: number }
  /** Flat PCB mount, in global Circuit JSON XY. Never derive it from folded CAD. */
  flatMount: { x: number; y: number }
  defaultRotation?: Point3
}

export type CadComponentPlacement = Pick<
  CadComponentWithFoldState,
  "position" | "rotation" | "is_on_folded_board"
>

/** Pure, idempotent CAD component placement conversion. Position is global Circuit JSON +Z-up
 * millimeters; rotation is XYZ degrees. Model-origin/scale/normal fields stay
 * model-local. The PCB mount selects the inverse when assembled regions overlap.
 */
export function transformCadComponent<T extends CadComponentWithFoldState>(
  { cadComponent, foldPcbs }: { cadComponent: T; foldPcbs: boolean },
  context: CadFoldContext,
): T {
  return transformCadComponentPlacement(
    { cadComponentPlacement: cadComponent, foldPcbs },
    context,
  )
}

/** Transform a CAD component placement before a circuit-json record/id exists. Coordinates
 * and rotations use the same world-space convention as transformCadComponent.
 */
export function transformCadComponentPlacement<T extends CadComponentPlacement>(
  {
    cadComponentPlacement,
    foldPcbs,
  }: { cadComponentPlacement: T; foldPcbs: boolean },
  context: CadFoldContext,
): T {
  if ((cadComponentPlacement.is_on_folded_board === true) === foldPcbs)
    return cadComponentPlacement
  const { fold, boardCenter, flatMount } = context
  const anchor = {
    x: flatMount.x - boardCenter.x,
    y: flatMount.y - boardCenter.y,
    z: 0,
  }
  fold.assertRigid([anchor], "CAD mount")
  const point = {
    x: cadComponentPlacement.position.x - boardCenter.x,
    y: cadComponentPlacement.position.y - boardCenter.y,
    z: cadComponentPlacement.position.z,
  }
  const direction = foldPcbs ? fold.direction : fold.inverseDirection
  const transformed = foldPcbs
    ? fold.point(point, anchor)
    : fold.inversePoint(point, anchor)
  const rotation = cadComponentPlacement.rotation ??
    context.defaultRotation ?? { x: 0, y: 0, z: 0 }
  const basis = axes.map((v) => direction(rotateVector(v, rotation), anchor))
  return {
    ...cadComponentPlacement,
    position: {
      x: transformed.x + boardCenter.x,
      y: transformed.y + boardCenter.y,
      z: transformed.z,
    },
    rotation: rotationFromAxes(basis),
    is_on_folded_board: foldPcbs,
  }
}

/** Resolve an explicit board reference, then subcircuit ownership. An ambiguous
 * multi-board association fails rather than guessing from folded coordinates. */
export function getCadFoldContext(
  cadComponent: CadComponentWithFoldState,
  json: AnyCircuitElement[],
): CadFoldContext | undefined {
  const pcb = json.find(
    (e) =>
      e.type === "pcb_component" &&
      e.pcb_component_id === cadComponent.pcb_component_id,
  )
  if (pcb?.type !== "pcb_component") {
    if (cadComponent.is_on_folded_board)
      throw new Error(
        `Folded CAD ${cadComponent.cad_component_id} requires its flat pcb_component reference`,
      )
    return undefined
  }
  const boards = json.filter((e): e is PcbBoard => e.type === "pcb_board")
  const explicit = pcb.positioned_relative_to_pcb_board_id
  const matching = explicit
    ? boards.filter((b) => b.pcb_board_id === explicit)
    : boards.filter(
        (b) => b.subcircuit_id && b.subcircuit_id === pcb.subcircuit_id,
      )
  const board =
    matching.length === 1
      ? matching[0]
      : !explicit && !matching.length && boards.length === 1
        ? boards[0]
        : undefined
  if (!board)
    throw new Error(
      `Cannot unambiguously resolve board for CAD ${cadComponent.cad_component_id}`,
    )
  const bends = json.filter(
    (e): e is PcbBendRecord =>
      e.type === "pcb_bend" && e.pcb_board_id === board.pcb_board_id,
  )
  return {
    fold: createPcbFold(bends, board.thickness ?? 1.6),
    boardCenter: board.center,
    flatMount: pcb.center,
    defaultRotation: {
      x: (cadComponent.layer ?? pcb.layer) === "bottom" ? 180 : 0,
      y: 0,
      z: 0,
    },
  }
}

/** Transform CAD records only; PCB traces/components, bends, stiffeners, source
 * records and the caller's input array are left untouched. Mixed flat/folded CAD
 * is normalized record-by-record, so repeated calls cannot double-fold a placement. */
export function transformCircuitJsonCadComponents<T extends AnyCircuitElement>(
  json: T[],
  options: { foldPcbs: boolean },
): T[] {
  const hasBends = json.some((element) => element.type === "pcb_bend")
  return json.map((element) => {
    if (element.type !== "cad_component") return element
    const cadComponent = element as CadComponentWithFoldState
    if (!hasBends && !cadComponent.is_on_folded_board) return element
    if ((cadComponent.is_on_folded_board === true) === options.foldPcbs)
      return element
    const context = getCadFoldContext(cadComponent, json)
    if (
      !context ||
      (!context.fold.bends.length && !cadComponent.is_on_folded_board)
    )
      return element
    return transformCadComponent(
      { cadComponent: cadComponent, foldPcbs: options.foldPcbs },
      context,
    ) as T
  })
}
