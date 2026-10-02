import type { PcbBendRecord, Point2 } from "../../lib"

/** Board-local XY, +Z above, mm; same outline as the core two-arm regression. */
export const twoArmOutline: Point2[] = [
  { x: -20, y: -10 },
  { x: 20, y: -10 },
  { x: 20, y: -4 },
  { x: 40, y: -4 },
  { x: 40, y: 4 },
  { x: 20, y: 4 },
  { x: 20, y: 10 },
  { x: 4, y: 10 },
  { x: 4, y: 30 },
  { x: -4, y: 30 },
  { x: -4, y: 10 },
  { x: -20, y: 10 },
]

export const topArmBend: PcbBendRecord = {
  type: "pcb_bend",
  pcb_bend_id: "top_arm",
  pcb_board_id: "board",
  start: { x: -4, y: 20 },
  end: { x: 4, y: 20 },
  bend_angle: 90,
  bend_radius: 1,
  bend_side: "left",
}

export const rightArmBend: PcbBendRecord = {
  ...topArmBend,
  pcb_bend_id: "right_arm",
  start: { x: 30, y: -4 },
  end: { x: 30, y: 4 },
  bend_side: "right",
}

export const topMount = { x: 0, y: 25, z: 0.06 }
export const rightMount = { x: 35, y: 0, z: 0.06 }
