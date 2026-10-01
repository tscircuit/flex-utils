import { expect, test } from "bun:test"
import {
  createPcbFold,
  createStiffenerMesh,
  extrudePolygon,
  foldSurfaceMesh,
  transformCircuitJsonCadComponents,
  type PcbBendRecord,
  type Point2,
  type Point3,
} from "../lib"
import type { AnyCircuitElement, PcbStiffenerRect } from "circuit-json"

const outline: Point2[] = [
  { x: -20, y: -10 },
  { x: 20, y: -10 },
  { x: 20, y: 30 },
  { x: 12, y: 30 },
  { x: 12, y: 10 },
  { x: -12, y: 10 },
  { x: -12, y: 30 },
  { x: -20, y: 30 },
]
const leftBend: PcbBendRecord = {
  type: "pcb_bend",
  pcb_bend_id: "left",
  pcb_board_id: "board",
  start: { x: -20, y: 20 },
  end: { x: -12, y: 20 },
  bend_angle: 90,
  bend_radius: 1,
  bend_side: "left",
}
const close = (actual: Point3, expected: Point3) => {
  for (const coordinate of ["x", "y", "z"] as const)
    expect(actual[coordinate]).toBeCloseTo(expected[coordinate], 7)
}

test("a finite chord folds the left tail while the neighboring tail and its bend-zone mounts stay flat", () => {
  const fold = createPcbFold([leftBend], 0.12, { outline })
  const left = { x: -16, y: 25, z: 0.2 },
    right = { x: 16, y: 25, z: 0.2 }
  close(fold.point(left), {
    x: -16,
    y: 20 + 1 - Math.PI / 4 - 0.2,
    z: 5 + 1 - Math.PI / 4,
  })
  close(fold.point(right), right)
  close(fold.direction({ x: 0, y: 0, z: 1 }, right), { x: 0, y: 0, z: 1 })
  close(fold.inversePoint(fold.point(left), left), left)
  expect(() =>
    fold.assertRigid([{ x: 16, y: 20, z: 0 }], "right mount"),
  ).not.toThrow()
  expect(() =>
    fold.assertRigid([{ x: -16, y: 20, z: 0 }], "left mount"),
  ).toThrow("left mount intersects")
  const proximal = { x: -16, y: 20 - Math.PI / 8, z: 0 }
  expect(fold.point(proximal).z).toBeGreaterThan(0)
  // Keep the old full-line mode for consumers that have not provided an outline.
  expect(createPcbFold([leftBend], 0.12).point(right).z).toBeGreaterThan(5)
})

