/** Color parsing, which has two independent paths — entities and layer table entries — and a
 * group whose value is not quite a color.
 *
 * Group 420 holds a 32-bit value whose high byte is a color *method* marker: 0xC2 means the low
 * 24 bits are RGB. Files also write a bare RGB value with no marker, and writers that treat the
 * field as signed produce a negative number for the same bits. All three forms appear across
 * test-data/, so all three are here.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** A minimal drawing: one layer and one line, with the given group codes spliced in. */
function Dxf({layerCodes = [], entityCodes = []} = {}) {
    return [
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER",
        "0", "LAYER", "2", "L1", "70", "0", "62", "7", ...layerCodes,
        "0", "ENDTAB", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
        "0", "LINE", "8", "L1", "10", "0", "20", "0", "11", "1", "21", "1", ...entityCodes,
        "0", "ENDSEC", "0", "EOF"
    ].join("\n") + "\n"
}

const Parse = dxf => new DxfParser().parseSync(dxf)
const Entity = dxf => Parse(dxf).entities[0]
const Layer = dxf => Parse(dxf).tables.layer.layers.L1

test("an ACI index in group 62 becomes an RGB value", () => {
    assert.strictEqual(Entity(Dxf({entityCodes: ["62", "1"]})).color, 0xff0000, "ACI 1 is red")
    assert.strictEqual(Entity(Dxf({entityCodes: ["62", "3"]})).color, 0x00ff00, "ACI 3 is green")
})

test("group 62 keeps BYLAYER and BYBLOCK distinguishable", () => {
    assert.strictEqual(Entity(Dxf({entityCodes: ["62", "256"]})).colorIndex, 256, "BYLAYER")
    assert.strictEqual(Entity(Dxf({entityCodes: ["62", "0"]})).colorIndex, 0, "BYBLOCK")
})

test("a true color with the 0xC2 method marker keeps only its RGB bits", () => {
    /* 0xC200FF00: marker 0xC2, green. */
    assert.strictEqual(Entity(Dxf({entityCodes: ["420", "3254845184"]})).color, 0x00ff00)
})

test("a true color written as a negative number is the same value", () => {
    /* The same bits as above, from a writer that treats the field as signed. Eight of the values
     * in test-data/ are written this way. */
    assert.strictEqual((-1040122112 >>> 0), 0xc200ff00, "the two spellings are the same bits")
    assert.strictEqual(Entity(Dxf({entityCodes: ["420", "-1040122112"]})).color, 0x00ff00)
})

test("a true color written without a marker is left alone", () => {
    assert.strictEqual(Entity(Dxf({entityCodes: ["420", "65280"]})).color, 0x00ff00,
                       "bare RGB, which is how most files write it")
})

test("both spellings of one color end up equal, so their batches can merge", () => {
    /* This is the point of masking: a batching key holds the color, so leaving the marker in
     * place gave the same visible color two keys and two draw calls. */
    const marked = Entity(Dxf({entityCodes: ["420", "3254845184"]})).color
    const bare = Entity(Dxf({entityCodes: ["420", "65280"]})).color
    const viaAci = Entity(Dxf({entityCodes: ["62", "3"]})).color
    assert.strictEqual(marked, bare)
    assert.strictEqual(marked, viaAci)
})

test("a layer true color is masked the same way as an entity's", () => {
    assert.strictEqual(Layer(Dxf({layerCodes: ["420", "3254845184"]})).color, 0x00ff00)
    assert.strictEqual(Layer(Dxf({layerCodes: ["420", "-1040122112"]})).color, 0x00ff00)
    assert.strictEqual(Layer(Dxf({layerCodes: ["420", "65280"]})).color, 0x00ff00)
})
