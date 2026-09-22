import type { PcbStiffener } from "circuit-json"
import type { PcbFold } from "./pcb-fold"
import { extrudePolygon } from "./polygon"
import { boundsOfTriangles } from "./surface"

/** Stiffener vertices stay board-local (+Z up, mm). Stiffeners are rigid and may
 * not cross a bend zone. Includes the adhesive spacing from the board surface. */
export function createStiffenerMesh(
  stiffener: PcbStiffener,
  boardThickness: number,
  fold?: PcbFold,
) {
  const adhesive = stiffener.adhesive_thickness ?? 0
  if (
    !Number.isFinite(adhesive) ||
    adhesive < 0 ||
    !Number.isFinite(stiffener.thickness) ||
    stiffener.thickness <= 0 ||
    !["top", "bottom"].includes(stiffener.layer)
  )
    throw new Error(`Invalid PCB stiffener ${stiffener.pcb_stiffener_id}`)
  const outline =
    stiffener.shape === "polygon"
      ? stiffener.outline
      : (() => {
          if (!(stiffener.width > 0 && stiffener.height > 0))
            throw new Error("Invalid stiffener dimensions")
          const a = ((stiffener.rotation ?? 0) * Math.PI) / 180
          return [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([x, y]) => ({
            x:
              stiffener.center.x +
              ((x! * stiffener.width) / 2) * Math.cos(a) -
              ((y! * stiffener.height) / 2) * Math.sin(a),
            y:
              stiffener.center.y +
              ((x! * stiffener.width) / 2) * Math.sin(a) +
              ((y! * stiffener.height) / 2) * Math.cos(a),
          }))
        })()
  const near = boardThickness / 2 + adhesive,
    far = near + stiffener.thickness
  const mesh = extrudePolygon(
    outline,
    stiffener.layer === "top" ? near : -far,
    stiffener.layer === "top" ? far : -near,
  )
  if (!fold) return mesh
  fold.assertRigid(
    mesh.triangles.flatMap((t) => t.vertices),
    stiffener.pcb_stiffener_id,
  )
  const anchor = {
    x: outline.reduce((s, p) => s + p.x, 0) / outline.length,
    y: outline.reduce((s, p) => s + p.y, 0) / outline.length,
    z: 0,
  }
  const triangles = mesh.triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((p) => fold.point(p, anchor)) as typeof t.vertices,
    normal: fold.direction(t.normal, anchor),
  }))
  return { ...mesh, triangles, boundingBox: boundsOfTriangles(triangles) }
}
