# @tscircuit/flex-utils

Renderer-independent flex PCB math, shared by core, 3d-viewer and circuit-json-to-gltf.

```ts
import { transformCircuitJsonCadComponents } from "@tscircuit/flex-utils"

const folded = transformCircuitJsonCadComponents(circuitJson, { foldPcbs: true })
const flat = transformCircuitJsonCadComponents(folded, { foldPcbs: false })
```

These pure functions transform only `cad_component.position` and `rotation`, setting
`is_on_folded_board` to the requested pose. Missing/false means flat; true means
assembled. Mixed inputs and repeated conversions are supported. Model-origin,
model-axis and scale fields remain model-local. PCB components, traces, outlines,
bends and stiffeners always remain flat. The flat `pcb_component` mount and board
association are required for inversion: stacked regions can occupy the same XY.
An ambiguous or missing association fails explicitly rather than guessing.

All math uses right-handed Circuit JSON coordinates, **+Z up, millimeters**, with
CAD rotations in intrinsic XYZ **degrees** (`THREE.Euler` XYZ convention). Board
surface points and bend endpoints are board-local. CAD positions and PCB mounts
are in global Circuit JSON coordinates; board center translation is applied once.
Equivalent Euler triples at gimbal lock may differ, but the pose round-trips.

- `createPcbFold(bends, thickness, { outline })`: finite-radius neutral-surface deformation;
  `point`/`direction`, and `inversePoint`/`inverseDirection` with a **flat anchor**.
- `foldSurfaceMesh(mesh, fold)`: tessellate at tangencies and at most 5-degree arc
  intervals, retaining flat UVs, face identity, and triangle metadata.
- `extrudePolygon({ outline, bottom, top })` / `createStiffenerMesh(...)`: shared
  polygon extrusion and rigid stiffener geometry including adhesive spacing.
- `transformCadComponent` / `getCadFoldContext`: single-component pose helpers.

Provide a simple, board-local outline to make each finite bend segment select the
connected region it cuts off. A bend must cross that region from boundary to
boundary. The curved strip must stay in one cross-section; folds whose moving
region wraps behind its proximal tangent are unsupported. Widened distal tips
are included, and independent tails can have bends at the same position. Omitting
the outline retains the original infinite-line deformation. `getCadFoldContext`
uses the Circuit JSON board outline automatically, translating it to board-local XY.

Initial scope is parallel bend chains sharing a moving direction. Overlapping
bend zones are allowed only on disjoint regions. Without an outline, bend axes
must span the full board cross-section. Rigid mounts and stiffeners cannot
lie in bend zones. Unsupported geometry throws. This package has no Three.js,
GLTF, DOM, native addon, model loader or rendering dependency.

Run `bun test`, `bun run typecheck`, and `bun run build`.

`transformCadComponent({ cadComponent, foldPcbs }, context)` transforms an existing record. `transformCadComponentPlacement({ cadComponentPlacement, foldPcbs }, context)` transforms its position and rotation before a record exists. Both use `CadFoldContext` as the second argument.
