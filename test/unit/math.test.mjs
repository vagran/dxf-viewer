/** Matrix2 and the segment intersection helpers. Both are pure functions over numbers, so they are
 * the cheapest things in the repo to pin down.
 */
import {test} from "node:test"
import assert from "node:assert"
import {Vector2} from "three"

import {Matrix2} from "../../src/math/Matrix2.js"
import {IntersectSegments, IntersectSegmentsParametric} from "../../src/math/utils.js"

const Close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-12,
              `${message}: expected ${expected}, got ${actual}`)

test("Matrix2 multiplies a vector", () => {
    const m = new Matrix2(1, 2, 3, 4)
    const v = m.multiply(new Vector2(5, 6))
    assert.deepStrictEqual([v.x, v.y], [1 * 5 + 2 * 6, 3 * 5 + 4 * 6])
})

test("Matrix2 determinant", () => {
    assert.strictEqual(new Matrix2(1, 2, 3, 4).det(), -2)
    assert.strictEqual(new Matrix2(1, 2, 2, 4).det(), 0, "singular matrix")
})

test("Matrix2 inverts when given a determinant", () => {
    const m = new Matrix2(4, 7, 2, 6)
    const inverse = m.inverse(m.det())
    Close(inverse.a00, 0.6, "a00")
    Close(inverse.a01, -0.7, "a01")
    Close(inverse.a10, -0.2, "a10")
    Close(inverse.a11, 0.4, "a11")

    const identity = inverse.multiply(m.multiply(new Vector2(3, 5)))
    Close(identity.x, 3, "round trip x")
    Close(identity.y, 5, "round trip y")
})

test("Matrix2 reports a singular matrix as not invertible", () => {
    const m = new Matrix2(1, 2, 2, 4)
    assert.strictEqual(m.inverse(m.det()), undefined)
})

test("Matrix2 computes its own determinant when none is given", () => {
    const m = new Matrix2(4, 7, 2, 6)
    const inverse = m.inverse()
    Close(inverse.a00, 0.6, "a00")
    Close(inverse.a11, 0.4, "a11")
    assert.strictEqual(new Matrix2(1, 2, 2, 4).inverse(), undefined, "singular, with no argument")
})

test("Matrix2 solves a linear system", () => {
    /* Both branches of solve(): |a00| >= |a10| and the other way round. */
    for (const m of [new Matrix2(4, 7, 2, 6), new Matrix2(2, 6, 4, 7)]) {
        const expected = new Vector2(3, 5)
        const b = m.multiply(expected)
        const x = m.solve(b)
        Close(x.x, expected.x, "x")
        Close(x.y, expected.y, "y")
    }
})

test("Matrix2 reports a singular system as unsolvable", () => {
    assert.strictEqual(new Matrix2(1, 2, 2, 4).solve(new Vector2(1, 1)), undefined)
})

const V = (x, y) => new Vector2(x, y)

test("crossing segments intersect at the expected parameters", () => {
    const params = IntersectSegmentsParametric(V(0, 0), V(10, 0), V(4, -5), V(4, 5))
    Close(params[0], 0.4, "parameter along the first segment")
    Close(params[1], 0.5, "parameter along the second segment")
    assert.notStrictEqual(params[2], 0, "cross product sign carries the crossing direction")

    const point = IntersectSegments(V(0, 0), V(10, 0), V(4, -5), V(4, 5))
    Close(point.x, 4, "x")
    Close(point.y, 0, "y")
})

test("the cross product sign says which side the second segment crosses from", () => {
    const up = IntersectSegmentsParametric(V(0, 0), V(10, 0), V(4, -5), V(4, 5))
    const down = IntersectSegmentsParametric(V(0, 0), V(10, 0), V(4, 5), V(4, -5))
    assert.ok(up[2] * down[2] < 0, "reversing the second segment flips the sign")
})

test("parallel, collinear and degenerate segments do not intersect", () => {
    assert.strictEqual(IntersectSegmentsParametric(V(0, 0), V(10, 0), V(0, 1), V(10, 1)), null,
                       "parallel")
    assert.strictEqual(IntersectSegmentsParametric(V(0, 0), V(10, 0), V(2, 0), V(8, 0)), null,
                       "collinear counts as parallel, not as an intersection")
    assert.strictEqual(IntersectSegmentsParametric(V(0, 0), V(0, 0), V(-1, 0), V(1, 0)), null,
                       "zero-length first segment")
    assert.strictEqual(IntersectSegmentsParametric(V(-1, 0), V(1, 0), V(5, 5), V(5, 5)), null,
                       "zero-length second segment")
})

test("an intersection beyond the endpoints is reported only when forced", () => {
    /* The lines cross at x = 20, past the end of the first segment. */
    const a = [V(0, 0), V(10, 0)]
    const b = [V(20, -5), V(20, 5)]
    assert.strictEqual(IntersectSegmentsParametric(...a, ...b), null)

    const forced = IntersectSegmentsParametric(...a, ...b, true)
    Close(forced[0], 2, "parameter runs past 1 when forced")
})

test("touching at an endpoint is an intersection", () => {
    const params = IntersectSegmentsParametric(V(0, 0), V(10, 0), V(10, 0), V(10, 10))
    Close(params[0], 1, "at the end of the first segment")
    Close(params[1], 0, "at the start of the second")
})
