const EPSILON = 1e-6

export class HatchCalculator {
  boundaryPaths

  /**
   * Arrays of `Path` to use as boundary, and each `Path` is array of `Point`.
   * 
   * @param {Point[][]} boundaryPaths 
   */
  constructor(boundaryPaths) {
    this.boundaryPaths = boundaryPaths

  }

  /**
   * Clip `line` on masking defined by `boundaryPaths`
   * 
   * @param {[Point, Point]} line 
   * @returns {[Point, Point][]} clipped line segments
   */
  ClipLine(line) {
    // concat
    const intersections = this.boundaryPaths.reduce((intersections, path) => {
      intersections.push(...this._GetIntersections(line, path))
      return intersections
    }, []).sort((a, b) => a - b)

    const isFirstInside = this._IsInside(line[0])
    const segments = isFirstInside
      ? [0, ...intersections]
      : intersections

    return Array.from(new Array(segments.length / 2), (_, i) => {
      const start = [
        line[0].x + (line[1].x - line[0].x) * segments[2 * i],
        line[0].y + (line[1].y - line[0].y) * segments[2 * i],
      ]
      const end = [
        line[0].x + (line[1].x - line[0].x) * segments[2 * i + 1],
        line[0].y + (line[1].y - line[0].y) * segments[2 * i + 1],
      ]
      return [start, end]
    })
  }

  /**
   * Compute intersection of `line` and `path` and return
   * each interpolation constant `t0`s. Note that they're not sorted.
   * Each `t0` is in [0, 1).
   * 
   * @param {[Point, Point]} line 
   * @param {Point[]} path 
   * @returns {number[]} arrays of intersection lerp param t0 for line
   */
  _GetIntersections(line, path) {
    let count = 0
    const result = new Array(path.length)
    for (let i = 0; i < path.length; ++i) {
      const j = (i + 1) % path.length
      const t0 = this._GetIntersection(line, path[i], path[j])

      if (t0 === undefined) continue
      result[count++] = t0
    }
    result.length = count
    return result
  }

  /**
   * Compute intersection of two lines and return `t0` such that
   * line0[0] + t0 * (line0[1] - line0[0]) = intersection of `line1`.
   * 
   * Note that start point of line is inclusive while the other is exclusive.
   * If there is no such `t0`, returns `undefined`
   * 
   * @param {[Point, Point]} line0 
   * @param {[Point, Point]} line1 
   * @returns {number | undefined} t0
   */
  _GetIntersection(line0, line1) {
    const [s0, e0] = line0
    const [s1, e1] = line1
    const diff0 = { x: e0.x - s0.x, y: e0.y - s0.y }
    const diff1 = { x: s1.x - e1.x, y: s1.y - e1.y }
    
    const det = diff0.x * diff1.y - diff0.y * diff1.x
    if (Math.abs(det) < EPSILON) return undefined

    const A = this._GetInverse2x2(
      diff0.x, diff1.x,
      diff0.y, diff1.y,
      det
    )
    const b = { x: s1.x - s0.x, y: s1.y - s0.y }
    const [t0, t1] = this._MatMul(A, b)

    // one side is exclusive to avoid duplicated counting, 
    // when intersection point is exactly a vertex of edges
    if (t0 < 0 || t0 >= 1 || t1 < 0 || t1 >= 1) return undefined
    return t0
  }

  _GetInverse2x2(a00, a01, a10, a11, det) {
    return [
      a11 / det, -a01 / det,
      -a10 / det, a00 / det,
    ]
  }

  _MatMul([a00, a01, a10, a11], b0, b1) {
    return [
      a00 * b0 + a01 * b1,
      a10 * b0 + a11 * b1
    ]
  }

  /**
   * Return whether `point` is inside of union of `paths`
   * 
   * @param {Point} point 
   * @returns {boolean} is `point` inside of union of `paths`
   */
  _IsInside(point) {
    const p = this._GetFarthestCenterOnPath(point)
    const q = [2 * p.x - point.x, 2 * p.y - point.y]

    // use odd even rule
    let count = 0
    for (const path of this.paths) {
      count += this._GetIntersections([point, q], path).length
    }
    return count % 2 === 1
  }

  /**
   * Return the most farthest edge's center point of paths
   * 
   * @param {Point} point 
   * @returns {Point} Farthest center of edges on path
   */
  _GetFarthestCenterOnPath(point) {
    let dMaxPoint = null
    let dMaxSq = 0
    for (const path of this.boundaryPaths) {
      for (let i = 0; i < path.length; ++i) {
        const j = (i + 1) % path.length
        const x = (path[i].x + path[j].x) * 0.5
        const y = (path[i].y + path[j].y) * 0.5
        const dSq = (point.x - x) ** 2 + (point.y - y) ** 2

        if (dMaxSq < dSq) {
          dMaxSq = dSq
          dMaxPoint = { x, y }
        }
      }
    }
    return dMaxPoint
  }
}