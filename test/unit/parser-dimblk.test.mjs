/** DIMSTYLE arrowhead blocks, which a modern file names only indirectly.
 *
 * DIMBLK, DIMBLK1 and DIMBLK2 name the block an arrowhead is drawn from. Group codes 5, 6 and 7
 * carry that name directly, and the specification marks all three obsolete: since R2000 the
 * variables are written as group codes 342, 343 and 344, holding the handle of the BLOCK_RECORD
 * instead. A file written by netDxf in issue #80 has only the handle form, so reading just 5/6/7
 * dropped the reference and every dimension in it drew the default arrow where AutoCAD draws an
 * architectural tick.
 *
 * The handle cannot be followed while the table is being read -- BLOCKS normally comes after
 * TABLES -- so the parser resolves it once the whole file is parsed, which is what these cover.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../../src/parser/DxfParser.js"

/** A drawing with one BLOCK and one DIMSTYLE that refers to it through `tags`.
 *
 * The block is owned by BLOCK_RECORD handle "2B", which is what an arrowhead variable points at.
 * BLOCKS is written after TABLES, as a real file has it.
 *
 * @param {string[]} tags Group code/value pairs placed in the DIMSTYLE record.
 * @returns {string} DXF text.
 */
function Dxf(tags) {
    return [
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "DIMSTYLE",
        "0", "DIMSTYLE", "105", "1A", "2", "S1", ...tags,
        "0", "ENDTAB", "0", "ENDSEC",
        "0", "SECTION", "2", "BLOCKS",
        "0", "BLOCK", "5", "2D", "330", "2B", "2", "_ARCHTICK", "10", "0", "20", "0",
        "0", "LINE", "8", "0", "10", "-0.5", "20", "-0.5", "11", "0.5", "21", "0.5",
        "0", "ENDBLK",
        "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"
    ].join("\n") + "\n"
}

const Style = tags => new DxfParser().parseSync(Dxf(tags)).tables.dimstyle.dimStyles.S1

test("a DIMBLK handle resolves to the block name", () => {
    assert.strictEqual(Style(["342", "2B"]).DIMBLK, "_ARCHTICK")
})

test("DIMBLK1 and DIMBLK2 resolve the same way", () => {
    const style = Style(["343", "2B", "344", "2B"])
    assert.strictEqual(style.DIMBLK1, "_ARCHTICK")
    assert.strictEqual(style.DIMBLK2, "_ARCHTICK")
})

test("the obsolete name form still works on its own", () => {
    assert.strictEqual(Style(["5", "_OBLIQUE"]).DIMBLK, "_OBLIQUE")
})

test("the handle wins over a name given by the obsolete code", () => {
    assert.strictEqual(Style(["5", "_OBLIQUE", "342", "2B"]).DIMBLK, "_ARCHTICK")
})

test("the intermediate handle property is not left behind", () => {
    assert.ok(!Style(["342", "2B"]).hasOwnProperty("DIMBLK_handle"))
})

test("an unresolvable handle leaves the variable unset rather than holding a handle", () => {
    /* Better no arrowhead name than one that looks like a block name and is not: LinearDimension
     * falls back to the default arrow for a name it does not recognize, which is also what a
     * missing variable means. */
    const style = Style(["342", "FFFF"])
    assert.strictEqual(style.DIMBLK, undefined)
    assert.ok(!style.hasOwnProperty("DIMBLK_handle"))
})

test("a style naming no arrowhead block gets no arrowhead variables", () => {
    const style = Style(["41", "0.18"])
    assert.strictEqual(style.DIMASZ, 0.18)
    assert.strictEqual(style.DIMBLK, undefined)
})
