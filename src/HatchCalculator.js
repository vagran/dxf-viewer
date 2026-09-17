import {Vector2, Matrix3, Box2} from "three"
import {IntersectSegmentsParametric, MatrixRotateCW, MatrixScale,
        MatrixTranslate} from "./math/utils.js"

export const HatchStyle = Object.freeze({
    ODD_PARITY: 0,
    OUTERMOST: 1,
    THROUGH_ENTIRE_AREA: 2
})

/** An intersection this close to an edge endpoint is treated as being at the vertex itself, so
 * that the two edges meeting there are collapsed into a single crossing decision.
 *
 * It is a *distance*, given as a fraction of the boundary's overall size and converted to each
 * edge's parameter space in `_ProcessEdges()`. As a fraction of the edge it would mean the two
 * edges at one vertex disagree about where that vertex ends: a tessellated fillet chord and the
 * wall it runs into differ in length by two orders of magnitude routinely, and the long one then
 * claims every near miss of the corner as a crossing through it -- on top of the real crossing the
 * short one already reported. See `ENDPOINT_MARGIN_MAX`.
 */
const ENDPOINT_MARGIN = 1e-6

/** Upper bound for the converted margin, for an edge shorter than the margin itself. Such an edge
 * is below the resolution the boundary is described at, and taking all of it as "at the vertex" is
 * the intended reading; it must stay under 0.5 so the two ends of one edge cannot both match.
 */
const ENDPOINT_MARGIN_MAX = 0.25

/** Tolerance for "this point sits on that edge", as a fraction of the edge length. Boundary loops
 * of one hatch share corners and whole edges, exactly so in a well-formed file; the margin is for
 * the ones which only nearly do.
 */
const ON_EDGE_MARGIN = 1e-6

/** @return {boolean} True if both edges crossed from the same side, false otherwise. */
function EdgeSameSide(e1, e2) {
    return (e1.intersection[2] > 0 && e2.intersection[2] > 0) ||
           (e1.intersection[2] < 0 && e2.intersection[2] < 0)
}

/** Context for one line clipping calculations. */
class ClipCalculator {

    constructor(boundaryLoops, style, line, endpointMargin) {
        this.style = style
        this.line = line
        this.lineDir = line[1].clone().sub(line[0]).normalize()
        this.endpointMargin = endpointMargin

        this.loops = []
        for (let loopIdx = 0; loopIdx < boundaryLoops.length; loopIdx++) {
            const loop = boundaryLoops[loopIdx]
            const _loop = []
            for (let vtxIdx = 0; vtxIdx < loop.length; vtxIdx++) {
                _loop.push({
                    idx: vtxIdx,
                    start: loop[vtxIdx],
                    end: loop[vtxIdx == loop.length - 1 ? 0 : vtxIdx + 1],
                    loopIdx
                })
            }
            this.loops.push(_loop)
        }
    }

    /**
     * @return {number[2][]} List of resulting line segments in parametric form. Parameter value 0
     *  corresponds to the provided line start point, 1 - to end point.
     */
    Calculate() {
        this._ProcessEdges()
        this._CreateNodes()
        /* Sort from line start towards end. */
        this.nodes.sort((e1, e2) => e1.intersection[0] - e2.intersection[0])
        if (this.style == HatchStyle.THROUGH_ENTIRE_AREA) {
            return this._GenerateThroughAllSegments()
        }
        /* ODD_PARITY and OUTERMOST are differentiated by filtering loops list (for outermost style
         * only external and outermost loop should be left).
         */
        return this._GenerateOddParitySegments()
    }

    _ProcessEdges() {
        for (const loop of this.loops) {
            for (const edge of loop) {
                const edgeVec = edge.end.clone().sub(edge.start)
                const len = edgeVec.length()
                edge.isZero = len <= Number.EPSILON
                if (edge.isZero) {
                    continue
                }
                edge.endMargin = Math.min(this.endpointMargin / len, ENDPOINT_MARGIN_MAX)
                edgeVec.divideScalar(len)
                const a = edgeVec.cross(this.lineDir)
                edge.isParallel = Math.abs(a) <= 1e-6
                if (edge.isParallel) {
                    continue
                }
                edge.intersection = IntersectSegmentsParametric(this.line[0], this.line[1],
                    edge.start, edge.end, true)
                if (!edge.intersection) {
                    /* Missing intersection indicates some degenerative case, treat it as
                     * parallel.
                     */
                    edge.isParallel = true
                }
            }
        }
    }

