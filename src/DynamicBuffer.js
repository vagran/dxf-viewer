/** Typed-array-based buffer which can be dynamically extended. */
export class DynamicBuffer {
    /**
     * @param type Array type, see NativeType.
     * @param initialCapacity Initial capacity, number of elements.
     */
    constructor(type, initialCapacity = 16) {
        this.type = type
        this.capacity = initialCapacity
        this.size = 0
        this.buffer = new (NativeArray(type))(initialCapacity)
    }

    GetSize() {
        return this.size
    }

    /**
     * Append new value to the buffer end.
     * @return Appended value position in the buffer.
     */
    Push(value) {
        this._CheckGrow()
        const pos = this.size
        this.buffer[pos] = value
        this.size++
        return pos
    }

    Get(index) {
        if (index >= this.size) {
            throw new Error(`Index out of range: ${index}/${this.size}`)
        }
        return this.buffer[index]
    }

    /** Copy content to the specified buffer.
     * @param dstBuffer Destination buffer, should be typed array of the same type.
     * @param dstOffset {number} Offset in elements in the destination buffer.
     * @param srcOffset {number} Offset in elements in this buffer.
     * @param size {number} Number of elements to copy, -1 (default) to copy till this buffer end.
     */
    CopyTo(dstBuffer, dstOffset, srcOffset = 0, size = -1) {
        if (size === -1) {
            size = this.size - srcOffset
        }
        const src = new (NativeArray(this.type))(this.buffer.buffer, srcOffset, size)
        dstBuffer.set(src, dstOffset)
    }

    _CheckGrow() {
        if (this.size < this.capacity) {
            return
        }
        this.capacity *= 2
        const newBuffer = new (NativeArray(this.type))(this.capacity)
        newBuffer.set(this.buffer)
        this.buffer = newBuffer
    }
}

export const NativeType = {
    INT8: 0,
    UINT8: 1,
    UINT8_CLAMPED: 2,
    INT16: 3,
    UINT16: 4,
    INT32: 5,
    UINT32: 6,
    INT64: 7,
    UINT64: 8,
    FLOAT32: 9,
    FLOAT64: 10
}

/** Get TypedArray type corresponding to the specified NativeType. */
export function NativeArray(type) {
    switch (type) {
    case NativeType.INT8:
        return Int8Array
    case NativeType.UINT8:
        return Uint8Array
    case NativeType.UINT8_CLAMPED:
        return Uint8ClampedArray
    case NativeType.INT16:
        return Int16Array
    case NativeType.UINT16:
        return Uint16Array
    case NativeType.INT32:
        return Int32Array
    case NativeType.UINT32:
        return Uint32Array
    case NativeType.FLOAT32:
        return Float32Array
    case NativeType.FLOAT64:
        return Float64Array
    default:
        throw new Error("Unrecognized native type: " + type)
    }
}