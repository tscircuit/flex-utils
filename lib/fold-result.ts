/** Expected reasons that valid flat geometry cannot be folded. */
export interface PcbFoldIssue {
  code:
    | "invalid_bend_geometry"
    | "unsupported_bend_geometry"
    | "nonparallel_bends"
    | "overlapping_bend_zones"
    | "invalid_finite_bend_region"
    | "incomplete_bend_cross_section"
    | "rigid_bend_zone_intersection"
  message: string
  bendId?: string
}

/** Strict folding APIs throw this error for expected folding limitations.
 * Invalid flat meshes and unexpected failures remain ordinary exceptions.
 */
export class PcbFoldError extends Error {
  constructor(public readonly issue: PcbFoldIssue) {
    super(issue.message)
    this.name = "PcbFoldError"
  }
}

export type PcbFoldResult<T> =
  | { ok: true; value: T }
  | { ok: false; issue: PcbFoldIssue }

/** Internal bridge between strict and result APIs. Never swallow model,
 * geometry, or programming errors that are not declared folding limitations.
 */
export function capturePcbFoldResult<T>(fold: () => T): PcbFoldResult<T> {
  try {
    return { ok: true, value: fold() }
  } catch (error) {
    if (!(error instanceof PcbFoldError)) throw error
    return { ok: false, issue: error.issue }
  }
}
