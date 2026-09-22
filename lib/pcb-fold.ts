import type { Point3 } from "./types"
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

/** Parallel bends with the same moving direction form an ordered fold chain.
 * Input endpoints and returned transforms are board-local Circuit JSON (+Z up, mm).
 * Ordering comes from geometry, never from Circuit JSON array order.
 */
export function createPcbFold(
  records: PcbBendRecord[],
  thickness: number,
): PcbFold {
  if (!Number.isFinite(thickness) || thickness < 0)
    throw new Error("Board thickness must be finite and nonnegative")
  const bends: Bend[] = records
    .map((b) => {
      const { start, end, bend_angle: degrees, bend_radius: radius } = b
      const values = [start?.x, start?.y, end?.x, end?.y, degrees, radius]
      if (
        values.some((v) => !Number.isFinite(v)) ||
        radius <= thickness / 2 ||
        !["left", "right"].includes(b.bend_side)
      ) {
        throw new Error(
          `Invalid PCB bend ${b.pcb_bend_id}: finite geometry and radius greater than half the board thickness are required`,
        )
      }
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length < EPS || Math.abs(degrees) > 180)
        throw new Error(
          `Unsupported PCB bend ${b.pcb_bend_id}: distinct endpoints and angles within ±180 degrees are required`,
        )
      const sign = b.bend_side === "right" ? 1 : -1
      const nx = (sign * (end.y - start.y)) / length
      const ny = (-sign * (end.x - start.x)) / length
      const angle = (degrees * Math.PI) / 180
      const width = radius * Math.abs(angle)
      const center = start.x * nx + start.y * ny
      return {
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
    })
    .filter((b) => Math.abs(b.angle) > EPS)
  const first = bends[0]
  if (
    first &&
    bends.some(
      (b) => Math.abs(b.nx - first.nx) > EPS || Math.abs(b.ny - first.ny) > EPS,
    )
  ) {
    throw new Error(
      "Folded PCB rendering currently requires parallel bends with the same moving direction",
    )
  }
  bends.sort((a, b) => a.start - b.start)
  for (let i = 1; i < bends.length; i++) {
    if (bends[i]!.start < bends[i - 1]!.end - EPS)
      throw new Error("Overlapping PCB bend zones are not supported")
  }
  const distalFirst = [...bends].reverse()
  const transform = (p: Point3, anchor: Point3, direction: boolean): Point3 => {
    let result = { ...p }
    // Fold distal regions first, then carry them with each proximal fold.
    for (const b of distalFirst) {
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
  const inverse = (p: Point3, anchor: Point3, direction: boolean): Point3 => {
    const origin = direction
      ? { x: 0, y: 0, z: 0 }
      : transform({ x: 0, y: 0, z: 0 }, anchor, false)
    const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }
    const axes = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ].map((v) => transform(v, anchor, true))
    const dot = (v: Point3) => v.x * d.x + v.y * d.y + v.z * d.z
    return { x: dot(axes[0]!), y: dot(axes[1]!), z: dot(axes[2]!) }
  }
  return {
    bends,
    inversePoint: (p, anchor) => inverse(p, anchor, false),
    inverseDirection: (p, anchor) => inverse(p, anchor, true),
    point: (p, anchor = p) => transform(p, anchor, false),
    direction: (p, anchor) => transform(p, anchor, true),
    assertRigid(points, label) {
      for (const b of bends) {
        const ds = points.map((p) => p.x * b.nx + p.y * b.ny)
        if (Math.max(...ds) > b.start + EPS && Math.min(...ds) < b.end - EPS)
          throw new Error(`${label} intersects PCB bend zone ${b.id}`)
      }
    },
  }
}
