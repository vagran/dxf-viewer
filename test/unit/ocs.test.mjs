/** The OCS helpers: the arbitrary axis algorithm, and the projection of an OCS plane onto WCS XY
 * that every planar entity is drawn through.
 *
 * The expected values are ezdxf's, from `ezdxf.math.OCS(n).ux`, `.uy` and `.to_wcs((3, 4, 5))`,
 * so they are an independent implementation of the same specification rather than this one's
 * output written down.
 */
import {test} from "node:test"
import assert from "node:assert"
import {Matrix3, Vector2} from "three"

import {OcsBasis, OcsToWcsMatrix, WcsToOcs} from "../../src/math/Ocs.js"

const Close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-12,
              `${message}: expected ${expected}, got ${actual}`)

const V = (x, y, z) => ({x, y, z})

/** extrusion, OCS X axis, OCS Y axis, WCS XY of OCS (3, 4, 5). */
const REFERENCE = [
    /* |Nx| and |Ny| below 1/64: the X axis comes from WCS Y. */
    [V(0, 0, -1), [-1, 0, 0], [0, 1, 0], [-3, 4]],
    [V(0.005, 0.003, -1), [-0.9999875002343703, 0, -0.004999937501171852],
     [-1.4999557513205227e-05, 0.9999955001428704, 0.002999911502641045],
     [-2.9750229239223263, 4.014981745577984]],
    /* Above it: from WCS Z. */
    [V(0, -0.6, 0.8), [1, 0, 0], [0, 0.8, 0.6], [3, 0.2]],
    [V(1, 0, 0), [0, 1, 0], [0, 0, 1], [5, 3]],
    /* Not normalized. */
    [V(2, -3, 6), [0.8320502943378437, 0.5547001962252291, 0],
     [-0.4754573110501964, 0.7131859665752945, 0.5150787536377127],
     [2.022893067384174, 2.373987312119723]],
    /* Issue #105, the first of its three polylines. */
    [V(0.0113355368555999, -0.173648177668273, 0.9847425125364923),
     [0.9978761275325522, 0.06514011130354207, 0],
     [-0.06414623687195677, 0.9826510450265904, 0.17401776921716003],
     [2.793721119387829, 3.257783625675623]]
]

for (const [extrusion, ax, ay, wcs] of REFERENCE) {
    const name = `(${extrusion.x}, ${extrusion.y}, ${extrusion.z})`

    test(`OCS axes match ezdxf for extrusion ${name}`, () => {
        const basis = OcsBasis(extrusion)
        for (const [axis, expected, label] of [[basis.ax, ax, "X"], [basis.ay, ay, "Y"]]) {
            Close(axis.x, expected[0], `${label}.x`)
            Close(axis.y, expected[1], `${label}.y`)
            Close(axis.z, expected[2], `${label}.z`)
        }
    })

    test(`OCS point projects onto WCS XY as ezdxf has it, for extrusion ${name}`, () => {
        const m = OcsToWcsMatrix(OcsBasis(extrusion), 5)
        const p = new Vector2(3, 4).applyMatrix3(m)
        Close(p.x, wcs[0], "x")
        Close(p.y, wcs[1], "y")
    })

    test(`WCS to OCS inverts OCS to WCS, for extrusion ${name}`, () => {
        const basis = OcsBasis(extrusion)
        const {ax, ay, az} = basis
        const w = ax.clone().multiplyScalar(3).addScaledVector(ay, 4).addScaledVector(az, 5)
        const o = WcsToOcs(basis, w)
        Close(o.x, 3, "x")
        Close(o.y, 4, "y")
        Close(o.z, 5, "z")
    })
}

test("the default extrusion needs no transform", () => {
    assert.strictEqual(OcsBasis(undefined), null, "absent")
    assert.strictEqual(OcsBasis(V(0, 0, 1)), null, "+Z")
    assert.strictEqual(OcsBasis(V(0, 0, 2)), null, "+Z, not normalized")
    assert.strictEqual(OcsToWcsMatrix(null, 10), null)
})

test("an extrusion that cannot be normalized is taken as the default", () => {
    assert.strictEqual(OcsBasis(V(0, 0, 0)), null, "zero length")
    assert.strictEqual(OcsBasis(V(NaN, 0, 1)), null, "NaN")
    assert.strictEqual(OcsBasis(V(Infinity, 0, 0)), null, "infinite")
})

test("negative Z is exactly the X mirror, elevation notwithstanding", () => {
    const m = OcsToWcsMatrix(OcsBasis(V(0, 0, -1)), 123)
    const expected = new Matrix3().makeScale(-1, 1)
    for (let i = 0; i < 9; i++) {
        assert.ok(m.elements[i] === expected.elements[i], `element ${i}: ${m.elements[i]}`)
    }
})

test("a vertical plane collapses onto a line", () => {
    /* Extrusion along X: the OCS plane is WCS YZ, and from the top it is the line x = elevation. */
    const m = OcsToWcsMatrix(OcsBasis(V(1, 0, 0)), 7)
    for (const [x, y] of [[0, 0], [3, 4], [-5, 10]]) {
        const p = new Vector2(x, y).applyMatrix3(m)
        Close(p.x, 7, `x of (${x}, ${y})`)
        Close(p.y, x, `y of (${x}, ${y})`)
    }
})
