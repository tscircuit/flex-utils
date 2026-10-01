// lib/fold-result.ts
var PcbFoldError = class extends Error {
  constructor(issue) {
    super(issue.message);
    this.issue = issue;
    this.name = "PcbFoldError";
  }
  issue;
};
function capturePcbFoldResult(fold) {
  try {
    return { ok: true, value: fold() };
  } catch (error) {
    if (!(error instanceof PcbFoldError)) throw error;
    return { ok: false, issue: error.issue };
  }
}

// lib/finite-bend-region.ts
var EPS = 1e-7;
var samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
function pointInPolygon(point, polygon, includeBoundary = true) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS)
      return includeBoundary;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y))
      inside = !inside;
  }
  return inside;
}
function lineCrossings(outline, nx, ny, d) {
  const crossings = [];
  for (let edge = 0; edge < outline.length; edge++) {
    const a = outline[edge], b = outline[(edge + 1) % outline.length];
    const da = a.x * nx + a.y * ny - d, db = b.x * nx + b.y * ny - d;
    if (Math.abs(da) < EPS && Math.abs(db) < EPS) continue;
    if (da > EPS && db > EPS || da < -EPS && db < -EPS) continue;
    if (Math.abs(da - db) < EPS) continue;
    const fraction = Math.max(0, Math.min(1, da / (da - db)));
    const point = {
      x: a.x + (b.x - a.x) * fraction,
      y: a.y + (b.y - a.y) * fraction
    };
    if (crossings.some((crossing) => samePoint(crossing.point, point))) continue;
    crossings.push(
      fraction > 1 - EPS ? { point: b, edge: (edge + 1) % outline.length, fraction: 0 } : { point, edge, fraction }
    );
  }
  return crossings.sort(
    (a, b) => -ny * a.point.x + nx * a.point.y - (-ny * b.point.x + nx * b.point.y)
  );
}
function movingPolygon(outline, a, b, nx, ny) {
  const polygon = [];
  for (let edge = 0; edge < outline.length; edge++) {
    polygon.push(outline[edge]);
    for (const crossing of [a, b].filter((c) => c.edge === edge).sort((a2, b2) => a2.fraction - b2.fraction))
      if (crossing.fraction > EPS) polygon.push(crossing.point);
  }
  const start = polygon.findIndex((p) => samePoint(p, a.point));
  const end = polygon.findIndex((p) => samePoint(p, b.point));
  if (start < 0 || end < 0)
    throw new Error("Cannot resolve PCB bend boundary crossings");
  const path = (from, to) => {
    const points = [polygon[from]];
    while (from !== to) {
      from = (from + 1) % polygon.length;
      points.push(polygon[from]);
    }
    return points;
  };
  const area = outline.reduce((sum, p, i) => {
    const next = outline[(i + 1) % outline.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  const side = Math.sign(area) * ((b.point.y - a.point.y) * nx - (b.point.x - a.point.x) * ny);
  return side > 0 ? path(start, end) : path(end, start);
}
function getFiniteBendRegion({
  bendId,
  outline,
  nx,
  ny,
  center,
  proximal,
  axisMin,
  axisMax
}) {
  const finiteCrossings = lineCrossings(outline, nx, ny, center).filter(
    ({ point }) => {
      const along = -ny * point.x + nx * point.y;
      return along >= axisMin - EPS && along <= axisMax + EPS;
    }
  );
  if (finiteCrossings.length !== 2)
    throw new PcbFoldError({
      code: "invalid_finite_bend_region",
      message: "A finite PCB bend must cut one board cross-section from boundary to boundary",
      bendId
    });
  const [a, b] = finiteCrossings;
  const middle = {
    x: (a.point.x + b.point.x) / 2,
    y: (a.point.y + b.point.y) / 2
  };
  if (!pointInPolygon(middle, outline, false))
    throw new PcbFoldError({
      code: "invalid_finite_bend_region",
      message: "A finite PCB bend must pass through the board interior",
      bendId
    });
  const centerRegion = movingPolygon(outline, a, b, nx, ny);
  const alongMiddle = -ny * middle.x + nx * middle.y;
  const proximalCrossings = lineCrossings(outline, nx, ny, proximal);
  for (let i = 0; i + 1 < proximalCrossings.length; i++) {
    const left = proximalCrossings[i], right = proximalCrossings[i + 1];
    const lo = -ny * left.point.x + nx * left.point.y;
    const hi = -ny * right.point.x + nx * right.point.y;
    if (alongMiddle <= lo + EPS || alongMiddle >= hi - EPS) continue;
    const midpoint = {
      x: (left.point.x + right.point.x) / 2,
      y: (left.point.y + right.point.y) / 2
    };
    if (!pointInPolygon(midpoint, outline, false)) continue;
    const region = movingPolygon(outline, left, right, nx, ny);
    if (region.some((p) => p.x * nx + p.y * ny < proximal - EPS) || centerRegion.some((p) => !pointInPolygon(p, region)) || region.some(
      (p) => p.x * nx + p.y * ny >= center - EPS && !pointInPolygon(p, centerRegion)
    ))
      break;
    return region;
  }
  throw new PcbFoldError({
    code: "invalid_finite_bend_region",
    message: "The finite PCB bend zone must remain in one connected board cross-section",
    bendId
  });
}
function polygonsTouch(a, b) {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a)))
    return true;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
      if (cross(p, q, r) * cross(p, q, s) < -EPS && cross(r, s, p) * cross(r, s, q) < -EPS)
        return true;
    }
  return false;
}

