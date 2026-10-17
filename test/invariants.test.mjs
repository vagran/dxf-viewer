/** Properties that hold without anyone having to write down the expected answer.
 *
 * These are the cheapest tests in the suite to extend, because there is nothing to maintain: no
 * golden to review, no expected output to regenerate. Two of them work by building the *same*
 * drawing two different ways and requiring the results to agree, which means neither side has to
 * be known correct in advance — only consistent.
 */
import {test} from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {BuildScene} from "./scene-dump.mjs"
import {ValidateScene} from "./validate-scene.mjs"
import {SceneReader, PrimitiveType} from "../src/SceneReader.js"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, "fixtures")

/** Must match _TRANSLATION in test/fixtures/gen/generate.py. */
const TRANSLATION = [1_000_000, 500_000]

const fixtures = fs.readdirSync(fixturesDir).filter(name => name.endsWith(".dxf")).sort()

/** Primitives as sorted, rounded strings, so two scenes can be compared as multisets.
 *
 * Rounding to 3 decimals is what makes the comparison meaningful rather than exact: vertices are
 * stored as float32, and the two sides of these comparisons reach the same coordinate by different
 * arithmetic. The residual difference is around 1e-5, so 1e-3 has room to spare without hiding
 * anything a reviewer would care about.
 */
function Canonical(scene, offset = [0, 0]) {
    const result = []
    for (const primitive of new SceneReader(scene).ReadPrimitives()) {
        const vertices = primitive.vertices
            .map(([x, y]) => `${(x - offset[0]).toFixed(3)},${(y - offset[1]).toFixed(3)}`)
            .join(" ")
        result.push(`${primitive.type} ${primitive.layer} ${primitive.color} ${vertices}`)
    }
    result.sort()
    return result
}

/* ---------------------------------------------------------------------------------------------
 * Translation invariance.
 *
 * Exercises the origin scheme: DxfScene stores every vertex relative to the first one it sees, so
 * that float32 attributes stay precise for drawings in survey coordinates. A drawing shifted by a
 * million units must therefore produce the same geometry, shifted.
 * ------------------------------------------------------------------------------------------- */

/** Hatch *patterns* are anchored in model space, not to their boundary -- which is why AutoCAD
 * offers a hatch origin at all. Moving the geometry therefore moves it relative to the pattern and
 * legitimately changes which lines fall inside the loop, so these are not invariant and are not
 * expected to be. Solid hatches, whose triangulation follows the boundary, stay in.
 */
const NOT_TRANSLATION_INVARIANT = new Set([
    "pattern-hatch", "pattern-hatch-concave", "pattern-hatch-cut-corner",
    "pattern-hatch-embedded-spacing", "pattern-hatch-placeholder", "pattern-hatch-rotated",
    "pattern-hatch-repeated-vertex", "pattern-hatch-textbox"
])

for (const fixture of fixtures) {
    const name = path.basename(fixture, ".dxf")
    if (NOT_TRANSLATION_INVARIANT.has(name)) {
        continue
    }
    test(`translating the drawing changes nothing but position: ${name}`, async () => {
        const plain = await BuildScene(path.join(fixturesDir, fixture))
        const moved = await BuildScene(path.join(fixturesDir, "translated", fixture))

        assert.deepStrictEqual(ValidateScene(moved), [])
        assert.deepStrictEqual(Canonical(moved, TRANSLATION), Canonical(plain))
    })
}

/* ---------------------------------------------------------------------------------------------
 * Blocks: flattened, instanced, and gone.
 *
 * DxfScene has two block paths -- inline the geometry, or emit one instance transform per use --
 * chosen by a size threshold. Exploding the INSERTs in ezdxf gives a third rendering of the same
 * drawing with no blocks at all, which is genuinely independent of both rather than another route
 * through the same code.
 * ------------------------------------------------------------------------------------------- */

const explodedDir = path.join(fixturesDir, "exploded")
for (const fixture of fs.readdirSync(explodedDir).filter(n => n.endsWith(".dxf")).sort()) {
    const name = path.basename(fixture, ".dxf")
    test(`block geometry survives being exploded: ${name}`, async () => {
        const withBlocks = await BuildScene(path.join(fixturesDir, fixture))
        const exploded = await BuildScene(path.join(explodedDir, fixture))

        assert.deepStrictEqual(ValidateScene(exploded), [])
        assert.deepStrictEqual(Canonical(exploded), Canonical(withBlocks))
    })
}

