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
