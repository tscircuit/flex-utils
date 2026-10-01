import { CadComponent, AnyCircuitElement, PcbStiffener } from 'circuit-json';

interface Point2 {
    x: number;
    y: number;
}
interface Point3 {
    x: number;
    y: number;
    z: number;
}
interface Triangle {
    vertices: [Point3, Point3, Point3];
    normal: Point3;
    uvs?: [
        {
            u: number;
            v: number;
        },
        {
            u: number;
            v: number;
        },
        {
            u: number;
            v: number;
        }
    ];
    pcbFace?: "top" | "bottom" | "side";
}
interface SurfaceMesh {
    triangles: Triangle[];
    boundingBox: {
        min: Point3;
        max: Point3;
    };
}

/** Expected reasons that valid flat geometry cannot be folded. */
interface PcbFoldIssue {
    code: "invalid_bend_geometry" | "unsupported_bend_geometry" | "nonparallel_bends" | "overlapping_bend_zones" | "invalid_finite_bend_region" | "incomplete_bend_cross_section" | "rigid_bend_zone_intersection";
    message: string;
    bendId?: string;
}
/** Strict folding APIs throw this error for expected folding limitations.
 * Invalid flat meshes and unexpected failures remain ordinary exceptions.
 */
declare class PcbFoldError extends Error {
    readonly issue: PcbFoldIssue;
    constructor(issue: PcbFoldIssue);
}
type PcbFoldResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    issue: PcbFoldIssue;
};

/** Circuit JSON bend geometry, board-local +Z up, millimeters. */
interface PcbBendRecord {
    type: "pcb_bend";
    pcb_bend_id: string;
    pcb_board_id: string;
    name?: string;
    pcb_group_id?: string;
    subcircuit_id?: string;
    start: {
        x: number;
        y: number;
    };
    end: {
        x: number;
        y: number;
    };
    bend_angle: number;
    bend_radius: number;
    bend_side: "left" | "right";
}
interface Bend {
    id: string;
    nx: number;
    ny: number;
    start: number;
    end: number;
    angle: number;
    radius: number;
    axisMin: number;
    axisMax: number;
    movingOutline?: readonly Point2[];
}
/** Points/directions in board-local Circuit JSON: +Z up, mm. */
interface PcbFold {
    bends: Bend[];
    point(point: Point3, flatAnchor?: Point3): Point3;
    inversePoint(point: Point3, flatAnchor: Point3): Point3;
    inverseDirection(direction: Point3, flatAnchor: Point3): Point3;
    direction(direction: Point3, flatAnchor: Point3): Point3;
    assertRigid(points: Point3[], label: string): void;
}
interface PcbFoldOptions {
    /** Simple board outline, board-local XY in millimeters. Enables finite chords. */
    outline?: readonly Point2[];
}
/** Parallel bends with the same moving direction form an ordered fold chain.
 * Input endpoints and returned transforms are board-local Circuit JSON (+Z up, mm).
 * Ordering comes from geometry, never from Circuit JSON array order.
 */
declare function createPcbFold(records: PcbBendRecord[], thickness: number, { outline }?: PcbFoldOptions): PcbFold;
/** Construct a board-local (+Z up, mm) fold, reporting expected folding
 * limitations as data. Malformed board geometry and unexpected errors throw.
 */
declare function tryCreatePcbFold(records: PcbBendRecord[], thickness: number, options?: PcbFoldOptions): PcbFoldResult<PcbFold>;

declare function boundsOfTriangles(triangles: Triangle[]): {
    min: {
        x: number;
        y: number;
        z: number;
    };
    max: {
        x: number;
        y: number;
        z: number;
    };
};
/** Tessellate at tangencies and <=5 degree arc steps, then deform in board-local
 * Circuit JSON (+Z up, mm). Preserve flat UVs, face labels and triangle metadata.
 */
declare function foldSurfaceMesh<T extends SurfaceMesh>(mesh: T, fold: PcbFold): T;
/** Tessellate and fold a board-local surface (+Z up, mm), reporting expected
 * unsupported cross-sections as data. Unexpected deformation failures throw.
 */
declare function tryFoldSurfaceMesh<T extends SurfaceMesh>(mesh: T, fold: PcbFold): PcbFoldResult<T>;

type CadComponentWithFoldState = CadComponent & {
    is_on_folded_board?: boolean;
};
/** Right-handed intrinsic XYZ Euler angles in degrees, matching the viewer's
 * THREE.Euler(..., "XYZ"). Vectors apply Z, then Y, then X. */
