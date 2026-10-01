import { expect, test } from "bun:test"
import {
  createPcbFold,
  createStiffenerMesh,
  extrudePolygon,
  foldRigidMesh,
  PcbFoldError,
  tryCreatePcbFold,
  tryFoldRigidMesh,
  tryFoldStiffenerMesh,
  tryFoldSurfaceMesh,
  type PcbBendRecord,
  type PcbFoldIssue,
  type Triangle,
} from "../lib"
import type { PcbStiffener } from "circuit-json"

const bend: PcbBendRecord = {
  type: "pcb_bend",
  pcb_bend_id: "bend",
  pcb_board_id: "board",
  start: { x: 0, y: -10 },
  end: { x: 0, y: 10 },
  bend_angle: 90,
  bend_radius: 2,
  bend_side: "right",
}
const outline = [
  { x: -20, y: -10 },
  { x: 20, y: -10 },
  { x: 20, y: 10 },
  { x: -20, y: 10 },
]
const rigid = () =>
  extrudePolygon({
    outline: [
      { x: 8, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 3 },
      { x: 8, y: 3 },
    ],
    bottom: 0.3,
    top: 0.9,
  })

test("fold construction reports typed limitations while strict APIs retain their messages", () => {
  const cases: { records: PcbBendRecord[]; code: PcbFoldIssue["code"] }[] = [
    {
      records: [{ ...bend, bend_radius: 0 }],
      code: "invalid_bend_geometry",
    },
    {
      records: [{ ...bend, end: bend.start }],
      code: "unsupported_bend_geometry",
    },
    {
      records: [
        bend,
        {
          ...bend,
          pcb_bend_id: "oblique",
          start: { x: -10, y: 0 },
          end: { x: 10, y: 0 },
        },
      ],
      code: "nonparallel_bends",
    },
    {
      records: [bend, { ...bend, pcb_bend_id: "overlap" }],
      code: "overlapping_bend_zones",
    },
  ]
  for (const { records, code } of cases) {
    const result = tryCreatePcbFold(records, 0.12)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("Expected unsupported fold")
    expect(result.issue.code).toBe(code)
    expect(() => createPcbFold(records, 0.12)).toThrow(PcbFoldError)
    expect(() => createPcbFold(records, 0.12)).toThrow(result.issue.message)
  }
  const partial = tryCreatePcbFold(
    [{ ...bend, start: { x: 0, y: -1 }, end: { x: 0, y: 1 } }],
    0.12,
    { outline },
  )
  expect(partial).toEqual({
    ok: false,
    issue: {
      code: "invalid_finite_bend_region",
      message:
        "A finite PCB bend must cut one board cross-section from boundary to boundary",
      bendId: "bend",
    },
  })
  const valid = tryCreatePcbFold([bend], 0.12, { outline })
  expect(valid.ok).toBe(true)
  if (!valid.ok) throw new Error(valid.issue.message)
  expect(valid.value.point({ x: 10, y: 2, z: 0 }).z).toBeGreaterThan(10)
})

test("result APIs reject malformed flat board data and propagate unexpected failures", () => {
  expect(() => tryCreatePcbFold([bend], -1)).toThrow("Board thickness")
  expect(() => tryCreatePcbFold([bend], 0.12, { outline: [] })).toThrow(
    "finite board outline",
  )
  const failure = new Error("Unexpected geometry failure")
  const brokenRecord = {
    ...bend,
    get bend_angle(): number {
      throw failure
    },
  }
  expect(() => tryCreatePcbFold([brokenRecord], 0.12)).toThrow(failure)
  const fold = createPcbFold([bend], 0.12)
  const brokenFold = {
    ...fold,
    point() {
      throw failure
    },
  }
  expect(() => tryFoldSurfaceMesh(rigid(), brokenFold)).toThrow(failure)
  expect(() =>
    tryFoldRigidMesh(rigid(), brokenFold, {
      flatAnchor: { x: 9, y: 2.5, z: 0 },
    }),
  ).toThrow(failure)
})

test("legacy surface cross-section limitations are explicit folding results", () => {
  const fold = createPcbFold(
    [{ ...bend, start: { x: 0, y: -1 }, end: { x: 0, y: 1 } }],
    0.12,
  )
  const board = extrudePolygon({ outline, bottom: -0.06, top: 0.06 })
  const before = JSON.stringify(board)
  expect(tryFoldSurfaceMesh(board, fold)).toEqual({
    ok: false,
    issue: {
      code: "incomplete_bend_cross_section",
      message:
        "PCB bend bend must span the full board cross-section through its bend zone",
      bendId: "bend",
    },
  })
  expect(JSON.stringify(board)).toBe(before)
})

