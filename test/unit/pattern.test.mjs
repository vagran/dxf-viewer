/** Hatch pattern parsing and the name registry. */
import {test} from "node:test"
import assert from "node:assert"
import {Vector2} from "three"

import {Pattern, RegisterPattern, LookupPattern} from "../../src/Pattern.js"

const Close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-12,
              `${message}: expected ${expected}, got ${actual}`)

const Line = (angle, offset = new Vector2(0, 1), extra = {}) =>
    ({angle, offset, ...extra})

test("a .pat file parses into a named pattern", () => {
    const pattern = Pattern.ParsePatFile(
        "*MYPATTERN, a description with, commas\n" +
        "45, 0, 0, 0, 3.175\n")
    assert.strictEqual(pattern.name, "MYPATTERN")
    assert.strictEqual(pattern.lines.length, 1)
    Close(pattern.lines[0].angle, Math.PI / 4, "degrees become radians")
    assert.deepStrictEqual([pattern.lines[0].base.x, pattern.lines[0].base.y], [0, 0])
    assert.deepStrictEqual([pattern.lines[0].offset.x, pattern.lines[0].offset.y], [0, 3.175])
    assert.strictEqual(pattern.lines[0].dashes, undefined, "no dashes means a solid line")
})

test("several line definitions are kept in order", () => {
    const pattern = Pattern.ParsePatFile(
        "*CROSSHATCH\n" +
        "0, 0, 0, 0, 1\n" +
        "90, 0, 0, 0, 1\n")
    assert.strictEqual(pattern.lines.length, 2)
    Close(pattern.lines[0].angle, 0, "first line")
    Close(pattern.lines[1].angle, Math.PI / 2, "second line")
})

test("trailing dash values become the dash pattern", () => {
    const pattern = Pattern.ParsePatFile("*DASHED\n0, 0, 0, 0, 1, 0.5, -0.25\n")
    assert.deepStrictEqual(pattern.lines[0].dashes, [0.5, -0.25])
})

test("comments, blank lines and a trailing comma are tolerated", () => {
    const pattern = Pattern.ParsePatFile(
        "; a leading comment\n" +
        "\n" +
        "*SPACED\n" +
        "   \n" +
        "  0, 0, 0, 0, 1,   ; trailing comment and comma\n")
    assert.strictEqual(pattern.name, "SPACED")
    assert.strictEqual(pattern.lines.length, 1)
    assert.deepStrictEqual([pattern.lines[0].offset.x, pattern.lines[0].offset.y], [0, 1])
})

test("malformed content is rejected", () => {
    assert.throws(() => Pattern.ParsePatFile("*ONLYHEADER"), /Invalid .pat file content/,
                  "a single line cannot hold both a header and a definition")
    assert.throws(() => Pattern.ParsePatFile("no header here\n0, 0, 0, 0, 1\n"),
                  /Bad header/)
    assert.throws(() => Pattern.ParsePatFile("*BAD\n0, 0, zero, 0, 1\n"),
                  /Failed to parse number/)
})

test("isQcadDefault recognises the single 45-degree solid line QCAD always embeds", () => {
    assert.strictEqual(new Pattern([Line(Math.PI / 4)]).isQcadDefault, true)
    assert.strictEqual(new Pattern([Line(Math.PI / 4 + 1e-15)]).isQcadDefault, true,
                       "the angle comparison has a tolerance")
})

test("isQcadDefault rejects anything else", () => {
    assert.strictEqual(new Pattern([Line(Math.PI / 3)]).isQcadDefault, false, "wrong angle")
    assert.strictEqual(new Pattern([Line(Math.PI / 4), Line(0)]).isQcadDefault, false,
                       "more than one line")
    assert.strictEqual(new Pattern([]).isQcadDefault, false, "no lines")
    assert.strictEqual(new Pattern([Line(Math.PI / 4, new Vector2(0, 1), {dashes: [1, -1]})])
                           .isQcadDefault, false, "dashed, so not the default")
})

test("offsetInLineSpace defaults on, and is the difference between a .pat and an embedded pattern",
     () => {
         assert.strictEqual(new Pattern([Line(0)]).offsetInLineSpace, true)
         assert.strictEqual(new Pattern([Line(0)], "N", false).offsetInLineSpace, false)
         assert.strictEqual(Pattern.ParsePatFile("*P\n0, 0, 0, 0, 1\n").offsetInLineSpace, true,
                       "values from a .pat file are not pre-rotated")
     })

/* ContradictsNamedPattern is what keeps the QCAD placeholder test from throwing away a real
 * definition. ANSI31 is a single 45 degrees solid line, which is exactly the shape of that
 * placeholder, so "it looks like the QCAD default" cannot decide on its own -- only whether the
 * named pattern looks like it as well. Spacing, base points and dash lengths are all scaled by the
 * embedding and are deliberately not compared.
 */

const Named = lines => new Pattern(lines, "NAMED")

test("a genuine ANSI31 definition does not contradict the named pattern", () => {
    const embedded = new Pattern([Line(Math.PI / 4, new Vector2(-0.224, 0.224))], "ANSI31", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(Named([Line(Math.PI / 4)])), false,
                       "same line count, same angle, no dashes either side")
    assert.strictEqual(embedded.isQcadDefault, true,
                       "and the QCAD test alone would have matched it")
})

