/** The two text-format parsers: the %%-code substitution shared by TEXT and MTEXT, and the MTEXT
 * inline format code parser.
 */
import {test} from "node:test"
import assert from "node:assert"

import {ParseSpecialChars} from "../../src/TextRenderer.js"
import {MTextFormatParser} from "../../src/MTextFormatParser.js"

const EntityType = MTextFormatParser.EntityType

test("%%-codes become their characters", () => {
    const cases = [
        ["%%d", "\xb0", "degree"],
        ["%%p", "\xb1", "plus/minus"],
        ["%%c", "∅", "diameter"],
        ["%%%", "%", "a literal percent"],
        ["%%o", "", "overscore toggle, dropped because it is not implemented"],
        ["%%u", "", "underscore toggle, likewise"]
    ]
    for (const [input, expected, what] of cases) {
        assert.strictEqual(ParseSpecialChars(input), expected, what)
    }
})

test("%%-codes are case insensitive", () => {
    assert.strictEqual(ParseSpecialChars("%%D"), "\xb0")
    assert.strictEqual(ParseSpecialChars("%%C"), "∅")
})

test("unrecognised %%-codes are left alone", () => {
    assert.strictEqual(ParseSpecialChars("%%z"), "%%z")
    assert.strictEqual(ParseSpecialChars("50% off"), "50% off", "a lone percent is not a code")
})

test("substitution happens in place, not just at the ends", () => {
    assert.strictEqual(ParseSpecialChars("a%%db"), "a\xb0b")
    assert.strictEqual(ParseSpecialChars("90%%d and 45%%d"), "90\xb0 and 45\xb0",
                       "every occurrence, not only the first")
})

test("\\U+XXXX escapes become their code point", () => {
    assert.strictEqual(ParseSpecialChars("\\U+00B0"), "\xb0")
    assert.strictEqual(ParseSpecialChars("\\U+2205"), "∅")
    assert.strictEqual(ParseSpecialChars("\\U+00b0"), "\xb0", "lower case hex")
    assert.strictEqual(ParseSpecialChars("\\U+ZZZZ"), "\\U+ZZZZ", "not hex, so not a code")
    assert.strictEqual(ParseSpecialChars("\\U+00B"), "\\U+00B", "needs four digits")
})

/** The parsed tree as nested plain data, so a test can state the whole expected shape at once. */
function Parse(text) {
    const parser = new MTextFormatParser()
    parser.Parse(text)
    const Convert = items => [...items].map(item => {
        switch (item.type) {
        case EntityType.TEXT:
            return {text: item.content}
        case EntityType.SCOPE:
            return {scope: Convert(item.content)}
        case EntityType.PARAGRAPH:
            return "paragraph"
        case EntityType.NON_BREAKING_SPACE:
            return "nbsp"
        case EntityType.PARAGRAPH_ALIGNMENT:
            return {align: item.alignment}
        case EntityType.COLOR:
            return {color: item.color}
        case EntityType.STACK:
            return {stack: [item.numerator, item.divider, item.denominator]}
        default:
            return {unknown: item.type}
        }
    })
    return Convert(parser.GetContent())
}

test("plain text parses to a single chunk", () => {
    assert.deepStrictEqual(Parse("hello"), [{text: "hello"}])
    assert.deepStrictEqual(Parse(""), [], "nothing at all yields nothing")
})

test("\\P starts a new paragraph", () => {
    assert.deepStrictEqual(Parse("a\\Pb"), [{text: "a"}, "paragraph", {text: "b"}])
})

test("\\~ is a non-breaking space", () => {
    assert.deepStrictEqual(Parse("a\\~b"), [{text: "a"}, "nbsp", {text: "b"}])
})

test("braces open and close a nested scope", () => {
    assert.deepStrictEqual(Parse("{inner}tail"),
                           [{scope: [{text: "inner"}]}, {text: "tail"}])
    assert.deepStrictEqual(Parse("a{b{c}}"),
                           [{text: "a"}, {scope: [{text: "b"}, {scope: [{text: "c"}]}]}],
                           "scopes nest")
})

test("an escaped brace is literal text", () => {
    assert.deepStrictEqual(Parse("a\\{b").map(item => item.text).join(""), "a{b")
})

test("\\C resolves an ACI index to a colour value", () => {
    assert.deepStrictEqual(Parse("\\C1;red"), [{color: 0xff0000}, {text: "red"}])
    assert.deepStrictEqual(Parse("\\C3;green"), [{color: 0x00ff00}, {text: "green"}])
})

test("\\pxq sets paragraph alignment", () => {
    for (const alignment of ["l", "c", "r", "j", "d"]) {
        assert.deepStrictEqual(Parse(`\\pxq${alignment};text`),
                               [{align: alignment}, {text: "text"}])
    }
})

test("GetText yields the text and nothing else, flattening scopes", () => {
    const parser = new MTextFormatParser()
    parser.Parse("a{b\\Pc}\\C1;d")
    assert.deepStrictEqual([...parser.GetText()], ["a", "b", "c", "d"])
})

/* The \S stacking code is the one format code whose user data is the text itself: it runs from the
 * code to the terminating ";", so a parser that skips the code drops the text with it.
 */

test("\\S splits its user data at the divider", () => {
    assert.deepStrictEqual(Parse("\\SA^ B;"), [{stack: ["A", "^", "B"]}],
                           "the space after ^ belongs to the encoding, not to the text")
    assert.deepStrictEqual(Parse("\\S1/2;"), [{stack: ["1", "/", "2"]}])
    assert.deepStrictEqual(Parse("\\S1#4;"), [{stack: ["1", "#", "4"]}])
})

test("text around a stack is kept", () => {
    assert.deepStrictEqual(Parse("{\\H0.7x;\\SA^ B;}tail"),
                           [{scope: [{stack: ["A", "^", "B"]}]}, {text: "tail"}],
                           "the reported case: a stack in a height scope, followed by plain text")
    assert.deepStrictEqual(Parse("5\\S1/2; in"),
                           [{text: "5"}, {stack: ["1", "/", "2"]}, {text: " in"}])
})

test("only the first divider splits, and an escaped one does not", () => {
    assert.deepStrictEqual(Parse("\\Sa/b/c;"), [{stack: ["a", "/", "b/c"]}],
                           "later dividers are part of the denominator")
    assert.deepStrictEqual(Parse("\\Sa\\/b^ c;"), [{stack: ["a/b", "^", "c"]}])
    assert.deepStrictEqual(Parse("\\Sa\\;b^ c;"), [{stack: ["a;b", "^", "c"]}],
                           "an escaped semicolon does not terminate the expression")
})

test("a stack with no divider is plain text", () => {
    assert.deepStrictEqual(Parse("\\Sabc;"), [{text: "abc"}])
    assert.deepStrictEqual(Parse("\\S;tail"), [{text: "tail"}], "empty user data yields nothing")
})

test("an unterminated stack runs to the end of the text", () => {
    assert.deepStrictEqual(Parse("\\Sa^ b"), [{stack: ["a", "^", "b"]}])
})

test("GetText yields both halves of a stack", () => {
    const parser = new MTextFormatParser()
    parser.Parse("\\Sa^ b;c")
    assert.deepStrictEqual([...parser.GetText()], ["a", "b", "c"],
                           "the font pre-scan reads this, so a missing half means a missing font")
})