/* ---------------------------------------------------------------------------------------------
 * No zero-length segments.
 *
 * A closed polyline reaches its first vertex again through its closing index, so a vertex list
 * that ends on a copy of the first one draws a segment of zero length and stores a vertex for it.
 * Two ways lead there: the file closing the polyline explicitly as well as by the flag, and the
 * decomposer generating the closing segment itself once a bulge has made it build its own
 * vertices. `polyline-closed-repeated` has both, and the rest of the fixtures keep the rule from
 * being broken somewhere else.
 * ------------------------------------------------------------------------------------------- */

for (const fixture of fixtures) {
    const name = path.basename(fixture, ".dxf")
    test(`no polyline repeats a vertex: ${name}`, async () => {
        const scene = await BuildScene(path.join(fixturesDir, fixture))
        for (const primitive of new SceneReader(scene).ReadPrimitives()) {
            if (primitive.type !== PrimitiveType.POLYLINE) {
                continue
            }
            for (let i = 1; i < primitive.vertices.length; i++) {
                const [x0, y0] = primitive.vertices[i - 1]
                const [x1, y1] = primitive.vertices[i]
                assert.ok(x0 !== x1 || y0 !== y1,
                          `(${x1}, ${y1}) repeated in ${JSON.stringify(primitive.vertices)}`)
            }
        }
    })
}

/* ---------------------------------------------------------------------------------------------
 * Hatch containment.
 *
 * Every hatch line the clipper emits has to lie inside the region the hatch covers. The concave
 * fixture is the one that matters for the shape of the boundary: on a convex loop, "between the
 * outermost two crossings" is accidentally correct, and only a notch distinguishes real clipping
 * from that. The cut-corner fixture is the one that matters for a boundary of more than one loop,
 * and for the crossings at its vertices: its own hole is what a line runs across when a corner
 * crossing is counted once instead of twice.
 * ------------------------------------------------------------------------------------------- */

/** Boundaries as given to the path builders in test/fixtures/gen/generate.py, one list of loops
 * per fixture. A point is inside the hatch when it is inside an odd number of them.
 */
const HATCH_BOUNDARIES = {
    "pattern-hatch": [[[0, 0], [20, 0], [20, 20], [0, 20]]],
    "pattern-hatch-concave": [[[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]]],
    "pattern-hatch-cut-corner": [
        [[-5, -5], [60, -5], [60, 100], [-5, 100]],
        [[2, 2 + 1 / 128], [2 + 1 / 128, 2], [42, 2], [42, 92], [2, 92]]
    ],
    /* The hole repeats its (8200, 8200) corner one representable step away from itself. The line
     * grazing that corner used to lose its crossing there and run on across the hole.
     */
    "pattern-hatch-repeated-vertex": [
        [[8176, 8180], [8220, 8180], [8220, 8224], [8176, 8224]],
        [[8200, 8212], [8200, 8200], [8200 + 2 ** -39, 8200], [8212, 8204], [8208, 8212]]
    ]
}

/** Ray casting. Returns true when the point is strictly inside the loop. */
function IsInside([x, y], loop) {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [xi, yi] = loop[i]
        const [xj, yj] = loop[j]
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

for (const [name, loops] of Object.entries(HATCH_BOUNDARIES)) {
    test(`hatch lines stay inside the boundary: ${name}`, async () => {
        const scene = await BuildScene(path.join(fixturesDir, `${name}.dxf`))
        let segments = 0
        for (const primitive of new SceneReader(scene).ReadPrimitives()) {
            assert.strictEqual(primitive.type, PrimitiveType.POLYLINE)
            for (let i = 1; i < primitive.vertices.length; i++) {
                const a = primitive.vertices[i - 1]
                const b = primitive.vertices[i]
                const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
                const depth = loops.reduce((n, loop) => n + (IsInside(midpoint, loop) ? 1 : 0), 0)
                assert.ok(depth % 2 == 1,
                          `segment ${JSON.stringify(a)}-${JSON.stringify(b)} has its midpoint ` +
                          `at ${JSON.stringify(midpoint)}, outside the boundary`)
                assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9,
                          `degenerate segment at ${JSON.stringify(a)}`)
                segments++
            }
        }
        assert.ok(segments > 0, "no hatch lines were emitted at all")
    })
}

