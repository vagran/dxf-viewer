import { Vector2, Matrix3, Box2 } from "three"
import { IntersectSegmentsParametric } from "../math/utils"

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
     * @param {[Vector2, Vector2]} line Line segment defined by start and end points. Assuming start
     *  and end points lie out of the boundary loops specified in the constructor.
     * @returns {[Vector2, Vector2][]} clipped line segments
     */
    ClipLine(line) {
        //XXX just odd parity now

        const n = this.boundaryPaths.length
        const nodes = []
        for (let i = 0; i < n; i++) {
            this._GetLoopIntersections(line, this.boundaryPaths[i], i, nodes)
        }

        /** Sort nodes from line start to end. */
        nodes.sort((a, b) => a.lineParam - b.lineParam)

        //XXX clip colinear
        return this._GenerateClippedSegments(line, nodes)
        // return [line]//XXX
    }

    /**
     * @param {Vector2} seedPoint Pattern seed point coordinates in OCS.
     * @param {?number} angle Pattern rotation angle in radians.
     * @param {?number} scale Pattern scale.
     * @return {Matrix3} Transformation from OCS to pattern space.
     */
    GetPatternTransform({seedPoint, angle, scale}) {
        const m = new Matrix3().makeTranslation(-seedPoint.x, -seedPoint.y)
        if (angle) {
            /* Matrix3.rotate() inverts angle sign. */
            m.rotate(angle)
        }
        if ((scale ?? 1) != 1) {
            m.scale(1 / scale, 1 / scale)
        }
        return m
    }

    /**
     * @param {Matrix3} patTransform Transformation from OCS to pattern space previously obtained by
     *      GetPatternTransform() method.
     * @param {?Vector2} basePoint Line base point coordinate in pattern space.
     * @param {?number} angle Line direction angle in radians, CCW from +X direction.
     * @return {Matrix3} Transformation from OCS to pattern line space. Line is started at origin
     *  and directed into position X axis direction.
     */
    GetLineTransform({patTransform, basePoint, angle}) {
        const m = patTransform.clone()
        if (basePoint) {
            m.translate(-basePoint.x, -basePoint.y)
        }
        if (angle) {
            /* Matrix3.rotate() inverts angle sign. */
            m.rotate(angle)
        }
        return m
    }

    /**
     * @param {Matrix3} transform Transformation from OCS to target coordinates space.
     * @return {Box2} Pattern AABB in target coordinate space.
     */
    GetBoundingBox(transform) {
        const box = new Box2()
        for (const path of this.boundaryPaths) {
            for (const v of path) {
                box.expandByPoint(v.clone().applyMatrix3(transform))
            }
        }
        return box
    }

    /**
     * @typedef LineNode
     * @property {number} lineParam Line parameter of the intersection point (0 for line start
     *  point, 1 - for end).
     * @property {number} loopIndex Index of the loop intersected with.
     * @property {number} edgeIndex Index of the intersected edge in the loop.
     * @property {boolean} side Side of the edge intersected with.
     */

    /**
     * @param {Vector2[2]} line Line segment defined by start and end points.
     * @param {Vector2[2]} edge Edge segment defined by start and end points.
     * @param {number} loopIndex Index of the loop the specified edge belongs to.
     * @return {?LineNode} Intersection node, null if no intersection or colinear edge.
     */
    _GetEdgeIntersection(line, edge, loopIndex, edgeIndex) {
        const params = IntersectSegmentsParametric(line[0], line[1], edge[0], edge[1])
        if (!params) {
            return null
        }
        return {
            lineParam: params[0],
            loopIndex,
            edgeIndex,
            side: params[2] > 0
        }
    }

    /**
     * Calculate intersections for the specified loop.
     * @param {Vector2[2]} line Line segment defined by start and end points.
     * @param {Vector2[]} loop Loop points.
     * @param {number} loopIndex Index of the loop.
     * @param {LineNode[]} result Intersection nodes appended to this array.
     */
    _GetLoopIntersections(line, loop, loopIndex, result) {
        const n = loop.length
        for (let i = 0; i < n; i++) {
            const iNext = i == n - 1 ? 0 : i + 1
            const node = this._GetEdgeIntersection(line, [loop[i], loop[iNext]], loopIndex, i)
            if (node) {
                result.push(node)
            }
        }
        return result
    }

    /**
     * Produce list of clipped line segment based on the provided list of intersection nodes.
     * @param {Vector2[2]} line Line segment defined by start and end points.
     * @param {LineNode[]} nodes
     * @return {Vector2[2][]} List of clipped line segments.
     */
    _GenerateClippedSegments(line, nodes) {
        const lineDir = line[1].clone().sub(line[0])
        /* False when segment is clipped out, true when it is drawn. */
        let state = false
        let prevNode = null
        const result = []
        const n = nodes.length
        for (let i = 0; i < n; i++) {
            const node = nodes[i]
            if (prevNode === null || prevNode.loopIndex != node.loopIndex ||
                prevNode.side != node.side || !this._IsConnectedEdges(node, prevNode)) {

                if (state && prevNode !== null &&
                    (node.lineParam - prevNode.lineParam) > Number.EPSILON) {

                    /* New segment is generated. */
                    result.push([lineDir.clone().multiplyScalar(prevNode.lineParam).add(line[0]),
                                 lineDir.clone().multiplyScalar(node.lineParam).add(line[0])])
                }
                state = !state
            }
            prevNode = node
        }
        return result
    }

    /**
     * @param {LineNode} node1
     * @param {LineNode} node2
     * @return {boolean} True if intersected edges are connected edges of one loop.
     */
    _IsConnectedEdges(node1, node2) {
        if (node1.loopIndex != node2.loopIndex) {
            return false
        }
        const n = this.boundaryPaths[node1.loopIndex].length

        function GetPrev(i) {
            return i == 0 ? n - 1 : i - 1
        }

        function GetNext(i) {
            i == n - 1 ? 0 : i + 1
        }

        return GetPrev(node1.edgeIndex) == node2.edgeIndex ||
               GetNext(node1.edgeIndex) == node2.edgeIndex
    }
}