declare function rotateVector(v: Point3, degrees: Point3): Point3;
interface CadFoldContext {
    fold: PcbFold;
    boardCenter: {
        x: number;
        y: number;
    };
    /** Flat PCB mount, in global Circuit JSON XY. Never derive it from folded CAD. */
    flatMount: {
        x: number;
        y: number;
    };
    defaultRotation?: Point3;
}
type CadComponentPlacement = Pick<CadComponentWithFoldState, "position" | "rotation" | "is_on_folded_board">;
/** Pure, idempotent CAD component placement conversion. Position is global Circuit JSON +Z-up
 * millimeters; rotation is XYZ degrees. Model-origin/scale/normal fields stay
 * model-local. The PCB mount selects the inverse when assembled regions overlap.
 */
declare function transformCadComponent<T extends CadComponentWithFoldState>({ cadComponent, foldPcbs }: {
    cadComponent: T;
    foldPcbs: boolean;
}, context: CadFoldContext): T;
/** Transform a CAD component placement before a circuit-json record/id exists. Coordinates
 * and rotations use the same world-space convention as transformCadComponent.
 */
declare function transformCadComponentPlacement<T extends CadComponentPlacement>({ cadComponentPlacement, foldPcbs, }: {
    cadComponentPlacement: T;
    foldPcbs: boolean;
}, context: CadFoldContext): T;
/** Resolve an explicit board reference, then subcircuit ownership. An ambiguous
 * multi-board association fails rather than guessing from folded coordinates. */
declare function getCadFoldContext(cadComponent: CadComponentWithFoldState, json: AnyCircuitElement[]): CadFoldContext | undefined;
/** Transform CAD records only; PCB traces/components, bends, stiffeners, source
 * records and the caller's input array are left untouched. Mixed flat/folded CAD
 * is normalized record-by-record, so repeated calls cannot double-fold a placement. */
declare function transformCircuitJsonCadComponents<T extends AnyCircuitElement>(json: T[], options: {
    foldPcbs: boolean;
}): T[];

/** Extrude a simple polygon in board-local Circuit JSON (+Z up, mm).
 * Used for stiffeners and uncut board surfaces; face labels survive folding. */
declare function extrudePolygon({ outline, bottom, top, }: {
    outline: {
        x: number;
        y: number;
    }[];
    bottom: number;
    top: number;
}): SurfaceMesh;

/** Stiffener vertices stay board-local (+Z up, mm). Stiffeners are rigid and may
 * not cross a bend zone. Includes the adhesive spacing from the board surface. */
declare function createStiffenerMesh({ stiffener, boardThickness, fold, }: {
    stiffener: PcbStiffener;
    boardThickness: number;
    fold?: PcbFold;
}): SurfaceMesh;
/** Fold an already-created flat stiffener mesh in board-local +Z-up mm.
 * Retains createStiffenerMesh's outline-average anchor and reports bend-zone
 * collisions as data, allowing callers to reuse the same flat mesh on failure.
 */
declare function tryFoldStiffenerMesh<T extends SurfaceMesh>(mesh: T, stiffener: PcbStiffener, fold: PcbFold): PcbFoldResult<T>;

interface RigidFoldOptions {
    /** Board-local flat point (+Z up, mm) selecting one rigid fold transform. */
    flatAnchor: Point3;
    label?: string;
    /** Optional PCB mount, independently checked even if a model offset moves
     * all mesh vertices outside the bend zone. Board-local +Z up, mm.
     */
    mount?: Point3;
}
/** Carry a rigid mesh with its PCB in board-local Circuit JSON (+Z up, mm).
 * Vertices are points; normals are directions and do not receive translation.
 * Preserve triangle metadata and UVs, and leave the input mesh untouched.
 */
declare function foldRigidMesh<T extends SurfaceMesh>(mesh: T, fold: PcbFold, { flatAnchor, label, mount }: RigidFoldOptions): T;
/** Report a rigid mesh/mount intersecting a bend zone as data. Invalid mesh
 * data and unexpected transformation failures throw; no flat policy is chosen.
 */
declare function tryFoldRigidMesh<T extends SurfaceMesh>(mesh: T, fold: PcbFold, options: RigidFoldOptions): PcbFoldResult<T>;

export { type CadComponentPlacement, type CadComponentWithFoldState, type CadFoldContext, type PcbBendRecord, type PcbFold, PcbFoldError, type PcbFoldIssue, type PcbFoldOptions, type PcbFoldResult, type Point2, type Point3, type RigidFoldOptions, type SurfaceMesh, type Triangle, boundsOfTriangles, createPcbFold, createStiffenerMesh, extrudePolygon, foldRigidMesh, foldSurfaceMesh, getCadFoldContext, rotateVector, transformCadComponent, transformCadComponentPlacement, transformCircuitJsonCadComponents, tryCreatePcbFold, tryFoldRigidMesh, tryFoldStiffenerMesh, tryFoldSurfaceMesh };
