import {
  encodePNG,
  renderDrawCalls,
  type DrawCall,
  type RenderOptionsInput,
} from "poppygl"
import type { SurfaceMesh } from "../../lib"

/** Render flex-utils geometry directly in its right-handed board-local frame:
 * +X right, +Y top, +Z above, millimeters. No viewer/exporter transform is applied.
 * Camera positions and debug points use that same frame.
 */
export async function renderSurfaceMeshes(
  meshes: {
    mesh: SurfaceMesh
    color: DrawCall["material"]["baseColorFactor"]
  }[],
  options: RenderOptionsInput,
) {
  const drawCalls: DrawCall[] = meshes.map(({ mesh, color }) => ({
    positions: new Float32Array(
      mesh.triangles.flatMap((triangle) =>
        triangle.vertices.flatMap(({ x, y, z }) => [x, y, z]),
      ),
    ),
    normals: new Float32Array(
      mesh.triangles.flatMap(({ normal: { x, y, z } }) => [
        x,
        y,
        z,
        x,
        y,
        z,
        x,
        y,
        z,
      ]),
    ),
    uvs: null,
    indices: null,
    model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    material: { baseColorFactor: color, baseColorTexture: null },
  }))
  const { bitmap } = renderDrawCalls(drawCalls, {
    width: 1000,
    height: 760,
    camPos: [55, -65, 60],
    lookAt: [0, 9, 2],
    up: "z+",
    fov: 35,
    cull: false,
    backgroundColor: "#f4f5f7",
    ambient: 0.45,
    lightDir: [-0.4, -0.5, -1],
    grid: false,
    ...options,
  })
  return encodePNG(bitmap)
}
