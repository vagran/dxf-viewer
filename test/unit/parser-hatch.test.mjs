/** HATCH boundary path parsing, where group 97 means two different things and the edge parser has
 * to know which one it is looking at.
 *
 * On an edge path, the edge list is followed by `97` and one `330` handle per source object the
 * boundary was made from. The edge parser used to swallow that `97` as one of the spline groups it
 * ignores, and the path parser was then left staring at a `330`: it gave up, took the whole
 * entity's remaining paths with it, and a hatch came out as its first loop alone. Every
 * associative hatch in a real drawing writes handles there -- "ft0275 (solid-hatch).dxf" of issue
 * #116 has four of them, each of which filled a window profile solid.
 *
 * A spline edge writes a `97` of its own, before its fit points. The two are told apart by order
 * alone, which is what these pin down along with the paths that follow the `97`.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** Group codes of a boundary path holding a single closed square of four line edges, spelled
 * `[start, end]` per edge. */
function Edges(pathType, edges) {
    const codes = ["92", String(pathType), "93", String(edges.length)]
    for (const [[x0, y0], [x1, y1]] of edges) {
        codes.push("72", "1", "10", String(x0), "20", String(y0),
                   "11", String(x1), "21", String(y1))
    }
    return codes
}

const SQUARE = [[[0, 0], [10, 0]], [[10, 0], [10, 10]], [[10, 10], [0, 10]], [[0, 10], [0, 0]]]
const INNER = [[[2, 2], [8, 2]], [[8, 2], [8, 8]], [[8, 8], [2, 8]], [[2, 8], [2, 2]]]

/** A minimal drawing whose single HATCH entity has the given boundary path group codes. */
function Dxf(paths) {
    return [
        "0", "SECTION", "2", "ENTITIES",
        "0", "HATCH",
        "8", "0",
        "100", "AcDbHatch",
        "10", "0", "20", "0", "30", "0",
        "210", "0", "220", "0", "230", "1",
        "2", "SOLID",
        "70", "1", /* Solid fill. */
        "71", "1", /* Associative. */
        "91", String(paths.length),
        ...paths.flat(),
        "75", "0", "76", "1", "98", "0",
        "0", "ENDSEC", "0", "EOF"
    ].join("\n") + "\n"
}

const Parse = paths => new DxfParser().parseSync(Dxf(paths)).entities[0]

test("a path's source object handles do not end the path", () => {
    const hatch = Parse([
        [...Edges(1, SQUARE), "97", "1", "330", "2CE"],
        [...Edges(16, INNER), "97", "1", "330", "2D0"]
    ])
    assert.strictEqual(hatch.boundaryLoops.length, 2, "both paths were read")
    assert.deepStrictEqual(hatch.boundaryLoops[0].sourceRefs, ["2CE"])
    assert.deepStrictEqual(hatch.boundaryLoops[1].sourceRefs, ["2D0"])
    assert.strictEqual(hatch.boundaryLoops[1].edges.length, 4, "and the second one in full")
})

test("a count of zero costs no handles", () => {
    /* What a non-associative hatch writes. It reads the same either way, because the value is
     * never what stopped the parse -- the token was. */
    const hatch = Parse([
        [...Edges(1, SQUARE), "97", "0"],
        [...Edges(16, INNER), "97", "0"]
    ])
    assert.strictEqual(hatch.boundaryLoops.length, 2)
    assert.deepStrictEqual(hatch.boundaryLoops[0].sourceRefs ?? [], [])
})

test("a path with no source objects at all still has two loops", () => {
    const hatch = Parse([Edges(1, SQUARE), Edges(16, INNER)])
    assert.strictEqual(hatch.boundaryLoops.length, 2)
})

test("a spline edge keeps its own group 97 and the path continues past it", () => {
    /* The spline's 97 counts fit data and comes before the points; the path's comes after all of
     * its edges. Reading the wrong one as the path's ends the entity there. */
    const spline = [
        "92", "1", "93", "1",
        "72", "4",
        "94", "3", /* Degree. */
        "73", "0", /* Rational. */
        "74", "0", /* Periodic. */
        "95", "0", /* Number of knots. */
        "96", "0", /* Number of control points. */
        "97", "2", /* Number of fit data. */
        "11", "0", "21", "0",
        "11", "10", "21", "10",
        "12", "0", "22", "0", /* Start tangent. */
        "13", "1", "23", "1", /* End tangent. */
        "97", "1", "330", "2D2"
    ]
    const hatch = Parse([spline, [...Edges(16, INNER), "97", "0"]])
    assert.strictEqual(hatch.boundaryLoops.length, 2, "the path after the spline was read")
    const edge = hatch.boundaryLoops[0].edges[0]
    assert.strictEqual(edge.type, 4)
    assert.strictEqual(edge.fitPoints.length, 2, "the fit points are the edge's own")
    assert.strictEqual(edge.controlPoints, undefined)
    assert.deepStrictEqual(hatch.boundaryLoops[0].sourceRefs, ["2D2"],
                           "and the path's own 97 is still the path's")
})

test("the tangents of a fit data spline do not end the path", () => {
    /* The other half of the same defect: 12 and 13 fell through to the edge parser's default and
     * returned from there, which ends the boundary path just as early. */
    const spline = [
        "92", "1", "93", "1",
        "72", "4", "94", "3", "74", "0", "95", "0", "96", "0", "97", "1",
        "11", "5", "21", "5",
        "12", "0", "22", "0",
        "13", "1", "23", "1"
    ]
    const hatch = Parse([spline, Edges(1, SQUARE)])
    assert.strictEqual(hatch.boundaryLoops.length, 2, "the second path survived the tangents")
})

test("the other edge types are read alongside the lines", () => {
    /* An arc and an elliptic arc, so the loop is not just a rectangle. */
    const hatch = Parse([[
        "92", "1", "93", "3",
        "72", "1", "10", "0", "20", "0", "11", "10", "21", "0",
        "72", "2", "10", "10", "20", "5", "40", "5", "50", "0", "51", "180", "73", "1",
        "72", "3", "10", "5", "20", "5", "11", "3", "21", "0", "40", "0.5",
        "50", "0", "51", "90", "73", "1",
        "97", "0"
    ]])
    assert.deepStrictEqual(hatch.boundaryLoops[0].edges.map(e => e.type), [1, 2, 3])
})