/* ---------------------------------------------------------------------------------------------
 * Chunk splitting.
 *
 * Indices are Uint16, so an indexed batch is cut into chunks of at most 0x10000 vertices, and
 * Entity._IterateLineChunks handles the corner cases -- notably a closed shape whose closing
 * vertex does not fit in the last chunk. No oracle is needed: whatever the chunking did, a closed
 * polyline of N vertices must emit exactly N segments and an open one N-1.
 *
 * The drawing is emitted as DXF text here rather than committed, because at this size it would be
 * a megabyte of fixture for one assertion.
 * ------------------------------------------------------------------------------------------- */

/** Minimal DXF holding one LWPOLYLINE. No HEADER or TABLES; the defaults apply. */
function LwPolylineDxf(vertexCount, closed) {
    const parts = ["0", "SECTION", "2", "ENTITIES",
                   "0", "LWPOLYLINE", "8", "0", "62", "1",
                   "90", String(vertexCount), "70", closed ? "1" : "0"]
    for (let i = 0; i < vertexCount; i++) {
        /* A zigzag, so no two consecutive vertices coincide. */
        parts.push("10", String(i), "20", String(i % 2))
    }
    parts.push("0", "ENDSEC", "0", "EOF")
    return parts.join("\n") + "\n"
}

async function WithChunkedPolyline(vertexCount, closed, Body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dxf-chunk-"))
    const file = path.join(dir, "p.dxf")
    fs.writeFileSync(file, LwPolylineDxf(vertexCount, closed))
    try {
        await Body(await BuildScene(file))
    } finally {
        fs.rmSync(dir, {recursive: true, force: true})
    }
}

for (const closed of [false, true]) {
    const vertexCount = 0x10000 + 1
    test(`polyline of ${vertexCount} vertices splits into chunks (${closed ? "closed" : "open"})`,
         () => WithChunkedPolyline(vertexCount, closed, scene => {
             assert.deepStrictEqual(ValidateScene(scene), [])

             const chunks = scene.batches.flatMap(batch => batch.chunks ?? [])
             assert.ok(chunks.length >= 2, `expected more than one chunk, got ${chunks.length}`)
             for (const chunk of chunks) {
                 assert.ok(chunk.verticesSize / 2 <= 0x10000,
                      `chunk holds ${chunk.verticesSize / 2} vertices`)
             }
         }))
}

/* Sizes chosen around the chunk boundary, where the seam segment used to be dropped: one below,
 * exactly on it, just over, and spanning three chunks. 0x10000 closed is its own case -- it used
 * to emit the closing segment twice rather than lose one.
 */
const CHUNK_SEAM_CASES = [
    [0x10000 - 1, false], [0x10000, false], [0x10000 + 1, false], [0x10000 + 2, false],
    [2 * 0x10000 + 5, false],
    [0x10000 - 1, true], [0x10000, true], [0x10000 + 1, true], [0x10000 + 2, true],
    [2 * 0x10000 + 5, true]
]

for (const [vertexCount, closed] of CHUNK_SEAM_CASES) {
    test(`chunk seams keep every segment: ${vertexCount} vertices ` +
         `(${closed ? "closed" : "open"})`,
         () => WithChunkedPolyline(vertexCount, closed, scene => {
             assert.deepStrictEqual(ValidateScene(scene), [])
             let segments = 0
             for (const primitive of new SceneReader(scene).ReadPrimitives()) {
                 segments += primitive.vertices.length - 1
             }
             assert.strictEqual(segments, closed ? vertexCount : vertexCount - 1)
         }))
}

/* Triangles are split by Entity._IterateTriangleChunks, and a solid hatch is the one thing large
 * enough to need it. Area is the oracle: whatever the chunking did, the triangles must cover the
 * boundary's area exactly once, so a dropped or a doubled triangle shows.
 */

/** Minimal DXF holding one solid HATCH with a polyline loop per entry of `loops`, each a circle of
 * the given vertex count and radius.
 */
function SolidHatchDxf(loops) {
    const parts = ["0", "SECTION", "2", "ENTITIES",
                   "0", "HATCH", "8", "0", "2", "SOLID", "70", "1", "71", "0",
                   "91", String(loops.length)]
    for (const {vertexCount, radius} of loops) {
        parts.push("92", "2", "72", "0", "73", "1", "93", String(vertexCount))
        for (const [x, y] of Circle(vertexCount, radius)) {
            parts.push("10", String(x), "20", String(y))
        }
        parts.push("97", "0")
    }
    parts.push("75", "0", "98", "0", "0", "ENDSEC", "0", "EOF")
    return parts.join("\n") + "\n"
}

