import type { Point2, Point3 } from "./types"
import {
  capturePcbFoldResult,
  PcbFoldError,
  type PcbFoldResult,
} from "./fold-result"
import {
  getFiniteBendRegion,
  pointInPolygon,
  polygonContainsPolygon,
  polygonsTouch,
} from "./finite-bend-region"
/** Circuit JSON bend geometry, board-local +Z up, millimeters. */
export interface PcbBendRecord {
  type: "pcb_bend"
  pcb_bend_id: string
  pcb_board_id: string
  name?: string
  pcb_group_id?: string
  subcircuit_id?: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  bend_angle: number
  bend_radius: number
  bend_side: "left" | "right"
}

interface Bend {
  id: string
  nx: number
  ny: number
  start: number
  end: number
  angle: number
  radius: number
  axisMin: number
  axisMax: number
  movingOutline?: readonly Point2[]
}
const EPS = 1e-7

/** Points/directions in board-local Circuit JSON: +Z up, mm. */
export interface PcbFold {
  bends: Bend[]
  point(point: Point3, flatAnchor?: Point3): Point3
  inversePoint(point: Point3, flatAnchor: Point3): Point3
  inverseDirection(direction: Point3, flatAnchor: Point3): Point3
  direction(direction: Point3, flatAnchor: Point3): Point3
  assertRigid(points: Point3[], label: string): void
}

export interface PcbFoldOptions {
  /** Simple board outline, board-local XY in millimeters. Enables finite chords. */
  outline?: readonly Point2[]
}

/** Order board-local bends (+Z up, mm) from parent to child. A finite moving
 * region may be independent or nested wholly beyond a parent's curved strip.
 * Child folds then occur first and are carried rigidly by their parent folds.
 */
function orderPcbBends(bends: Bend[]): Bend[] {
  const sorted = [...bends].sort(
    (a, b) =>
      a.start - b.start ||
      a.nx - b.nx ||
      a.ny - b.ny ||
      a.id.localeCompare(b.id),
  )
  const parents = new Map<Bend, Bend[]>()
  const overlap = (bend: Bend): never => {
    throw new PcbFoldError({
      code: "overlapping_bend_zones",
      message:
        "Overlapping PCB bend zones or incompatible moving regions are not supported",
      bendId: bend.id,
    })
  }
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!,
        b = sorted[j]!
      if (a.movingOutline && b.movingOutline) {
        if (!polygonsTouch(a.movingOutline, b.movingOutline)) continue
        const aContainsB = polygonContainsPolygon(
          a.movingOutline,
          b.movingOutline,
        )
        const bContainsA = polygonContainsPolygon(
          b.movingOutline,
          a.movingOutline,
        )
        if (aContainsB === bContainsA) overlap(b)
        const parent = aContainsB ? a : b,
          child = aContainsB ? b : a
        if (
          child.movingOutline!.some(
            (p) => p.x * parent.nx + p.y * parent.ny < parent.end - EPS,
          )
        )
          overlap(child)
        parents.set(child, [...(parents.get(child) ?? []), parent])
      } else {
        // Without an outline, preserve the legacy infinite-line fold chain.
        if (Math.abs(a.nx - b.nx) > EPS || Math.abs(a.ny - b.ny) > EPS)
          throw new PcbFoldError({
            code: "nonparallel_bends",
            message:
              "Nonparallel PCB bends or bends with opposite moving directions require a board outline to resolve their moving regions",
          })
        if (b.start < a.end - EPS) overlap(b)
        parents.set(b, [...(parents.get(b) ?? []), a])
      }
    }
  const ordered: Bend[] = [],
    visited = new Set<Bend>()
  const visit = (bend: Bend) => {
    if (visited.has(bend)) return
    for (const parent of parents.get(bend) ?? []) visit(parent)
    visited.add(bend)
    ordered.push(bend)
  }
  for (const bend of sorted) visit(bend)
  return ordered
}

/** Independent finite regions and rigidly nested regions can bend about any axis.
 * Input endpoints and returned transforms are board-local Circuit JSON (+Z up, mm).
 * Ordering comes from region containment, never from Circuit JSON array order.
 * Without a board outline, bends must remain parallel with one moving direction.
 */
