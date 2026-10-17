/** The groups an entity's OCS is made of: its extrusion direction (210) and its elevation.
 *
 * Group 210 is per entity, with no common handler, so an entity parser lacking a `case 210` drops
 * it silently and the entity draws in the WCS plane instead of its own. Elevation lives somewhere
 * different in every entity type, and with a tilted extrusion it moves the entity sideways: in
 * the drawing of issue #105 the POLYLINE elevation accounts for some 56 units of displacement.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

const EXTRUSION = ["210", "0", "220", "-0.6", "230", "0.8"]

/** A minimal drawing holding the given entity group codes. */
function Parse(codes) {
    const dxf = ["0", "SECTION", "2", "ENTITIES", ...codes, "0", "ENDSEC", "0", "EOF"]
    return new DxfParser().parseSync(dxf.join("\n") + "\n").entities[0]
}

test("TEXT reads its extrusion direction", () => {
    const text = Parse(["0", "TEXT", "8", "0", "10", "1", "20", "2", "30", "3", "40", "1",
                        "1", "A", ...EXTRUSION])
    assert.deepStrictEqual(text.extrusionDirection, {x: 0, y: -0.6, z: 0.8})
    assert.deepStrictEqual(text.startPoint, {x: 1, y: 2, z: 3}, "Z of the insertion point")
})

test("MTEXT reads its extrusion direction", () => {
    const mtext = Parse(["0", "MTEXT", "8", "0", "10", "1", "20", "2", "30", "3", "40", "1",
                         "1", "A", ...EXTRUSION])
    assert.deepStrictEqual(mtext.extrusionDirection, {x: 0, y: -0.6, z: 0.8})
})

test("DIMENSION reads its extrusion direction", () => {
    const dim = Parse(["0", "DIMENSION", "8", "0", "10", "0", "20", "0", "30", "0",
                       "11", "5", "21", "5", "31", "7", "70", "0", ...EXTRUSION])
    assert.deepStrictEqual(dim.extrusionDirection, {x: 0, y: -0.6, z: 0.8})
    assert.strictEqual(dim.middleOfText.z, 7, "the text midpoint carries the elevation")
})

test("POLYLINE reads its elevation", () => {
    const polyline = Parse([
        "0", "POLYLINE", "8", "0", "66", "1", "10", "0", "20", "0", "30", "-321.5", "70", "1",
        ...EXTRUSION,
        "0", "VERTEX", "8", "0", "10", "1", "20", "2", "30", "-321.5",
        "0", "VERTEX", "8", "0", "10", "3", "20", "4", "30", "-321.5",
        "0", "SEQEND", "8", "0"
    ])
    assert.strictEqual(polyline.elevation, -321.5)
    assert.deepStrictEqual(polyline.extrusionDirection, {x: 0, y: -0.6, z: 0.8})
    assert.strictEqual(polyline.vertices.length, 2)
})

test("HATCH reads its elevation point", () => {
    const hatch = Parse([
        "0", "HATCH", "8", "0", "100", "AcDbHatch",
        "10", "0", "20", "0", "30", "12.5",
        ...EXTRUSION,
        "2", "SOLID", "70", "1", "71", "0",
        "91", "1",
        "92", "2", "72", "0", "73", "1", "93", "3",
        "10", "0", "20", "0", "10", "10", "20", "0", "10", "0", "20", "10",
        "97", "0",
        "75", "0", "76", "1", "98", "0"
    ])
    assert.strictEqual(hatch.elevation, 12.5)
    assert.deepStrictEqual(hatch.extrusionDirection, {x: 0, y: -0.6, z: 0.8})
    assert.strictEqual(hatch.boundaryLoops.length, 1, "the boundary is still read")
    assert.strictEqual(hatch.boundaryLoops[0].polyline.vertices.length, 3)
})
