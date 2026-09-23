import earcut from "earcut"
import type { Point3, SurfaceMesh, Triangle } from "./types"
import { boundsOfTriangles } from "./surface"

/** Extrude a simple polygon in board-local Circuit JSON (+Z up, mm).
 * Used for stiffeners and uncut board surfaces; face labels survive folding. */
export function extrudePolygon({
  outline,
  bottom,
  top,
}: {
  outline: { x: number; y: number }[]
  bottom: number
  top: number
}): SurfaceMesh {
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
  let area = 0
  for (const [i, a] of outline.entries()) {
    const b = outline[(i + 1) % outline.length]!
    area += a.x * b.y - b.x * a.y
  }
  if (Math.abs(area) < 1e-12) throw new Error("Degenerate polygon")
  const polygon = area > 0 ? outline : [...outline].reverse()
  const triangles: Triangle[] = []
  const add = ({
    a,
    b,
    c,
    pcbFace,
  }: {
    a: Point3
    b: Point3
    c: Point3
    pcbFace: Triangle["pcbFace"]
  }) => {
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
    add({
      a: { ...a, z: top },
      b: { ...b, z: top },
      c: { ...c, z: top },
      pcbFace: "top",
    })
    add({
      a: { ...c, z: bottom },
      b: { ...b, z: bottom },
      c: { ...a, z: bottom },
      pcbFace: "bottom",
    })
  }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!
    add({
      a: { ...a, z: bottom },
      b: { ...b, z: bottom },
      c: { ...b, z: top },
      pcbFace: "side",
    })
    add({
      a: { ...a, z: bottom },
      b: { ...b, z: top },
      c: { ...a, z: top },
      pcbFace: "side",
    })
  }
  return { triangles, boundingBox: boundsOfTriangles(triangles) }
}
