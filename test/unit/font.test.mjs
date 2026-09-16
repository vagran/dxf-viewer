/** The Font wrapper and glyph tessellation, against the generated test font.
 *
 * test/fixtures/fonts/test-font.ttf is built by the fixture generator and every glyph in it is a
 * rectangle with known coordinates, so the numbers below can be read against
 * test/fixtures/gen/generate.py rather than taken on trust. The font declares 1000 units/em and
 * TextRenderer scales by 100 / (unitsPerEm * 72), so every measurement is <font units> / 720.
 */
import {test} from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"
import opentype from "opentype.js"

import {TextRenderer} from "../../src/TextRenderer.js"

const FONT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)),
                            "..", "fixtures", "fonts", "test-font.ttf")

/** Font units per rendered unit: 100 / (1000 * 72) inverted. */
const UNIT = 720

function LoadFont() {
    const buffer = fs.readFileSync(FONT_PATH)
    return opentype.parse(buffer.buffer.slice(buffer.byteOffset,
                                              buffer.byteOffset + buffer.byteLength))
}

/** @return {Promise<TextRenderer>} A renderer with the test font loaded. */
async function Renderer(text = "ABI ") {
    const font = LoadFont()
    const renderer = new TextRenderer([async () => font])
    await renderer.FetchFonts(text)
    return renderer
}

const Close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9,
              `${message}: expected ${expected}, got ${actual}`)

test("the font loads and reports the characters it has", async () => {
    const font = (await Renderer()).fonts[0]
    for (const char of ["A", "B", "I", " "]) {
        assert.strictEqual(font.HasChar(char), true, `should have ${JSON.stringify(char)}`)
    }
    assert.strictEqual(font.HasChar("Z"), false, "Z is deliberately absent from the test font")
})

test("fetching fonts reports whether every character resolved", async () => {
    const font = LoadFont()
    const renderer = new TextRenderer([async () => font])
    assert.strictEqual(await renderer.FetchFonts("ABI"), true)
    assert.strictEqual(await renderer.FetchFonts("Z"), false,
                       "a character no loaded font covers")
})

test("glyph advances are the font's, scaled", async () => {
    const font = (await Renderer()).fonts[0]
    Close(font.GetCharPath("A").advance, 1000 / UNIT, "A is a full-width box")
    Close(font.GetCharPath("I").advance, 400 / UNIT, "I is narrower, so layout cannot ignore it")
    Close(font.GetCharPath(" ").advance, 500 / UNIT, "space advances without an outline")
})

test("glyph bounds are the font's, scaled", async () => {
    const font = (await Renderer()).fonts[0]
    const bounds = font.GetCharPath("A").bounds
    Close(bounds.xMin, 100 / UNIT, "xMin")
    Close(bounds.xMax, 900 / UNIT, "xMax")
    Close(bounds.yMin, 0, "yMin")
    Close(bounds.yMax, 800 / UNIT, "yMax")
})

test("a character with no glyph has no path", async () => {
    const font = (await Renderer()).fonts[0]
    assert.strictEqual(font.GetCharPath("Z"), null)
})

test("kerning comes from the pair, not from the first character twice", async () => {
    const font = (await Renderer()).fonts[0]
    /* The test font declares exactly one kerning pair, A followed by B. Reading the second glyph
     * index from the first character would make this zero, because A/A is not a pair.
     */
    Close(font.GetKerning("A", "B"), -120 / UNIT, "the declared pair")
    Close(font.GetKerning("A", "A"), 0, "not a pair")
    Close(font.GetKerning("B", "A"), 0, "kerning is directional")
    Close(font.GetKerning("I", "B"), 0, "another non-pair")
})

test("kerning against a character the font lacks is zero", async () => {
    const font = (await Renderer()).fonts[0]
    Close(font.GetKerning("Z", "A"), 0, "missing first character")
    Close(font.GetKerning("A", "Z"), 0, "missing second character")
})

test("a plain glyph tessellates to two triangles", async () => {
    const renderer = await Renderer()
    const shape = renderer._GetCharShape("A")
    assert.strictEqual(shape.vertices.length, 4, "the four corners of the box")
    assert.strictEqual(shape.indices.length, 6, "two triangles")
    Close(shape.advance, 1000 / UNIT, "the shape carries the advance")
})

test("a glyph with a hole tessellates as a ring", async () => {
    const renderer = await Renderer()
    const shape = renderer._GetCharShape("B")
    assert.strictEqual(shape.vertices.length, 8, "four corners outside and four inside")
    assert.strictEqual(shape.indices.length, 24,
                       "eight triangles — a ring, not a filled box")

    /* Nothing should be emitted inside the hole: every triangle centroid must be outside the
     * 300..700 square that the glyph cuts out.
     */
    const inHole = ([x, y]) =>
        x > 300 / UNIT && x < 700 / UNIT && y > 200 / UNIT && y < 600 / UNIT
    for (let i = 0; i < shape.indices.length; i += 3) {
        const points = [0, 1, 2].map(k => shape.vertices[shape.indices[i + k]])
        const centroid = [(points[0].x + points[1].x + points[2].x) / 3,
                          (points[0].y + points[1].y + points[2].y) / 3]
        assert.ok(!inHole(centroid),
                  `triangle at ${JSON.stringify(centroid)} lies inside the hole`)
    }
})

test("every glyph vertex is inside the glyph's own bounds", async () => {
    const renderer = await Renderer()
    for (const char of ["A", "B", "I"]) {
        const shape = renderer._GetCharShape(char)
        const bounds = shape.bounds
        for (const vertex of shape.vertices) {
            assert.ok(vertex.x >= bounds.xMin - 1e-9 && vertex.x <= bounds.xMax + 1e-9 &&
                      vertex.y >= bounds.yMin - 1e-9 && vertex.y <= bounds.yMax + 1e-9,
                      `${char}: vertex ${vertex.x},${vertex.y} outside its bounds`)
        }
    }
})
