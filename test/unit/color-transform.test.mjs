/** The background-dependent entity color correction.
 *
 * This used to be a private method of DxfViewer and could only be checked by eye in the example
 * project. It is pinned here because it has to give the same answer from two places — when a
 * material is created and when every cached material is re-corrected after the background changes —
 * and because the two flags overlap: the pure black/white inversion is applied whenever *either*
 * option is enabled, which is preserved below as it was, not as it perhaps ought to be.
 */
import {test} from "node:test"
import assert from "node:assert"

import {Chroma, ContrastRatio, Luminance, TransformColor} from "../../src/ColorTransform.js"

const BLACK = 0x000000
const WHITE = 0xffffff

/** Contrast ratio as a number >= 1, the way _TransformColor() compares it. */
function Contrast(a, b) {
    const ratio = ContrastRatio(a, b)
    return ratio >= 1 ? ratio : 1 / ratio
}

test("luminance spans the full range", () => {
    assert.strictEqual(Luminance(BLACK), 0)
    assert.strictEqual(Luminance(WHITE), 1)
    assert.ok(Luminance(0xff0000) < Luminance(0x00ff00))
})

test("contrast ratio is 21 between white and black and 1 for a color with itself", () => {
    assert.strictEqual(ContrastRatio(WHITE, BLACK), 21)
    assert.strictEqual(ContrastRatio(BLACK, WHITE), 1 / 21)
    assert.strictEqual(ContrastRatio(0x123456, 0x123456), 1)
})

test("no correction options leaves every color alone", () => {
    for (const color of [BLACK, WHITE, 0x123456, 0xff0000, 0x000080]) {
        assert.strictEqual(TransformColor(color, WHITE, false, false), color)
        assert.strictEqual(TransformColor(color, BLACK, false, false), color)
    }
})

test("pure black and white are inverted against the background", () => {
    assert.strictEqual(TransformColor(WHITE, WHITE, false, true), BLACK)
    assert.strictEqual(TransformColor(BLACK, BLACK, false, true), WHITE)
    /* Already visible, so nothing to do. */
    assert.strictEqual(TransformColor(WHITE, BLACK, false, true), WHITE)
    assert.strictEqual(TransformColor(BLACK, WHITE, false, true), BLACK)
})

test("a mid-tone background triggers no inversion", () => {
    /* The thresholds are 0.8 and 0.2 relative luminance; 0x808080 is about 0.216. */
    assert.strictEqual(TransformColor(WHITE, 0x808080, false, true), WHITE)
    assert.strictEqual(TransformColor(BLACK, 0x808080, false, true), BLACK)
})

test("color correction darkens a too-light color on a light background", () => {
    /* 0xeeeeee against white has a contrast ratio of only 1.17. */
    assert.strictEqual(TransformColor(0xeeeeee, WHITE, true, false), 0xbcbcbc)
    assert.ok(Contrast(TransformColor(0xeeeeee, WHITE, true, false), WHITE) >= 1.5)
})

test("color correction lightens a too-dark color on a dark background", () => {
    const color = 0x202020
    const corrected = TransformColor(color, 0x303030, true, false)
    assert.ok(Luminance(corrected) > Luminance(color))
})

test("a dark color on a black background is lightened, not blackened", () => {
    /* The target used to be twice the background luminance, which is zero here: the color was
     * darkened to black and disappeared into the background it was corrected against. */
    const color = 0x000080
    const corrected = TransformColor(color, BLACK, true, true)
    assert.notStrictEqual(corrected, BLACK)
    assert.ok(Luminance(corrected) > Luminance(color))
    assert.ok(Contrast(corrected, BLACK) >= 1.5)
})

