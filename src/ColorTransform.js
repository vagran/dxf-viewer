/** Background-dependent correction of entity colors.
 *
 * Kept out of DxfViewer so that it is a pure function of the color, the background and the two
 * options. The same math has to be applied twice - when a material for a color is created, and
 * again to every cached material when the background changes after the scene is loaded - and this
 * way it can be unit tested without a WebGL context.
 */

/** Transform sRGB color component to linear color space. */
function LinearColor(c) {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Transform linear color component to sRGB color space. */
function SRgbColor(c) {
    return c < 0.003 ? c * 12.92 : Math.pow(c, 1 / 2.4) * 1.055 - 0.055
}

/** Get relative luminance value for a color.
 * https://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef
 * @param {number} color RGB color value.
 * @returns {number} Luminance value in range [0; 1].
 */
export function Luminance(color) {
    const r = LinearColor(((color & 0xff0000) >>> 16) / 255)
    const g = LinearColor(((color & 0xff00) >>> 8) / 255)
    const b = LinearColor((color & 0xff) / 255)

    return r * 0.2126 + g * 0.7152 + b * 0.0722
}

/**
 * Get contrast ratio for a color pair.
 * https://www.w3.org/TR/2008/REC-WCAG20-20081211/#contrast-ratiodef
 * @param {number} c1 First RGB color value.
 * @param {number} c2 Second RGB color value.
 * @returns {number} Contrast ratio between the colors. Greater than one if the first color color is
 *  brighter than the second one.
 */
export function ContrastRatio(c1, c2) {
    return (Luminance(c1) + 0.05) / (Luminance(c2) + 0.05)
}

function HlsToRgb({h, l, s}) {
    let r, g, b
    if (s === 0) {
        /* Achromatic */
        r = g = b = l
    } else {
        function hue2rgb(p, q, t) {
            if (t < 0) {
                t += 1
            }
            if (t > 1) {
                t -= 1
            }
            if (t < 1 / 6) {
                return p + (q - p) * 6 * t
            }
            if (t < 1 / 2) {
                return q
            }
            if (t < 2 / 3) {
                return p + (q - p) * (2 / 3 - t) * 6
            }
            return p
        }

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r = hue2rgb(p, q, h + 1 / 3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1 / 3)
    }

    return (Math.min(Math.floor(SRgbColor(r) * 256), 255) << 16) |
           (Math.min(Math.floor(SRgbColor(g) * 256), 255) << 8) |
            Math.min(Math.floor(SRgbColor(b) * 256), 255)
}

function RgbToHls(color) {
    const r = LinearColor(((color & 0xff0000) >>> 16) / 255)
    const g = LinearColor(((color & 0xff00) >>> 8) / 255)
    const b = LinearColor((color & 0xff) / 255)

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h, s
    const l = (max + min) / 2

    if (max === min) {
        /* Achromatic */
        h = s = 0
    } else {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0)
            break
        case g:
            h = (b - r) / d + 2
            break
        case b:
            h = (r - g) / d + 4
            break
        }
        h /= 6
    }

    return {h, l, s}
}

function Lighten(color, factor) {
    const hls = RgbToHls(color)
    hls.l *= factor
    if (hls.l > 1) {
        hls.l = 1
    }
    return HlsToRgb(hls)
}

function Darken(color, factor) {
    const hls = RgbToHls(color)
    hls.l /= factor
    return HlsToRgb(hls)
}

/** Contrast ratio below which an entity color is considered too close to the background. */
const MIN_TARGET_RATIO = 1.5

/** Contrast a neutral (hueless) entity color is held to on a dark background.
 *
 * Such a color has only its lightness to stand out with, where a colored one also has hue, so it
 * needs more of a ratio to be readable - a dark grey at the ordinary 1.5 is legible in the numeric
 * sense and still looks like part of the background. Only dark backgrounds: on a light one the same
 * rule would push the light greys (ACI 253, 254) down to a mid grey, changing what the light theme
 * has always looked like for no reported problem.
 */
const NEUTRAL_MIN_TARGET_RATIO = 3

/** CIE L*a*b* chroma below which a color counts as neutral. Ten is far below the chroma of any
 *  color a drawing uses to carry a hue, and far above the rounding noise of an r = g = b grey.
 */
const NEUTRAL_CHROMA = 10

/** The non-linear part of the CIE L*a*b* transform. */
function LabCurve(t) {
    return t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29
}

/** CIE L*a*b* chroma of a color, against the D65 white point. Near zero for a grey - the matrix
 *  rows and the white point are not the same numbers to the last digit, so an achromatic color
 *  lands within a few millionths of the axis rather than exactly on it.
 * @param {number} color RGB color value.
 * @returns {number} Chroma.
 */
export function Chroma(color) {
    const r = LinearColor(((color & 0xff0000) >>> 16) / 255)
    const g = LinearColor(((color & 0xff00) >>> 8) / 255)
    const b = LinearColor((color & 0xff) / 255)

    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    const z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b

    const fx = LabCurve(x / 0.95047)
    const fy = LabCurve(y)
    const fz = LabCurve(z / 1.08883)
    const aStar = 500 * (fx - fy)
    const bStar = 200 * (fy - fz)

    return Math.sqrt(aStar * aStar + bStar * bStar)
}

/**
 * Ensure the color is contrast enough with the specified background color.
 * @param {number} color RGB value.
 * @param {number} clearColor Background RGB value.
 * @param {boolean} colorCorrection Adjust every color which is too close to the background.
 * @param {boolean} blackWhiteInversion Invert pure white and black colors which are invisible
 *  against the background.
 * @returns {number} RGB value to use for rendering.
 */
export function TransformColor(color, clearColor, colorCorrection, blackWhiteInversion) {
    if (!colorCorrection && !blackWhiteInversion) {
        return color
    }
    /* The two inversion cases below are applied whenever either option is enabled, not only when
     * blackWhiteInversion is set. That is the behaviour this code has always had, and it is
     * deliberately preserved here rather than changed under a refactoring.
     */
    const bkgLum = Luminance(clearColor)
    if (color === 0xffffff && bkgLum >= 0.8) {
        return 0
    }
    if (color === 0 && bkgLum <= 0.2) {
        return 0xffffff
    }
    if (!colorCorrection) {
        return color
    }
    const minRatio = bkgLum <= 0.5 && Chroma(color) < NEUTRAL_CHROMA ?
        NEUTRAL_MIN_TARGET_RATIO : MIN_TARGET_RATIO
    const fgLum = Luminance(color)
    const contrast = ContrastRatio(color, clearColor)
    const diff = contrast >= 1 ? contrast : 1 / contrast
    if (diff < minRatio) {
        let targetLum
        if (bkgLum > 0.5) {
            targetLum = bkgLum / 2
        } else {
            /* Twice the background is the mirror of the branch above, but it is not enough next to
             * a black background: it is zero when the background is, and short of the required
             * ratio while the background is nearly so, so a dark color would be pushed further into
             * the background instead of out of it. The second term is what the contrast formula
             * asks of a lighter color, (L + 0.05) / (bkgLum + 0.05) = minRatio, solved for L - it
             * is what the correction needs however dark the background is. Whichever is further
             * from the background wins, so only backgrounds dark enough for the old target to fall
             * short of the required ratio change behaviour.
             */
            targetLum = Math.max(bkgLum * 2, (bkgLum + 0.05) * minRatio - 0.05)
        }
        if (targetLum > fgLum) {
            color = Lighten(color, targetLum / fgLum)
        } else {
            color = Darken(color, fgLum / targetLum)
        }
    }
    return color
}
