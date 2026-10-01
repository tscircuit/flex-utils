import { expect, test } from "bun:test"
import {
  createPcbFold,
  extrudePolygon,
  foldSurfaceMesh,
  type PcbBendRecord,
} from "../lib"
import "./fixtures/png-matcher"
import { renderSurfaceMeshes } from "./fixtures/render-surface-meshes"

test("the finite bend folds RL's tail while RR's tail remains flat", async () => {
  // Exact board outline and bend from tscircuit/tscircuit#5277, in board-local mm.
  const outline = [
    { x: -20, y: -10 },
    { x: 20, y: -10 },
    { x: 20, y: 30 },
    { x: 12, y: 30 },
    { x: 12, y: 10 },
    { x: -12, y: 10 },
    { x: -12, y: 30 },
    { x: -20, y: 30 },
  ]
  const bend: PcbBendRecord = {
    type: "pcb_bend",
    pcb_bend_id: "left_tail_bend",
    pcb_board_id: "flex_board",
    start: { x: -20, y: 20 },
    end: { x: -12, y: 20 },
    bend_angle: 90,
    bend_radius: 1,
    bend_side: "left",
  }
  const board = extrudePolygon({ outline, bottom: -0.06, top: 0.06 })
  // Colored mounting blocks at the issue's resistor positions make each tail
  // easy to identify. They exercise the same surface deformation as the board.
  const mounts = [-16, 16].map((x) =>
    extrudePolygon({
      outline: [
        { x: x - 1, y: 24.5 },
        { x: x + 1, y: 24.5 },
        { x: x + 1, y: 25.5 },
        { x: x - 1, y: 25.5 },
      ],
      bottom: 0.06,
      top: 0.6,
    }),
  )

  for (const folded of [false, true]) {
    const fold = createPcbFold(folded ? [bend] : [], 0.12, { outline })
    const png = await renderSurfaceMeshes(
      [
        { mesh: foldSurfaceMesh(board, fold), color: [0.85, 0.52, 0.12, 1] },
        { mesh: foldSurfaceMesh(mounts[0]!, fold), color: [0.8, 0.12, 0.1, 1] },
        { mesh: foldSurfaceMesh(mounts[1]!, fold), color: [0.08, 0.3, 0.8, 1] },
      ],
      {
        debugPoints: [
          { label: "RL", position: fold.point({ x: -16, y: 25, z: 0.6 }) },
          { label: "RR", position: fold.point({ x: 16, y: 25, z: 0.6 }) },
        ],
        debugFontSize: 20,
        debugLabelColor: [0.08, 0.1, 0.15],
      },
    )
    await expect(png).toMatchPngSnapshot(
      import.meta.path,
      folded ? "finite-bend-left-tail-folded" : "finite-bend-flat-reference",
    )
  }
})
