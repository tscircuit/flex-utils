import { expect, test } from "bun:test"
import {
  createPcbFold,
  extrudePolygon,
  foldRigidMesh,
  foldSurfaceMesh,
  tryCreatePcbFold,
  type PcbBendRecord,
  type Point3,
} from "../lib"
import { polygonContainsPolygon } from "../lib/finite-bend-region"
import {
  rightArmBend,
  rightMount,
  topArmBend,
  topMount,
  twoArmOutline,
} from "./fixtures/two-arm-board"

const close = (actual: Point3, expected: Point3) => {
  for (const coordinate of ["x", "y", "z"] as const)
    expect(actual[coordinate]).toBeCloseTo(expected[coordinate], 7)
}
const basis: Point3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
]
const reverseBend = (bend: PcbBendRecord): PcbBendRecord => ({
  ...bend,
  start: bend.end,
  end: bend.start,
  bend_side: bend.bend_side === "left" ? "right" : "left",
})

test("independent arms bend about different axes with stable geometry and rigid inverse transforms", () => {
  const original = JSON.stringify([topArmBend, rightArmBend, twoArmOutline])
  let referenceMesh: ReturnType<typeof foldSurfaceMesh> | undefined
  for (const reversedOutline of [false, true])
    for (const reversedEndpoints of [false, true])
      for (const reversedRecords of [false, true]) {
        let records = [topArmBend, rightArmBend]
        if (reversedEndpoints) records = records.map(reverseBend)
        if (reversedRecords) records.reverse()
        const outline = reversedOutline
          ? [...twoArmOutline].reverse()
          : twoArmOutline
        const fold = createPcbFold(records, 0.12, { outline })
        // Quarter-circle tangencies give these positions independently of fold.point.
        close(fold.point(topMount), {
          x: 0,
          y: 21 - Math.PI / 4 - 0.06,
          z: 6 - Math.PI / 4,
        })
        close(fold.point(rightMount), {
          x: 31 - Math.PI / 4 - 0.06,
          y: 0,
          z: 6 - Math.PI / 4,
        })
        close(fold.point({ x: 0, y: 0, z: 0.06 }), { x: 0, y: 0, z: 0.06 })
        close(fold.direction(basis[2]!, topMount), { x: 0, y: -1, z: 0 })
        close(fold.direction(basis[2]!, rightMount), { x: -1, y: 0, z: 0 })
        for (const mount of [topMount, rightMount]) {
          fold.assertRigid([mount], "arm mount")
          close(fold.inversePoint(fold.point(mount), mount), mount)
          for (const direction of basis)
            close(
              fold.inverseDirection(fold.direction(direction, mount), mount),
              direction,
            )
        }
        const mesh = foldSurfaceMesh(
          extrudePolygon({ outline: twoArmOutline, bottom: -0.06, top: 0.06 }),
          fold,
        )
        expect(mesh.boundingBox.max.z).toBeCloseTo(11 - Math.PI / 4, 7)
        if (referenceMesh) expect(mesh).toEqual(referenceMesh)
        else referenceMesh = mesh
      }
  expect(JSON.stringify([topArmBend, rightArmBend, twoArmOutline])).toBe(
    original,
  )
})

test("the original left-side body fold carries the already-folded top arm", () => {
  const bodyBend = { ...rightArmBend, bend_side: "left" as const }
  for (const records of [
    [topArmBend, bodyBend],
    [bodyBend, topArmBend],
  ]) {
    const fold = createPcbFold(records, 0.12, { outline: twoArmOutline })
    expect(fold.bends.map((bend) => bend.id)).toEqual(["right_arm", "top_arm"])
    close(fold.point(rightMount), rightMount)
    close(fold.point(topMount), {
      x: 35,
      y: 21 - Math.PI / 4 - 0.06,
      z: 31 - Math.PI / 4,
    })
    close(fold.point({ x: 0, y: 0, z: 0.06 }), {
      x: 29 + Math.PI / 4 + 0.06,
      y: 0,
      z: 31 - Math.PI / 4,
    })
    const expectedBasis = [
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
    ]
    for (let i = 0; i < basis.length; i++)
      close(fold.direction(basis[i]!, topMount), expectedBasis[i]!)
    for (const mount of [topMount, rightMount]) {
      close(fold.inversePoint(fold.point(mount), mount), mount)
      for (const direction of basis)
        close(
          fold.inverseDirection(fold.direction(direction, mount), mount),
          direction,
        )
    }
    const mountMesh = extrudePolygon({
      outline: [
        { x: -1, y: 24.5 },
        { x: 1, y: 24.5 },
        { x: 1, y: 25.5 },
        { x: -1, y: 25.5 },
      ],
      bottom: 0.06,
      top: 0.6,
    })
    const rigid = foldRigidMesh(mountMesh, fold, {
      flatAnchor: topMount,
      mount: topMount,
    })
    for (const triangle of rigid.triangles)
      for (const p of triangle.vertices) {
        expect(p.x).toBeGreaterThanOrEqual(34.5 - 1e-7)
        expect(p.x).toBeLessThanOrEqual(35.5 + 1e-7)
        expect(p.z).toBeGreaterThan(29)
      }
  }
})

