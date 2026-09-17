/** HatchCalculator.ClipLine — the scanline clipping behind every patterned hatch.
 *
 * ClipLine returns **parameter ranges along the input line**, not points: [0, 1] spans the segment
 * it was given. The caller multiplies them back out. Start and end are assumed to lie outside the
 * boundary, which is how the hatch code calls it.
 */
import {test} from "node:test"
import assert from "node:assert"
import {Vector2} from "three"

import {HatchCalculator, HatchStyle} from "../../src/HatchCalculator.js"

const Loop = points => points.map(([x, y]) => new Vector2(x, y))

/** A 10x10 square, and a 4x4 hole in the middle of it. */
const SQUARE = Loop([[0, 0], [10, 0], [10, 10], [0, 10]])
const HOLE = Loop([[3, 3], [7, 3], [7, 7], [3, 7]])
/** An L: the whole of the bottom, and the left half of the top. */
const L_SHAPE = Loop([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]])

function Clip(loops, style, [ax, ay], [bx, by]) {
    return new HatchCalculator(loops, style)
        .ClipLine([new Vector2(ax, ay), new Vector2(bx, by)])
}

const CloseTo = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9,
              `${message}: expected ${expected}, got ${actual}`)

function AssertRanges(actual, expected, message) {
    assert.strictEqual(actual.length, expected.length,
                       `${message}: expected ${expected.length} range(s), got ` +
                       JSON.stringify(actual))
    for (const [i, range] of expected.entries()) {
        CloseTo(actual[i][0], range[0], `${message}: range ${i} start`)
        CloseTo(actual[i][1], range[1], `${message}: range ${i} end`)
    }
}

test("a line crossing a convex loop yields the part inside it", () => {
    /* From x=-5 to x=15, so the square spans parameters 0.25 to 0.75. */
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [-5, 5], [15, 5]),
                 [[0.25, 0.75]], "horizontal through the middle")
})

test("a line that misses the boundary yields nothing", () => {
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [-5, 20], [15, 20]), [], "above")
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [-5, -20], [15, -20]), [], "below")
})

test("a hole splits the line in two under odd parity", () => {
    AssertRanges(Clip([SQUARE, HOLE], HatchStyle.ODD_PARITY, [-5, 5], [15, 5]),
                 [[0.25, 0.4], [0.6, 0.75]], "the hole is skipped")
})

test("THROUGH_ENTIRE_AREA ignores the inner loop", () => {
    AssertRanges(Clip([SQUARE, HOLE], HatchStyle.THROUGH_ENTIRE_AREA, [-5, 5], [15, 5]),
                 [[0.25, 0.75]], "filled straight through the hole")
})

test("a concave boundary is clipped to the part that is really inside", () => {
    /* Below the notch the shape is 10 wide; above it, only 4. */
    AssertRanges(Clip([L_SHAPE], HatchStyle.ODD_PARITY, [-5, 2], [15, 2]),
                 [[0.25, 0.75]], "through the full-width part")
    AssertRanges(Clip([L_SHAPE], HatchStyle.ODD_PARITY, [-5, 7], [15, 7]),
                 [[0.25, 0.45]], "through the narrow part, stopping at the notch")
})

test("a diagonal through two opposite corners spans the whole square", () => {
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [-5, -5], [15, 15]),
                 [[0.25, 0.75]], "corner to corner")
})

test("ranges come back ordered, inside the segment, and non-empty", () => {
    const ranges = Clip([SQUARE, HOLE], HatchStyle.ODD_PARITY, [-5, 5], [15, 5])
    let previousEnd = 0
    for (const [start, end] of ranges) {
        assert.ok(start >= 0 && end <= 1, `range [${start}, ${end}] is within the segment`)
        assert.ok(start < end, `range [${start}, ${end}] is not empty`)
        assert.ok(start >= previousEnd, "ranges do not overlap and are in order")
        previousEnd = end
    }
})

test("reversing the line reverses the parameters but covers the same ground", () => {
    const forward = Clip([SQUARE, HOLE], HatchStyle.ODD_PARITY, [-5, 5], [15, 5])
    const backward = Clip([SQUARE, HOLE], HatchStyle.ODD_PARITY, [15, 5], [-5, 5])
    assert.strictEqual(backward.length, forward.length)
    const mirrored = backward.map(([start, end]) => [1 - end, 1 - start]).reverse()
    AssertRanges(mirrored, forward.map(r => [...r]), "the same intervals, measured from the far end")
})

test("a line lying along an edge produces nothing", () => {
    /* Degenerate: the line is collinear with the bottom edge, so it is on the boundary rather than
     * inside it. Pinning the current answer -- it is the one case here with no obviously right
     * result, and a hatch line exactly on an edge is invisible either way.
     */
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [-5, 0], [15, 0]), [], "along the bottom")
})

test("a line touching a single corner produces nothing", () => {
    /* Grazes the corner at (10, 10) without entering. */
    AssertRanges(Clip([SQUARE], HatchStyle.ODD_PARITY, [5, 15], [15, 5]), [], "tangent at a corner")
})

test("an empty boundary clips everything away", () => {
    AssertRanges(Clip([], HatchStyle.ODD_PARITY, [-5, 5], [15, 5]), [], "no loops at all")
})


