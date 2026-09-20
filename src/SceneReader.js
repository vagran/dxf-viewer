/** Reads a scene produced by {@link DxfScene} back into flat, renderer-independent primitives.
 *
 * `DxfScene` is where all the DXF-specific complexity lives; what comes out of it is three packed
 * ArrayBuffers plus a batch list, shaped for WebGL. `DxfViewer` turns that into three.js objects,
 * but nothing about the representation is specific to three.js — a consumer that wants geometry
 * rather than pixels has to walk the same buffers, resolve the same deferred colors and expand the
 * same instance transforms. This does that walk once, so the answer is not reimplemented per
 * consumer.
 *
 * Everything here is free of the DOM and of three.js, so it runs under plain node.
 *
 * Coordinates come out in **model space**: the scene origin is added back, so what is yielded can
 * be compared directly against the source drawing.
 *
 * Note that this is a second implementation of the decoding that `DxfViewer`'s own `Batch` class
 * performs; the two are expected to agree and are not currently checked against each other.
 */
import {BatchingKey} from "./BatchingKey.js"
import {ColorCode} from "./DxfScene.js"

/** Kind of geometry a primitive describes. */
export const PrimitiveType = Object.freeze({
    /** A rasterized dot. Exactly one vertex. */
    POINT: "POINT",
    /** A connected run of line segments. Two or more vertices. */
    POLYLINE: "POLYLINE",
    /** One filled triangle. Exactly three vertices. */
    TRIANGLE: "TRIANGLE"
})

/**
 * @typedef {Object} Primitive
 * @property {string} type One of {@link PrimitiveType}.
 * @property {?string} layer Resolved layer name, null when the geometry is bound to no layer.
 * @property {number} color Resolved RGB value. Never a {@link ColorCode} sentinel: BY_LAYER and
 *  BY_BLOCK are resolved against the instantiating block and layer, exactly as the renderer
 *  resolves them.
 * @property {number[][]} vertices `[x, y]` pairs in model space.
 */

export class SceneReader {
    /** @param {{}} scene The object produced by `DxfScene.Build()`, i.e. `dxfScene.scene`. */
    constructor(scene) {
        this.scene = scene
        this.origin = scene.origin ?? {x: 0, y: 0}

        this.layers = new Map()
        for (const layer of scene.layers) {
            this.layers.set(layer.name, layer)
        }

        /* Block definition batches, indexed by block name. Collected up front because an instance
         * batch may appear before the definition it refers to.
         */
        this.blocks = new Map()
        for (const batch of scene.batches) {
            if (!IsBlockDefinition(batch.key)) {
                continue
            }
            let batches = this.blocks.get(batch.key.blockName)
            if (!batches) {
                batches = []
                this.blocks.set(batch.key.blockName, batches)
            }
            batches.push(new BatchReader(this, scene, batch))
        }
    }

    /** @returns {{x: number, y: number}} Offset that was subtracted from every stored vertex. */
    GetOrigin() {
        return this.origin
    }

    /** @returns {?{minX: number, maxX: number, minY: number, maxY: number}} Model space bounds. */
    GetBounds() {
        return this.scene.bounds ?? null
    }

    /** @returns {Iterable<{name: string, displayName: string, color: number}>} */
    GetLayers() {
        return this.layers.values()
    }

    /** Walk the whole scene.
     *
     * Block definition batches are not yielded on their own; they are yielded once per instance,
     * transformed into place, which is how they are drawn.
     *
     * @returns {Generator<Primitive>} In batch order, which is the order the renderer draws them.
     */
    *ReadPrimitives() {
        for (const batch of this.scene.batches) {
            if (IsBlockDefinition(batch.key)) {
                continue
            }
            for (const primitive of new BatchReader(this, this.scene, batch).Read()) {
                for (const vertex of primitive.vertices) {
                    vertex[0] += this.origin.x
                    vertex[1] += this.origin.y
                }
                yield primitive
            }
        }
    }
}

