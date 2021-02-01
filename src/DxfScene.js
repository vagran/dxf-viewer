import {DynamicBuffer, NativeType} from "./DynamicBuffer"
import "bintrees/dist/rbtree"
import {BatchingKey} from "./BatchingKey"

/** Use 16-bit indices for indexed geometry. */
const INDEXED_CHUNK_SIZE = 0x10000

/** This class prepares an internal representation of a DXF file, optimized fo WebGL rendering. It
 * is decoupled in such a way so that it should be possible to build it in a web-worker, effectively
 * transfer it to the main thread, and easily apply it to a Three.js scene there.
 */
export class DxfScene {

    constructor() {
        /* Scene origin. All input coordinates are made local to this point to minimize precision
        * loss.
        */
        this.origin = null
        this.batches = new RBTree((b1, b2) => b1.key.Compare(b2.key))
        this.layers = new Map()
        this.bounds = null
    }

    /** Build the scene from the provided parsed DXF. */
    Build(dxf) {
        if(dxf.tables && dxf.tables.layer) {
            for (const [, layer] of Object.entries(dxf.tables.layer.layers)) {
                this.layers.set(layer.name, layer)
            }
        }

        for (let entity of dxf.entities) {
            if (entity.type === "LINE") {
                this.ProcessLine(entity)
            } if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE") {
                this.ProcessPolyline(entity)
            } else {
                // console.log("Unhandled entity type: " + entity.type)
            }
        }

