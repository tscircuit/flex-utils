import type { PcbStiffener } from "circuit-json"
import type { PcbFold } from "./pcb-fold"
import { extrudePolygon } from "./polygon"
import { foldRigidMesh, tryFoldRigidMesh } from "./rigid"
import type { PcbFoldResult } from "./fold-result"
import type { Point2, SurfaceMesh } from "./types"

function getStiffenerOutline(stiffener: PcbStiffener): Point2[] {
  if (stiffener.shape === "polygon") return stiffener.outline
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
}

function getStiffenerAnchor(outline: Point2[]) {
  return {
    x: outline.reduce((s, p) => s + p.x, 0) / outline.length,
    y: outline.reduce((s, p) => s + p.y, 0) / outline.length,
    z: 0,
  }
}

/** Stiffener vertices stay board-local (+Z up, mm). Stiffeners are rigid and may
 * not cross a bend zone. Includes the adhesive spacing from the board surface. */
export function createStiffenerMesh({
  stiffener,
  boardThickness,
  fold,
}: {
  stiffener: PcbStiffener
  boardThickness: number
  fold?: PcbFold
}) {
  const adhesive = stiffener.adhesive_thickness ?? 0
  if (
    !Number.isFinite(adhesive) ||
    adhesive < 0 ||
    !Number.isFinite(stiffener.thickness) ||
    stiffener.thickness <= 0 ||
    !["top", "bottom"].includes(stiffener.layer)
  )
    throw new Error(`Invalid PCB stiffener ${stiffener.pcb_stiffener_id}`)
  const outline = getStiffenerOutline(stiffener)
  const near = boardThickness / 2 + adhesive,
    far = near + stiffener.thickness
  const mesh = extrudePolygon({
    outline: outline,
    bottom: stiffener.layer === "top" ? near : -far,
    top: stiffener.layer === "top" ? far : -near,
  })
  if (!fold) return mesh
  return foldRigidMesh(mesh, fold, {
    flatAnchor: getStiffenerAnchor(outline),
    label: stiffener.pcb_stiffener_id,
  })
}

/** Fold an already-created flat stiffener mesh in board-local +Z-up mm.
 * Retains createStiffenerMesh's outline-average anchor and reports bend-zone
 * collisions as data, allowing callers to reuse the same flat mesh on failure.
 */
export function tryFoldStiffenerMesh<T extends SurfaceMesh>(
  mesh: T,
  stiffener: PcbStiffener,
  fold: PcbFold,
): PcbFoldResult<T> {
  return tryFoldRigidMesh(mesh, fold, {
    flatAnchor: getStiffenerAnchor(getStiffenerOutline(stiffener)),
    label: stiffener.pcb_stiffener_id,
  })
}
