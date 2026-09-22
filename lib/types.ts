export interface Point3 {
  x: number
  y: number
  z: number
}
export interface Triangle {
  vertices: [Point3, Point3, Point3]
  normal: Point3
  uvs?: [
    { u: number; v: number },
    { u: number; v: number },
    { u: number; v: number },
  ]
  pcbFace?: "top" | "bottom" | "side"
}
export interface SurfaceMesh {
  triangles: Triangle[]
  boundingBox: { min: Point3; max: Point3 }
}
