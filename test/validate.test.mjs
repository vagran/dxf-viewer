/** Structural validation of the scenes built from every fixture, plus proof that the validation
 * can actually fail.
 *
 * The second half matters as much as the first. `ValidateScene` reports nothing for every fixture
 * and for every drawing in the private corpus, which is the desired result and also exactly what a
 * validator that checks nothing at all would produce. Injecting a specific corruption and
 * requiring it to be caught is what tells the two apart.
 */
import {test} from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {BuildScene} from "./scene-dump.mjs"
import {ValidateScene} from "./validate-scene.mjs"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, "fixtures")

const fixtures = fs.readdirSync(fixturesDir).filter(name => name.endsWith(".dxf")).sort()

for (const fixture of fixtures) {
    test(`scene is structurally sound: ${path.basename(fixture, ".dxf")}`, async () => {
        const issues = ValidateScene(await BuildScene(path.join(fixturesDir, fixture)))
        assert.deepStrictEqual(issues, [])
    })
}

/** Deep enough copy that a mutation cannot reach the original. */
function CloneScene(scene) {
    return {
        ...scene,
        vertices: scene.vertices.slice(0),
        indices: scene.indices.slice(0),
        transforms: scene.transforms.slice(0),
        batches: scene.batches.map(batch => ({
            ...batch,
            key: {...batch.key},
            chunks: batch.chunks?.map(chunk => ({...chunk}))
        }))
    }
}

const CORRUPTIONS = [
    ["an index addressing past its chunk", "polyline",
     scene => { new Uint16Array(scene.indices)[0] = 0xffff }],
    ["a non-finite coordinate", "polyline",
     scene => { new Float32Array(scene.vertices)[2] = NaN }],
    ["a gap in the vertex buffer", "points",
     scene => { scene.batches[0].verticesSize = 0 }],
    ["two batches sharing vertices", "points",
     scene => { scene.batches[1].verticesOffset = scene.batches[0].verticesOffset }],
    ["a duplicated batching key", "points",
     scene => { scene.batches[1].key = {...scene.batches[0].key} }],
    ["an unresolved color outside a block", "polyline",
     scene => { scene.batches[0].key.color = -1 }],
    ["a transform count that is not whole matrices", "block-instanced",
     scene => {
         const batch = scene.batches.find(b => b.transformsSize !== undefined)
         batch.transformsSize -= 1
     }]
]

for (const [description, fixture, Corrupt] of CORRUPTIONS) {
    test(`validation catches ${description}`, async () => {
        const scene = CloneScene(await BuildScene(path.join(fixturesDir, `${fixture}.dxf`)))
        assert.deepStrictEqual(ValidateScene(scene), [], "fixture should start clean")
        Corrupt(scene)
        assert.notDeepStrictEqual(ValidateScene(scene), [],
                                  "corruption was not reported by ValidateScene")
    })
}