// lib/pcb-fold.ts
var EPS2 = 1e-7;
function createPcbFold(records, thickness, { outline } = {}) {
  if (!Number.isFinite(thickness) || thickness < 0)
    throw new Error("Board thickness must be finite and nonnegative");
  if (outline && (outline.length < 3 || outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
    throw new Error(
      "A finite board outline with at least three points is required"
    );
  const bends = records.map((b) => {
    const { start, end, bend_angle: degrees, bend_radius: radius } = b;
    const values = [start?.x, start?.y, end?.x, end?.y, degrees, radius];
    if (values.some((v) => !Number.isFinite(v)) || radius <= thickness / 2 || !["left", "right"].includes(b.bend_side)) {
      throw new PcbFoldError({
        code: "invalid_bend_geometry",
        message: `Invalid PCB bend ${b.pcb_bend_id}: finite geometry and radius greater than half the board thickness are required`,
        bendId: b.pcb_bend_id
      });
    }
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < EPS2 || Math.abs(degrees) > 180)
      throw new PcbFoldError({
        code: "unsupported_bend_geometry",
        message: `Unsupported PCB bend ${b.pcb_bend_id}: distinct endpoints and angles within \xB1180 degrees are required`,
        bendId: b.pcb_bend_id
      });
    const sign = b.bend_side === "right" ? 1 : -1;
    const nx = sign * (end.y - start.y) / length;
    const ny = -sign * (end.x - start.x) / length;
    const angle = degrees * Math.PI / 180;
    const width = radius * Math.abs(angle);
    const center = start.x * nx + start.y * ny;
    const geometry = {
      id: b.pcb_bend_id,
      nx,
      ny,
      start: center - width / 2,
      end: center + width / 2,
      angle,
      radius,
      axisMin: Math.min(
        -ny * start.x + nx * start.y,
        -ny * end.x + nx * end.y
      ),
      axisMax: Math.max(
        -ny * start.x + nx * start.y,
        -ny * end.x + nx * end.y
      )
    };
    if (outline && Math.abs(angle) > EPS2)
      geometry.movingOutline = getFiniteBendRegion({
        bendId: b.pcb_bend_id,
        outline,
        nx,
        ny,
        center,
        proximal: geometry.start,
        axisMin: geometry.axisMin,
        axisMax: geometry.axisMax
      });
    return geometry;
  }).filter((b) => Math.abs(b.angle) > EPS2);
  const first = bends[0];
  if (first && bends.some(
    (b) => Math.abs(b.nx - first.nx) > EPS2 || Math.abs(b.ny - first.ny) > EPS2
  )) {
    throw new PcbFoldError({
      code: "nonparallel_bends",
      message: "Folded PCB rendering currently requires parallel bends with the same moving direction"
    });
  }
  bends.sort((a, b) => a.start - b.start);
  for (let i = 0; i < bends.length; i++)
    for (let j = i + 1; j < bends.length; j++) {
      const a = bends[i], b = bends[j];
      if (b.start < a.end - EPS2 && (!a.movingOutline || !b.movingOutline || polygonsTouch(a.movingOutline, b.movingOutline)))
        throw new PcbFoldError({
          code: "overlapping_bend_zones",
          message: "Overlapping PCB bend zones are not supported",
          bendId: b.id
        });
    }
  const distalFirst = [...bends].reverse();
  const transform = ({
    p,
    anchor,
    direction
  }) => {
    let result = { ...p };
    for (const b of distalFirst) {
      if (b.movingOutline && !pointInPolygon(anchor, b.movingOutline)) continue;
      const width = b.end - b.start;
      const s = anchor.x * b.nx + anchor.y * b.ny - b.start;
      const q = Math.max(0, Math.min(width, s));
      const theta = b.angle * q / width;
      const cos = Math.cos(theta), sin = Math.sin(theta);
      const projected = result.x * b.nx + result.y * b.ny - (direction ? 0 : b.start);
      const tangentX = result.x - (projected + (direction ? 0 : b.start)) * b.nx;
      const tangentY = result.y - (projected + (direction ? 0 : b.start)) * b.ny;
      const signedRadius = Math.sign(b.angle) * b.radius;
      const tx = direction ? 0 : signedRadius * sin - q * cos;
      const tz = direction ? 0 : signedRadius * (1 - cos) - q * sin;
      const folded = projected * cos - result.z * sin + tx;
      result = {
        x: tangentX + (folded + (direction ? 0 : b.start)) * b.nx,
        y: tangentY + (folded + (direction ? 0 : b.start)) * b.ny,
        z: projected * sin + result.z * cos + tz
      };
    }
    return result;
  };
  const inverse = ({
    p,
    anchor,
    direction
  }) => {
    const origin = direction ? { x: 0, y: 0, z: 0 } : transform({
      p: { x: 0, y: 0, z: 0 },
      anchor,
      direction: false
    });
    const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
    const axes2 = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 }
    ].map((v) => transform({ p: v, anchor, direction: true }));
    const dot = (v) => v.x * d.x + v.y * d.y + v.z * d.z;
    return { x: dot(axes2[0]), y: dot(axes2[1]), z: dot(axes2[2]) };
  };
  return {
    bends,
    inversePoint: (p, anchor) => inverse({ p, anchor, direction: false }),
    inverseDirection: (p, anchor) => inverse({ p, anchor, direction: true }),
    point: (p, anchor = p) => transform({ p, anchor, direction: false }),
    direction: (p, anchor) => transform({ p, anchor, direction: true }),
    assertRigid(points, label) {
      for (const b of bends) {
        const width = b.end - b.start;
        const progress = points.map(
          (p) => b.movingOutline && !pointInPolygon(p, b.movingOutline) ? 0 : Math.max(0, Math.min(width, p.x * b.nx + p.y * b.ny - b.start))
        );
        if (Math.max(...progress) > EPS2 && Math.min(...progress) < width - EPS2)
          throw new PcbFoldError({
            code: "rigid_bend_zone_intersection",
            message: `${label} intersects PCB bend zone ${b.id}`,
            bendId: b.id
          });
      }
    }
  };
}
function tryCreatePcbFold(records, thickness, options = {}) {
  return capturePcbFoldResult(() => createPcbFold(records, thickness, options));
}

