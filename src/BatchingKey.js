/** Key for render batches. */
export class BatchingKey {
    /**
     * Components order matters for lookup by prefix.
     * @param layerName {?String} Layer name, null if not bound to a layer (e.g. block definition
     *  without layer specified).
     * @param blockName {?String} Block name if applicable. If specified and geometryType is not
     *  BLOCK_INSTANCE, the batch is part of block definition. Otherwise it is block instance.
     * @param geometryType {?number} One of BatchingKey.GeometryType.
     * @param color {number} Color ARGB value.
     * @param lineType {?number} Line type ID, null for non-lines. Zero is default type (solid
     *  line).
     */
    constructor(layerName, blockName, geometryType, color, lineType) {
        this.layerName = layerName ?? null
        this.blockName = blockName ?? null
        this.geometryType = geometryType ?? null
        this.color = color
        this.lineType = lineType ?? null
    }

    /** Comparator function. Fields lexical order corresponds to the constructor arguments order.
     * Null values are always first.
     */
    Compare(other) {
        let c = CompareValues(this.layerName, other.layerName)
        if (c !== 0) {
            return c
        }
        c = CompareValues(this.blockName, other.blockName)
        if (c !== 0) {
            return c
        }
        c = CompareValues(this.geometryType, other.geometryType)
        if (c !== 0) {
            return c
        }
        c = CompareValues(this.color, other.color)
        if (c !== 0) {
            return c
        }
        return CompareValues(this.lineType, other.lineType)
    }

    IsIndexed() {
        return this.geometryType === BatchingKey.GeometryType.INDEXED_LINES ||
               this.geometryType === BatchingKey.GeometryType.INDEXED_TRIANGLES
    }

    IsInstanced() {
        return this.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE ||
               this.geometryType === BatchingKey.GeometryType.POINT_INSTANCE
    }
}

BatchingKey.GeometryType = Object.freeze({
    POINTS: 0,
    LINES: 1,
    INDEXED_LINES: 2,
    TRIANGLES: 3,
    INDEXED_TRIANGLES: 4,
    BLOCK_INSTANCE: 5,
    /** Shaped point instances. */
    POINT_INSTANCE: 6
})

/** Comparator function for arbitrary types. Null is always first. This is used just to make some
 * ordering for keys in tree structures, so no locale-aware string comparison.
 */
export function CompareValues(v1, v2) {
    if (v1 === null) {
        if (v2 === null) {
            return 0
        }
        return -1
    }
    if (v2 === null) {
        return 1
    }
    if (v1 < v2) {
        return -1
    }
    if (v1 > v2) {
        return 1
    }
    return 0
}
