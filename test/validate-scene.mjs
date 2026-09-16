/** Structural checks on a scene produced by DxfScene.
 *
 * Nothing here needs expected output, so it can run over any drawing — the synthetic fixtures, the
 * private corpus in test-data/, or a file someone attached to a bug report before anyone
 * understands what is wrong with it. That is the point: assertions that cost nothing to extend to
 * new input are the only ones that will ever cover the hard files.
 *
 * These are invariants of the serialized format, not judgements about whether the geometry is
 * *right*. A scene can pass all of this and still draw the wrong picture.
 */
import {BatchingKey} from "../src/BatchingKey.js"
import {ColorCode} from "../src/DxfScene.js"

/** Indices are Uint16, so a chunk can address at most this many vertices. */
const MAX_CHUNK_VERTICES = 0x10000

const GEOMETRY_TYPE_NAMES = Object.fromEntries(
    Object.entries(BatchingKey.GeometryType).map(([name, value]) => [value, name]))

function Describe(batch, index) {
    const key = batch.key
    const type = GEOMETRY_TYPE_NAMES[key.geometryType] ?? `UNKNOWN(${key.geometryType})`
    return `batch #${index} ${type} layer=${key.layerName} block=${key.blockName}`
}

/** @param scene {{}} The object produced by `DxfScene.Build()`.
 * @return {string[]} One entry per problem found; empty when the scene is structurally sound.
 */
export function ValidateScene(scene) {
    const issues = []
    const Check = (condition, message) => {
        if (!condition) {
            issues.push(message)
        }
    }

    const vertices = new Float32Array(scene.vertices)
    const indices = new Uint16Array(scene.indices)
    const transforms = new Float32Array(scene.transforms)

    /* Every element of every buffer should be claimed by exactly one batch. Gaps mean space was
     * allocated and never written, overlaps mean two batches share vertices by accident. */
    const claimedVertices = new Uint8Array(vertices.length)
    const claimedIndices = new Uint8Array(indices.length)
    const claimedTransforms = new Uint8Array(transforms.length)

    const Claim = (claimed, offset, size, buffer, what) => {
        if (offset < 0 || size < 0 || offset + size > claimed.length) {
            issues.push(`${what}: ${buffer} range [${offset}, ${offset + size}) is outside the ` +
                        `buffer of ${claimed.length}`)
            return false
        }
        for (let i = offset; i < offset + size; i++) {
            if (claimed[i]) {
                issues.push(`${what}: ${buffer} element ${i} is claimed by more than one batch`)
                return false
            }
            claimed[i] = 1
        }
        return true
    }

    const seenKeys = new Set()
    const definedBlocks = new Set()
    const instantiatedBlocks = new Set()

    scene.batches.forEach((batch, index) => {
        const key = batch.key
        const what = Describe(batch, index)

        const keyId = JSON.stringify([key.layerName, key.blockName, key.geometryType, key.color,
                                      key.lineType])
        Check(!seenKeys.has(keyId), `${what}: duplicate batching key; batches should have merged`)
        seenKeys.add(keyId)

        const isInstance = key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE ||
                           key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE
        if (key.blockName !== null) {
            (isInstance ? instantiatedBlocks : definedBlocks).add(key.blockName)
        }

        /* Deferred colors only make sense inside a block definition, where they are resolved at
         * instantiation. Anywhere else they would reach the renderer as a negative color. */
        if (key.blockName === null || isInstance) {
            Check(key.color !== ColorCode.BY_LAYER && key.color !== ColorCode.BY_BLOCK,
                  `${what}: unresolved color ${key.color} outside a block definition`)
        }

        if (batch.chunks) {
            for (const [chunkIndex, chunk] of batch.chunks.entries()) {
                const chunkWhat = `${what} chunk #${chunkIndex}`
                const vertexCount = chunk.verticesSize / 2
                Check(chunk.verticesSize % 2 === 0,
                      `${chunkWhat}: ${chunk.verticesSize} floats is not whole vertices`)
                Check(vertexCount <= MAX_CHUNK_VERTICES,
                      `${chunkWhat}: ${vertexCount} vertices exceeds the Uint16 index limit`)

                if (!Claim(claimedVertices, chunk.verticesOffset, chunk.verticesSize, "vertices",
                           chunkWhat) ||
                    !Claim(claimedIndices, chunk.indicesOffset, chunk.indicesSize, "indices",
                           chunkWhat)) {
                    continue
                }

                const perPrimitive =
                    key.geometryType === BatchingKey.GeometryType.INDEXED_TRIANGLES ? 3 : 2
                Check(chunk.indicesSize % perPrimitive === 0,
                      `${chunkWhat}: ${chunk.indicesSize} indices is not whole primitives`)

                for (let i = 0; i < chunk.indicesSize; i++) {
                    const value = indices[chunk.indicesOffset + i]
                    if (value >= vertexCount) {
                        issues.push(`${chunkWhat}: index ${value} at ${i} addresses past the ` +
                                    `chunk's ${vertexCount} vertices`)
                        break
                    }
                }
                for (let i = 0; i < chunk.verticesSize; i++) {
                    if (!Number.isFinite(vertices[chunk.verticesOffset + i])) {
                        issues.push(`${chunkWhat}: non-finite vertex coordinate at ${i}`)
                        break
                    }
                }
            }

        } else if (batch.transformsSize !== undefined) {
            Check(batch.transformsSize % 6 === 0,
                  `${what}: ${batch.transformsSize} floats is not whole 3x2 transforms`)
            if (Claim(claimedTransforms, batch.transformsOffset, batch.transformsSize,
                      "transforms", what)) {
                for (let i = 0; i < batch.transformsSize; i++) {
                    if (!Number.isFinite(transforms[batch.transformsOffset + i])) {
                        issues.push(`${what}: non-finite transform element at ${i}`)
                        break
                    }
                }
            }

        } else {
            const perPrimitive = {
                [BatchingKey.GeometryType.POINTS]: 2,
                [BatchingKey.GeometryType.POINT_INSTANCE]: 2,
                [BatchingKey.GeometryType.LINES]: 4,
                [BatchingKey.GeometryType.TRIANGLES]: 6
            }[key.geometryType]
            Check(perPrimitive !== undefined, `${what}: unexpected non-indexed geometry type`)
            if (perPrimitive !== undefined) {
                Check(batch.verticesSize % perPrimitive === 0,
                      `${what}: ${batch.verticesSize} floats is not whole primitives`)
            }
            if (Claim(claimedVertices, batch.verticesOffset, batch.verticesSize, "vertices",
                      what)) {
                for (let i = 0; i < batch.verticesSize; i++) {
                    if (!Number.isFinite(vertices[batch.verticesOffset + i])) {
                        issues.push(`${what}: non-finite vertex coordinate at ${i}`)
                        break
                    }
                }
            }
        }
    })

    const Unclaimed = (claimed, name) => {
        const count = claimed.reduce((n, v) => n + (v ? 0 : 1), 0)
        Check(count === 0, `${count} of ${claimed.length} ${name} elements are allocated but ` +
                           "claimed by no batch")
    }
    Unclaimed(claimedVertices, "vertices")
    Unclaimed(claimedIndices, "indices")
    Unclaimed(claimedTransforms, "transforms")

    for (const name of instantiatedBlocks) {
        Check(definedBlocks.has(name),
              `block "${name}" is instantiated but has no definition batches`)
    }

    return issues
}
