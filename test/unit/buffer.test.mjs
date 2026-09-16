/** DynamicBuffer, the growable typed array every batch accumulates into. */
import {test} from "node:test"
import assert from "node:assert"

import {DynamicBuffer, NativeType, NativeArray} from "../../src/DynamicBuffer.js"

test("push and read back", () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32)
    assert.strictEqual(buffer.GetSize(), 0)
    assert.strictEqual(buffer.Push(1.5), 0, "Push returns the position it wrote to")
    assert.strictEqual(buffer.Push(2.5), 1)
    assert.strictEqual(buffer.GetSize(), 2)
    assert.strictEqual(buffer.Get(0), 1.5)
    assert.strictEqual(buffer.Get(1), 2.5)
})

test("reading past the end throws rather than returning the spare capacity", () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32, 8)
    buffer.Push(1)
    assert.throws(() => buffer.Get(1), /Index out of range/)
})

test("growing past the initial capacity keeps every value", () => {
    const buffer = new DynamicBuffer(NativeType.INT32, 2)
    const count = 1000
    for (let i = 0; i < count; i++) {
        buffer.Push(i)
    }
    assert.strictEqual(buffer.GetSize(), count)
    assert.ok(buffer.capacity >= count, "capacity grew")
    for (let i = 0; i < count; i++) {
        assert.strictEqual(buffer.Get(i), i, `value at ${i} survived the reallocations`)
    }
})

test("copy into a destination buffer at an offset", () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32)
    for (const value of [1, 2, 3]) {
        buffer.Push(value)
    }
    const destination = new Float32Array(5)
    buffer.CopyTo(destination, 2)
    assert.deepStrictEqual([...destination], [0, 0, 1, 2, 3])
})

test("copying a bounded number of elements", () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32)
    for (const value of [1, 2, 3, 4]) {
        buffer.Push(value)
    }
    const destination = new Float32Array(4)
    buffer.CopyTo(destination, 0, 0, 2)
    assert.deepStrictEqual([...destination], [1, 2, 0, 0])
})

test("copy starting from an offset within the source", () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32)
    for (const value of [1, 2, 3, 4]) {
        buffer.Push(value)
    }
    const destination = new Float32Array(2)
    buffer.CopyTo(destination, 0, 2, 2)
    assert.deepStrictEqual([...destination], [3, 4])
})

test("an offset that is not a whole number of bytes is still an element count", () => {
    /* One element of an Int8Array is one byte and one element of a Float64Array is eight, so an
     * implementation confusing the two units agrees with this one only for Int8Array.
     */
    const buffer = new DynamicBuffer(NativeType.FLOAT64)
    for (const value of [10, 20, 30, 40, 50]) {
        buffer.Push(value)
    }
    const destination = new Float64Array(3)
    buffer.CopyTo(destination, 0, 1, 3)
    assert.deepStrictEqual([...destination], [20, 30, 40])
})

test("an offset with no size copies through to the end", () => {
    const buffer = new DynamicBuffer(NativeType.INT32)
    for (const value of [1, 2, 3, 4, 5]) {
        buffer.Push(value)
    }
    const destination = new Int32Array(3)
    buffer.CopyTo(destination, 0, 2)
    assert.deepStrictEqual([...destination], [3, 4, 5])
})

test("a copy never reaches into the unused capacity", () => {
    const buffer = new DynamicBuffer(NativeType.INT32, 64)
    for (const value of [7, 8]) {
        buffer.Push(value)
    }
    const destination = new Int32Array(4).fill(-1)
    buffer.CopyTo(destination, 0)
    assert.deepStrictEqual([...destination], [7, 8, -1, -1],
                           "only the two pushed values, not the spare capacity")
})

test("NativeArray maps each supported type to its typed array", () => {
    const expected = [
        [NativeType.INT8, Int8Array], [NativeType.UINT8, Uint8Array],
        [NativeType.UINT8_CLAMPED, Uint8ClampedArray], [NativeType.INT16, Int16Array],
        [NativeType.UINT16, Uint16Array], [NativeType.INT32, Int32Array],
        [NativeType.UINT32, Uint32Array], [NativeType.FLOAT32, Float32Array],
        [NativeType.FLOAT64, Float64Array]
    ]
    for (const [type, arrayType] of expected) {
        assert.strictEqual(NativeArray(type), arrayType)
    }
    assert.throws(() => NativeArray(-1), /Unrecognized native type/)
})

test("NativeType declares two 64-bit integer types that NativeArray cannot build", () => {
    /* Pinning the current state rather than endorsing it: INT64 and UINT64 are in the enum but
     * fall through to the default case. Nothing asks for them, and BigInt64Array would not be
     * interchangeable with the rest anyway.
     */
    assert.throws(() => NativeArray(NativeType.INT64), /Unrecognized native type/)
    assert.throws(() => NativeArray(NativeType.UINT64), /Unrecognized native type/)
})
