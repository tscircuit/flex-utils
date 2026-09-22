import earcut from "earcut"
import type { Point3, SurfaceMesh, Triangle } from "./types"
import { boundsOfTriangles } from "./surface"

/** Extrude a simple polygon in board-local Circuit JSON (+Z up, mm).
 * Used for stiffeners and uncut board surfaces; face labels survive folding. */
export function extrudePolygon(
  outline: { x: number; y: number }[],
  bottom: number,
  top: number,
): SurfaceMesh {
  if (
    outline.length < 3 ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(top) ||
    top <= bottom ||
    outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new Error(
      "A finite polygon and positive extrusion thickness are required",
    )
  const area = outline.reduce((s, a, i) => {
    const b = outline[(i + 1) % outline.length]!
    return s + a.x * b.y - b.x * a.y
  }, 0)
  if (Math.abs(area) < 1e-12) throw new Error("Degenerate polygon")
  const polygon = area > 0 ? outline : [...outline].reverse()
  const triangles: Triangle[] = []
  const add = (
    a: Point3,
    b: Point3,
    c: Point3,
    pcbFace: Triangle["pcbFace"],
  ) => {
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
      v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const n = {
      x: u.y * v.z - u.z * v.y,
      y: u.z * v.x - u.x * v.z,
      z: u.x * v.y - u.y * v.x,
    }
    const l = Math.hypot(n.x, n.y, n.z)
    if (l > 1e-12)
      triangles.push({
        vertices: [a, b, c],
        normal: { x: n.x / l, y: n.y / l, z: n.z / l },
        pcbFace,
      })
  }
  const indices = earcut(polygon.flatMap((p) => [p.x, p.y]))
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((j) => polygon[j]!) as [
      (typeof polygon)[number],
      (typeof polygon)[number],
      (typeof polygon)[number],
    ]
    add({ ...a, z: top }, { ...b, z: top }, { ...c, z: top }, "top")
    add({ ...c, z: bottom }, { ...b, z: bottom }, { ...a, z: bottom }, "bottom")
  }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!
    add({ ...a, z: bottom }, { ...b, z: bottom }, { ...b, z: top }, "side")
    add({ ...a, z: bottom }, { ...b, z: top }, { ...a, z: top }, "side")
  }
  return { triangles, boundingBox: boundsOfTriangles(triangles) }
}