        this.scene = this._BuildScene()
        delete this.batches
        delete this.layers
    }

    ProcessLine(entity, isBlock = false) {
        //XXX check entity.linetype
        //XXX start end width
        //XXX bulge
        if (entity.vertices.length !== 2) {
            return
        }
        const color = this._GetEntityColor(entity)
        const key = new BatchingKey(entity.hasOwnProperty("layer") ? entity.layer : null,
                                    false, BatchingKey.GeometryType.LINES, color, 0)
        const batch = this._GetBatch(key)
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v))
        }
    }

    ProcessPolyline(entity, isBlock = false) {
        //XXX check entity.linetype
        //XXX start end width
        //XXX bulge
        if (entity.vertices < 2) {
            return
        }
        const color = this._GetEntityColor(entity)
        /* It is more optimal to render short polylines un-indexed. Also DXF often contains
         * polylines with just two points.
         */
        const verticesCount = entity.vertices.length
        if (verticesCount <= 3) {
            const key = new BatchingKey(entity.hasOwnProperty("layer") ? entity.layer : null,
                                        false, BatchingKey.GeometryType.LINES, color, 0)
            const batch = this._GetBatch(key)
            let prev = null
            for (const v of entity.vertices) {
                if (prev !== null) {
                    batch.PushVertex(this._TransformVertex(prev))
                    batch.PushVertex(this._TransformVertex(v))
                }
                prev = v
            }
            if (entity.shape && verticesCount > 2) {
                batch.PushVertex(this._TransformVertex(entity.vertices[verticesCount - 1]))
                batch.PushVertex(this._TransformVertex(entity.vertices[0]))
            }
            return
        }

        const key = new BatchingKey(entity.hasOwnProperty("layer") ? entity.layer : null,
                                    false, BatchingKey.GeometryType.INDEXED_LINES, color, 0)
        const batch = this._GetBatch(key)
        /* Line may be split if exceeds chunk limit. */
        for (const lineChunk of this._IterateLineChunks(entity)) {
            const chunk = batch.PushChunk(lineChunk.verticesCount)
            for (const v of lineChunk.vertices) {
                chunk.PushVertex(this._TransformVertex(v))
            }
            for (const idx of lineChunk.indices) {
                chunk.PushIndex(idx)
            }
            chunk.Finish()
        }
    }

    /** Split line into chunks with at most INDEXED_CHUNK_SIZE vertices in each one. Each chunk is
     * an object with the following properties:
     *  * "verticesCount" - length of "vertices"
     *  * "vertices" - iterator for included vertices.
     *  * "indices" - iterator for indices.
     *  Closed shapes are handled properly.
     */
    *_IterateLineChunks(entity) {
        const verticesCount = entity.vertices.length
        if (verticesCount < 2) {
            return
        }
        const _this = this
        /* chunkOffset == verticesCount for shape closing vertex. */
        for (let chunkOffset = 0; chunkOffset <= verticesCount; chunkOffset += INDEXED_CHUNK_SIZE) {
            let count = verticesCount - chunkOffset
            let isLast
            if (count > INDEXED_CHUNK_SIZE) {
                count = INDEXED_CHUNK_SIZE
                isLast = false
            } else {
                isLast = true
            }
            if (isLast && entity.shape && chunkOffset > 0 && count === INDEXED_CHUNK_SIZE) {
                /* Corner case - required shape closing vertex does not fit into the chunk. Will
                * require additional chunk.
                */
                isLast = false
            }
            if (chunkOffset === verticesCount && !entity.shape) {
                /* Shape is not closed and it is last closing vertex iteration. */
                break
            }

            let vertices, indices, chunkVerticesCount
            if (count < 2) {
                /* Either last vertex or last shape-closing vertex, or both. */
                if (count === 1 && entity.shape) {
                    /* Both. */
                    vertices = (function*() {
                        yield entity.vertices[chunkOffset]
                        yield entity.vertices[0]
                    })()
                } else if (count === 1) {
                    /* Just last vertex. Take previous one to make a line. */
                    vertices = (function*() {
                        yield entity.vertices[chunkOffset - 1]
                        yield entity.vertices[chunkOffset]
                    })()
                } else {
                    /* Just shape-closing vertex. Take last one to make a line. */
                    vertices = (function*() {
                        yield entity.vertices[verticesCount - 1]
                        yield entity.vertices[0]
                    })()
                }
                indices = this._IterateLineIndices(2, false)
                chunkVerticesCount = 2
            } else if (isLast && entity.shape && chunkOffset > 0 && count < INDEXED_CHUNK_SIZE) {
                /* Additional vertex to close the shape. */
                vertices = (function*() {
                    yield* _this._IterateVertices(entity, chunkOffset, count)
                    yield entity.vertices[0]
                })()
                indices = this._IterateLineIndices(count + 1, false)
                chunkVerticesCount = count + 1
            } else {
                vertices = this._IterateVertices(entity, chunkOffset, count)
                indices = this._IterateLineIndices(count,
                                                   isLast && chunkOffset === 0 && entity.shape)
                chunkVerticesCount = count
            }
            yield {
                verticesCount: chunkVerticesCount,
                vertices,
                indices
            }
        }
    }

    *_IterateVertices(entity, startIndex, count) {
        for (let idx = startIndex; idx < startIndex + count; idx++) {
            yield entity.vertices[idx]
        }
    }

    *_IterateLineIndices(verticesCount, close) {
        for (let idx = 0; idx < verticesCount - 1; idx++) {
            yield idx
            yield idx + 1
        }
        if (close && verticesCount > 2) {
            yield verticesCount - 1
            yield 0
        }
    }

    _GetEntityColor(entity) {
        //XXX check block
        if (entity.hasOwnProperty("color")) {
            //XXX colorIndex 256 - by block
            return entity.color
        }
        if (entity.hasOwnProperty("layer")) {
            const layer = this.layers.get(entity.layer)
            if (layer) {
                return layer.color
            }
        }
        return 0
    }

    _GetBatch(key) {
        let batch = this.batches.find({key})
        if (batch !== null) {
            return batch
        }
        batch = new RenderBatch(key)
        this.batches.insert(batch)
        return batch
    }

    _TransformVertex(v) {
        if (this.bounds === null) {
            this.bounds = { minX: v.x, maxX: v.x, minY: v.y, maxY: v.y }
        } else {
            if (v.x < this.bounds.minX) {
                this.bounds.minX = v.x
            } else if (v.x > this.bounds.maxX) {
                this.bounds.maxX = v.x
            }
            if (v.y < this.bounds.minY) {
                this.bounds.minY = v.y
            } else if (v.y > this.bounds.maxY) {
                this.bounds.maxY = v.y
            }
        }
        if (this.origin === null) {
            this.origin = { x: v.x, y: v.y }
        }
        return { x: v.x - this.origin.x, y: v.y - this.origin.y }
    }

    _BuildScene() {
        let verticesSize = 0
        let indicesSize = 0
        this.batches.each(b => {
            verticesSize += b.GetVerticesBufferSize()
            indicesSize += b.GetIndicesBufferSize()
        })

        const scene = {
            vertices: new ArrayBuffer(verticesSize),
            indices: new ArrayBuffer(indicesSize),
            batches: [],
            layers: [],
            origin: this.origin,
            bounds: this.bounds
        }

        const buffers = {
            vertices: new Float32Array(scene.vertices),
            verticesOffset: 0,
            indices: new Uint16Array(scene.indices),
            indicesOffset: 0
        }

        this.batches.each(b => {
            scene.batches.push(b.Serialize(buffers))
        })

        for (const layer of this.layers.values()) {
            scene.layers.push({
                name: layer.name,
                color: layer.color
            })
        }
        return scene
    }
}

class RenderBatch {
    constructor(key) {
        this.key = key
        if (key.IsIndexed()) {
            this.chunks = []
        } else {
            this.vertices = new DynamicBuffer(NativeType.FLOAT32)
        }
    }

