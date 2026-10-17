/** 3DFACE parsing: four corners from groups 10-13, and the invisible edge flags in group 70.
 *
 * Group 70 and anything else after the corners has to leave all four of them in place. Losing the
 * fourth turns a quad into a triangle, which is how the faces of every drawing that writes the
 * flags used to come out.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** A unit square as a single 3DFACE, followed by the given groups. */
function Face(...tail) {
    const dxf = [
        "0", "SECTION", "2", "ENTITIES",
        "0", "3DFACE", "8", "0",
        "10", "0", "20", "0", "30", "0", "11", "1", "21", "0", "31", "0",
        "12", "1", "22", "1", "32", "0", "13", "0", "23", "1", "33", "0",
        ...tail,
        "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "1",
        "0", "ENDSEC", "0", "EOF"
    ].join("\n") + "\n"
    const entities = new DxfParser().parseSync(dxf).entities
    assert.strictEqual(entities.length, 2, "the entity after the face is read too")
    return entities[0]
}

const SQUARE = [{x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}, {x: 1, y: 1, z: 0}, {x: 0, y: 1, z: 0}]

test("the four corners are read in order", () => {
    assert.deepStrictEqual(Face().vertices, SQUARE)
})

test("group 70 after the corners keeps the fourth one", () => {
    const face = Face("70", "5")
    assert.deepStrictEqual(face.vertices, SQUARE)
    assert.strictEqual(face.invisibleEdges, 5)
})

test("groups after group 70 are still read", () => {
    const face = Face("70", "8", "62", "3")
    assert.deepStrictEqual(face.vertices, SQUARE)
    assert.strictEqual(face.invisibleEdges, 8)
    assert.strictEqual(face.colorIndex, 3)
})

test("a face without group 70 has no invisible edges", () => {
    assert.strictEqual(Face().invisibleEdges, undefined)
})