// lib/surface.ts
var EPS3 = 1e-7;
function boundsOfTriangles(triangles) {
  const points = triangles.flatMap((t) => t.vertices);
  if (!points.length)
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points)
    for (const key of ["x", "y", "z"]) {
      min[key] = Math.min(min[key], p[key]);
      max[key] = Math.max(max[key], p[key]);
    }
  return { min, max };
}
function foldSurfaceMesh(mesh, fold) {
  const planes = fold.bends.flatMap((b) => {
    const steps = Math.ceil(Math.abs(b.angle) / (Math.PI / 36));
    return Array.from({ length: steps + 1 }, (_, i) => ({
      b,
      d: b.start + (b.end - b.start) * i / steps
    }));
  });
  const { min, max } = mesh.boundingBox;
  const split = ({
    polygon,
    nx,
    ny,
    d
  }) => {
    const distances = polygon.map(({ p }) => nx * p.x + ny * p.y - d);
    if (Math.min(...distances) >= -EPS3 || Math.max(...distances) <= EPS3)
      return [polygon];
    const halves = [[], []];
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], next = (i + 1) % polygon.length, b = polygon[next];
        const da = distances[i] * sign, db = distances[next] * sign;
        if (da >= -EPS3) halves[side].push(a);
        if (da > EPS3 && db < -EPS3 || da < -EPS3 && db > EPS3) {
          const t = da / (da - db);
          halves[side].push({
            p: {
              x: a.p.x + (b.p.x - a.p.x) * t,
              y: a.p.y + (b.p.y - a.p.y) * t,
              z: a.p.z + (b.p.z - a.p.z) * t
            },
            uv: {
              u: a.uv.u + (b.uv.u - a.uv.u) * t,
              v: a.uv.v + (b.uv.v - a.uv.v) * t
            }
          });
        }
      }
    }
    return halves.filter((p) => p.length >= 3);
  };
  const triangles = [];
  for (const triangle of mesh.triangles) {
    const face = triangle.pcbFace ?? (triangle.normal.z > 0.8 ? "top" : triangle.normal.z < -0.8 ? "bottom" : "side");
    let polygons = [
      triangle.vertices.map((p, index) => ({
        p,
        uv: triangle.uvs?.[index] ?? {
          u: (p.x - min.x) / (max.x - min.x),
          v: 1 - (p.y - min.y) / (max.y - min.y)
        }
      }))
    ];
    for (const { b, d } of planes)
      polygons = polygons.flatMap(
        (p) => split({ polygon: p, nx: b.nx, ny: b.ny, d })
      );
    for (const polygon of polygons) {
      for (const b of fold.bends) {
        if (b.movingOutline) continue;
        const mid = polygon.reduce((sum, { p }) => sum + p.x * b.nx + p.y * b.ny, 0) / polygon.length;
        if (mid > b.start + EPS3 && mid < b.end - EPS3 && polygon.some(({ p }) => {
          const along = -b.ny * p.x + b.nx * p.y;
          return along < b.axisMin - EPS3 || along > b.axisMax + EPS3;
        }))
          throw new PcbFoldError({
            code: "incomplete_bend_cross_section",
            message: `PCB bend ${b.id} must span the full board cross-section through its bend zone`,
            bendId: b.id
          });
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        const verts = [polygon[0], polygon[i], polygon[i + 1]];
        const vertices = verts.map(
          ({ p }) => fold.point(p)
        );
        const [a, b, c] = vertices;
        const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const n = {
          x: u.y * v.z - u.z * v.y,
          y: u.z * v.x - u.x * v.z,
          z: u.x * v.y - u.y * v.x
        };
        const l = Math.hypot(n.x, n.y, n.z);
        if (l < 1e-12) continue;
        triangles.push({
          ...triangle,
          vertices,
          normal: { x: n.x / l, y: n.y / l, z: n.z / l },
          pcbFace: face,
          uvs: verts.map(({ uv }) => uv)
        });
      }
    }
  }
  return { ...mesh, triangles, boundingBox: boundsOfTriangles(triangles) };
}
function tryFoldSurfaceMesh(mesh, fold) {
  return capturePcbFoldResult(() => foldSurfaceMesh(mesh, fold));
}

