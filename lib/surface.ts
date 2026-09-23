import type { Point3, Triangle, SurfaceMesh } from "./types"
import type { PcbFold } from "./pcb-fold"
const EPS = 1e-7
export function boundsOfTriangles(triangles: Triangle[]) {
  const points = triangles.flatMap((t) => t.vertices)
  if (!points.length)
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of points)
    for (const key of ["x", "y", "z"] as const) {
      min[key] = Math.min(min[key], p[key])
      max[key] = Math.max(max[key], p[key])
    }
  return { min, max }
}
/** Tessellate at tangencies and <=5 degree arc steps, then deform in board-local
 * Circuit JSON (+Z up, mm). Preserve flat UVs, face labels and triangle metadata.
 */
export function foldSurfaceMesh<T extends SurfaceMesh>(
  mesh: T,
  fold: PcbFold,
): T {
  const planes = fold.bends.flatMap((b) => {
    const steps = Math.ceil(Math.abs(b.angle) / (Math.PI / 36))
    return Array.from({ length: steps + 1 }, (_, i) => ({
      b,
      d: b.start + ((b.end - b.start) * i) / steps,
    }))
  })
  const { min, max } = mesh.boundingBox
  type Vertex = { p: Point3; uv: { u: number; v: number } }
  const split = ({
    polygon,
    nx,
    ny,
    d,
  }: {
    polygon: Vertex[]
    nx: number
    ny: number
    d: number
  }): Vertex[][] => {
    const distances = polygon.map(({ p }) => nx * p.x + ny * p.y - d)
    if (Math.min(...distances) >= -EPS || Math.max(...distances) <= EPS)
      return [polygon]
    const halves: Vertex[][] = [[], []]
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!,
          next = (i + 1) % polygon.length,
          b = polygon[next]!
        const da = distances[i]! * sign,
          db = distances[next]! * sign
        if (da >= -EPS) halves[side]!.push(a)
        if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
          const t = da / (da - db)
          halves[side]!.push({
            p: {
              x: a.p.x + (b.p.x - a.p.x) * t,
              y: a.p.y + (b.p.y - a.p.y) * t,
              z: a.p.z + (b.p.z - a.p.z) * t,
            },
            uv: {
              u: a.uv.u + (b.uv.u - a.uv.u) * t,
              v: a.uv.v + (b.uv.v - a.uv.v) * t,
            },
          })
        }
      }
    }
    return halves.filter((p) => p.length >= 3)
  }
  const triangles: Triangle[] = []
  for (const triangle of mesh.triangles) {
    const face =
      triangle.pcbFace ??
      (triangle.normal.z > 0.8
        ? "top"
        : triangle.normal.z < -0.8
          ? "bottom"
          : "side")
    let polygons: Vertex[][] = [
      triangle.vertices.map((p, index) => ({
        p,
        uv: triangle.uvs?.[index] ?? {
          u: (p.x - min.x) / (max.x - min.x),
          v: 1 - (p.y - min.y) / (max.y - min.y),
        },
      })),
    ]
    for (const { b, d } of planes)
      polygons = polygons.flatMap((p) =>
        split({ polygon: p, nx: b.nx, ny: b.ny, d: d }),
      )
    for (const polygon of polygons) {
      for (const b of fold.bends) {
        const mid =
          polygon.reduce((sum, { p }) => sum + p.x * b.nx + p.y * b.ny, 0) /
          polygon.length
        if (
          mid > b.start + EPS &&
          mid < b.end - EPS &&
          polygon.some(({ p }) => {
            const along = -b.ny * p.x + b.nx * p.y
            return along < b.axisMin - EPS || along > b.axisMax + EPS
          })
        )
          throw new Error(
            `PCB bend ${b.id} must span the full board cross-section through its bend zone`,
          )
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        const verts = [polygon[0]!, polygon[i]!, polygon[i + 1]!]
        const vertices = verts.map(({ p }) =>
          fold.point(p),
        ) as Triangle["vertices"]
        const [a, b, c] = vertices
        const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
          v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
        const n = {
          x: u.y * v.z - u.z * v.y,
          y: u.z * v.x - u.x * v.z,
          z: u.x * v.y - u.y * v.x,
        }
        const l = Math.hypot(n.x, n.y, n.z)
        if (l < 1e-12) continue
        triangles.push({
          ...triangle,
          vertices,
          normal: { x: n.x / l, y: n.y / l, z: n.z / l },
          pcbFace: face,
          uvs: verts.map(({ uv }) => uv) as NonNullable<Triangle["uvs"]>,
        })
      }
    }
  }
  return { ...mesh, triangles, boundingBox: boundsOfTriangles(triangles) }
}
