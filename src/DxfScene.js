import {DynamicBuffer, NativeType} from "./DynamicBuffer"
import "./RBTree"
import {BatchingKey} from "./BatchingKey"
import {Matrix3} from "three"

/** Use 16-bit indices for indexed geometry. */
const INDEXED_CHUNK_SIZE = 0x10000
/** Target angle for each segment of tessellated arc. */
const ARC_TESSELLATION_ANGLE = 10 / 180 * Math.PI

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
        /* RBTree<BatchingKey, RenderBatch> */
        this.batches = new RBTree((b1, b2) => b1.key.Compare(b2.key))
        /* Indexed by layer name, value is layer object from parsed DXF. */
        this.layers = new Map()
        /* Indexed by block name, value is block object from parsed DXF. */
        this.blocks = new Map()
        this.bounds = null
    }

    /** Build the scene from the provided parsed DXF. */
    Build(dxf) {
        if(dxf.tables && dxf.tables.layer) {
            for (const [, layer] of Object.entries(dxf.tables.layer.layers)) {
                this.layers.set(layer.name, layer)
            }
        }

        if (dxf.blocks) {
            for (const [, block] of Object.entries(dxf.blocks)) {
                this.blocks.set(block.name, block)
            }
        }

        /* 0 - CCW, 1 - CW */
        this.angBase = dxf.header["$ANGBASE"] || 0
        /* Zero angle direction, 0 is +X */
        this.angDir = dxf.header["$ANGDIR"] || 0
        this.pdMode = dxf.header["$PDMODE"] || 0
        this.pdSize = dxf.header["$PDSIZE"] || 0

        for (const block of this.blocks.values()) {
            if (block.hasOwnProperty("entities")) {
                for (const entity of block.entities) {
                    this._ProcessDxfEntity(entity, block.name)
                }
            }
        }

        for (const entity of dxf.entities) {
            this._ProcessDxfEntity(entity)
        }

        this.scene = this._BuildScene()

        delete this.batches
        delete this.layers
        delete this.blocks
    }

    _ProcessDxfEntity(entity, blockName = null) {
        let renderEntities
        const isBlock = blockName !== null
        if (entity.type === "LINE") {
            renderEntities = this._DecomposeLine(entity, isBlock)
        } if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE") {
            renderEntities = this._DecomposePolyline(entity, isBlock)
        } else if (entity.type === "ARC") {
            renderEntities = this._DecomposeArc(entity, isBlock)
        } else if (entity.type === "CIRCLE") {
            renderEntities = this._DecomposeCircle(entity, isBlock)
        } else if (entity.type === "POINT") {
            renderEntities = this._DecomposePoint(entity, isBlock)
        } else if (entity.type === "INSERT") {
            if (isBlock) {
                console.warn(
                    `Nested blocks are currently not supported, ${blockName} includes ${entity.name}`)
                return
            }
            /* Works with rendering batches without intermediate entities. */
            this._ProcessInsert(entity)
            return
        } else {
            //XXX console.log("Unhandled entity type: " + entity.type)
            return
        }
        for (const renderEntity of renderEntities) {
            this._ProcessEntity(renderEntity, blockName)
        }
    }

    /**
     * @param entity {Entity}
     * @param blockName {?string}
     */
    _ProcessEntity(entity, blockName = null) {
        switch (entity.type) {
        case Entity.Type.POINTS:
            this._ProcessPoints(entity, blockName)
            break
        case Entity.Type.LINE_SEGMENTS:
            this._ProcessLineSegments(entity, blockName)
            break
        case Entity.Type.POLYLINE:
            this._ProcessPolyline(entity, blockName)
            break
        default:
            throw new Error("Unhandled entity type: " + entity.type)
        }
    }

    _GetLineType(entity, vertex = null, isBlock = false) {
        //XXX lookup
        return 0
    }

    /** Check if start/end with are not specified. */
    _IsPlainLine(entity) {
        return !Boolean(entity.startWidth || entity.endWidth)
    }

    *_DecomposeLine(entity, isBlock) {
        /* start/end width, bulge - seems cannot be present, at least with current parser */
        if (entity.vertices.length !== 2) {
            return
        }
        const layer = this._GetEntityLayer(entity, isBlock)
        const color = this._GetEntityColor(entity, isBlock)
        yield new Entity(Entity.Type.LINE_SEGMENTS, entity.vertices, layer, color,
                         this._GetLineType(entity, entity.vertices[0]))
    }

    /** Generate vertices for bulged line segment.
     *
     * @param vertices Generated vertices pushed here.
     * @param startVtx Starting vertex. Assuming it is already present in the vertices array.
     * @param endVtx Ending vertex.
     * @param bulge Bulge value (see DXF specification).
     */
    _GenerateBulgeVertices(vertices, startVtx, endVtx, bulge) {
        //XXX
        vertices.push(endVtx)
    }

    /** Generate vertices for arc segment.
     *
     * @param vertices Generated vertices pushed here.
     * @param center Center vector.
     * @param radius
     * @param startAngle {number?} Start angle. Zero if not specified. Arc is drawn in CCW direction
     *  from start angle towards end angle.
     * @param endAngle {number?} Optional end angle. Full circle is drawn if not specified.
     */
    _GenerateArcVertices(vertices, center, radius, startAngle, endAngle) {
        if (!center || !radius) {
            return
        }
        /* Normalize angles - make them starting from +X in CCW direction. End angle should be
         * greater than start angle.
         */
        if (startAngle === undefined) {
            startAngle = 0
        } else {
            startAngle += this.angBase
        }
        let isClosed = false
        if (endAngle === undefined || endAngle === null) {
            endAngle = startAngle + 2 * Math.PI
            isClosed = true
        } else {
            endAngle += this.angBase
        }
        if (this.angDir) {
            const tmp = startAngle
            startAngle = endAngle
            endAngle = tmp
        }
        while (endAngle <= startAngle) {
            endAngle += Math.PI * 2
        }

        const arcAngle = endAngle - startAngle
        let numSegments = Math.floor(arcAngle / ARC_TESSELLATION_ANGLE)
        if (numSegments === 0) {
            numSegments = 1
        }
        const step = arcAngle / numSegments
        for (let i = 0; i <= numSegments; i++) {
            if (i === numSegments && isClosed) {
                break
            }
            const a = startAngle + i * step
            const v = {
                x: center.x + radius * Math.cos(a),
                y: center.y + radius * Math.sin(a)
            }
            vertices.push(v)
        }
    }

    *_DecomposeArc(entity, isBlock) {
        const color = this._GetEntityColor(entity, isBlock)
        const layer = this._GetEntityLayer(entity, isBlock)
        const lineType = this._GetLineType(entity, null, isBlock)
        const vertices = []
        this._GenerateArcVertices(vertices, entity.center, entity.radius, entity.startAngle,
                                  entity.endAngle)
        yield new Entity(Entity.Type.POLYLINE, vertices, layer, color, lineType,
                         entity.endAngle === undefined)
    }

    *_DecomposeCircle(entity, isBlock) {
        const color = this._GetEntityColor(entity, isBlock)
        const layer = this._GetEntityLayer(entity, isBlock)
        const lineType = this._GetLineType(entity, null, isBlock)
        const vertices = []
        this._GenerateArcVertices(vertices, entity.center, entity.radius)
        yield new Entity(Entity.Type.POLYLINE, vertices, layer, color, lineType, true)
    }

    *_DecomposePoint(entity, isBlock) {
        if (this.pdMode === PdMode.NONE) {
            /* Points not displayed. */
            return
        }
        if (this.pdSize <= 0) {
            /* Currently not supported. */
            return
        }
        const color = this._GetEntityColor(entity, isBlock)
        const layer = this._GetEntityLayer(entity, isBlock)
        const markType = this.pdMode & PdMode.MARK_MASK

        if (markType === PdMode.DOT) {
            yield new Entity(Entity.Type.POINTS, [entity.position], layer, color, null, false)
        }

        if ((this.pdMode & PdMode.SHAPE_MASK) !== 0) {
            /* Shaped mark should be instanced. */
            //XXX not implemented
            return
        }
        if (markType === PdMode.DOT) {
            return
        }

        const vertices = []

        const _this = this
        function PushVertex(offsetX, offsetY) {
            vertices.push({
                x: entity.position.x + offsetX * _this.pdSize * 0.5,
                y: entity.position.y + offsetY * _this.pdSize * 0.5
            })
        }

        if (markType === PdMode.PLUS) {
            PushVertex(0, 1.5)
            PushVertex(0, -1.5)
            PushVertex(-1.5, 0)
            PushVertex(1.5, 0)
        } else if (markType === PdMode.CROSS) {
            PushVertex(-1, 1)
            PushVertex(1, -1)
            PushVertex(1, 1)
            PushVertex(-1, -1)
        } else if (markType === PdMode.TICK) {
            PushVertex(0, 1)
            PushVertex(0, 0)
        } else if (markType === PdMode.CIRCLE) {
            this._GenerateArcVertices(vertices, entity.position, this.pdSize * 0.5)
        } else {
            console.warn("Unsupported point display type: " + markType)
            return
        }
        yield new Entity(Entity.Type.LINE_SEGMENTS, vertices, layer, color, null, false)
    }

    /** Updates batches directly. */
    _ProcessInsert(entity) {
        const block = this.blocks.get(entity.name)
        if (block === null) {
            console.warn("INSERT encountered with unknown block name: " + entity.name)
            return
        }
        const origin = block.position
        const layer = this._GetEntityLayer(entity, false)
        const color = this._GetEntityColor(entity, false)
        const lineType = this._GetLineType(entity, null, false)
        const key = new BatchingKey(layer, entity.name, BatchingKey.GeometryType.BLOCK_INSTANCE,
                                    color, lineType)
        const batch = this._GetBatch(key)
        const position = this._TransformVertex(entity.position)
        let transform = new Matrix3().setUvTransform(
            position.x - origin.x,
            position.y - origin.y,
            entity.xScale || 1,
            entity.yScale || 1,
            entity.rotation || 0,
            origin.x,
            origin.y)
        //XXX grid instancing not supported yet
        batch.PushInstanceTransform(transform)
    }

    /** XXX not needed here, needed in renderer
     * Iterate block definition batches.
     * @param blockName {string}
     * @return {Generator<RenderBatch>}
     */
    *_GetBlockDefinition(blockName) {
        const it = this.batches.lowerBound({
             key: new BatchingKey(null, blockName, null, null, null)
        })
        let batch = it.data()
        while(batch !== null) {
            if (batch.key.layer !== null ||
                batch.key.blockName !== blockName ||
                batch.key.isInstanced) {

                break
            }
            yield batch
            batch = it.next()
        }
    }

    /**
     * Generate entities for shaped polyline (e.g. line resulting in mesh). All segments are shaped
     * (have start/end width). Segments may be bulge.
     * @param vertices
     * @param layer
     * @param color
     * @param lineType
     * @param shape {Boolean} True if closed polyline.
     * @return {Generator<Entity>}
     */
    *_GenerateShapedPolyline(vertices, layer, color, lineType, shape) {
        //XXX
        yield new Entity(Entity.Type.POLYLINE, vertices, layer, color, lineType, shape)
    }

    *_DecomposePolyline(entity, isBlock = false) {
        const verticesCount = entity.vertices.length
        if (verticesCount < 2) {
            return
        }
        const color = this._GetEntityColor(entity, isBlock)
        const layer = this._GetEntityLayer(entity, isBlock)
        const _this = this
        let startIdx = 0
        let curPlainLine = this._IsPlainLine(entity.vertices[0])
        let curLineType = this._GetLineType(entity, entity.vertices[0], isBlock)
        let curVertices = null

        function *CommitSegment(endIdx) {
            if (endIdx === startIdx) {
                return
            }
            let isClosed = false
            let vertices = curVertices
            if (endIdx === verticesCount && startIdx === 0) {
                isClosed = true
                if (vertices === null) {
                    vertices = entity.vertices
                }
            } else if (endIdx === verticesCount - 1 && startIdx === 0) {
                if (vertices === null) {
                    vertices = entity.vertices
                }
            } else if (endIdx === verticesCount) {
                if (vertices === null) {
                    vertices = entity.vertices.slice(startIdx, endIdx)
                    vertices.push(entity.vertices[0])
                }
            } else {
                if (vertices === null) {
                    vertices = entity.vertices.slice(startIdx, endIdx + 1)
                }
            }

            if (curPlainLine) {
                yield new Entity(Entity.Type.POLYLINE, vertices, layer, color, curLineType, isClosed)
            } else {
                yield* _this._GenerateShapedPolyline(vertices, layer, color, curLineType, isClosed)
            }

            startIdx = endIdx
            if (endIdx !== verticesCount) {
                curPlainLine = _this._IsPlainLine(entity.vertices[endIdx])
                curLineType = _this._GetLineType(entity, entity.vertices[endIdx])
            }
            curVertices = null
        }

        for (let vIdx = 1; vIdx <= verticesCount; vIdx++) {
            const prevVtx = entity.vertices[vIdx - 1]
            let vtx
            if (vIdx === verticesCount) {
                if (!entity.shape) {
                    yield* CommitSegment(vIdx - 1)
                    break
                }
                vtx = entity.vertices[0]
            } else {
                vtx = entity.vertices[vIdx]
            }

            if (Boolean(prevVtx.bulge) && curPlainLine) {
                if (curVertices === null) {
                    curVertices = entity.vertices.slice(startIdx, vIdx)
                }
                this._GenerateBulgeVertices(curVertices, prevVtx, vtx, prevVtx.bulge)
            } else if (curVertices !== null) {
                curVertices.push(vtx)
            }

            if (vIdx === verticesCount) {
                yield* CommitSegment(vIdx)
                break
            }

            const isPlainLine = this._IsPlainLine(vtx)
            const lineType = this._GetLineType(entity, vtx)
            if (isPlainLine !== curPlainLine ||
                /* Line type is accounted for plain lines only. */
                (curPlainLine && lineType !== curLineType)) {

                yield* CommitSegment(vIdx)
            }
        }
    }

    /**
     * @param entity {Entity}
     * @param blockName {String?}
     */
    _ProcessPoints(entity, blockName = null) {
        const isBlock = blockName !== null
        const key = new BatchingKey(entity.layer, blockName,
                                    BatchingKey.GeometryType.POINTS, entity.color, 0)
        const batch = this._GetBatch(key)
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v, isBlock))
        }
    }

    /**
     * @param entity {Entity}
     * @param blockName {String?}
     */
    _ProcessLineSegments(entity, blockName = null) {
        if (entity.vertices.length % 2 !== 0) {
            throw Error("Even number of vertices expected")
        }
        const isBlock = blockName !== null
        const key = new BatchingKey(entity.layer, blockName,
                                    BatchingKey.GeometryType.LINES, entity.color, entity.lineType)
        const batch = this._GetBatch(key)
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v, isBlock))
        }
    }

    /**
     * @param entity {Entity}
     * @param blockName {String?}
     */
    _ProcessPolyline(entity, blockName = null) {
        if (entity.vertices.length < 2) {
            return
        }
        const isBlock = blockName !== null
        /* It is more optimal to render short polylines un-indexed. Also DXF often contains
         * polylines with just two points.
         */
        const verticesCount = entity.vertices.length
        if (verticesCount <= 3) {
            const key = new BatchingKey(entity.layer, blockName,
                                        BatchingKey.GeometryType.LINES, entity.color,
                                        entity.lineType)
            const batch = this._GetBatch(key)
            let prev = null
            for (const v of entity.vertices) {
                if (prev !== null) {
                    batch.PushVertex(this._TransformVertex(prev, isBlock))
                    batch.PushVertex(this._TransformVertex(v, isBlock))
                }
                prev = v
            }
            if (entity.shape && verticesCount > 2) {
                batch.PushVertex(this._TransformVertex(entity.vertices[verticesCount - 1], isBlock))
                batch.PushVertex(this._TransformVertex(entity.vertices[0], isBlock))
            }
            return
        }

        const key = new BatchingKey(entity.layer, blockName,
                                    BatchingKey.GeometryType.INDEXED_LINES,
                                    entity.color, entity.lineType)
        const batch = this._GetBatch(key)
        /* Line may be split if exceeds chunk limit. */
        for (const lineChunk of entity._IterateLineChunks()) {
            const chunk = batch.PushChunk(lineChunk.verticesCount)
            for (const v of lineChunk.vertices) {
                chunk.PushVertex(this._TransformVertex(v, isBlock))
            }
            for (const idx of lineChunk.indices) {
                chunk.PushIndex(idx)
            }
            chunk.Finish()
        }
    }

    /** Resolve entity color.
     *
     * @param entity
     * @param isBlock {Boolean}
     * @return {number} RGB color value. For block entity it also may be one of ColorCode values
     *  which are resolved on block instantiation.
     */
    _GetEntityColor(entity, isBlock = false) {
        let color = ColorCode.BY_LAYER
        if (entity.colorIndex === 0) {
            color = ColorCode.BY_BLOCK
        } else if (entity.colorIndex === 256) {
            color = ColorCode.BY_LAYER
        } else if (entity.hasOwnProperty("color")) {
            color = entity.color
        }

        if (isBlock) {
            return color
        }
        if (color === ColorCode.BY_LAYER || color === ColorCode.BY_BLOCK) {
            /* BY_BLOCK is not useful when not in block so replace it by layer as well. */
            if (entity.hasOwnProperty("layer")) {
                const layer = this.layers.get(entity.layer)
                if (layer) {
                    return layer.color
                }
            }
        } else {
            return color
        }
        /* Fallback to black. */
        return 0
    }

    /** @return {?string} Layer name, null for block entity. */
    _GetEntityLayer(entity, isBlock = false) {
        if (isBlock) {
            return null
        }
        if (entity.hasOwnProperty("layer")) {
            return entity.layer
        }
        return "0"
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

    _TransformVertex(v, isBlock = false) {
        if (isBlock) {
            return v
        }
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
        let transformsSize = 0
        this.batches.each(b => {
            verticesSize += b.GetVerticesBufferSize()
            indicesSize += b.GetIndicesBufferSize()
            transformsSize += b.GetTransformsSize()
        })

        const scene = {
            vertices: new ArrayBuffer(verticesSize),
            indices: new ArrayBuffer(indicesSize),
            transforms: new ArrayBuffer(transformsSize),
            batches: [],
            layers: [],
            origin: this.origin,
            bounds: this.bounds
        }

        const buffers = {
            vertices: new Float32Array(scene.vertices),
            verticesOffset: 0,
            indices: new Uint16Array(scene.indices),
            indicesOffset: 0,
            transforms: new Float32Array(scene.transforms),
            transformsOffset: 0
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
        } else if (key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            this.transforms = new DynamicBuffer(NativeType.FLOAT32)
        } else {
            this.vertices = new DynamicBuffer(NativeType.FLOAT32)
        }
    }

    PushVertex(v) {
        const idx = this.vertices.Push(v.x)
        this.vertices.Push(v.y)
        return idx
    }

    /**
     * @param matrix {Matrix3} 3x3 Transform matrix. Assuming 2D affine transform so only top 3x2
     *  sub-matrix is taken.
     */
    PushInstanceTransform(matrix) {
        /* Storing in row-major order as expected by renderer. */
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                this.transforms.Push(matrix.elements[col * 3 + row])
            }
        }
    }

    /** This method actually reserves space for the specified number of indexed vertices in some
     * chunk. The returned object should be used to push exactly the same amount vertices and any
     * number of their referring indices.
     * @param verticesCount Number of vertices in the chunk.
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
        } else if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            return 0
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

    /** @return Instances transforms buffer required size in bytes. */
    GetTransformsSize() {
        if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            return this.transforms.GetSize() * Float32Array.BYTES_PER_ELEMENT
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

        } else if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            const size = this.transforms.GetSize()
            const batch = {
                key: this.key,
                transformsOffset: buffers.transformsOffset,
                transformsSize: size
            }
            this.transforms.CopyTo(buffers.transforms, buffers.transformsOffset)
            buffers.transformsOffset += size
            return batch

        } else {
            const size = this.vertices.GetSize()
            const batch = {
                key: this.key,
                verticesOffset: buffers.verticesOffset,
                verticesSize: size
            }
            this.vertices.CopyTo(buffers.vertices, buffers.verticesOffset)
            buffers.verticesOffset += size
            return batch
        }
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
            chunk.verticesSize = size
            this.vertices.CopyTo(buffers.vertices, buffers.verticesOffset)
            buffers.verticesOffset += size
        }
        {
            const size = this.indices.GetSize()
            chunk.indicesOffset = buffers.indicesOffset
            chunk.indicesSize = size
            this.indices.CopyTo(buffers.indices, buffers.indicesOffset)
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

/** Internal entity representation. DXF features are decomposed into these simpler entities. Whole
 * entity always shares single material.
 */
class Entity {
    /** @param type {Entity.Type}
     * @param vertices {{x, y}[]}
     * @param layer {?string}
     * @param color {number}
     * @param lineType {number}
     * @param shape {Boolean} true if closed shape.
     */
    constructor(type, vertices, layer, color, lineType, shape = false) {
        this.type = type
        this.vertices = vertices
        this.layer = layer
        this.color = color
        this.lineType = lineType
        this.shape = shape
    }

    *_IterateVertices(startIndex, count) {
        for (let idx = startIndex; idx < startIndex + count; idx++) {
            yield this.vertices[idx]
        }
    }

    /** Split line into chunks with at most INDEXED_CHUNK_SIZE vertices in each one. Each chunk is
     * an object with the following properties:
     *  * "verticesCount" - length of "vertices"
     *  * "vertices" - iterator for included vertices.
     *  * "indices" - iterator for indices.
     *  Closed shapes are handled properly.
     */
    *_IterateLineChunks() {
        const verticesCount = this.vertices.length
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
            if (isLast && this.shape && chunkOffset > 0 && count === INDEXED_CHUNK_SIZE) {
                /* Corner case - required shape closing vertex does not fit into the chunk. Will
                * require additional chunk.
                */
                isLast = false
            }
            if (chunkOffset === verticesCount && !this.shape) {
                /* Shape is not closed and it is last closing vertex iteration. */
                break
            }

            let vertices, indices, chunkVerticesCount
            if (count < 2) {
                /* Either last vertex or last shape-closing vertex, or both. */
                if (count === 1 && this.shape) {
                    /* Both. */
                    vertices = (function*() {
                        yield this.vertices[chunkOffset]
                        yield this.vertices[0]
                    })()
                } else if (count === 1) {
                    /* Just last vertex. Take previous one to make a line. */
                    vertices = (function*() {
                        yield this.vertices[chunkOffset - 1]
                        yield this.vertices[chunkOffset]
                    })()
                } else {
                    /* Just shape-closing vertex. Take last one to make a line. */
                    vertices = (function*() {
                        yield this.vertices[verticesCount - 1]
                        yield this.vertices[0]
                    })()
                }
                indices = _IterateLineIndices(2, false)
                chunkVerticesCount = 2
            } else if (isLast && this.shape && chunkOffset > 0 && count < INDEXED_CHUNK_SIZE) {
                /* Additional vertex to close the shape. */
                vertices = (function*() {
                    yield* _this._IterateVertices(chunkOffset, count)
                    yield this.vertices[0]
                })()
                indices = _IterateLineIndices(count + 1, false)
                chunkVerticesCount = count + 1
            } else {
                vertices = this._IterateVertices(chunkOffset, count)
                indices = _IterateLineIndices(count,
                                              isLast && chunkOffset === 0 && this.shape)
                chunkVerticesCount = count
            }
            yield {
                verticesCount: chunkVerticesCount,
                vertices,
                indices
            }
        }
    }
}

Entity.Type = Object.freeze({
    POINTS: 0,
    /** Each vertices pair defines a segment. */
    LINE_SEGMENTS: 1,
    POLYLINE: 2
})

function* _IterateLineIndices(verticesCount, close) {
    for (let idx = 0; idx < verticesCount - 1; idx++) {
        yield idx
        yield idx + 1
    }
    if (close && verticesCount > 2) {
        yield verticesCount - 1
        yield 0
    }
}

/** Point display mode, $PDMODE system variable. */
const PdMode = Object.freeze({
    DOT: 0,
    NONE: 1,
    PLUS: 2,
    CROSS: 3,
    TICK: 4,
    MARK_MASK: 0xf,

    CIRCLE: 0x20,
    SQUARE: 0x40,

    SHAPE_MASK: 0xf0
})

/** Special color values, used for block entities. Regular entities color is resolved instantly. */
export const ColorCode = Object.freeze({
    BY_LAYER: -1,
    BY_BLOCK: -2
})