test("a single 45-degree line contradicts a pattern of another shape", () => {
    /* PLAST is three horizontal lines, so the placeholder cannot be it whatever the name says. */
    const placeholder = new Pattern([Line(Math.PI / 4)], "PLAST", false)
    assert.strictEqual(placeholder.ContradictsNamedPattern(
        Named([Line(0), Line(0), Line(0)])), true)
})

test("a rotated instance of the named pattern does not contradict it", () => {
    /* The same pattern turned by the HATCH's own angle is still that pattern. A mirrored floor
     * plan hatches ANSI31 along 135 degrees and turns one wall's pattern by another 90, which puts
     * the definition line at 45 - the table's own angle, arrived at from the other side. Reading
     * the two as different patterns made that one wall hatch from the table, 25.4 times sparser
     * than the walls beside it.
     */
    const embedded = new Pattern([Line(Math.PI / 4)], "ANSI31", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(Named([Line(Math.PI / 4)])), false)
    assert.strictEqual(embedded.ContradictsNamedPattern(Named([Line(3 * Math.PI / 4)])), false,
                       "and a pattern table entry a half turn from it is the same family too")
    assert.strictEqual(embedded.isQcadDefault, true,
                       "which is the shape the QCAD test matches")
})

test("the angle between the lines is what is compared, not the drawing's", () => {
    /* A two-line pattern turned as a whole matches; one whose lines are a different angle apart
     * does not. */
    const cross = new Pattern([Line(0), Line(Math.PI / 2)], "CROSS", false)
    assert.strictEqual(cross.ContradictsNamedPattern(Named([Line(Math.PI / 3),
                                                             Line(Math.PI / 3 + Math.PI / 2)])),
                       false)
    assert.strictEqual(cross.ContradictsNamedPattern(Named([Line(0), Line(Math.PI / 4)])), true)
})

test("line angles are compared modulo half a turn", () => {
    /* A line family is the same family when its lines are turned by 180 degrees. */
    assert.strictEqual(new Pattern([Line(3 * Math.PI / 4)], "N", false)
                           .ContradictsNamedPattern(Named([Line(-Math.PI / 4)])), false)
})

test("a different number of lines contradicts", () => {
    assert.strictEqual(new Pattern([Line(0)], "N", false)
                           .ContradictsNamedPattern(Named([Line(0), Line(0)])), true)
})

test("dash signs are compared, their lengths are not", () => {
    const embedded = new Pattern([Line(0, new Vector2(0, 1), {dashes: [0, -1]})], "N", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(
        Named([Line(0, new Vector2(0, 1), {dashes: [0, -3.175]})])), false,
                       "a dot and a gap, at the embedding's own scale")
    assert.strictEqual(embedded.ContradictsNamedPattern(
        Named([Line(0, new Vector2(0, 1), {dashes: [0.5, -3.175]})])), true,
                       "the dot became a dash")
    assert.strictEqual(embedded.ContradictsNamedPattern(
        Named([Line(0, new Vector2(0, 1), {dashes: [0]})])), true, "one dash fewer")
    assert.strictEqual(embedded.ContradictsNamedPattern(Named([Line(0)])), true,
                       "dashes against no dashes")
})

test("a registered pattern is found again, case insensitively", () => {
    const pattern = new Pattern([Line(0)], "UnitTestPattern")
    RegisterPattern(pattern, true)
    assert.strictEqual(LookupPattern("UnitTestPattern", true), pattern)
    assert.strictEqual(LookupPattern("UNITTESTPATTERN", true), pattern)
    assert.strictEqual(LookupPattern("unittestpattern", true), pattern)
})

test("the metric and imperial registries are separate", () => {
    const metric = new Pattern([Line(0)], "UnitTestMeasurement")
    const imperial = new Pattern([Line(Math.PI / 2)], "UnitTestMeasurement")
    RegisterPattern(metric, true)
    RegisterPattern(imperial, false)
    assert.strictEqual(LookupPattern("UnitTestMeasurement", true), metric)
    assert.strictEqual(LookupPattern("UnitTestMeasurement", false), imperial)
})

test("a missing name looks up as null rather than undefined", () => {
    assert.strictEqual(LookupPattern("NoSuchPatternExistsHere", true), null)
    assert.strictEqual(LookupPattern("NoSuchPatternExistsHere", false), null)
})

test("an anonymous pattern cannot be registered", () => {
    assert.throws(() => RegisterPattern(new Pattern([Line(0)])),
                  /Anonymous pattern cannot be registered/)
})

test("the built-in patterns are registered on import", async () => {
    await import("../../src/patterns/index.js")
    const ansi31 = LookupPattern("ANSI31", true)
    assert.ok(ansi31, "ANSI31 should be present in the metric registry")
    assert.strictEqual(ansi31.lines.length, 1)
    Close(ansi31.lines[0].angle, Math.PI / 4, "ANSI31 is a 45 degree hatch")

    const imperial = LookupPattern("ANSI31", false)
    assert.ok(imperial, "and in the imperial registry")
    Close(imperial.lines[0].offset.length() * 25.4, ansi31.lines[0].offset.length(),
          "imperial patterns are the metric ones scaled by 1/25.4")
})