    PushVertex(v) {
        const idx = this.vertices.Push(v.x)
        this.vertices.Push(v.y)
        return idx
    }

    /** This method actually reserves space for the specified number of vertices in some chunk.
     * The returned object should be used to push exactly the same amount vertices and any number of
     * their referring indices.
     * @param verticesCount
     * @return {IndexedChunkWriter}
     */
    PushChunk(verticesCount) {
        if (verticesCount > INDEXED_CHUNK_SIZE) {
            throw new Error("Vertices count exceeds chunk limit: " + verticesCount)
        }
        /* Find suitable chunk with minimal remaining space to fill them as fully as possible. */
        let curChunk = null
        let curSpace = 0
        for (const chunk of this.chunks) {
            const space = INDEXED_CHUNK_SIZE - chunk.vertices.GetSize() / 2
            if (space < verticesCount) {
                continue
            }
            if (curChunk === null || space < curSpace) {
                curChunk = chunk
                curSpace = space
            }
        }
        if (curChunk === null) {
            curChunk = this._NewChunk(verticesCount)
        }
        return new IndexedChunkWriter(curChunk, verticesCount)
    }

    /** @return Vertices buffer required size in bytes. */
    GetVerticesBufferSize() {
        if (this.key.IsIndexed()) {
            let size = 0
            for (const chunk of this.chunks) {
                size += chunk.vertices.GetSize()
            }
            return size * Float32Array.BYTES_PER_ELEMENT
        } else {
            return this.vertices.GetSize() * Float32Array.BYTES_PER_ELEMENT
        }
    }

    /** @return Indices buffer required size in bytes. */
    GetIndicesBufferSize() {
        if (this.key.IsIndexed()) {
            let size = 0
            for (const chunk of this.chunks) {
                size += chunk.indices.GetSize()
            }
            return size * Uint16Array.BYTES_PER_ELEMENT
        } else {
            return 0
        }
    }

    Serialize(buffers) {
        if (this.key.IsIndexed()) {
            const batch = {
                key: this.key,
                chunks: []
            }
            for (const chunk of this.chunks) {
                batch.chunks.push(chunk.Serialize(buffers))
            }
            return batch

        } else {
            const size = this.vertices.GetSize()
            const batch = {
                key: this.key,
                verticesOffset: buffers.verticesOffset,
                verticesCount: size
            }
            const src = new Float32Array(this.vertices.buffer.buffer, 0, size)
            buffers.vertices.set(src, buffers.verticesOffset)
            buffers.verticesOffset += size
            return batch
        }

        //XXX instances
    }

    _NewChunk(initialCapacity) {
        const chunk = new IndexedChunk(initialCapacity)
        this.chunks.push(chunk)
        return chunk
    }
}

class IndexedChunk {
    constructor(initialCapacity) {
        if (initialCapacity < 16) {
            initialCapacity = 16
        }
        /* Average two indices per vertex. */
        this.indices = new DynamicBuffer(NativeType.UINT16, initialCapacity * 2)
        /* Two components per vertex. */
        this.vertices = new DynamicBuffer(NativeType.FLOAT32, initialCapacity * 2)
    }

    Serialize(buffers) {
        const chunk = {}
        {
            const size = this.vertices.GetSize()
            chunk.verticesOffset = buffers.verticesOffset
            chunk.verticesCount = size
            const src = new Float32Array(this.vertices.buffer.buffer, 0, size)
            buffers.vertices.set(src, buffers.verticesOffset)
            buffers.verticesOffset += size
        }
        {
            const size = this.indices.GetSize()
            chunk.indicesOffset = buffers.indicesOffset
            chunk.indicesCount = size
            const src = new Uint16Array(this.indices.buffer.buffer, 0, size)
            buffers.indices.set(src, buffers.indicesOffset)
            buffers.indicesOffset += size
        }
        return chunk
    }
}

class IndexedChunkWriter {
    constructor(chunk, verticesCount) {
        this.chunk = chunk
        this.verticesCount = verticesCount
        this.verticesOffset = this.chunk.vertices.GetSize() / 2
        this.numVerticesPushed = 0
    }

    PushVertex(v) {
        if (this.numVerticesPushed === this.verticesCount) {
            throw new Error()
        }
        this.chunk.vertices.Push(v.x)
        this.chunk.vertices.Push(v.y)
        this.numVerticesPushed++
    }

    PushIndex(idx) {
        if (idx < 0 || idx >= this.verticesCount) {
            throw new Error(`Index out of range: ${idx}/${this.verticesCount}`)
        }
        this.chunk.indices.Push(idx + this.verticesOffset)
    }

    Finish() {
        if (this.numVerticesPushed !== this.verticesCount) {
            throw new Error(`Not all vertices pushed: ${this.numVerticesPushed}/${this.verticesCount}`)
        }
    }
}
