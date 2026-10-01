import { expect, test } from "bun:test"
import {
  extrudePolygon,
  tryCreatePcbFold,
  tryFoldRigidMesh,
  tryFoldSurfaceMesh,
  type PcbBendRecord,
} from "../lib"
import "./fixtures/png-matcher"
import { renderSurfaceMeshes } from "./fixtures/render-surface-meshes"

test("a valid board and rigid CAD fold while an invalid rigid placement can stay flat", async () => {
  const outline = [
    { x: -20, y: -10 },
    { x: 20, y: -10 },
    { x: 20, y: 10 },
    { x: -20, y: 10 },
  ]
  const bend: PcbBendRecord = {
    type: "pcb_bend",
    pcb_bend_id: "bend",
    pcb_board_id: "board",
    start: { x: 0, y: -10 },
    end: { x: 0, y: 10 },
    bend_angle: 90,
    bend_radius: 1,
    bend_side: "right",
  }
  const fold = tryCreatePcbFold([bend], 0.12, { outline })
  if (!fold.ok) throw new Error(fold.issue.message)
  const board = tryFoldSurfaceMesh(
    extrudePolygon({ outline, bottom: -0.06, top: 0.06 }),
    fold.value,
  )
  if (!board.ok) throw new Error(board.issue.message)
  const block = (x: number, y: number) =>
    extrudePolygon({
      outline: [
        { x: x - 1, y: y - 0.5 },
        { x: x + 1, y: y - 0.5 },
        { x: x + 1, y: y + 0.5 },
        { x: x - 1, y: y + 0.5 },
      ],
      bottom: 0.06,
      top: 0.9,
    })
  const goodMount = { x: 12, y: 4, z: 0 }
  const good = tryFoldRigidMesh(block(12, 4), fold.value, {
    flatAnchor: goodMount,
    mount: goodMount,
    label: "Valid CAD",
  })
  if (!good.ok) throw new Error(good.issue.message)
  const invalidMesh = block(0, -4)
  const badMount = { x: 0, y: -4, z: 0 }
  const bad = tryFoldRigidMesh(invalidMesh, fold.value, {
    flatAnchor: badMount,
    mount: badMount,
    label: "Invalid CAD",
  })
  expect(bad.ok).toBe(false)
  if (bad.ok) throw new Error("Expected bend-zone placement issue")
  expect(bad.issue.code).toBe("rigid_bend_zone_intersection")
  const png = await renderSurfaceMeshes(
    [
      { mesh: board.value, color: [0.85, 0.52, 0.12, 1] },
      { mesh: good.value, color: [0.08, 0.3, 0.8, 1] },
      { mesh: invalidMesh, color: [0.8, 0.12, 0.1, 1] },
    ],
    {
      camPos: [-50, -55, 45],
      lookAt: [-2, 0, 6],
      debugPoints: [
        {
          label: "valid fold",
          position: fold.value.point({ ...goodMount, z: 1.2 }, goodMount),
        },
        { label: "bend-zone issue", position: { ...badMount, z: 1.2 } },
      ],
      debugFontSize: 20,
      debugLabelColor: [0.08, 0.1, 0.15],
    },
  )
  await expect(png).toMatchPngSnapshot(
    import.meta.path,
    "fold-results-rigid-placement",
  )
})
