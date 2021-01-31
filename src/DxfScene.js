import {DynamicBuffer, NativeType} from "./DynamicBuffer"
import "bintrees/dist/rbtree"
import {BatchingKey} from "./BatchingKey"

/** This class is an internal representation of a DXF file, optimized fo WebGL rendering. It is
 * decoupled in such a way so that it should be possible to build it in web-worker, effectively
 * transfer to the main thread, and apply to Three.js scene there.
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

        //XXX
        // this.batches.each(b => console.log(b))

        this.scene = this._BuildScene()
        delete this.batches
        delete this.layers
    }

    ProcessLine(entity, isBlock = false) {
        //XXX check entity.linetype
        //XXX check color and colorIndex (0 - by block, 256 - by layer)
        //XXX start end width
        //XXX bulge
        const color = this._GetEntityColor(entity)
        const key = new BatchingKey(entity.hasOwnProperty("layer") ? entity.layer : null,
                                    false, BatchingKey.GeometryType.LINES, color, 0)
        const batch = this._GetBatch(key)
        if (entity.vertices.length !== 2) {
            return
        }
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v))
        }
    }

    ProcessPolyline(entity, isBlock = false) {
        // console.log(entity)//XXX
        //XXX temporal test stub
        const color = this._GetEntityColor(entity)
        const key = new BatchingKey(entity.hasOwnProperty("layer") ? entity.layer : null,
                                    false, BatchingKey.GeometryType.LINES, color, 0)
        const batch = this._GetBatch(key)
        let prev = null
        for (const v of entity.vertices) {
            if (prev !== null) {
                batch.PushVertex(this._TransformVertex(prev))
            }
            prev = v
            batch.PushVertex(this._TransformVertex(v))
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
        this.batches.each(b => {
            verticesSize += b.vertices.GetSize()
        })
        const scene = {
            vertices: new ArrayBuffer(verticesSize * Float32Array.BYTES_PER_ELEMENT),
            batches: [],
            layers: []
        }
        const vertices = new Float32Array(scene.vertices)
        let offset = 0
        this.batches.each(b => {
            const size = b.vertices.GetSize()
            const batch = {
                key: b.key,
                verticesOffset: offset,
                verticesCount: size
            }
            scene.batches.push(batch)
            const src = new Float32Array(b.vertices.buffer.buffer, 0, size)
            vertices.set(src, offset)
            offset += size
        })
        //XXX indices, instances

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
        this.vertices = new DynamicBuffer(NativeType.FLOAT32)
        if (key.IsIndexed()) {
            this.indices = new DynamicBuffer(NativeType.UINT16)
            this.chunks = []
        }
    }

    PushVertex(v) {
        const idx = this.vertices.Push(v.x)
        this.vertices.Push(v.y)
        return idx
    }
}