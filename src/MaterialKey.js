/** Key for materials. */
import {BatchingKey, CompareValues} from "./BatchingKey";

export class MaterialKey {
    /**
     * @param isInstanced {Boolean}
     * @param geometryType {?number} One of BatchingKey.GeometryType.
     * @param color {number} Color ARGB value.
     * @param lineType {?number} Line type ID, null for non-lines. Zero is default type (solid
     *  line).
     */
    constructor(isInstanced, geometryType, color, lineType) {
        this.isInstanced = isInstanced
        this.geometryType = geometryType
        this.color = color
        this.lineType = lineType
    }

    /** Comparator function. Fields lexical order corresponds to the constructor arguments order.
     * Null values are always first.
     */
    Compare(other) {
        let c = CompareValues(this.isInstanced, other.isInstanced)
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
}