// lib/cad.ts
var axes = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 }
];
function rotateVector(v, degrees) {
  const [x, y, z] = [degrees.x, degrees.y, degrees.z].map(
    (a2) => a2 * Math.PI / 180
  );
  const a = {
    x: Math.cos(z) * v.x - Math.sin(z) * v.y,
    y: Math.sin(z) * v.x + Math.cos(z) * v.y,
    z: v.z
  };
  const b = {
    x: Math.cos(y) * a.x + Math.sin(y) * a.z,
    y: a.y,
    z: -Math.sin(y) * a.x + Math.cos(y) * a.z
  };
  return {
    x: b.x,
    y: Math.cos(x) * b.y - Math.sin(x) * b.z,
    z: Math.sin(x) * b.y + Math.cos(x) * b.z
  };
}
function rotationFromAxes([a, b, c]) {
  const y = Math.asin(Math.max(-1, Math.min(1, c.x)));
  const regular = Math.abs(c.x) < 1 - 1e-12;
  return {
    x: (regular ? Math.atan2(-c.y, c.z) : Math.atan2(b.z, b.y)) * 180 / Math.PI,
    y: y * 180 / Math.PI,
    z: (regular ? Math.atan2(-b.x, a.x) : 0) * 180 / Math.PI
  };
}
function transformCadComponent({ cadComponent, foldPcbs }, context) {
  return transformCadComponentPlacement(
    { cadComponentPlacement: cadComponent, foldPcbs },
    context
  );
}
function transformCadComponentPlacement({
  cadComponentPlacement,
  foldPcbs
}, context) {
  if (cadComponentPlacement.is_on_folded_board === true === foldPcbs)
    return cadComponentPlacement;
  const { fold, boardCenter, flatMount } = context;
  const anchor = {
    x: flatMount.x - boardCenter.x,
    y: flatMount.y - boardCenter.y,
    z: 0
  };
  fold.assertRigid([anchor], "CAD mount");
  const point = {
    x: cadComponentPlacement.position.x - boardCenter.x,
    y: cadComponentPlacement.position.y - boardCenter.y,
    z: cadComponentPlacement.position.z
  };
  const direction = foldPcbs ? fold.direction : fold.inverseDirection;
  const transformed = foldPcbs ? fold.point(point, anchor) : fold.inversePoint(point, anchor);
  const rotation = cadComponentPlacement.rotation ?? context.defaultRotation ?? { x: 0, y: 0, z: 0 };
  const basis = axes.map((v) => direction(rotateVector(v, rotation), anchor));
  return {
    ...cadComponentPlacement,
    position: {
      x: transformed.x + boardCenter.x,
      y: transformed.y + boardCenter.y,
      z: transformed.z
    },
    rotation: rotationFromAxes(basis),
    is_on_folded_board: foldPcbs
  };
}
function getCadFoldContext(cadComponent, json) {
  const pcb = json.find(
    (e) => e.type === "pcb_component" && e.pcb_component_id === cadComponent.pcb_component_id
  );
  if (pcb?.type !== "pcb_component") {
    if (cadComponent.is_on_folded_board)
      throw new Error(
        `Folded CAD ${cadComponent.cad_component_id} requires its flat pcb_component reference`
      );
    return void 0;
  }
  const boards = json.filter((e) => e.type === "pcb_board");
  const explicit = pcb.positioned_relative_to_pcb_board_id;
  const matching = explicit ? boards.filter((b) => b.pcb_board_id === explicit) : boards.filter(
    (b) => b.subcircuit_id && b.subcircuit_id === pcb.subcircuit_id
  );
  const board = matching.length === 1 ? matching[0] : !explicit && !matching.length && boards.length === 1 ? boards[0] : void 0;
  if (!board)
    throw new Error(
      `Cannot unambiguously resolve board for CAD ${cadComponent.cad_component_id}`
    );
  const bends = json.filter(
    (e) => e.type === "pcb_bend" && e.pcb_board_id === board.pcb_board_id
  );
  return {
    fold: createPcbFold(bends, board.thickness ?? 1.6, {
      outline: board.outline?.map((p) => ({
        x: p.x - board.center.x,
        y: p.y - board.center.y
      }))
    }),
    boardCenter: board.center,
    flatMount: pcb.center,
    defaultRotation: {
      x: (cadComponent.layer ?? pcb.layer) === "bottom" ? 180 : 0,
      y: 0,
      z: 0
    }
  };
}
function transformCircuitJsonCadComponents(json, options) {
  const hasBends = json.some((element) => element.type === "pcb_bend");
  return json.map((element) => {
    if (element.type !== "cad_component") return element;
    const cadComponent = element;
    if (!hasBends && !cadComponent.is_on_folded_board) return element;
    if (cadComponent.is_on_folded_board === true === options.foldPcbs)
      return element;
    const context = getCadFoldContext(cadComponent, json);
    if (!context || !context.fold.bends.length && !cadComponent.is_on_folded_board)
      return element;
    return transformCadComponent(
      { cadComponent, foldPcbs: options.foldPcbs },
      context
    );
  });
}

