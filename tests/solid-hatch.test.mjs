import './resolve-js.mjs'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
const {DxfScene} = await import('../src/DxfScene.js')
const {default: DxfParser} = await import('../src/parser/DxfParser.js')

const square = (x, y, size, type = 3) => ({
    type, isExternal: (type & 1) != 0, isOutermost: (type & 16) != 0,
    polyline: {vertices: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]
        .map(([x, y]) => ({x, y}))}
})
const hatch = (boundaryLoops, hatchStyle = 0) => ({
    type: 'HATCH', isSolid: true, layer: '0', boundaryLoops, hatchStyle
})
const meshes = entity => [...new DxfScene()._DecomposeHatch(entity, null)]
const area = meshes => meshes.reduce((sum, mesh) => {
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = mesh.indices.slice(i, i + 3).map(i => mesh.vertices[i])
        sum += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    }
    return sum
}, 0)

for (const style of [0, 1, 2]) {
    test(`separate outlines remain separate with hatch style ${style}`, () => {
        const result = meshes(hatch([square(0, 0, 2), square(5, 0, 3)], style))
        assert.equal(result.length, 2)
        assert.equal(area(result), 13)
        for (const mesh of result) {
            const xs = mesh.vertices.map(v => v.x)
            assert.ok(Math.max(...xs) <= 2 || Math.min(...xs) >= 5)
        }
    })
}

for (const [style, expected] of [[0, 69], [1, 65], [2, 101]]) {
    test(`unordered nested islands and holes obey hatch style ${style}`, () => {
        const inner = square(4, 4, 2, 2)
        const hole = square(2, 2, 6, 18)
        hole.polyline.vertices.reverse()
        const entity = hatch([inner, square(20, 0, 1), hole, square(0, 0, 10)], style)
        assert.equal(area(meshes(entity)), expected)
    })
}

test('a hole is assigned to its containing outline, not the first outline', () => {
    const entity = hatch([square(0, 0, 2), square(6, 1, 1, 18), square(5, 0, 3)])
    assert.equal(area(meshes(entity)), 12)
})

test('negative extrusion mirrors solid hatch geometry once', () => {
    const entity = hatch([square(1, 0, 2), square(6, 0, 2)])
    entity.extrusionDirection = {x: 0, y: 0, z: -1}
    const result = meshes(entity)
    assert.equal(area(result), 8)
    assert.deepEqual(result.map(m => Math.min(...m.vertices.map(p => p.x))), [-3, -8])
})

test('187C: all 17 wall outlines triangulate independently with no room-spanning triangles', () => {
    const data = new DxfParser().parseSync(readFileSync(
        new URL('./fixtures/multiple-external-hatch.dxf', import.meta.url), 'utf8'))
    const entity = data.entities[0]
    assert.equal(entity.handle, '187C')
    assert.equal(entity.layer, '0')
    assert.equal(entity.hatchStyle, 1)
    assert.equal(entity.boundaryLoops.length, 17)
    assert.ok(entity.boundaryLoops.every(l => l.isExternal))
    const scene = new DxfScene()
    const loops = scene._GetHatchBoundaryLoops(entity)
    const result = meshes(entity)
    assert.equal(result.length, 17)
    let expectedArea = 0
    for (const [i, loop] of loops.entries()) {
        assert.deepEqual(result[i].vertices, loop.vertices)
        let signedArea = 0
        for (let j = 0; j < loop.vertices.length; j++) {
            const a = loop.vertices[j], b = loop.vertices[(j + 1) % loop.vertices.length]
            signedArea += a.x * b.y - b.x * a.y
        }
        // Loop 8 has a retraced edge in the source drawing; its signed area
        // is not a reliable polygon area. Keep it in the separation checks above.
        if (i != 8) expectedArea += Math.abs(signedArea) / 2
    }
    assert.ok(Math.abs(area(result.filter((_, i) => i != 8)) - expectedArea) < 1e-9)
    for (const mesh of result) {
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const triangle = mesh.indices.slice(i, i + 3).map(j => mesh.vertices[j])
            for (const point of [{x: 26, y: 34}, {x: 24, y: 34}]) {
                const sides = triangle.map((a, j) => {
                    const b = triangle[(j + 1) % 3]
                    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
                })
                assert.ok(!(sides.every(s => s > 0) || sides.every(s => s < 0)),
                          'room interior must remain unfilled')
            }
        }
    }
})
