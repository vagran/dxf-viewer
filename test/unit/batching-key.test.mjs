/** BatchingKey and its comparator.
 *
 * Batches live in an RBTree ordered by this comparator, and DxfScene looks batches up *by prefix* —
 * all batches on a layer, all batches of a block. That only works if the comparator orders by the
 * fields in the order the constructor takes them, which is what most of this file pins.
 */
import {test} from "node:test"
import assert from "node:assert"

import {BatchingKey, CompareValues} from "../../src/BatchingKey.js"

const GeometryType = BatchingKey.GeometryType
const Key = (layer, block, geometry, color, lineType) =>
    new BatchingKey(layer, block, geometry, color, lineType)

test("missing components become null rather than undefined", () => {
    const key = new BatchingKey(undefined, undefined, undefined, 0, undefined)
    assert.deepStrictEqual(
        [key.layerName, key.blockName, key.geometryType, key.lineType],
        [null, null, null, null])
})

test("CompareValues puts null first and orders the rest naturally", () => {
    assert.strictEqual(CompareValues(null, null), 0)
    assert.strictEqual(CompareValues(null, "a"), -1)
    assert.strictEqual(CompareValues("a", null), 1)
    assert.strictEqual(CompareValues("a", "b"), -1)
    assert.strictEqual(CompareValues(2, 10), -1, "numbers compare as numbers, not as strings")
    assert.strictEqual(CompareValues("a", "a"), 0)
})

test("a key compares equal to an identical key", () => {
    const a = Key("L", "B", GeometryType.LINES, 0xff0000, 0)
    const b = Key("L", "B", GeometryType.LINES, 0xff0000, 0)
    assert.strictEqual(a.Compare(b), 0)
    assert.strictEqual(b.Compare(a), 0)
})

test("comparison is antisymmetric", () => {
    const keys = [
        Key("A", null, GeometryType.LINES, 1, 0),
        Key("B", "X", GeometryType.POINTS, 2, 0),
        Key("A", "X", GeometryType.LINES, 1, null)
    ]
    for (const a of keys) {
        for (const b of keys) {
            /* Summed rather than negated: -Math.sign(0) is -0, which strictEqual rejects. */
            assert.strictEqual(Math.sign(a.Compare(b)) + Math.sign(b.Compare(a)), 0,
                               `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
        }
    }
})

test("fields decide the order in the order the constructor takes them", () => {
    const base = () => Key("L", "B", GeometryType.LINES, 5, 5)
    /* Each pair differs in exactly one field, and the earlier field always wins even when a later
     * one points the other way. */
    const cases = [
        ["layerName", Key("A", "Z", GeometryType.TRIANGLES, 9, 9), Key("B", "A", GeometryType.POINTS, 1, 1)],
        ["blockName", Key("L", "A", GeometryType.TRIANGLES, 9, 9), Key("L", "B", GeometryType.POINTS, 1, 1)],
        ["geometryType", Key("L", "B", GeometryType.POINTS, 9, 9), Key("L", "B", GeometryType.LINES, 1, 1)],
        ["color", Key("L", "B", GeometryType.LINES, 1, 9), Key("L", "B", GeometryType.LINES, 5, 1)],
        ["lineType", Key("L", "B", GeometryType.LINES, 5, 1), base()]
    ]
    for (const [field, lower, higher] of cases) {
        assert.strictEqual(lower.Compare(higher), -1, `${field} should decide the order`)
        assert.strictEqual(higher.Compare(lower), 1, `${field}, reversed`)
    }
})

test("keys sharing a prefix sort contiguously, which is what lookup by prefix needs", () => {
    const keys = []
    for (const layer of [null, "A", "B"]) {
        for (const block of [null, "P", "Q"]) {
            for (const geometry of [GeometryType.LINES, GeometryType.TRIANGLES]) {
                keys.push(Key(layer, block, geometry, 0x112233, 0))
            }
        }
    }
    /* Shuffle deterministically, so a comparator that only works on already-sorted input fails. */
    keys.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? 1 : -1))
    keys.sort((a, b) => a.Compare(b))

    const IsContiguous = Describe => {
        const seen = new Map()
        let previous = null
        for (const [index, key] of keys.entries()) {
            const group = Describe(key)
            if (group !== previous) {
                assert.ok(!seen.has(group),
                          `group ${group} reappears at ${index} after ${seen.get(group)}`)
                seen.set(group, index)
                previous = group
            }
        }
    }
    IsContiguous(key => String(key.layerName))
    IsContiguous(key => `${key.layerName}/${key.blockName}`)
})

test("null components sort ahead of present ones", () => {
    const anonymous = Key(null, null, GeometryType.LINES, 0, 0)
    const named = Key("A", null, GeometryType.LINES, 0, 0)
    assert.strictEqual(anonymous.Compare(named), -1)
})

test("IsIndexed covers exactly the indexed geometry types", () => {
    const indexed = [GeometryType.INDEXED_LINES, GeometryType.INDEXED_TRIANGLES]
    for (const [name, value] of Object.entries(GeometryType)) {
        const key = Key("L", null, value, 0, 0)
        assert.strictEqual(key.IsIndexed(), indexed.includes(value), name)
    }
})

test("IsInstanced covers exactly the instanced geometry types", () => {
    const instanced = [GeometryType.BLOCK_INSTANCE, GeometryType.POINT_INSTANCE]
    for (const [name, value] of Object.entries(GeometryType)) {
        const key = Key("L", null, value, 0, 0)
        assert.strictEqual(key.IsInstanced(), instanced.includes(value), name)
    }
})