test("negative independent folds retain their selected moving regions", () => {
  const fold = createPcbFold(
    [{ ...topArmBend, bend_angle: -90 }, rightArmBend],
    0.12,
    { outline: twoArmOutline },
  )
  close(fold.point(topMount), {
    x: 0,
    y: 21 - Math.PI / 4 + 0.06,
    z: -6 + Math.PI / 4,
  })
  close(fold.point(rightMount), {
    x: 31 - Math.PI / 4 - 0.06,
    y: 0,
    z: 6 - Math.PI / 4,
  })
})

test("parallel fold chains remain geometric and work beside an independent axis", () => {
  const topDistal = {
    ...topArmBend,
    pcb_bend_id: "top_distal",
    bend_angle: -90,
    start: { x: -4, y: 26 },
    end: { x: 4, y: 26 },
  }
  const chain = createPcbFold([topArmBend, topDistal], 0.12, {
    outline: twoArmOutline,
  })
  const point = { x: 0, y: 29, z: 0.06 }
  // Two opposite quarter circles restore the original orientation. Their arc
  // tangencies leave this distal point translated by (0, -4-pi/2, 8-pi/2).
  const expected = { x: 0, y: 25 - Math.PI / 2, z: 8 - Math.PI / 2 + 0.06 }
  close(chain.point(point), expected)
  for (const direction of basis)
    close(chain.direction(direction, point), direction)
  for (const records of [
    [topDistal, rightArmBend, topArmBend],
    [topArmBend, topDistal, rightArmBend],
  ]) {
    const fold = createPcbFold(records, 0.12, { outline: twoArmOutline })
    close(fold.point(point), expected)
    close(fold.point(rightMount), {
      x: 31 - Math.PI / 4 - 0.06,
      y: 0,
      z: 6 - Math.PI / 4,
    })
  }
})

test("opposite moving directions fold both ends of a rectangular board", () => {
  const outline = [
    { x: -20, y: -4 },
    { x: 20, y: -4 },
    { x: 20, y: 4 },
    { x: -20, y: 4 },
  ]
  const right = {
    ...rightArmBend,
    start: { x: 10, y: -4 },
    end: { x: 10, y: 4 },
  }
  const left = {
    ...right,
    pcb_bend_id: "left_arm",
    start: { x: -10, y: -4 },
    end: { x: -10, y: 4 },
    bend_side: "left" as const,
  }
  for (const bends of [
    [left, right],
    [right, left],
  ]) {
    const fold = createPcbFold(bends, 0.12, { outline })
    close(fold.point({ x: 15, y: 0, z: 0.06 }), {
      x: 11 - Math.PI / 4 - 0.06,
      y: 0,
      z: 6 - Math.PI / 4,
    })
    close(fold.point({ x: -15, y: 0, z: 0.06 }), {
      x: -11 + Math.PI / 4 + 0.06,
      y: 0,
      z: 6 - Math.PI / 4,
    })
    close(fold.point({ x: 0, y: 0, z: 0.06 }), { x: 0, y: 0, z: 0.06 })
    close(fold.direction(basis[2]!, { x: -15, y: 0, z: 0 }), {
      x: 1,
      y: 0,
      z: 0,
    })
    close(fold.direction(basis[2]!, { x: 15, y: 0, z: 0 }), {
      x: -1,
      y: 0,
      z: 0,
    })
  }
})

test("crossing regions and nested curves inside a parent bend strip fail explicitly", () => {
  const rectangle = [
    { x: -20, y: -10 },
    { x: 20, y: -10 },
    { x: 20, y: 10 },
    { x: -20, y: 10 },
  ]
  const across = {
    ...topArmBend,
    start: { x: -20, y: 0 },
    end: { x: 20, y: 0 },
  }
  const vertical = {
    ...rightArmBend,
    start: { x: 0, y: -10 },
    end: { x: 0, y: 10 },
  }
  const crossing = tryCreatePcbFold([across, vertical], 0.12, {
    outline: rectangle,
  })
  expect(crossing.ok).toBe(false)
  if (crossing.ok) throw new Error("Expected incompatible intersecting regions")
  expect(crossing.issue.code).toBe("overlapping_bend_zones")
  expect(() => createPcbFold([topArmBend, rightArmBend], 0.12)).toThrow(
    "board outline",
  )
  const stripOverlap = tryCreatePcbFold(
    [
      topArmBend,
      {
        ...topArmBend,
        pcb_bend_id: "close",
        start: { x: -4, y: 20.5 },
        end: { x: 4, y: 20.5 },
      },
    ],
    0.12,
    { outline: twoArmOutline },
  )
  expect(stripOverlap.ok).toBe(false)
  if (stripOverlap.ok) throw new Error("Expected overlapping curved strips")
  expect(stripOverlap.issue.code).toBe("overlapping_bend_zones")
})

test("containment checks edges through concavities, not only their endpoints", () => {
  const notched = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 3, y: 10 },
    { x: 3, y: 4 },
    { x: 2, y: 4 },
    { x: 2, y: 10 },
    { x: 0, y: 10 },
  ]
  const crossingNotch = [
    { x: 1, y: 5 },
    { x: 9, y: 5 },
    { x: 9, y: 6 },
    { x: 1, y: 6 },
  ]
  expect(polygonContainsPolygon(notched, crossingNotch)).toBe(false)
  expect(
    polygonContainsPolygon(notched, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 0, y: 3 },
    ]),
  ).toBe(true)
})