    /** Create intersection nodes. Each node with `toggle` property set causes line state change, so
     * unnecessary changes should be filtered out inside this method. Node also can suppress or
     * un-suppress line if currently enabled, this is done by setting `suppress` and
     * `unsuppress` properties on the edge.
     */
    _CreateNodes() {
        this.nodes = []
        for (const loop of this.loops) {
            for (let edge of loop) {
                if (edge.isZero || edge.isParallel || edge.isProcessed || !edge.intersection) {
                    continue
                }

                if (edge.intersection[1] < -edge.endMargin ||
                    edge.intersection[1] > 1 + edge.endMargin) {
                    /* No intersection. */
                    continue
                }

                /* Some intersection exists, check if near endpoints. */
                const isStartVtx = edge.intersection[1] <= edge.endMargin
                if (isStartVtx || edge.intersection[1] >= 1 - edge.endMargin) {
                    /* Intersection near start or end vertex, force connected edge check. */
                    let [connEdge, isDirect] = this._GetConnectedEdge(edge, isStartVtx)
                    if (!connEdge) {
                        /* Some invalid case, ignore. */
                        continue
                    }
                    edge.isProcessed = true
                    connEdge.isProcessed = true
                    if (isDirect) {
                        if (EdgeSameSide(edge, connEdge)) {
                            edge.toggle = true
                            this.nodes.push(edge)
                        }
                    } else {
                        /** Connected through colinear edge(s). Mark the first edge to temporarily
                         * disable line if it is enabled. Second edge either toggles the state or
                         * restores previous one.
                         */
                        if (edge.intersection[0] > connEdge.intersection[0]) {
                            /* Set proper order, `edge` is the first intersection, `connEdge` - the
                             * second one.
                             */
                            const tmp = connEdge
                            connEdge = edge
                            edge = tmp
                        }

                        edge.suppress = true
                        connEdge.unsuppress = true

                        this.nodes.push(edge)

                        if (EdgeSameSide(edge, connEdge)) {
                            connEdge.toggle = true
                        }
                        this.nodes.push(connEdge)
                    }

                } else {
                    /* Clean inner intersection. */
                    edge.isProcessed = true
                    edge.toggle = true
                    this.nodes.push(edge)
                }
            }
        }
    }

    /**
     * @param {Edge} edge
     * @param {boolean} isStartVtx True for connected through start vertex, false for end vertex.
     * @return {[?Edge, boolean]} Connected valid edge if found, null if not found (e.g. is the same
     *  edge for some reason). Second value is true if directly connected, false if though colinear
     *  edges.
     */
    _GetConnectedEdge(edge, isStartVtx) {
        const loop = this.loops[edge.loopIdx]
        let i = edge.idx
        let isDirect = true
        do {
            if (isStartVtx) {
                if (i == 0) {
                    i = loop.length - 1
                } else {
                    i--
                }
            } else {
                if (i == loop.length - 1) {
                    i = 0
                } else {
                    i++
                }
            }
            const connEdge = loop[i]
            if (connEdge.isZero || connEdge.isParallel) {
                isDirect = false
            } else {
                return [connEdge, isDirect]
            }
        } while (i != edge.idx)
        return [null, false]
    }

    _GenerateOddParitySegments() {
        const result = []
        let state = false
        /* Incremented with each suppression, decremented with each un-suppression. */
        let suppress = 0
        /* Previous node when line was enabled. */
        let prevNode = null

        for (const node of this.nodes) {
            if (node.suppress) {
                suppress++
            }
            if (node.unsuppress) {
                suppress--
            }
            if (node.toggle) {
                state = !state
            }
            if (suppress == 0 && state && (node.unsuppress || node.toggle)) {
                /* Just started new segment. */
                prevNode = node
            } else if ((suppress || !state) && prevNode) {
                if (node.intersection[0] - prevNode.intersection[0] > Number.EPSILON) {
                    result.push([prevNode.intersection[0], node.intersection[0]])
                }
                prevNode = null
            }
        }

        return result
    }

