import { Matrix3, Vector2, Box2 } from "three"
import { Matrix2 } from '../math/Matrix2'
import { UnionIntervals } from "./UnionIntervals"

const EPSILON = 1e-6

export const HatchStyle = Object.freeze({
    ODD_PARITY: 0,
    OUTERMOST: 1,
    THROUGH_ENTIRE_AREA: 2
})

export class HatchCalculator {
    boundaryPaths
    style

    /**
     * Arrays of `Path` to use as boundary, and each `Path` is array of `Point`.
     *
     * @param {Vector2[][]} boundaryPaths
     * @param {HatchStyle} style
     */
    constructor(boundaryPaths, style) {
        this.boundaryPaths = boundaryPaths
        this.style = style
    }

    /**
     * Clip `line` using strategy defined by `this.style`
     *
     * @param {[Vector2, Vector2]} line
     * @returns {[Vector2, Vector2][]} clipped line segments
     */
    ClipLine(line) {
        if (this.style === HatchStyle.ODD_PARITY) {
            return this._ClipLineOddParity(line)
        }
        if (this.style === HatchStyle.THROUGH_ENTIRE_AREA) {
            return this._ClipLineUnion(line)
        }
        console.warn('Unsupported hatch style: HatchStyle.OUTERMOST')
        return this._ClipLineUnion(line)
    }

    /**
     * Clip `line` on masking defined by `boundaryPaths`
     *
     * @param {[Vector2, Vector2]} line
     * @returns {[Vector2, Vector2][]} clipped line segments
     */
    _ClipLineOddParity(line) {
        // concat
        const intersections = this.boundaryPaths.reduce((intersections, path) => {
            intersections.push(...this._GetIntersections(line, path))
            return intersections
        }, [])

        const tSegments = this._RefineTSegments(intersections, line[0])
        return this._ToLineSegments(line, tSegments)
    }

    /**
     * Clip `line` on masking defined by union of `boundaryPaths`
     * 
     * @param {[Vector2, Vector2]} line 
     * @returns {[Vector2, Vector2][]} clipped line segments
     */
    _ClipLineUnion(line) {
        const tSegments = this.boundaryPaths.map((path) => {
            const intersections = this._GetIntersections(line, [path])

            if (!intersections.length) return []

            return this._RefineTSegments(intersections, line[0])
        }).reduce((acc, segments) => acc.concat(segments), [])

        if (!tSegments.length) return []

        const unifiedTSegments = UnionIntervals(tSegments)
        return this._ToLineSegments(line, unifiedTSegments)
    }

    /**
     * @return {Matrix3} Transformation from OCS to pattern space.
     */
    GetPatternTransform({seedPoint, basePoint, angle, scale}) {
        const m = Matrix3.makeTranslation(-seedPoint.x, -seedPoint.y)
        if (angle) {
            m.rotate(-angle * Math.PI / 180)
        }
        if ((scale ?? 1) != 1) {
            m.scale(1 / scale, 1 / scale)
        }
        if (basePoint) {
            m.translate(basePoint.x, basePoint.y)
        }
        return m
    }

    /**
     * @param {Matrix3} patTransform Transformation from OCS to pattern space previously obtained by
     *  GetPatternTransform() method.
     * @return {Box2} Pattern AABB in pattern coordinate space.
     */
    GetPatternBoundingBox(patTransform) {
        const box = new Box2()
        for (const path of this.boundaryPaths) {
            for (const v of path) {
                box.expandByPoint(v.clone().applyMatrix3(patTransform))
            }
        }
        return box
    }

    /**
     * Compute intersection of `line` and `path` and return
     * each interpolation constant `t0`s. Note that they're not sorted.
     * Each `t0` is in [0, 1).
     *
     * @param {[Vector2, Vector2]} line
     * @param {Vector2[]} path
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
     * @param {[Vector2, Vector2]} line0
     * @param {[Vector2, Vector2]} line1
     * @returns {number | undefined} t0
     */
    _GetIntersection(line0, line1) {
        const [s0, e0] = line0
        const [s1, e1] = line1
        const diff0 = e0.clone().sub(s0)
        const diff1 = s1.clone().sub(e1)

        const A = (new Matrix2(
            diff0.x, diff1.x,
            diff0.y, diff1.y,
        ))
        const det = A.det()
        if (Math.abs(det) < EPSILON) return undefined

        const AInverse = A.inverse(det)
        const b = s1.clone().sub(s0)
        const { x: t0, y: t1 } = AInverse.multiply(b)

        // one side is exclusive to avoid duplicated counting,
        // when intersection point is exactly a vertex of edges
        if (t0 < 0 || t0 >= 1 || t1 < 0 || t1 >= 1) return undefined
        return t0
    }

    /**
     * Transform relative intersection positions into
     * relative segments on line
     * 
     * @param {number[]} tPoints 
     * @param {Vector2} firstPosition 
     * @returns {[number, number][]}
     */
    _RefineTSegments(tPoints, firstPosition) {
        const isFirstInside = this._IsInside(firstPosition)
        const segments = isFirstInside
            ? [0, ...tPoints]
            : tPoints
        segments.sort((a, b) => a - b)
        return Array.from(new Array(segments.length / 2), (_, i) =>
            [segments[2 * i], segments[2 * i + 1]])
    }

    /**
     * Return whether `point` is inside of union of `paths`
     *
     * @param {Vector2} point
     * @returns {boolean} is `point` inside of union of `paths`
     */
    _IsInside(point) {
        const p = this._GetFarthestCenterOnPath(point)
        const q = p.clone().multiplyScalar(2).sub(point)

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
     * @param {Vector2} point
     * @returns {Vector2} Farthest center of edges on path
     */
    _GetFarthestCenterOnPath(point) {
        let dMaxPoint = null
        let dMaxSq = 0
        for (const path of this.boundaryPaths) {
            for (let i = 0; i < path.length; ++i) {
                const j = (i + 1) % path.length
                const m = path[i].clone().add(path[j]).divideScalar(2)
                const dSq = point.distanceToSquared(m)

                if (dMaxSq < dSq) {
                    dMaxSq = dSq
                    dMaxPoint = m
                }
            }
        }
        return dMaxPoint
    }

    /**
     * Transform relative segments on line into line segments
     * 
     * @param {[Vector2, Vector2]} line - Has start and end point of total line
     * @param {[number, number][]} tSegments - Has intervals in [0, 1]
     * @returns {[Vector2, Vector2][]}
     */
    _ToLineSegments(line, tSegments) {
        const [vs, ve] = line
        const diff = ve.clone().sub(vs)
        return tSegments.map(([t1, t2]) => 
            [
                diff.clone().multiplyScalar(t1).add(vs),
                diff.clone().multiplyScalar(t2).add(vs),
            ]
        )
    }
}
