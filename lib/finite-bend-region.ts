import type { Point2 } from "./types"

const EPS = 1e-7
type BoundaryCrossing = { point: Point2; edge: number; fraction: number }
const samePoint = (a: Point2, b: Point2) =>
  Math.hypot(a.x - b.x, a.y - b.y) < EPS

/** Includes boundary points. Input points are board-local XY in millimeters. */
export function pointInPolygon(
  point: Point2,
  polygon: readonly Point2[],
  includeBoundary = true,
) {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)
    if (
      Math.abs(cross) < EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) &&
      point.x >= Math.min(a.x, b.x) - EPS &&
      point.x <= Math.max(a.x, b.x) + EPS &&
      point.y >= Math.min(a.y, b.y) - EPS &&
      point.y <= Math.max(a.y, b.y) + EPS
    )
      return includeBoundary
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      inside = !inside
  }
  return inside
}

function lineCrossings(
  outline: readonly Point2[],
  nx: number,
  ny: number,
  d: number,
) {
  const crossings: BoundaryCrossing[] = []
  for (let edge = 0; edge < outline.length; edge++) {
    const a = outline[edge]!,
      b = outline[(edge + 1) % outline.length]!
    const da = a.x * nx + a.y * ny - d,
      db = b.x * nx + b.y * ny - d
    if (Math.abs(da) < EPS && Math.abs(db) < EPS) continue
    if ((da > EPS && db > EPS) || (da < -EPS && db < -EPS)) continue
    if (Math.abs(da - db) < EPS) continue
    const fraction = Math.max(0, Math.min(1, da / (da - db)))
    const point = {
      x: a.x + (b.x - a.x) * fraction,
      y: a.y + (b.y - a.y) * fraction,
    }
    if (crossings.some((crossing) => samePoint(crossing.point, point))) continue
    crossings.push(
      fraction > 1 - EPS
        ? { point: b, edge: (edge + 1) % outline.length, fraction: 0 }
        : { point, edge, fraction },
    )
  }
  return crossings.sort(
    (a, b) =>
      -ny * a.point.x + nx * a.point.y - (-ny * b.point.x + nx * b.point.y),
  )
}

function movingPolygon(
  outline: readonly Point2[],
  a: BoundaryCrossing,
  b: BoundaryCrossing,
  nx: number,
  ny: number,
) {
  const polygon: Point2[] = []
  for (let edge = 0; edge < outline.length; edge++) {
    polygon.push(outline[edge]!)
    for (const crossing of [a, b]
      .filter((c) => c.edge === edge)
      .sort((a, b) => a.fraction - b.fraction))
      if (crossing.fraction > EPS) polygon.push(crossing.point)
  }
  const start = polygon.findIndex((p) => samePoint(p, a.point))
  const end = polygon.findIndex((p) => samePoint(p, b.point))
  if (start < 0 || end < 0)
    throw new Error("Cannot resolve PCB bend boundary crossings")
  const path = (from: number, to: number) => {
    const points = [polygon[from]!]
    while (from !== to) {
      from = (from + 1) % polygon.length
      points.push(polygon[from]!)
    }
    return points
  }
  const area = outline.reduce((sum, p, i) => {
    const next = outline[(i + 1) % outline.length]!
    return sum + p.x * next.y - next.x * p.y
  }, 0)
  // The closing edge b->a has its interior on the left for a CCW outline.
  const side =
    Math.sign(area) *
    ((b.point.y - a.point.y) * nx - (b.point.x - a.point.x) * ny)
  return side > 0 ? path(start, end) : path(end, start)
}

/** Select the portion cut off by one finite bend chord, including the proximal
 * half of its curved strip. Outline and endpoints are board-local XY, +Z up, mm.
 * Simple outlines with one connected cross-section through the bend are supported.
 */
export function getFiniteBendRegion({
  outline,
  nx,
  ny,
  center,
  proximal,
  axisMin,
  axisMax,
}: {
  outline: readonly Point2[]
  nx: number
  ny: number
  center: number
  proximal: number
  axisMin: number
  axisMax: number
}): Point2[] {
  const finiteCrossings = lineCrossings(outline, nx, ny, center).filter(
    ({ point }) => {
      const along = -ny * point.x + nx * point.y
      return along >= axisMin - EPS && along <= axisMax + EPS
    },
  )
  if (finiteCrossings.length !== 2)
    throw new Error(
      "A finite PCB bend must cut one board cross-section from boundary to boundary",
    )
  const [a, b] = finiteCrossings as [BoundaryCrossing, BoundaryCrossing]
  const middle = {
    x: (a.point.x + b.point.x) / 2,
    y: (a.point.y + b.point.y) / 2,
  }
  if (!pointInPolygon(middle, outline, false))
    throw new Error("A finite PCB bend must pass through the board interior")
  const centerRegion = movingPolygon(outline, a, b, nx, ny)
  const alongMiddle = -ny * middle.x + nx * middle.y
  const proximalCrossings = lineCrossings(outline, nx, ny, proximal)
  for (let i = 0; i + 1 < proximalCrossings.length; i++) {
    const left = proximalCrossings[i]!,
      right = proximalCrossings[i + 1]!
    const lo = -ny * left.point.x + nx * left.point.y
    const hi = -ny * right.point.x + nx * right.point.y
    if (alongMiddle <= lo + EPS || alongMiddle >= hi - EPS) continue
    const midpoint = {
      x: (left.point.x + right.point.x) / 2,
      y: (left.point.y + right.point.y) / 2,
    }
    if (!pointInPolygon(midpoint, outline, false)) continue
    const region = movingPolygon(outline, left, right, nx, ny)
    if (
      region.some((p) => p.x * nx + p.y * ny < proximal - EPS) ||
      centerRegion.some((p) => !pointInPolygon(p, region)) ||
      region.some(
        (p) =>
          p.x * nx + p.y * ny >= center - EPS &&
          !pointInPolygon(p, centerRegion),
      )
    )
      break
    return region
  }
  throw new Error(
    "The finite PCB bend zone must remain in one connected board cross-section",
  )
}

export function polygonsTouch(a: readonly Point2[], b: readonly Point2[]) {
  if (
    a.some((p) => pointInPolygon(p, b)) ||
    b.some((p) => pointInPolygon(p, a))
  )
    return true
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i]!,
        q = a[(i + 1) % a.length]!,
        r = b[j]!,
        s = b[(j + 1) % b.length]!
      if (
        cross(p, q, r) * cross(p, q, s) < -EPS &&
        cross(r, s, p) * cross(r, s, q) < -EPS
      )
        return true
    }
  return false
}