    _GenerateThroughAllSegments() {
        const result = []
        /* Incremented with each suppression, decremented with each un-suppression. */
        let suppress = 0
        /* Previous node when line was enabled. */
        let prevNode = null
        /** For each loop count number of crossing from each side. One side increments corresponding
         * loop value, other decrements. When all values are zero, line is outside of any loop and
         * should not be rendered.
         */
        const loopStack = new Array(this.loops.length).fill(0)

        function IsOutside() {
            for (const n of loopStack) {
                if (n != 0) {
                    return false
                }
            }
            return true
        }

        for (const node of this.nodes) {
            if (node.suppress) {
                suppress++
            }
            if (node.unsuppress) {
                suppress--
            }
            const wasOutside = IsOutside()
            if (node.toggle) {
                if (node.intersection[2] > 0) {
                    loopStack[node.loopIdx]++
                } else {
                    loopStack[node.loopIdx]--
                }
            }
            if (suppress == 0 && !IsOutside() && (node.unsuppress || wasOutside)) {
                /* Just started new segment. */
                prevNode = node
            } else if ((suppress || IsOutside()) && prevNode) {
                if (node.intersection[0] - prevNode.intersection[0] > Number.EPSILON) {
                    result.push([prevNode.intersection[0], node.intersection[0]])
                }
                prevNode = null
            }
        }

        return result
    }
}

/** Ray casting test. A point lying on the loop itself gets an arbitrary answer, so callers must
 * make sure it does not.
 * @param {Vector2} pt
 * @param {Vector2[]} loop
 * @return {boolean} True if the point is inside the loop.
 */
function IsPointInsideLoop(pt, loop) {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i]
        const b = loop[j]
        if ((a.y > pt.y) != (b.y > pt.y) &&
            pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside
        }
    }
    return inside
}

/**
 * @param {Vector2} pt
 * @param {Vector2[]} loop
 * @return {boolean} True if the point lies on one of the loop's edges.
 */
function IsPointOnLoop(pt, loop) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[j]
        const b = loop[i]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const lenSq = dx * dx + dy * dy
        if (lenSq == 0) {
            continue
        }
        /* Both distances are taken as a fraction of the edge length, which keeps the margin
         * meaningful whatever the drawing's units and magnitude are.
         */
        if (Math.abs(dx * (pt.y - a.y) - dy * (pt.x - a.x)) > ON_EDGE_MARGIN * lenSq) {
            continue
        }
        const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq
        if (t >= -ON_EDGE_MARGIN && t <= 1 + ON_EDGE_MARGIN) {
            return true
        }
    }
    return false
}

/** Nesting test for two loops which do not cross each other, which is what a well-formed hatch
 * boundary guarantees: the whole of `inner` is then on one side of `outer`, so one point of it
 * decides.
 *
 * The point is taken from an edge rather than from a vertex. Boundary loops of one hatch routinely
 * touch - wall segments meeting at a corner, two fills sharing an edge - and a point on the shared
 * part reads as inside the other loop as readily as outside, which would turn a filled loop into
 * its neighbour's hole. Such points are skipped, and only a loop lying entirely on `outer` runs
 * out of them.
 *
 * @param {Vector2[]} inner
 * @param {Vector2[]} outer
 * @return {boolean}
 */
function IsLoopInsideLoop(inner, outer) {
    for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
        const a = inner[j]
        const b = inner[i]
        const pt = new Vector2((a.x + b.x) / 2, (a.y + b.y) / 2)
        if (!IsPointOnLoop(pt, outer)) {
            return IsPointInsideLoop(pt, outer)
        }
    }
    return false
}

export class HatchCalculator {
    boundaryLoops
    style
    /** Lazily computed by `_GetEndpointMargin()`. */
    _endpointMargin

    /**
     * Arrays of `Path` to use as boundary, and each `Path` is array of `Point`.
     *
     * @param {Vector2[][]} boundaryLoops
     * @param {HatchStyle} style
     */
    constructor(boundaryLoops, style) {
        this.boundaryLoops = boundaryLoops
        this.style = style
    }

    /**
     * Clip `line` using strategy defined by `this.style`
     *
     * @param {[Vector2, Vector2]} line Line segment defined by start and end points. Assuming start
     *  and end points lie out of the boundary loops specified in the constructor.
     * @returns {[number, number][]} Parameter ranges along the input line which are inside the
     *  boundary, ordered and non-overlapping. Zero is the start point and one is the end point, so
     *  the caller scales them back out along the line vector.
     */
    ClipLine(line) {
        return new ClipCalculator(this.boundaryLoops, this.style, line,
                                  this._GetEndpointMargin()).Calculate()
    }