export function createPcbFold(
  records: PcbBendRecord[],
  thickness: number,
  { outline }: PcbFoldOptions = {},
): PcbFold {
  if (!Number.isFinite(thickness) || thickness < 0)
    throw new Error("Board thickness must be finite and nonnegative")
  if (
    outline &&
    (outline.length < 3 ||
      outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  )
    throw new Error(
      "A finite board outline with at least three points is required",
    )
  const bends: Bend[] = records
    .map((b) => {
      const { start, end, bend_angle: degrees, bend_radius: radius } = b
      const values = [start?.x, start?.y, end?.x, end?.y, degrees, radius]
      if (
        values.some((v) => !Number.isFinite(v)) ||
        radius <= thickness / 2 ||
        !["left", "right"].includes(b.bend_side)
      ) {
        throw new PcbFoldError({
          code: "invalid_bend_geometry",
          message: `Invalid PCB bend ${b.pcb_bend_id}: finite geometry and radius greater than half the board thickness are required`,
          bendId: b.pcb_bend_id,
        })
      }
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length < EPS || Math.abs(degrees) > 180)
        throw new PcbFoldError({
          code: "unsupported_bend_geometry",
          message: `Unsupported PCB bend ${b.pcb_bend_id}: distinct endpoints and angles within ±180 degrees are required`,
          bendId: b.pcb_bend_id,
        })
      const sign = b.bend_side === "right" ? 1 : -1
      const nx = (sign * (end.y - start.y)) / length
      const ny = (-sign * (end.x - start.x)) / length
      const angle = (degrees * Math.PI) / 180
      const width = radius * Math.abs(angle)
      const center = start.x * nx + start.y * ny
      const geometry: Bend = {
        id: b.pcb_bend_id,
        nx,
        ny,
        start: center - width / 2,
        end: center + width / 2,
        angle,
        radius,
        axisMin: Math.min(
          -ny * start.x + nx * start.y,
          -ny * end.x + nx * end.y,
        ),
        axisMax: Math.max(
          -ny * start.x + nx * start.y,
          -ny * end.x + nx * end.y,
        ),
      }
      if (outline && Math.abs(angle) > EPS)
        geometry.movingOutline = getFiniteBendRegion({
          bendId: b.pcb_bend_id,
          outline,
          nx,
          ny,
          center,
          proximal: geometry.start,
          axisMin: geometry.axisMin,
          axisMax: geometry.axisMax,
        })
      return geometry
    })
    .filter((b) => Math.abs(b.angle) > EPS)
  const proximalFirst = orderPcbBends(bends)
  const distalFirst = [...proximalFirst].reverse()
  const transform = ({
    p,
    anchor,
    direction,
  }: {
    p: Point3
    anchor: Point3
    direction: boolean
  }): Point3 => {
    let result = { ...p }
    // Fold distal regions first, then carry them with each proximal fold.
    for (const b of distalFirst) {
      if (b.movingOutline && !pointInPolygon(anchor, b.movingOutline)) continue
      const width = b.end - b.start
      const s = anchor.x * b.nx + anchor.y * b.ny - b.start
      const q = Math.max(0, Math.min(width, s))
      const theta = (b.angle * q) / width
      const cos = Math.cos(theta),
        sin = Math.sin(theta)
      const projected =
        result.x * b.nx + result.y * b.ny - (direction ? 0 : b.start)
      const tangentX = result.x - (projected + (direction ? 0 : b.start)) * b.nx
      const tangentY = result.y - (projected + (direction ? 0 : b.start)) * b.ny
      const signedRadius = Math.sign(b.angle) * b.radius
      const tx = direction ? 0 : signedRadius * sin - q * cos
      const tz = direction ? 0 : signedRadius * (1 - cos) - q * sin
      const folded = projected * cos - result.z * sin + tx
      result = {
        x: tangentX + (folded + (direction ? 0 : b.start)) * b.nx,
        y: tangentY + (folded + (direction ? 0 : b.start)) * b.ny,
        z: projected * sin + result.z * cos + tz,
      }
    }
    return result
  }
  // For a fixed flat mount this is an affine rigid transform R*p + t.
  // Its inverse is R^T*(p-t), even when different folded regions overlap.
  const inverse = ({
    p,
    anchor,
    direction,
  }: {
    p: Point3
    anchor: Point3
    direction: boolean
  }): Point3 => {
    const origin = direction
      ? { x: 0, y: 0, z: 0 }
      : transform({
          p: { x: 0, y: 0, z: 0 },
          anchor: anchor,
          direction: false,
        })
    const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }
    const axes = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ].map((v) => transform({ p: v, anchor: anchor, direction: true }))
    const dot = (v: Point3) => v.x * d.x + v.y * d.y + v.z * d.z
    return { x: dot(axes[0]!), y: dot(axes[1]!), z: dot(axes[2]!) }
  }
  return {
    bends: proximalFirst,
    inversePoint: (p, anchor) =>
      inverse({ p: p, anchor: anchor, direction: false }),
    inverseDirection: (p, anchor) =>
      inverse({ p: p, anchor: anchor, direction: true }),
    point: (p, anchor = p) =>
      transform({ p: p, anchor: anchor, direction: false }),
    direction: (p, anchor) =>
      transform({ p: p, anchor: anchor, direction: true }),
    assertRigid(points, label) {
      for (const b of bends) {
        const width = b.end - b.start
        const progress = points.map((p) =>
          b.movingOutline && !pointInPolygon(p, b.movingOutline)
            ? 0
            : Math.max(0, Math.min(width, p.x * b.nx + p.y * b.ny - b.start)),
        )
        if (Math.max(...progress) > EPS && Math.min(...progress) < width - EPS)
          throw new PcbFoldError({
            code: "rigid_bend_zone_intersection",
            message: `${label} intersects PCB bend zone ${b.id}`,
            bendId: b.id,
          })
      }
    },
  }
}

/** Construct a board-local (+Z up, mm) fold, reporting expected folding
 * limitations as data. Malformed board geometry and unexpected errors throw.
 */
export function tryCreatePcbFold(
  records: PcbBendRecord[],
  thickness: number,
  options: PcbFoldOptions = {},
): PcbFoldResult<PcbFold> {
  return capturePcbFoldResult(() => createPcbFold(records, thickness, options))
}