// lib/polygon.ts
import earcut from "earcut";
function extrudePolygon({
  outline,
  bottom,
  top
}) {
  if (outline.length < 3 || !Number.isFinite(bottom) || !Number.isFinite(top) || top <= bottom || outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error(
      "A finite polygon and positive extrusion thickness are required"
    );
  let area = 0;
  for (const [i, a] of outline.entries()) {
    const b = outline[(i + 1) % outline.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < 1e-12) throw new Error("Degenerate polygon");
  const polygon = area > 0 ? outline : [...outline].reverse();
  const triangles = [];
  const add = ({
    a,
    b,
    c,
    pcbFace
  }) => {
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const n = {
      x: u.y * v.z - u.z * v.y,
      y: u.z * v.x - u.x * v.z,
      z: u.x * v.y - u.y * v.x
    };
    const l = Math.hypot(n.x, n.y, n.z);
    if (l > 1e-12)
      triangles.push({
        vertices: [a, b, c],
        normal: { x: n.x / l, y: n.y / l, z: n.z / l },
        pcbFace
      });
  };
  const indices = earcut(polygon.flatMap((p) => [p.x, p.y]));
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((j) => polygon[j]);
    add({
      a: { ...a, z: top },
      b: { ...b, z: top },
      c: { ...c, z: top },
      pcbFace: "top"
    });
    add({
      a: { ...c, z: bottom },
      b: { ...b, z: bottom },
      c: { ...a, z: bottom },
      pcbFace: "bottom"
    });
  }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    add({
      a: { ...a, z: bottom },
      b: { ...b, z: bottom },
      c: { ...b, z: top },
      pcbFace: "side"
    });
    add({
      a: { ...a, z: bottom },
      b: { ...b, z: top },
      c: { ...a, z: top },
      pcbFace: "side"
    });
  }
  return { triangles, boundingBox: boundsOfTriangles(triangles) };
}