/** A batch belongs to a block definition when it names a block but is not itself an instance of
 * one. Such batches are stored in block-local coordinates and are only meaningful once placed.
 */
function IsBlockDefinition(key) {
    return key.blockName !== null &&
           key.geometryType !== BatchingKey.GeometryType.BLOCK_INSTANCE &&
           key.geometryType !== BatchingKey.GeometryType.POINT_INSTANCE
}

/** Decodes one serialized batch. */
class BatchReader {
    constructor(reader, scene, batch) {
        this.reader = reader
        this.key = batch.key
        this.vertices = null
        this.chunks = null
        this.transforms = null

        if (Object.hasOwn(batch, "verticesOffset")) {
            const vertices = new Float32Array(scene.vertices,
                                              batch.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                                              batch.verticesSize)
            if (this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE) {
                /* A shaped point instance batch stores one 2D translation per instance in the
                 * vertex buffer. The same values are the dot positions when the point shape has a
                 * dot in it, and nothing otherwise.
                 */
                this.transforms = vertices
                if (scene.pointShapeHasDot) {
                    this.vertices = vertices
                }
            } else {
                this.vertices = vertices
            }
        }

        if (Object.hasOwn(batch, "chunks")) {
            this.chunks = batch.chunks.map(chunk => ({
                vertices: new Float32Array(scene.vertices,
                                           chunk.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                                           chunk.verticesSize),
                indices: new Uint16Array(scene.indices,
                                         chunk.indicesOffset * Uint16Array.BYTES_PER_ELEMENT,
                                         chunk.indicesSize)
            }))
        }

        if (Object.hasOwn(batch, "transformsOffset")) {
            /* Each transform is a 3x2 affine matrix in row-major order. */
            this.transforms = new Float32Array(scene.transforms,
                                               batch.transformsOffset *
                                                   Float32Array.BYTES_PER_ELEMENT,
                                               batch.transformsSize)
        }

        this.layer = this.key.layerName !== null ?
            (this.reader.layers.get(this.key.layerName) ?? null) : null
    }

    /** @param {?BatchReader} instanceBatch The instance batch placing this one, when this is a
     *      block definition batch being instantiated.
     * @returns {Generator<Primitive>}
     */
    *Read(instanceBatch = null) {
        if (this.key.IsInstanced()) {
            if (instanceBatch !== null) {
                throw new Error("Instance batch cannot itself be instantiated")
            }
            yield* this._ReadInstances()
            return
        }
        yield* this._ReadGeometry(instanceBatch)
    }

    *_ReadInstances() {
        const definition = this.reader.blocks.get(this.key.blockName)
        if (definition) {
            for (const batch of definition) {
                yield* batch.Read(this)
            }
        }
        if (this.vertices) {
            /* Dots belonging to the point shape itself. */
            yield* this._ReadGeometry(null)
        }
    }

    *_ReadGeometry(instanceBatch) {
        const color = instanceBatch ? instanceBatch._ResolveInstanceColor(this) : this.key.color
        const layer = this.layer ?? instanceBatch?.layer ?? null

        let type
        let Chop
        switch (this.key.geometryType) {
        case BatchingKey.GeometryType.POINTS:
        /* Also reached for the dots of a shaped point instance batch. */
        case BatchingKey.GeometryType.POINT_INSTANCE:
            type = PrimitiveType.POINT
            Chop = this._ChopPoints
            break
        case BatchingKey.GeometryType.LINES:
        case BatchingKey.GeometryType.INDEXED_LINES:
            type = PrimitiveType.POLYLINE
            Chop = this._ChopLines
            break
        case BatchingKey.GeometryType.TRIANGLES:
        case BatchingKey.GeometryType.INDEXED_TRIANGLES:
            type = PrimitiveType.TRIANGLE
            Chop = this._ChopTriangles
            break
        default:
            throw new Error(`Unexpected geometry type: ${this.key.geometryType}`)
        }

        const transformer = instanceBatch?._CreateTransformer() ?? null
        const count = transformer ? transformer.count : 1
        for (let i = 0; i < count; i++) {
            for (const vertices of Chop.call(this)) {
                if (transformer) {
                    transformer.Apply(i, vertices)
                }
                yield {
                    type,
                    layer: layer?.name ?? null,
                    color,
                    vertices
                }
            }
        }
    }

