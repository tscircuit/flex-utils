import { expect, test } from "bun:test"
import {
  createPcbFold,
  extrudePolygon,
  foldRigidMesh,
  foldSurfaceMesh,
} from "../lib"
import "./fixtures/png-matcher"
import { renderSurfaceMeshes } from "./fixtures/render-surface-meshes"
import {
  rightArmBend,
  rightMount,
  topArmBend,
  topMount,
  twoArmOutline,
} from "./fixtures/two-arm-board"

test("different bend axes fold independent arms and carry a nested arm with its moving body", async () => {
  const board = extrudePolygon({
    outline: twoArmOutline,
    bottom: -0.06,
    top: 0.06,
  })
  const mounts = [topMount, rightMount, { x: -10, y: 0, z: 0.06 }]
  const blocks = mounts.map(({ x, y }) =>
    extrudePolygon({
      outline: [
        { x: x - 1, y: y - 0.5 },
        { x: x + 1, y: y - 0.5 },
        { x: x + 1, y: y + 0.5 },
        { x: x - 1, y: y + 0.5 },
      ],
      bottom: 0.06,
      top: 0.6,
    }),
  )
  const cases = [
    { name: "nonparallel-flat-reference", bends: [] },
    { name: "nonparallel-independent-arms", bends: [topArmBend, rightArmBend] },
    {
      // Exact original core fixture: the right tip is fixed, while the main body
      // and already-folded top arm move with the vertical left-side bend.
      name: "nonparallel-nested-body",
      bends: [topArmBend, { ...rightArmBend, bend_side: "left" as const }],
    },
  ]
  const colors: [number, number, number, number][] = [
    [0.8, 0.12, 0.1, 1],
    [0.08, 0.3, 0.8, 1],
    [0.12, 0.55, 0.18, 1],
  ]
  for (const { name, bends } of cases) {
    const fold = createPcbFold(bends, 0.12, { outline: twoArmOutline })
    const png = await renderSurfaceMeshes(
      [
        { mesh: foldSurfaceMesh(board, fold), color: [0.85, 0.52, 0.12, 1] },
        ...blocks.map((mesh, i) => ({
          mesh: foldRigidMesh(mesh, fold, {
            flatAnchor: mounts[i]!,
            mount: mounts[i]!,
          }),
          color: colors[i]!,
        })),
      ],
      {
        // Board-local right-handed frame: +X right, +Y top, +Z above, mm.
        camPos:
          name === "nonparallel-nested-body" ? [105, -100, 85] : [-75, -70, 65],
        lookAt: name === "nonparallel-nested-body" ? [32, 6, 24] : [8, 7, 8],
        up: "z+",
        fov: 35,
        debugPoints: mounts.map((mount, i) => ({
          label: ["TOP ARM", "RIGHT ARM", "BODY"][i]!,
          position: fold.point({ ...mount, z: 0.8 }, mount),
        })),
        debugFontSize: 20,
        debugLabelColor: [0.08, 0.1, 0.15],
      },
    )
    await expect(png).toMatchPngSnapshot(import.meta.path, name)
  }
})