test("rigid mesh output carries points and normals, preserves metadata, and leaves inputs unchanged", () => {
  const fold = createPcbFold([bend], 0.12)
  const mesh = {
    ...rigid(),
    source: "off-axis CAD",
    triangles: rigid().triangles.map((triangle) => ({
      ...triangle,
      material: "red",
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0, v: 1 },
      ] as Triangle["uvs"],
    })),
  }
  const input = JSON.stringify(mesh)
  // Beyond this 2 mm quarter-circle: x = 2 - pi/2 - flat z,
  // z = flat x + 2 - pi/2. This expectation comes from the arc tangency.
  const folded = foldRigidMesh(mesh, fold, {
    flatAnchor: { x: 9, y: 2.5, z: 0 },
    label: "CAD",
    mount: { x: 9, y: 2.5, z: 0 },
  })
  expect(folded.source).toBe(mesh.source)
  for (let i = 0; i < mesh.triangles.length; i++) {
    const original = mesh.triangles[i]!
    const output = folded.triangles[i]!
    expect(output.material).toBe("red")
    expect(output.uvs).toEqual(original.uvs)
    for (let vertex = 0; vertex < 3; vertex++) {
      const p = original.vertices[vertex]!
      const moved = output.vertices[vertex]!
      expect(moved.x).toBeCloseTo(2 - Math.PI / 2 - p.z, 7)
      expect(moved.y).toBeCloseTo(p.y, 7)
      expect(moved.z).toBeCloseTo(p.x + 2 - Math.PI / 2, 7)
    }
    expect(output.normal.x).toBeCloseTo(-original.normal.z, 7)
    expect(output.normal.y).toBeCloseTo(original.normal.y, 7)
    expect(output.normal.z).toBeCloseTo(original.normal.x, 7)
  }
  expect(folded.boundingBox.min.x).toBeCloseTo(2 - Math.PI / 2 - 0.9, 7)
  expect(folded.boundingBox.max.z).toBeCloseTo(12 - Math.PI / 2, 7)
  expect(JSON.stringify(mesh)).toBe(input)
})

test("CAD mount validation is independent of model offsets and rigid extent validation", () => {
  const fold = createPcbFold([bend], 0.12)
  const mesh = rigid()
  const anchor = { x: 0, y: 2.5, z: 0 }
  // The offset model is entirely beyond the bend zone, but its PCB mount is not.
  expect(
    tryFoldRigidMesh(mesh, fold, {
      flatAnchor: anchor,
      mount: anchor,
      label: "Offset CAD",
    }),
  ).toEqual({
    ok: false,
    issue: {
      code: "rigid_bend_zone_intersection",
      message: "Offset CAD mount intersects PCB bend zone bend",
      bendId: "bend",
    },
  })
  expect(tryFoldRigidMesh(mesh, fold, { flatAnchor: anchor }).ok).toBe(true)
  const crossing = extrudePolygon({
    outline: [
      { x: -3, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: -3, y: 3 },
    ],
    bottom: 0.06,
    top: 0.3,
  })
  const result = tryFoldRigidMesh(crossing, fold, {
    flatAnchor: { x: 8, y: 2, z: 0 },
    label: "Crossing CAD",
  })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("Expected crossing rigid mesh")
  expect(result.issue.message).toBe(
    "Crossing CAD intersects PCB bend zone bend",
  )
})

test("already-created stiffeners preserve the shared outline anchor and invalid flat shapes still reject", () => {
  const fold = createPcbFold([bend], 0.12)
  const stiffener: PcbStiffener = {
    type: "pcb_stiffener",
    pcb_stiffener_id: "stiffener",
    pcb_board_id: "board",
    shape: "polygon",
    outline: [
      { x: 8, y: -2 },
      { x: 10, y: -2 },
      { x: 11, y: -1 },
      { x: 10, y: 2 },
      { x: 8, y: 1 },
    ],
    layer: "bottom",
    material: "polyimide",
    thickness: 0.2,
  }
  const flat = createStiffenerMesh({ stiffener, boardThickness: 0.12 })
  const result = tryFoldStiffenerMesh(flat, stiffener, fold)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.issue.message)
  expect(result.value).toEqual(
    createStiffenerMesh({ stiffener, boardThickness: 0.12, fold }),
  )
  expect(() =>
    createStiffenerMesh({
      stiffener: { ...stiffener, outline: [] },
      boardThickness: 0.12,
      fold,
    }),
  ).toThrow("finite polygon")
  expect(() =>
    createStiffenerMesh({
      stiffener: { ...stiffener, thickness: -1 },
      boardThickness: 0.12,
      fold,
    }),
  ).toThrow("Invalid PCB stiffener")
})
