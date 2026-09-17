/** HATCH boundary path parsing, where one group code means two different things.
 *
 * An edge-type boundary path ends with group 97, the number of source boundary objects, followed
 * by one 330 handle each. A *spline* edge carries a 97 of its own, counting its fit data. The edge
 * parser used to consume 97 wherever it appeared, so the terminator of an ordinary path was read
 * as a spline group and the path's 330 handles were left for the boundary parser, which gave up on
 * them -- taking the rest of that hatch's paths with it. A two-loop hatch then came out with one
 * loop: its hole filled in, and any further loop missing outright.
 *
 * Both halves of the same defect are here. A group the edge does not own has to end the edge, and
 * a group it does own -- a spline's 12 and 13 tangents, written whenever it has fit data -- has to
 * be consumed rather than end it.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** A square boundary path of four line edges, as group code/value pairs.
 *
 * @param flags {number} Group 92, the boundary path type.
 * @param sourceRefs {string[]} Handles for the 330 groups which follow group 97.
 */
function LinePath(flags, sourceRefs = []) {
    const codes = ["92", String(flags), "93", "4"]
    for (const [sx, sy, ex, ey] of [[0, 0, 20, 0], [20, 0, 20, 20],
                                    [20, 20, 0, 20], [0, 20, 0, 0]]) {
        codes.push("72", "1", "10", String(sx), "20", String(sy), "11", String(ex), "21", String(ey))
    }
    codes.push("97", String(sourceRefs.length))
    for (const handle of sourceRefs) {
        codes.push("330", handle)
    }
    return codes
}

/** A boundary path of one spline edge followed by one line edge.
 *
 * @param withFitData {boolean} True to give the spline fit points and tangents, which is what makes
 *  it write a 97 of its own.
 */
function SplinePath(withFitData) {
    const codes = ["92", "1", "93", "2",
                   "72", "4", "94", "2", "73", "0", "74", "0", "95", "4", "96", "3",
                   "40", "0", "40", "0", "40", "1", "40", "1",
                   "10", "0", "20", "0", "10", "10", "20", "10", "10", "20", "20", "0"]
    if (withFitData) {
        codes.push("97", "2",
                   "11", "0", "21", "0", "11", "20", "21", "0",
                   "12", "1", "22", "1", "13", "-1", "23", "1")
    } else {
        codes.push("97", "0")
    }
    codes.push("72", "1", "10", "20", "20", "0", "11", "0", "21", "0")
    codes.push("97", "1", "330", "ABC")
    return codes
}

/** A solid HATCH over the given boundary paths, as a whole parseable drawing. */
function Dxf(...paths) {
    const codes = [
        "0", "SECTION", "2", "ENTITIES",
        "0", "HATCH", "8", "0", "100", "AcDbHatch",
        "10", "0", "20", "0", "30", "0",
        "2", "SOLID", "70", "1", "71", "0",
        "91", String(paths.length)
    ]
    for (const path of paths) {
        codes.push(...path)
    }
    codes.push("75", "0", "76", "1", "98", "0")
    codes.push("0", "ENDSEC", "0", "EOF")
    return codes.join("\n") + "\n"
}

const Hatch = (...paths) => new DxfParser().parseSync(Dxf(...paths)).entities[0]

test("a path's source object handles do not end the hatch's boundary list", () => {
    const hatch = Hatch(LinePath(1, ["ABC"]), LinePath(16, ["DEF"]))
    assert.strictEqual(hatch.boundaryLoops.length, 2)
    assert.deepStrictEqual(hatch.boundaryLoops.map(l => l.edges.length), [4, 4])
    assert.deepStrictEqual(hatch.boundaryLoops.map(l => l.sourceRefs), [["ABC"], ["DEF"]])
})

test("several handles on one path are all consumed", () => {
    const hatch = Hatch(LinePath(1, ["ABC", "DEF", "012"]), LinePath(16))
    assert.strictEqual(hatch.boundaryLoops.length, 2)
    assert.deepStrictEqual(hatch.boundaryLoops[0].sourceRefs, ["ABC", "DEF", "012"])
})

test("a path with no source objects still parses", () => {
    /* This case worked throughout: with a zero count no 330 follows, so the boundary parser landed
     * on the next path's 92 whether or not the edge had eaten the 97. */
    const hatch = Hatch(LinePath(1), LinePath(16))
    assert.strictEqual(hatch.boundaryLoops.length, 2)
})

test("the loop flags are read per path", () => {
    const hatch = Hatch(LinePath(1, ["ABC"]), LinePath(16, ["DEF"]))
    assert.deepStrictEqual(hatch.boundaryLoops.map(l => [l.isExternal, l.isOutermost]),
                           [[true, false], [false, true]])
})

test("a spline edge keeps its own 97 and the fit data it counts", () => {
    const hatch = Hatch(SplinePath(true))
    assert.strictEqual(hatch.boundaryLoops.length, 1)
    const [spline, line] = hatch.boundaryLoops[0].edges
    assert.strictEqual(spline.type, 4)
    assert.strictEqual(spline.controlPoints.length, 3)
    assert.strictEqual(spline.fitPoints.length, 2)
    assert.deepStrictEqual([spline.startTangent.x, spline.startTangent.y], [1, 1])
    assert.deepStrictEqual([spline.endTangent.x, spline.endTangent.y], [-1, 1])
    assert.strictEqual(line.type, 1, "the edge after the spline survives its tangents")
    assert.deepStrictEqual(hatch.boundaryLoops[0].sourceRefs, ["ABC"])
})

test("a spline edge without fit data parses the same way", () => {
    const hatch = Hatch(SplinePath(false))
    const [spline, line] = hatch.boundaryLoops[0].edges
    assert.strictEqual(spline.controlPoints.length, 3)
    assert.strictEqual(spline.fitPoints, undefined)
    assert.strictEqual(line.type, 1)
})

test("a spline path is followed by the next path", () => {
    const hatch = Hatch(SplinePath(true), LinePath(16, ["DEF"]))
    assert.strictEqual(hatch.boundaryLoops.length, 2)
    assert.strictEqual(hatch.boundaryLoops[1].edges.length, 4)
})