test("near-black backgrounds are corrected to the target contrast too", () => {
    /* 1.45 rather than the 1.5 a colored entity is held to: the target luminance is an exact ratio
     * and the result is quantized to 8 bits, so a value between two representable colors lands a
     * fraction below. The point of the test is that no background, however dark, leaves a corrected
     * color invisible - the pure black case used to end at 0.05, the ratio of a color with itself.
     */
    for (const bkg of [0x000000, 0x050505, 0x121212, 0x202020, 0x2e2e2e]) {
        for (const color of [0x000000, 0x000080, 0x001030]) {
            const corrected = TransformColor(color, bkg, true, true)
            assert.ok(Contrast(corrected, bkg) >= 1.45,
                      `background ${bkg.toString(16)} color ${color.toString(16)} -> ` +
                      `${corrected.toString(16)}`)
        }
    }
})

test("chroma separates greys from colors", () => {
    /* Every ACI grey is achromatic, and a tint too faint to read as a color stays under the
     * threshold, while a dark color that unmistakably has a hue is well over it. A grey does not
     * come out at exactly zero - the transform puts it within a few millionths of the axis - which
     * the first tolerance is here to cover. */
    for (const grey of [0x000000, 0x333333, 0x5b5b5b, 0x848484, 0xadadad, 0xd6d6d6, WHITE]) {
        assert.ok(Chroma(grey) < 0.001, grey.toString(16))
    }
    for (const faintTint of [0x333340, 0x808088, 0x404048]) {
        assert.ok(Chroma(faintTint) < 10, faintTint.toString(16))
    }
    for (const color of [0x202030, 0x808000, 0x000080, 0x0066cc, 0xff0000, 0x00ff00]) {
        assert.ok(Chroma(color) > 10, color.toString(16))
    }
})

test("a neutral color on a dark background is held to a higher contrast", () => {
    /* A grey has no hue to be told apart from the background by, so it is corrected to 3:1 where a
     * colored entity only needs 1.5:1. ACI 250 is 1.66:1 on black and was left alone; ACI 251 is
     * already over 3:1 and still is. */
    assert.strictEqual(TransformColor(0x333333, BLACK, true, true), 0x595959)
    assert.strictEqual(TransformColor(0x404040, BLACK, true, true), 0x595959)
    assert.strictEqual(TransformColor(0x5b5b5b, BLACK, true, true), 0x5b5b5b)
    /* ACI 252, the reported grey subtitle that reads well once the colors are not darkened on their
     * way to the frame buffer - it must not be moved by this rule. */
    assert.strictEqual(TransformColor(0x848484, BLACK, true, true), 0x848484)
    assert.strictEqual(TransformColor(0xadadad, BLACK, true, true), 0xadadad)
})

test("the higher neutral contrast applies to dark backgrounds only", () => {
    /* On white the same greys keep the correction they have always had. */
    assert.strictEqual(TransformColor(0x333333, WHITE, true, false), 0x333333)
    assert.strictEqual(TransformColor(0x848484, WHITE, true, false), 0x848484)
    assert.strictEqual(TransformColor(0xd6d6d6, WHITE, true, false), 0xbcbcbc)
})

test("a colored entity on a dark background keeps the ordinary contrast", () => {
    /* The same target the algorithm has always used, so the appearance of colored entities is not
     * changed by the neutral rule. 0x000030 has contrast 1.04 against black; held to 3:1 it would
     * come out around 0x5656b0 instead. */
    assert.strictEqual(TransformColor(0x000030, BLACK, true, true), 0x00009f)
    assert.strictEqual(TransformColor(0x300000, BLACK, true, true), 0x600000)
    assert.strictEqual(TransformColor(0x202030, BLACK, true, true), 0x2a2a3d)
    assert.ok(Contrast(TransformColor(0x000030, BLACK, true, true), BLACK) < 2)
})

test("color correction leaves colors with enough contrast alone", () => {
    /* 0x00ff00 is deliberately absent: green on white has a contrast ratio of only 1.37, so it is
     * one of the colors this option exists to change. */
    for (const color of [0xff0000, 0x123456, 0x0000ff]) {
        assert.strictEqual(TransformColor(color, WHITE, true, false), color)
        assert.strictEqual(TransformColor(color, WHITE, true, true), color)
    }
})
