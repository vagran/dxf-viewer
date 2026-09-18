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

/* ContradictsNamedPattern -- whether a definition embedded in a HATCH could be the pattern the
 * entity names. It decides whether the file's own definition is used, which is the only place the
 * spacing the hatch was drawn at is recorded, or the registry's copy, which still has to be scaled.
 *
 * ANSI31 as the registry holds it: one solid line at 45 degrees. PLAST: three solid lines at 0,
 * which is what QCAD writes a single 45 degree line in place of.
 */
const ANSI31 = new Pattern([Line(Math.PI / 4, new Vector2(0, 3.175))], "ANSI31")
const PLAST = new Pattern([Line(0), Line(0), Line(0)], "PLAST")

test("a definition of the same shape as the named pattern is kept", () => {
    /* The case that matters for spacing: AutoCAD writes a real ANSI31 definition, already scaled,
     * and it must not be thrown away for looking like QCAD's placeholder -- it looks like it
     * because ANSI31 is that line.
     */
    const embedded = new Pattern([Line(Math.PI / 4, new Vector2(0, 0.3175))], "ANSI31", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(ANSI31), false)
})

test("spacing and base points are not what identifies a pattern", () => {
    /* An embedded definition arrives scaled, so neither can be compared -- only the shape. */
    const embedded = new Pattern([Line(Math.PI / 4, new Vector2(0, 1e6))], "ANSI31", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(ANSI31), false)
})

test("the pattern angle is taken off before the angles are compared", () => {
    /* A hatch rotates the named pattern by group 52, and the embedded definition is written
     * already rotated. PLAST at 90 degrees is what test-data's ED81 carries.
     */
    const embedded = new Pattern([Line(Math.PI / 2), Line(Math.PI / 2), Line(Math.PI / 2)],
                                 "PLAST", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(PLAST, Math.PI / 2), false)
    assert.strictEqual(embedded.ContradictsNamedPattern(PLAST, 0), true,
                       "unrotated, three lines at 90 degrees are not three at 0")
})

test("a line angle is the same one drawn the other way round", () => {
    const embedded = new Pattern([Line(Math.PI / 4 + Math.PI, new Vector2(0, 1))], "ANSI31", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(ANSI31), false, "225 degrees is 45")
})

test("QCAD's placeholder contradicts the pattern it is named after", () => {
    /* The workaround this exists for: QCAD exports one 45 degree solid line whatever the hatch is
     * called, so for anything but a pattern that really is that line the name has to win.
     */
    const placeholder = new Pattern([Line(Math.PI / 4)], "PLAST", false)
    assert.strictEqual(placeholder.ContradictsNamedPattern(PLAST), true)
})

test("a differing line count or dash structure contradicts", () => {
    assert.strictEqual(new Pattern([Line(0), Line(0)]).ContradictsNamedPattern(PLAST), true,
                       "two lines are not three")
    assert.strictEqual(new Pattern([]).ContradictsNamedPattern(ANSI31), true, "no lines at all")
    const dashed = new Pattern([Line(Math.PI / 4, new Vector2(0, 1), {dashes: [1, -1]})])
    assert.strictEqual(dashed.ContradictsNamedPattern(ANSI31), true, "dashed, ANSI31 is solid")
})

test("dash lengths are scaled too, so only their signs are compared", () => {
    const named = new Pattern([Line(0, new Vector2(1, 2), {dashes: [0, -2]})], "DOTS")
    const embedded = new Pattern([Line(0, new Vector2(0.1, 0.2), {dashes: [0, -0.2]})],
                                 "DOTS", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(named), false)
    const inverted = new Pattern([Line(0, new Vector2(0.1, 0.2), {dashes: [-0.2, 0]})],
                                 "DOTS", false)
    assert.strictEqual(inverted.ContradictsNamedPattern(named), true,
                       "a space where a dot belongs is a different pattern")
})

test("lines are matched in any order", () => {
    const named = new Pattern([Line(0), Line(Math.PI / 2)], "CROSS")
    const embedded = new Pattern([Line(Math.PI / 2), Line(0)], "CROSS", false)
    assert.strictEqual(embedded.ContradictsNamedPattern(named), false)
})

test("offsetInLineSpace defaults on, and is the difference between a .pat and an embedded pattern",
     () => {
         assert.strictEqual(new Pattern([Line(0)]).offsetInLineSpace, true)
         assert.strictEqual(new Pattern([Line(0)], "N", false).offsetInLineSpace, false)
         assert.strictEqual(Pattern.ParsePatFile("*P\n0, 0, 0, 0, 1\n").offsetInLineSpace, true,
                       "values from a .pat file are not pre-rotated")
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
