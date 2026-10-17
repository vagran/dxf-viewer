/** Polyface meshes and 3DFACE, beyond what the goldens of fixtures/mesh-polyface.dxf and
 * fixtures/mesh-3dface.dxf pin.
 *
 * The goldens cover the filled form under default options. The wireframe form is opt-in, so it is
 * checked here, and so is a mesh too large for one indexed chunk, which no fixture can afford to
 * be.
 */
import {test} from "node:test"
import assert from "node:assert"
import path from "node:path"
import {fileURLToPath} from "node:url"

import DxfParser from "../src/parser/DxfParser.js"
import {DxfScene} from "../src/DxfScene.js"
import {SceneReader, PrimitiveType} from "../src/SceneReader.js"
import {BuildScene} from "./scene-dump.mjs"
import {ValidateScene} from "./validate-scene.mjs"

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")

/** @return {string} An undirected segment, so that the two faces sharing an edge name it alike. */
function Edge(a, b) {
    const [p, q] = [a.join(","), b.join(",")].sort()
    return `${p} ${q}`
}

test("a wireframe polyface draws the edges of its faces", async () => {
    const scene = await BuildScene(path.join(fixturesDir, "mesh-polyface.dxf"),
                                   {sceneOptions: {wireframeMesh: true}})
    assert.deepStrictEqual(ValidateScene(scene), [])
    const edges = new Set()
    for (const primitive of new SceneReader(scene).ReadPrimitives()) {
        assert.strictEqual(primitive.type, PrimitiveType.POLYLINE)
        for (let i = 1; i < primitive.vertices.length; i++) {
            edges.add(Edge(primitive.vertices[i - 1], primitive.vertices[i]))
        }
    }
    /* See _MeshPolyface in fixtures/gen/generate.py: two 10x10 quads side by side, and a triangle
     * against the second one. Shared edges count once. */
    assert.deepStrictEqual([...edges].sort(), [
        Edge([0, 0], [10, 0]), Edge([10, 0], [10, 10]), Edge([10, 10], [0, 10]),
        Edge([0, 10], [0, 0]),
        Edge([10, 0], [20, 0]), Edge([20, 0], [20, 10]), Edge([20, 10], [10, 10]),
        Edge([20, 0], [30, 0]), Edge([30, 0], [20, 10])
    ].sort())
})

test("a wireframe 3DFACE draws its outline", async () => {
    const scene = await BuildScene(path.join(fixturesDir, "mesh-3dface.dxf"),
                                   {sceneOptions: {wireframeMesh: true}})
    assert.deepStrictEqual(ValidateScene(scene), [])
    const edges = new Set()
    for (const primitive of new SceneReader(scene).ReadPrimitives()) {
        assert.strictEqual(primitive.type, PrimitiveType.POLYLINE)
        for (let i = 1; i < primitive.vertices.length; i++) {
            edges.add(Edge(primitive.vertices[i - 1], primitive.vertices[i]))
        }
    }
    /* See _Mesh3dFace in fixtures/gen/generate.py: a square, a triangle and a chevron. */
    assert.deepStrictEqual([...edges].sort(), [
        Edge([0, 0], [10, 0]), Edge([10, 0], [10, 10]), Edge([10, 10], [0, 10]),
        Edge([0, 10], [0, 0]),
        Edge([20, 0], [30, 0]), Edge([30, 0], [30, 10]), Edge([30, 10], [20, 0]),
        Edge([40, 0], [45, 3]), Edge([45, 3], [50, 0]), Edge([50, 0], [45, 10]),
        Edge([45, 10], [40, 0])
    ].sort())
})

test("a polyface mesh too large for one chunk is split, not overflowed", async () => {
    /* Indices are Uint16, so a chunk addresses at most 0x10000 vertices. Faces sharing no vertex
     * reference three each, which crosses that limit at 21846 faces. */
    const numFaces = 22000
    const lines = ["0", "SECTION", "2", "ENTITIES", "0", "POLYLINE", "8", "0", "66", "1",
                   "70", "64", "71", String(numFaces * 3), "72", String(numFaces)]
    for (let i = 0; i < numFaces; i++) {
        /* Rows of 100 unit triangles, kept small so float32 holds them exactly. */
        const x = i % 100
        const y = Math.floor(i / 100)
        for (const [dx, dy] of [[0, 0], [0.5, 0], [0, 0.5]]) {
            lines.push("0", "VERTEX", "8", "0", "10", String(x + dx), "20", String(y + dy),
                       "30", "0", "70", "192")
        }
    }
    for (let i = 0; i < numFaces; i++) {
        lines.push("0", "VERTEX", "8", "0", "10", "0", "20", "0", "30", "0", "70", "128",
                   "71", String(i * 3 + 1), "72", String(i * 3 + 2), "73", String(i * 3 + 3))
    }
    lines.push("0", "SEQEND", "0", "ENDSEC", "0", "EOF")

    const log = console.log
    console.log = () => {}
    const scene = new DxfScene()
    try {
        await scene.Build(new DxfParser().parseSync(lines.join("\n") + "\n"))
    } finally {
        console.log = log
    }
    assert.deepStrictEqual(ValidateScene(scene.scene), [])
    const batch = scene.scene.batches[0]
    assert.strictEqual(batch.chunks.length, 2)
    let triangles = 0
    for (const primitive of new SceneReader(scene.scene).ReadPrimitives()) {
        assert.strictEqual(primitive.type, PrimitiveType.TRIANGLE)
        triangles++
    }
    assert.strictEqual(triangles, numFaces)
})