    /** @return {number} `ENDPOINT_MARGIN` as a distance in the boundary's own units. Taken from
     *  the boundary's bounding box so that it means the same thing whatever the drawing's scale,
     *  and computed once: a patterned hatch clips tens of thousands of lines against these loops.
     */
    _GetEndpointMargin() {
        if (this._endpointMargin === undefined) {
            const box = new Box2()
            for (const loop of this.boundaryLoops) {
                for (const v of loop) {
                    box.expandByPoint(v)
                }
            }
            const size = box.isEmpty() ? 0 : box.min.distanceTo(box.max)
            /* A boundary of zero extent produces nothing to clip, but the margin still has to be
             * a positive number for the conversion in `_ProcessEdges()`. */
            this._endpointMargin = (size || 1) * ENDPOINT_MARGIN
        }
        return this._endpointMargin
    }

    /**
     * Group the boundary loops into the areas a solid infill covers, so that each one can be
     * triangulated on its own.
     *
     * The loops of one HATCH are not necessarily one contour with its islands. An architectural
     * drawing routinely puts a dozen disjoint loops into a single hatch, one per wall segment, and
     * taking the first loop as the contour and all the rest as its holes hands the triangulator a
     * self-inconsistent polygon: the loops outside the first one are dropped and the fill spreads
     * over the whole hull instead.
     *
     * Nesting depth is what tells a hole from a separate area, which is the same rule the scanline
     * clipping applies for patterned hatches: a loop with an even number of loops around it is
     * filled, an odd one is a hole in the innermost loop containing it. Under
     * `THROUGH_ENTIRE_AREA` there are no holes at all - every outermost loop is filled solid,
     * matching what `ClipLine()` does for a patterned hatch of the same style.
     *
     * @return {{contour: Vector2[], holes: Vector2[][]}[]} Loops which enclose no area are
     *  dropped.
     */
    GetSolidRegions() {
        const throughAll = this.style == HatchStyle.THROUGH_ENTIRE_AREA
        /* A loop of fewer than three vertices encloses nothing: it can neither be filled nor
         * contain anything, and feeding it to the triangulator only inflates the vertex buffer.
         */
        const loops = this.boundaryLoops.filter(loop => loop.length >= 3)

        /* containers[i] - indices of the loops which contain loop i, so its nesting depth is their
         * count. O(n^2) in the loop count of one hatch, which is a handful in practice; index the
         * loops by bounding box if some drawing ever makes that hurt.
         */
        const containers = []
        for (let i = 0; i < loops.length; i++) {
            const loopContainers = []
            for (let j = 0; j < loops.length; j++) {
                if (i != j && IsLoopInsideLoop(loops[i], loops[j])) {
                    loopContainers.push(j)
                }
            }
            containers.push(loopContainers)
        }

        const regions = []
        /* Index in `regions` of the region each filled loop opens, -1 for the rest. */
        const regionIdx = []
        for (let i = 0; i < loops.length; i++) {
            const isFilled = throughAll ? containers[i].length == 0 : containers[i].length % 2 == 0
            if (!isFilled) {
                regionIdx.push(-1)
                continue
            }
            regionIdx.push(regions.length)
            regions.push({contour: loops[i], holes: []})
        }

        if (throughAll) {
            /* Inner loops are exactly what this style ignores, so nothing becomes a hole. */
            return regions
        }

        for (let i = 0; i < loops.length; i++) {
            if (containers[i].length % 2 == 0) {
                continue
            }
            /* The innermost containing loop is the one with the most containers of its own. Its
             * depth is one less, so it is an even-depth loop and has a region, unless the loops
             * intersect each other and the nesting is not a hierarchy at all.
             */
            let parent = containers[i][0]
            for (const j of containers[i]) {
                if (containers[j].length > containers[parent].length) {
                    parent = j
                }
            }
            if (regionIdx[parent] >= 0) {
                regions[regionIdx[parent]].holes.push(loops[i])
            }
        }

        return regions
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
            MatrixRotateCW(m, angle)
        }
        if ((scale ?? 1) != 1) {
            MatrixScale(m, 1 / scale, 1 / scale)
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
            MatrixTranslate(m, -basePoint.x, -basePoint.y)
        }
        if (angle) {
            MatrixRotateCW(m, angle)
        }
        return m
    }

    /**
     * @param {Matrix3} transform Transformation from OCS to target coordinates space.
     * @return {Box2} Pattern AABB in target coordinate space.
     */
    GetBoundingBox(transform) {
        const box = new Box2()
        for (const path of this.boundaryLoops) {
            for (const v of path) {
                box.expandByPoint(v.clone().applyMatrix3(transform))
            }
        }
        return box
    }
}