/** Rounded to three decimals, as a drawing's coordinates are. The rounding is what makes the
 * order of earcut's triangles expensive to split: it leaves vertices reflex all along the
 * boundary, and earcut then emits fans of thousands of triangles around one vertex.
 */
function Circle(vertexCount, radius) {
    const result = []
    for (let i = 0; i < vertexCount; i++) {
        const a = 2 * Math.PI * i / vertexCount
        result.push([Number((radius * Math.cos(a)).toFixed(3)),
                     Number((radius * Math.sin(a)).toFixed(3))])
    }
    return result
}

function PolygonArea(vertices) {
    let area = 0
    for (let i = 0; i < vertices.length; i++) {
        const [x0, y0] = vertices[i]
        const [x1, y1] = vertices[(i + 1) % vertices.length]
        area += x0 * y1 - x1 * y0
    }
    return Math.abs(area) / 2
}

const TRIANGLE_CHUNK_CASES = [
    [{vertexCount: 0x10000, radius: 100}],
    [{vertexCount: 0x10000 + 1, radius: 100}],
    [{vertexCount: 2 * 0x10000 + 5, radius: 100}],
    /* A hole, with the boundary crossing the limit only in total. */
    [{vertexCount: 0x8000 + 0x1000, radius: 100}, {vertexCount: 0x8000 + 0x1000, radius: 50}]
]

for (const loops of TRIANGLE_CHUNK_CASES) {
    const counts = loops.map(loop => loop.vertexCount).join(" + ")
    test(`solid hatch of ${counts} vertices splits into chunks covering its area`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dxf-chunk-"))
        const file = path.join(dir, "h.dxf")
        fs.writeFileSync(file, SolidHatchDxf(loops))
        let scene
        try {
            scene = await BuildScene(file)
        } finally {
            fs.rmSync(dir, {recursive: true, force: true})
        }
        assert.deepStrictEqual(ValidateScene(scene), [])

        const chunks = scene.batches.flatMap(batch => batch.chunks ?? [])
        const vertexCount = loops.reduce((n, loop) => n + loop.vertexCount, 0)
        /* A vertex is stored once per chunk using it, so some duplication is inherent, but taking
         * triangles in earcut's order costs 39% here, and in order of their lowest vertex 10%.
         */
        const stored = chunks.reduce((n, chunk) => n + chunk.verticesSize / 2, 0)
        assert.ok(stored <= vertexCount * 1.01, `${stored} vertices stored for ${vertexCount}`)
        assert.strictEqual(chunks.length, Math.ceil(stored / 0x10000))

        let area = 0
        for (const primitive of new SceneReader(scene).ReadPrimitives()) {
            assert.strictEqual(primitive.type, PrimitiveType.TRIANGLE)
            const [[x0, y0], [x1, y1], [x2, y2]] = primitive.vertices
            area += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2
        }
        const [outer, ...holes] = loops.map(loop => PolygonArea(Circle(loop.vertexCount,
                                                                       loop.radius)))
        const expected = holes.reduce((a, hole) => a - hole, outer)
        assert.ok(Math.abs(area - expected) < expected * 1e-5, `area ${area}, expected ${expected}`)
    })
}

/* ---------------------------------------------------------------------------------------------
 * Diagnostics are reported once per entity.
 *
 * A drawing is walked more than once -- _FetchFonts() pre-scans for text before any geometry is
 * processed -- and the pre-scan builds the same objects the geometry pass builds. A guard that
 * fires on both walks reports one broken entity as two, which is noise in the console and in the
 * smoke sweep, where the count is what a reader compares across a change.
 * ------------------------------------------------------------------------------------------- */

/** Collect everything written to console.warn while building. */
async function CountWarnings(fixture, substring) {
    const warn = console.warn
    const messages = []
    console.warn = (...args) => messages.push(args.join(" "))
    try {
        await BuildScene(path.join(fixturesDir, fixture))
    } finally {
        console.warn = warn
    }
    return messages.filter(message => message.includes(substring)).length
}

test("an unrenderable dimension is reported once, not once per pass", async () => {
    /* One DIMENSION with coincident measurement points, so LinearDimension's validity check
     * rejects it -- see test/fixtures/gen/generate.py. */
    assert.strictEqual(
        await CountWarnings("dimension-degenerate.dxf", "Invalid dimension geometry detected"), 1)
})
