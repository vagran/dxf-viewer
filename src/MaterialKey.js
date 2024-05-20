/** Key for materials. */
import {BatchingKey, CompareValues} from "./BatchingKey.js";

export class MaterialKey {
    /**
     * @param instanceType {Number} One of InstanceType values.
     * @param geometryType {?number} One of BatchingKey.GeometryType.
     * @param color {number} Color ARGB value.
     * @param lineType {?number} Line type ID, null for non-lines. Zero is default type (solid
     *  line).
     */
    constructor(instanceType, geometryType, color, lineType) {
        this.instanceType = instanceType
        this.geometryType = geometryType ?? null
        this.color = color
        this.lineType = lineType ?? null
    }

    /** Comparator function. Fields lexical order corresponds to the constructor arguments order.
     * Null values are always first.
     */
    Compare(other) {
        let c = CompareValues(this.instanceType, other.instanceType)
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
}