test("independent tails can share a bend line and result is invariant to winding, endpoint direction, and record order", () => {
  const rightBend = {
    ...leftBend,
    pcb_bend_id: "right",
    start: { x: 12, y: 20 },
    end: { x: 20, y: 20 },
    bend_angle: -90,
  }
  for (const boundary of [outline, [...outline].reverse()])
    for (const records of [
      [leftBend, rightBend],
      [rightBend, leftBend],
    ])
      for (const reverse of [false, true]) {
        const bends = reverse
          ? records.map((b) => ({
              ...b,
              start: b.end,
              end: b.start,
              bend_side: "right" as const,
            }))
          : records
        const fold = createPcbFold(bends, 0.12, { outline: boundary })
        expect(fold.point({ x: -16, y: 25, z: 0 }).z).toBeCloseTo(
          6 - Math.PI / 4,
          7,
        )
        expect(fold.point({ x: 16, y: 25, z: 0 }).z).toBeCloseTo(
          -6 + Math.PI / 4,
          7,
        )
        close(fold.point({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 })
      }
})

test("the complete connected tip folds when it widens beyond the bend endpoints", () => {
  const widened: Point2[] = [
    { x: -20, y: -10 },
    { x: 20, y: -10 },
    { x: 20, y: 10 },
    { x: -12, y: 10 },
    { x: -12, y: 23 },
    { x: -5, y: 26 },
    { x: -5, y: 30 },
    { x: -25, y: 30 },
    { x: -25, y: 26 },
    { x: -20, y: 23 },
  ]
  const fold = createPcbFold([leftBend], 0.12, { outline: widened })
  for (const x of [-23, -16, -7]) {
    const point = { x, y: 28, z: 0 }
    close(fold.point(point), { x, y: 21 - Math.PI / 4, z: 9 - Math.PI / 4 })
  }
})

test("surface subdivision and stiffeners use the same finite region as CAD mounts", () => {
  const fold = createPcbFold([leftBend], 0.12, { outline })
  const mesh = foldSurfaceMesh(
    extrudePolygon({ outline, bottom: -0.06, top: 0.06 }),
    fold,
  )
  const rightTailVertices = mesh.triangles
    .flatMap((triangle) => triangle.vertices)
    .filter((p) => p.x > 12 && p.y > 20)
  expect(rightTailVertices.length).toBeGreaterThan(0)
  expect(rightTailVertices.every((p) => Math.abs(p.z) <= 0.06 + 1e-7)).toBe(
    true,
  )
  expect(mesh.boundingBox.max.z).toBeCloseTo(11 - Math.PI / 4, 7)
  const stiffener = {
    type: "pcb_stiffener",
    pcb_stiffener_id: "right stiffener",
    pcb_board_id: "board",
    shape: "rect",
    center: { x: 16, y: 20 },
    width: 2,
    height: 2,
    layer: "bottom",
    material: "polyimide",
    thickness: 0.2,
  } satisfies PcbStiffenerRect
  const flat = createStiffenerMesh({ stiffener, boardThickness: 0.12 })
  expect(
    createStiffenerMesh({ stiffener, boardThickness: 0.12, fold }),
  ).toEqual(flat)
  expect(() =>
    createStiffenerMesh({
      stiffener: { ...stiffener, center: { x: -16, y: 20 } },
      boardThickness: 0.12,
      fold,
    }),
  ).toThrow("intersects")
})

test("Circuit JSON resolves world-space outlines to board-local finite folds and round-trips both tails", () => {
  const center = { x: 100, y: -70 }
  const json = [
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center,
      thickness: 0.12,
      outline: outline.map((p) => ({ x: p.x + center.x, y: p.y + center.y })),
    },
    leftBend,
    ...[-16, 16].flatMap((x, i) => [
      {
        type: "pcb_component",
        pcb_component_id: `pcb${i}`,
        center: { x: x + center.x, y: 25 + center.y },
        layer: "top",
      },
      {
        type: "cad_component",
        cad_component_id: `cad${i}`,
        pcb_component_id: `pcb${i}`,
        source_component_id: `src${i}`,
        position: { x: x + center.x, y: 25 + center.y, z: 0.2 },
        rotation: { x: 0, y: 0, z: 0 },
      },
    ]),
  ] as AnyCircuitElement[]
  const folded = transformCircuitJsonCadComponents(json, { foldPcbs: true })
  const cad = folded.filter((e) => e.type === "cad_component")
  expect(cad[0]!.position.z).toBeGreaterThan(5)
  close(cad[1]!.position, { x: 116, y: -45, z: 0.2 })
  const restored = transformCircuitJsonCadComponents(folded, {
    foldPcbs: false,
  }).filter((e) => e.type === "cad_component")
  for (let i = 0; i < restored.length; i++)
    close(
      restored[i]!.position,
      json.filter((e) => e.type === "cad_component")[i]!.position,
    )
})

test("incomplete segments, multiple cross-sections and overlapping zones fail explicitly", () => {
  expect(() =>
    createPcbFold([{ ...leftBend, start: { x: -19, y: 20 } }], 0.12, {
      outline,
    }),
  ).toThrow("boundary to boundary")
  expect(() =>
    createPcbFold([{ ...leftBend, end: { x: 20, y: 20 } }], 0.12, { outline }),
  ).toThrow("one board cross-section")
  expect(() =>
    createPcbFold([leftBend, { ...leftBend, pcb_bend_id: "duplicate" }], 0.12, {
      outline,
    }),
  ).toThrow("Overlapping")
  const atBranch = {
    ...leftBend,
    start: { x: -20, y: 10.3 },
    end: { x: -12, y: 10.3 },
  }
  expect(() => createPcbFold([atBranch], 0.12, { outline })).toThrow(
    "one connected board cross-section",
  )
  const shorterRightTail = outline.map((p) =>
    p.x > 0 && p.y === 30 ? { ...p, y: 20 } : p,
  )
  expect(() =>
    createPcbFold([leftBend], 0.12, { outline: shorterRightTail }),
  ).not.toThrow()
  const boundaryBend = {
    ...leftBend,
    start: { x: -20, y: 30 },
    end: { x: -12, y: 30 },
  }
  expect(() => createPcbFold([boundaryBend], 0.12, { outline })).toThrow(
    "board interior",
  )
})
