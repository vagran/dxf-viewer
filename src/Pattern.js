import {Vector2} from "three"

/* Tolerance for comparing two line angles, in radians. Angles survive the embedding unscaled, so
 * only the precision the file was written with has to be absorbed.
 */
const ANGLE_EPS = 1e-6

/** One line family of a hatch pattern: a line repeated at a fixed offset to fill the area.
 *
 * @typedef PatternLineDef
 * @property {number} angle Line angle in radians.
 * @property {?Vector2} base Base point for scaling, rotation and anchoring. [0,0] if not specified.
 * @property {Vector2} offset Offset for line instantiation.
 * @property {?number[]} dashes Dash lengths. Solid line if not specified. Negative numbers for
 *  spaces, positive for dashes, zero for dots.
 */

/** A hatch pattern: the line families a hatched area is filled with, and the name they are
 * registered under. Built-in patterns are registered at import time; `RegisterPattern()` adds
 * more, and `LookupPattern()` finds one by name.
 */
export class Pattern {
    /**
     * @param {PatternLineDef[]} lines The line families making up the pattern.
     * @param {?string} name Pattern name, null for an unnamed pattern.
     * @param {boolean} offsetInLineSpace Line offset is defined in line space when true, in pattern
     *  space when false. Pattern space offset is the observed behavior of AutoDesk viewer for
     *  patterns defined in hatch entity itself.
     */
    constructor(lines, name = null, offsetInLineSpace = true) {
        this.lines = lines
        /** @type {?string} Name the pattern is registered under, null for an unnamed one. */
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

    /** Check whether the shape of this pattern contradicts the shape of `named`, i.e. whether the
     * two cannot be the same pattern. Used to tell a placeholder definition embedded by an editor
     * from a real one, so only the properties an embedded definition preserves are compared: the
     * number of lines, the angles between them and the signs of the dash sequences. Spacing, base
     * points and dash lengths are all scaled by the embedding and so say nothing about the name.
     *
     * The angles are compared relative to the pattern's own first line, not to the drawing, because
     * an embedded definition carries the orientation the drawing uses the pattern in. A mirrored
     * plan hatches "ANSI31" along 135 degrees and one of its walls rotates that by another 90, so
     * its definition lines read 45 - which against the pattern table's own 45 is either the same
     * pattern or half a turn from it, depending on which of the two rotations is accounted for.
     * Comparing the internal structure sidesteps the question, and a placeholder is a single line
     * at 135 where the name means three horizontal ones, so the line count still separates them.
     * @param {Pattern} named Pattern to compare with, normally the one found by name.
     * @returns {boolean}
     */
    ContradictsNamedPattern(named) {
        if (this.lines.length != named.lines.length) {
            return true
        }
        /* A line family is the same family turned by half a turn, so angles are modulo 180. */
        const Normalize = angle => {
            const a = angle % Math.PI
            return a < 0 ? a + Math.PI : a
        }
        const Offsets = pattern => {
            const base = Normalize(pattern.lines[0].angle ?? 0)
            return pattern.lines.map(line => Normalize((line.angle ?? 0) - base))
        }
        const offsets = Offsets(this)
        const namedOffsets = Offsets(named)
        for (let i = 0; i < this.lines.length; i++) {
            if (Math.abs(offsets[i] - namedOffsets[i]) > ANGLE_EPS) {
                return true
            }
            const dashes = this.lines[i].dashes ?? []
            const namedDashes = named.lines[i].dashes ?? []
            if (dashes.length != namedDashes.length) {
                return true
            }
            for (let j = 0; j < dashes.length; j++) {
                if (Math.sign(dashes[j]) != Math.sign(namedDashes[j])) {
                    return true
                }
            }
        }
        return false
    }

    /** Parse a pattern from the content of a .pat file.
     * @param {string} content Whole file content.
     * @returns {Pattern} The parsed pattern.
     */
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

/** Add a pattern to the registry its name is looked up in.
 * @param {Pattern} pattern Must be named; an anonymous pattern throws.
 * @param {boolean} isMetric Register in the metric registry when true, the imperial one when
 *  false. The two are selected by the drawing's $MEASUREMENT variable.
 */
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

/** Find a registered pattern by name, case-insensitively.
 * @param {string} name Pattern name.
 * @param {boolean} isMetric Which registry to search. See RegisterPattern().
 * @returns {?Pattern} Null if no pattern of that name is registered.
 */
export function LookupPattern(name, isMetric = true) {
    return (isMetric ? patternsRegistryMetric : patternsRegistryImperial)
        .get(name.toUpperCase()) ?? null
}
