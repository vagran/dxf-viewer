/** A malformed entity costs the drawing that entity, not the drawing.
 *
 * Each record below is one a real file can carry -- a group code missing, or a coordinate spelled
 * "nan" -- and each used to either make `DxfScene.Build()` reject, or poison the scene origin with
 * NaN so that every vertex was offset by it and the canvas came out blank (#179, #180). The
 * property checked is the strongest one available without expected output: a drawing with the bad
 * record spliced in builds to exactly the same scene as the drawing without it, and reports one
 * entity skipped.
 *
 * The records are spliced in as DXF text, since none of them can be written with ezdxf, which is
 * what generates test/fixtures/.
 */
import {test} from "node:test"
import assert from "node:assert"

import DxfParser from "../src/parser/DxfParser.js"
import {DxfScene} from "../src/DxfScene.js"
import {FormatDump, TestFontFetcher} from "./scene-dump.mjs"
import {ValidateScene} from "./validate-scene.mjs"

/** Space-separated code/value pairs, which is how the records read in the issues. */
function Records(text) {
    const tokens = text.trim().split(/\s+/)
    const lines = []
    for (let i = 0; i < tokens.length; i += 2) {
        lines.push(tokens[i], tokens[i + 1])
    }
    return lines
}

/** A drawing with a line, a text and a block inserted twice, the block itself holding a nested
 * INSERT, so that every path a bad record can reach -- top level, block definition, nested block,
 * text -- has good geometry beside it.
 *
 * @param {object} bad
 * @param {string} [bad.first] Record placed first in ENTITIES, where it sets the scene origin.
 * @param {string} [bad.entities] Record placed last in ENTITIES.
 * @param {string} [bad.block] Record placed first in block B, where it sets the block offset.
 */
function Dxf({first = "", entities = "", block = ""} = {}) {
    return Records(`
        0 SECTION 2 BLOCKS
        0 BLOCK 8 0 2 C 70 0 10 0 20 0 3 C
        0 LINE 8 0 10 0 20 0 11 0 21 2
        0 ENDBLK 8 0
        0 BLOCK 8 0 2 B 70 0 10 0 20 0 3 B
        ${block}
        0 LINE 8 0 10 1 20 1 11 3 21 1
        0 INSERT 8 0 2 C 10 2 20 0
        0 ENDBLK 8 0
        0 ENDSEC
        0 SECTION 2 ENTITIES
        ${first}
        0 LINE 8 0 10 5 20 5 11 15 21 15
        0 TEXT 8 0 10 0 20 -5 40 1 1 AB
        0 INSERT 8 0 2 B 10 20 20 0
        0 INSERT 8 0 2 B 10 30 20 0 50 90
        ${entities}
        0 ENDSEC
        0 EOF`).join("\n") + "\n"
}

/** @returns {Promise<{dump: string, skipped: number, warnings: string[]}>} */
async function Build(text) {
    const {log, warn} = console
    const warnings = []
    console.log = () => {}
    console.warn = (...args) => warnings.push(args.join(" "))
    try {
        const scene = new DxfScene()
        await scene.Build(new DxfParser().parseSync(text), [TestFontFetcher()])
        assert.deepStrictEqual(ValidateScene(scene.scene), [])
        return {
            /* The count is asserted on its own, so the dumps compare as geometry alone. */
            dump: FormatDump(scene.scene).replace(/^numEntitiesSkipped .*\n/m, ""),
            skipped: scene.scene.numEntitiesSkipped,
            warnings
        }
    } finally {
        Object.assign(console, {log, warn})
    }
}

const CASES = [
    /* #179: the decomposition itself throws. */
    ["SOLID with one corner", {entities: "0 SOLID 8 0 10 1 20 1"}],
    ["ELLIPSE with no major axis", {entities: "0 ELLIPSE 8 0 10 0 20 0 40 0.5"}],
    ["HATCH with an elliptic edge with no major axis", {entities: `
        0 HATCH 8 0 2 SOLID 70 1 71 0 91 1
        92 0 93 1 72 3 10 0 20 0 40 0.5 50 0 51 360 73 1 97 0
        75 0 76 1 98 0`}],
    ["SPLINE with one control point", {entities: "0 SPLINE 8 0 70 8 71 3 72 0 73 1 74 0 10 0 20 0"}],
    /* #180: what breaks is outside the decomposition. */
    ["TEXT with no text", {entities: "0 TEXT 8 0 10 0 20 0 40 1"}],
    ["MTEXT with no text", {entities: "0 MTEXT 8 0 10 0 20 0 40 1"}],
    ["POINT with no position", {entities: "0 POINT 8 0"}],
    ["INSERT with no position", {entities: "0 INSERT 8 0 2 B"}],
    ["INSERT with an infinite scale", {entities: "0 INSERT 8 0 2 B 10 0 20 0 41 1e999"}],
    ["LINE with a NaN coordinate, first in the drawing", {
        first: "0 LINE 8 0 10 nan 20 5 11 10 21 -5"}],
    ["LINE with a NaN coordinate, later in the drawing", {
        entities: "0 LINE 8 0 10 nan 20 5 11 10 21 -5"}],
    /* The same, inside a block definition, where the instances must keep the rest of the block. */
    ["LINE with a NaN coordinate, first in a block", {block: "0 LINE 8 0 10 nan 20 0 11 1 21 1"}],
    ["ELLIPSE with no major axis in a block", {block: "0 ELLIPSE 8 0 10 0 20 0 40 0.5"}],
    ["nested INSERT with no position", {block: "0 INSERT 8 0 2 C"}],
    /* #178: a knot vector of the wrong length, as LibreDWG's dwg2dxf writes when the DWG record
     * has one. Degree 3 with four control points needs eight knots; these carry five. */
    ["SPLINE with too few knots", {entities: `
        0 SPLINE 8 0 70 8 71 3 72 5 73 4 40 0 40 0 40 1 40 1 40 1
        10 -10 20 -5 10 -3 20 8 10 3 20 -8 10 10 20 5`}, "Bad knot vector length"],
    ["HATCH with a spline edge with too few knots", {entities: `
        0 HATCH 8 0 2 SOLID 70 1 71 0 91 1
        92 0 93 2
        72 4 94 3 73 0 74 0 95 5 96 4 40 0 40 0 40 1 40 1 40 1
        10 -10 20 -5 10 -3 20 8 10 3 20 -8 10 10 20 5
        72 1 10 10 20 5 11 -10 21 -5
        97 0 75 0 76 1 98 0`}, "Bad knot vector length"]
]

const good = await Build(Dxf())

test("the reference drawing has nothing to skip", () => {
    assert.strictEqual(good.skipped, 0)
    assert.deepStrictEqual(good.warnings, [])
})

for (const [name, bad, reason = ""] of CASES) {
    test(`${name} is skipped, and the rest of the drawing is intact`, async () => {
        const result = await Build(Dxf(bad))
        assert.strictEqual(result.skipped, 1)
        assert.strictEqual(result.dump, good.dump)
        assert.ok(result.warnings.some(w => w.startsWith("Skipped malformed") && w.includes(reason)),
                  result.warnings)
    })
}

test("a malformed entity that would not be drawn anyway is not reported", async () => {
    /* $PDMODE 1 displays nothing, so a POINT with no position has nothing to get wrong. */
    const header = Records("0 SECTION 2 HEADER 9 $PDMODE 70 1 0 ENDSEC").join("\n") + "\n"
    const result = await Build(header + Dxf({entities: "0 POINT 8 0"}))
    assert.strictEqual(result.skipped, 0)
})