    /** Resolve the deferred color of a block definition batch against this instance batch.
     * @param {BatchReader} definitionBatch
     * @returns {number} RGB value.
     */
    _ResolveInstanceColor(definitionBatch) {
        const color = definitionBatch.key.color
        if (color === ColorCode.BY_BLOCK) {
            return this.key.color
        }
        if (color === ColorCode.BY_LAYER) {
            if (definitionBatch.layer) {
                return definitionBatch.layer.color
            }
            return this.layer ? this.layer.color : 0
        }
        return color
    }

    *_ChopPoints() {
        for (let i = 0; i < this.vertices.length; i += 2) {
            yield [[this.vertices[i], this.vertices[i + 1]]]
        }
    }

    /** Indexed line batches are mostly polylines that were split into index pairs. Consecutive
     * segments sharing an endpoint are rejoined into one run, which is both closer to the source
     * drawing and far more compact than emitting every segment separately.
     */
    *_ChopLines() {
        if (!this.chunks) {
            for (let i = 0; i < this.vertices.length; i += 4) {
                yield [[this.vertices[i], this.vertices[i + 1]],
                       [this.vertices[i + 2], this.vertices[i + 3]]]
            }
            return
        }
        for (const chunk of this.chunks) {
            let run = []
            let prevEnd = null
            for (let i = 0; i < chunk.indices.length; i += 2) {
                const start = chunk.indices[i]
                const end = chunk.indices[i + 1]
                if (start === prevEnd) {
                    run.push([chunk.vertices[end * 2], chunk.vertices[end * 2 + 1]])
                } else {
                    if (run.length > 0) {
                        yield run
                    }
                    run = [[chunk.vertices[start * 2], chunk.vertices[start * 2 + 1]],
                           [chunk.vertices[end * 2], chunk.vertices[end * 2 + 1]]]
                }
                prevEnd = end
            }
            if (run.length > 0) {
                yield run
            }
        }
    }

    *_ChopTriangles() {
        if (!this.chunks) {
            for (let i = 0; i < this.vertices.length; i += 6) {
                yield [[this.vertices[i], this.vertices[i + 1]],
                       [this.vertices[i + 2], this.vertices[i + 3]],
                       [this.vertices[i + 4], this.vertices[i + 5]]]
            }
            return
        }
        for (const chunk of this.chunks) {
            for (let i = 0; i < chunk.indices.length; i += 3) {
                const v = idx => [chunk.vertices[idx * 2], chunk.vertices[idx * 2 + 1]]
                yield [v(chunk.indices[i]), v(chunk.indices[i + 1]), v(chunk.indices[i + 2])]
            }
        }
    }

    /** @returns {{count: number, Apply: function(number, number[][])}} Applies instance transform
     *      number `i` to a list of vertices, in place.
     */
    _CreateTransformer() {
        const isPoint = this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE
        const stride = isPoint ? 2 : 6
        const transforms = this.transforms
        return {
            count: transforms.length / stride,
            Apply(i, vertices) {
                const o = i * stride
                if (isPoint) {
                    for (const v of vertices) {
                        v[0] += transforms[o]
                        v[1] += transforms[o + 1]
                    }
                    return
                }
                for (const v of vertices) {
                    const x = v[0] * transforms[o] + v[1] * transforms[o + 1] + transforms[o + 2]
                    const y = v[0] * transforms[o + 3] + v[1] * transforms[o + 4] +
                              transforms[o + 5]
                    v[0] = x
                    v[1] = y
                }
            }
        }
    }
}
