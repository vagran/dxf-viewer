import {Vector2} from "three"

/**
 * @typedef PatternLineDef
 * @property {number} angle Line angle in radians.
 * @property {?Vector2} base Base point for scaling, rotation and anchoring. [0,0] if not specified.
 * @property {Vector2} offset Offset for line instantiation.
 * @property {?number[]} dashes Dash lengths. Solid line if not specified. Negative numbers for
 *  spaces, positive for dashes, zero for dots.
 */

/** Tolerance for two pattern line angles being the same one, in radians. The values compared are
 * degrees out of a DXF file converted to radians against a table written in the same degrees, so
 * the only difference to absorb is that conversion's own rounding.
 */
const ANGLE_TOLERANCE = 1e-6

/** Reduce a line angle to [0, PI): a family of parallel lines is the same family drawn the other
 * way round.
 */
function NormalizeLineAngle(angle) {
    const a = angle % Math.PI
    return a < 0 ? a + Math.PI : a
}

/** @param {number} a Normalized angle.
 * @param {number} b Normalized angle.
 * @return {boolean} True if equal within `ANGLE_TOLERANCE`, wrapping around PI.
 */
function AnglesEqual(a, b) {
    const d = Math.abs(a - b)
    return d <= ANGLE_TOLERANCE || Math.PI - d <= ANGLE_TOLERANCE
}

/** @param {PatternLineDef} line
 * @return {string} What the line's dashes are, with their lengths left out: those are scaled along
 *  with everything else, while the count and the dash/space/dot of each one are not.
 */
function DashSignature(line) {
    if (!line.dashes || line.dashes.length == 0) {
        return ""
    }
    return line.dashes.map(Math.sign).join(",")
}

export class Pattern {
    /**
     * @param {PatternLineDef[]} lines
     * @param {boolean} offsetInLineSpace Line offset is defined in line space when true, in pattern
     *  space when false. Pattern space offset is the observed behavior of AutoDesk viewer for
     *  patterns defined in hatch entity itself.
     */
    constructor(lines, name = null, offsetInLineSpace = true) {
        this.lines = lines
        this.name = name
        this.offsetInLineSpace = offsetInLineSpace
    }

    /** Whether this definition has the shape QCAD writes into every hatch it exports: one solid
     * line at 45 degrees, regardless of the pattern the entity names. It is the only shape an
     * embedded definition is ever doubted for, and on its own it settles nothing - ANSI31 is that
     * line - so `ContradictsNamedPattern()` decides what to do about it.
     */
    get isQcadDefault() {
        if (this.lines.length != 1) {
            return false
        }
        const line = this.lines[0]
        if (line.dashes) {
            return false
        }
        if (Math.abs(line.angle - Math.PI / 4) > 10e-14) {
            return false
        }
        return true
    }

    /** Whether this definition, embedded in a HATCH entity, cannot be the pattern that entity
     * names - which means it is a placeholder and the named pattern should be used instead.
     *
     * Asked of a definition that looks like QCAD's placeholder (see `isQcadDefault`), which is the
     * only case where an embedded definition is doubted at all. It cannot simply be thrown away
     * for looking like that line: ANSI31 *is* a single 45 degree solid line, and the embedded copy
     * is the only place the file says what spacing it was drawn at. Comparing it with the named
     * pattern settles it.
     *
     * Only the shape is comparable. An embedded definition is already scaled and rotated, so its
     * spacing, base points and dash lengths say nothing about which pattern it is; the number of
     * lines, their angles relative to the hatch's own pattern angle, and whether each line is
     * solid, dashed or dotted all survive that transformation.
     *
     * @param {Pattern} named The pattern of this name from the registry.
     * @param {number} patternAngle Rotation the HATCH applies to the named pattern, in radians
     *  (group 52).
     * @return {boolean}
     */
    ContradictsNamedPattern(named, patternAngle = 0) {
        if (this.lines.length == 0 || this.lines.length != named.lines.length) {
            return true
        }
        const unmatched = [...this.lines]
        for (const namedLine of named.lines) {
            const angle = NormalizeLineAngle((namedLine.angle ?? 0) + patternAngle)
            const dashes = DashSignature(namedLine)
            const i = unmatched.findIndex(
                line => DashSignature(line) == dashes &&
                        AnglesEqual(NormalizeLineAngle(line.angle ?? 0), angle))
            if (i < 0) {
                return true
            }
            unmatched.splice(i, 1)
        }
        return false
    }

    static ParsePatFile(content) {
        const lines = content.split(/\r?\n/)
        if (lines.length < 2) {
            throw new Error("Invalid .pat file content")
        }
        let name = null
        const lineDefs = []
        for (let line of lines) {
            line = line.trim()
            if (line == "") {
                continue
            }
            if (line.startsWith(";")) {
                continue
            }
            if (name === null) {
                const m = line.match(/\*([^,]+)(?:,.*)?/)
                if (!m) {
                    throw new Error("Bad header for .pat file content")
                }
                name = m[1]
                continue
            }
            const commentPos = line.indexOf(";")
            if (commentPos != -1) {
                line = line.substring(0, commentPos).trim()
            }
            let params = line.split(/\s*,\s*/)
            /* Tolerate trailing comma. */
            if (params[params.length - 1] == "") {
                params.length = params.length - 1
            }
            params = params.map(s => {
                const x = parseFloat(s)
                if (isNaN(x)) {
                    throw new Error("Failed to parse number in .pat file: " + s)
                }
                return x
            })
            const lineDef = {
                angle: params[0] * Math.PI / 180,
                base: new Vector2(params[1], params[2]),
                offset: new Vector2(params[3], params[4])
            }
            if (params.length > 5) {
                lineDef.dashes = params.slice(5)
            }
            lineDefs.push(lineDef)
        }
        return new Pattern(lineDefs, name)
    }
}

const patternsRegistryMetric = new Map()
const patternsRegistryImperial = new Map()

/** @param {Pattern} pattern */
export function RegisterPattern(pattern, isMetric = true) {
    if (!pattern.name) {
        throw new Error("Anonymous pattern cannot be registered")
    }
    const name = pattern.name.toUpperCase()
    const registry = isMetric ? patternsRegistryMetric : patternsRegistryImperial
    if (registry.has(name)) {
        console.warn(`Pattern with name ${name} is already registered`)
        return
    }
    registry.set(name, pattern)
}

/** @return {?Pattern} */
export function LookupPattern(name, isMetric = true) {
    return (isMetric ? patternsRegistryMetric : patternsRegistryImperial)
        .get(name.toUpperCase()) ?? null
}
