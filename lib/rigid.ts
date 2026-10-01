import { capturePcbFoldResult, type PcbFoldResult } from "./fold-result"
import type { PcbFold } from "./pcb-fold"
import { boundsOfTriangles } from "./surface"
import type { Point3, SurfaceMesh, Triangle } from "./types"

export interface RigidFoldOptions {
  /** Board-local flat point (+Z up, mm) selecting one rigid fold transform. */
  flatAnchor: Point3
  label?: string
  /** Optional PCB mount, independently checked even if a model offset moves
   * all mesh vertices outside the bend zone. Board-local +Z up, mm.
   */
  mount?: Point3
}

/** Carry a rigid mesh with its PCB in board-local Circuit JSON (+Z up, mm).
 * Vertices are points; normals are directions and do not receive translation.
 * Preserve triangle metadata and UVs, and leave the input mesh untouched.
 */
export function foldRigidMesh<T extends SurfaceMesh>(
  mesh: T,
  fold: PcbFold,
  { flatAnchor, label = "Rigid mesh", mount }: RigidFoldOptions,
): T {
  if (mount) fold.assertRigid([mount], `${label} mount`)
  fold.assertRigid(
    mesh.triangles.flatMap((t) => t.vertices),
    label,
  )
  const triangles = mesh.triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((p) =>
      fold.point(p, flatAnchor),
    ) as Triangle["vertices"],
    normal: fold.direction(t.normal, flatAnchor),
  }))
  return { ...mesh, triangles, boundingBox: boundsOfTriangles(triangles) }
}

/** Report a rigid mesh/mount intersecting a bend zone as data. Invalid mesh
 * data and unexpected transformation failures throw; no flat policy is chosen.
 */
export function tryFoldRigidMesh<T extends SurfaceMesh>(
  mesh: T,
  fold: PcbFold,
  options: RigidFoldOptions,
): PcbFoldResult<T> {
  return capturePcbFoldResult(() => foldRigidMesh(mesh, fold, options))
}
