/** LAYER table parsing, where one bit-coded group carries three unrelated properties.
 *
 * Group 70 is "standard flags", and only bit 1 means the layer is frozen. Bit 2 is "frozen by
 * default in new viewports" -- a template for viewports that do not exist yet -- and bit 4 is
 * "locked", which prevents editing. Reading either of those as frozen hides geometry that AutoCAD
 * draws; seven of the drawings in test-data/ carry such a layer, WALL and GRIDLINES in
 * "AEC Plan Elev Sample.dxf" among them.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** A minimal drawing whose single layer carries the given group 70 value. */
function Dxf(flags) {
    return [
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER",
        "0", "LAYER", "2", "L1", "70", String(flags), "62", "7",
        "0", "ENDTAB", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
        "0", "LINE", "8", "L1", "10", "0", "20", "0", "11", "1", "21", "1",
        "0", "ENDSEC", "0", "EOF"
    ].join("\n") + "\n"
}

const Layer = flags => new DxfParser().parseSync(Dxf(flags)).tables.layer.layers.L1

test("bit 1 of group 70 freezes the layer", () => {
    assert.strictEqual(Layer(1).frozen, true)
})

test("no flags leaves the layer thawed", () => {
    assert.strictEqual(Layer(0).frozen, false)
})

test("frozen in new viewports is not frozen", () => {
    assert.strictEqual(Layer(2).frozen, false, "bit 2 describes viewports yet to be created")
})

test("locked is not frozen", () => {
    assert.strictEqual(Layer(4).frozen, false, "bit 4 only prevents editing")
})

test("the freeze bit still wins when other bits are set with it", () => {
    assert.strictEqual(Layer(3).frozen, true, "frozen, and frozen in new viewports")
    assert.strictEqual(Layer(7).frozen, true, "and locked as well")
})

test("the xref bits leave visibility alone", () => {
    /* 16 is "externally dependent on an xref", 32 that the xref resolved, 64 that the entry was
     * referenced. All three are bookkeeping, and all three appear on ordinary visible layers. */
    assert.strictEqual(Layer(16).frozen, false)
    assert.strictEqual(Layer(48).frozen, false)
    assert.strictEqual(Layer(64).frozen, false)
})

test("a negative color marks the layer off but does not freeze it", () => {
    /* Layer visibility has two independent switches in DXF: the freeze flag and the sign of the
     * color. The parser reports them separately. */
    const dxf = Dxf(0).replace("62\n7", "62\n-7")
    const layer = new DxfParser().parseSync(dxf).tables.layer.layers.L1
    assert.strictEqual(layer.visible, false)
    assert.strictEqual(layer.frozen, false)
    assert.strictEqual(layer.color, 0xffffff, "ACI 7, with the sign carrying no color information")
})
