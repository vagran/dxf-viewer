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

/* CopyTo documents srcOffset as an element count, and every other offset in the class is one. It
 * is passed straight to the TypedArray-over-ArrayBuffer constructor, whose second argument is a
 * *byte* offset -- so it reads from the wrong place when srcOffset is a multiple of the element
 * size, and throws outright when it is not. Every call site in the library uses the default of 0,
 * which is why this is harmless today.
 */
test("copy starting from an offset within the source",
     {todo: "CopyTo passes srcOffset to the TypedArray constructor, which takes bytes"}, () => {
    const buffer = new DynamicBuffer(NativeType.FLOAT32)
    for (const value of [1, 2, 3, 4]) {
        buffer.Push(value)
    }
    const destination = new Float32Array(2)
    buffer.CopyTo(destination, 0, 2, 2)
    assert.deepStrictEqual([...destination], [3, 4])
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
