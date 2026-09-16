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