// lib/rigid.ts
function foldRigidMesh(mesh, fold, { flatAnchor, label = "Rigid mesh", mount }) {
  if (mount) fold.assertRigid([mount], `${label} mount`);
  fold.assertRigid(
    mesh.triangles.flatMap((t) => t.vertices),
    label
  );
  const triangles = mesh.triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map(
      (p) => fold.point(p, flatAnchor)
    ),
    normal: fold.direction(t.normal, flatAnchor)
  }));
  return { ...mesh, triangles, boundingBox: boundsOfTriangles(triangles) };
}
function tryFoldRigidMesh(mesh, fold, options) {
  return capturePcbFoldResult(() => foldRigidMesh(mesh, fold, options));
}

// lib/stiffener.ts
function getStiffenerOutline(stiffener) {
  if (stiffener.shape === "polygon") return stiffener.outline;
  if (!(stiffener.width > 0 && stiffener.height > 0))
    throw new Error("Invalid stiffener dimensions");
  const a = (stiffener.rotation ?? 0) * Math.PI / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([x, y]) => ({
    x: stiffener.center.x + x * stiffener.width / 2 * Math.cos(a) - y * stiffener.height / 2 * Math.sin(a),
    y: stiffener.center.y + x * stiffener.width / 2 * Math.sin(a) + y * stiffener.height / 2 * Math.cos(a)
  }));
}
function getStiffenerAnchor(outline) {
  return {
    x: outline.reduce((s, p) => s + p.x, 0) / outline.length,
    y: outline.reduce((s, p) => s + p.y, 0) / outline.length,
    z: 0
  };
}
function createStiffenerMesh({
  stiffener,
  boardThickness,
  fold
}) {
  const adhesive = stiffener.adhesive_thickness ?? 0;
  if (!Number.isFinite(adhesive) || adhesive < 0 || !Number.isFinite(stiffener.thickness) || stiffener.thickness <= 0 || !["top", "bottom"].includes(stiffener.layer))
    throw new Error(`Invalid PCB stiffener ${stiffener.pcb_stiffener_id}`);
  const outline = getStiffenerOutline(stiffener);
  const near = boardThickness / 2 + adhesive, far = near + stiffener.thickness;
  const mesh = extrudePolygon({
    outline,
    bottom: stiffener.layer === "top" ? near : -far,
    top: stiffener.layer === "top" ? far : -near
  });
  if (!fold) return mesh;
  return foldRigidMesh(mesh, fold, {
    flatAnchor: getStiffenerAnchor(outline),
    label: stiffener.pcb_stiffener_id
  });
}
function tryFoldStiffenerMesh(mesh, stiffener, fold) {
  return tryFoldRigidMesh(mesh, fold, {
    flatAnchor: getStiffenerAnchor(getStiffenerOutline(stiffener)),
    label: stiffener.pcb_stiffener_id
  });
}
export {
  PcbFoldError,
  boundsOfTriangles,
  createPcbFold,
  createStiffenerMesh,
  extrudePolygon,
  foldRigidMesh,
  foldSurfaceMesh,
  getCadFoldContext,
  rotateVector,
  transformCadComponent,
  transformCadComponentPlacement,
  transformCircuitJsonCadComponents,
  tryCreatePcbFold,
  tryFoldRigidMesh,
  tryFoldStiffenerMesh,
  tryFoldSurfaceMesh
};