/* HatchCalculator.GetSolidRegions — the nesting grouping behind every solid hatch.
 *
 * The loops of one hatch are not necessarily one contour with its islands, so the grouping has to
 * read the nesting out of the geometry: even depth is a filled area, odd depth is a hole in the
 * innermost loop around it. The loop *order* must not matter, which is what several of these check
 * by declaring the loops inside out.
 */

/** Regions as `contour vertex count -> hole vertex counts`, which identifies them here because no
 * two loops in one case have the same size.
 */
function Regions(loops, style = HatchStyle.ODD_PARITY) {
    return new HatchCalculator(loops, style).GetSolidRegions()
        .map(({contour, holes}) => [contour.length, holes.map(hole => hole.length).sort()])
        .sort((a, b) => a[0] - b[0])
}

/** A square of `size`, `n` vertices along each side, with its lower left corner at (x, y). */
function Square(x, y, size, n = 1) {
    const points = []
    for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [0, 0]]) {
        for (let i = 0; i < n; i++) {
            points.push([x + size * dx, y + size * dy])
        }
    }
    return Loop(points)
}

test("a lone loop is one region with no holes", () => {
    assert.deepStrictEqual(Regions([SQUARE]), [[4, []]])
})

test("a loop inside another is its hole", () => {
    assert.deepStrictEqual(Regions([SQUARE, HOLE]), [[4, [4]]])
    assert.deepStrictEqual(Regions([HOLE, SQUARE]), [[4, [4]]],
                           "and the declaration order does not decide which is which")
})

test("disjoint loops are separate regions, not each other's holes", () => {
    /* The bug this grouping exists for: a wall fill carries one loop per wall segment, and taking
     * the first as the contour and the rest as its holes fills the space between them instead.
     */
    const walls = [Square(0, 0, 10), Square(20, 0, 10, 2), Square(40, 0, 10, 3)]
    assert.deepStrictEqual(Regions(walls), [[4, []], [8, []], [12, []]])
})

test("loops sharing a whole edge stay separate regions", () => {
    /* Wall segments meeting. A probe taken at a shared vertex or along the shared edge reads as
     * inside the neighbour as readily as outside, which would make one of these a hole.
     */
    assert.deepStrictEqual(Regions([Square(0, 0, 10), Square(10, 0, 10, 2)]), [[4, []], [8, []]])
})

test("loops touching at a single corner stay separate regions", () => {
    assert.deepStrictEqual(Regions([Square(0, 0, 10), Square(10, 10, 10, 2)]), [[4, []], [8, []]])
})

test("an island inside a hole is filled again", () => {
    /* Depth 2. Everything below the top level used to be a hole of the first loop, so this one
     * came out as a gap in the fill rather than as fill.
     */
    const island = Square(4, 4, 2, 3)
    assert.deepStrictEqual(Regions([SQUARE, HOLE, island]), [[4, [4]], [12, []]])
    assert.deepStrictEqual(Regions([island, HOLE, SQUARE]), [[4, [4]], [12, []]],
                           "innermost first")
})

test("a hole belongs to the innermost loop containing it", () => {
    /* Two nested holes under one contour: the deeper one is a hole of the island, not of the
     * square, and attaching it to the wrong parent would punch it out of the wrong fill.
     */
    const island = Square(4, 4, 3, 3)
    const islandHole = Square(4.5, 4.5, 2, 4)
    assert.deepStrictEqual(Regions([SQUARE, HOLE, island, islandHole]),
                           [[4, [4]], [12, [16]]])
})

test("loops which cannot bound an area are dropped", () => {
    assert.deepStrictEqual(Regions([Loop([[0, 0], [10, 0]]), Loop([[5, 5]]), SQUARE]), [[4, []]])
})

test("no loops at all is no regions", () => {
    assert.deepStrictEqual(Regions([]), [])
})

test("THROUGH_ENTIRE_AREA fills through the inner loops instead of holing them", () => {
    /* The style's whole meaning: ignore the internal structure. A hole would contradict it, and
     * the scanline clipping says the same for a patterned hatch of this style.
     */
    assert.deepStrictEqual(Regions([SQUARE, HOLE], HatchStyle.THROUGH_ENTIRE_AREA), [[4, []]])
    assert.deepStrictEqual(Regions([SQUARE, HOLE, Square(4, 4, 2, 3)],
                                   HatchStyle.THROUGH_ENTIRE_AREA),
                           [[4, []]], "and an island inside the hole adds nothing")
})

test("THROUGH_ENTIRE_AREA still keeps disjoint loops apart", () => {
    /* Only the *inner* structure is ignored. A hatch can have several outlines, and dropping all
     * but the first is what used to leave wall fills missing.
     */
    assert.deepStrictEqual(Regions([Square(0, 0, 10), Square(20, 0, 10, 2)],
                                   HatchStyle.THROUGH_ENTIRE_AREA),
                           [[4, []], [8, []]])
})

test("a line crossing two disjoint loops under THROUGH_ENTIRE_AREA is clipped to each", () => {
    /* The clipping counts crossings per loop, so the gap between two separate loops stays empty
     * rather than being bridged from the first crossing to the last.
     */
    const left = Loop([[0, 0], [10, 0], [10, 10], [0, 10]])
    const right = Loop([[20, 0], [30, 0], [30, 10], [20, 10]])
    AssertRanges(Clip([left, right], HatchStyle.THROUGH_ENTIRE_AREA, [-10, 5], [40, 5]),
                 [[0.2, 0.4], [0.6, 0.8]], "two segments, not one spanning both")
})
