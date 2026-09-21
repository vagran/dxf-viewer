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

test("\\M+nXXXX escapes are decoded through their code page", () => {
    assert.strictEqual(ParseSpecialChars("\\M+5D7DF\\M+5CFDF\\M+5BCDC"), "走线架",
                       "simplified Chinese, code page 936")
    assert.strictEqual(ParseSpecialChars("\\M+18382"), "モ", "Japanese, code page 932")
    assert.strictEqual(ParseSpecialChars("\\M+2A440"), "一",
                       "traditional Chinese, code page 950")
    assert.strictEqual(ParseSpecialChars("\\M+3B0A1"), "가", "Korean Wansung, code page 949")
    assert.strictEqual(ParseSpecialChars("\\M+5d7df"), "走", "lower case hex")
    assert.strictEqual(ParseSpecialChars("a\\M+5D7DFb"), "a走b", "in place")
})

test("\\M+nXXXX below 0x80 is the ASCII character", () => {
    assert.strictEqual(ParseSpecialChars("\\M+10041"), "A")
    assert.strictEqual(ParseSpecialChars("\\M+5005C"), "\\",
                       "single byte values are not code page specific")
})

test("\\M+nXXXX which cannot be decoded is left alone", () => {
    assert.strictEqual(ParseSpecialChars("\\M+48861"), "\\M+48861",
                       "Johab (code page 1361) is not supported")
    assert.strictEqual(ParseSpecialChars("\\M+6D7DF"), "\\M+6D7DF", "code page out of 1-5")
    assert.strictEqual(ParseSpecialChars("\\M+5D7D"), "\\M+5D7D", "needs four hex digits")
    assert.strictEqual(ParseSpecialChars("\\M+5ZZZZ"), "\\M+5ZZZZ", "not hex, so not a code")
    assert.strictEqual(ParseSpecialChars("\\M+5FFFF"), "\\M+5FFFF",
                       "not a character in that code page")
})

test("\\M+nXXXX has fixed width and does not swallow what follows", () => {
    assert.strictEqual(ParseSpecialChars("\\M+5D7DF\\M+5CFDFM+5BCDC"), "走线M+5BCDC")
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
        case EntityType.TAB:
            return "tab"
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

/* "\p" carries a comma separated argument list, and producers disagree about its order and about
 * where the "x" marker goes. Reading it as the fixed sequence "\pxq<c>;" dropped the alignment of
 * every other spelling, two of which are in the corpus.
 */

test("paragraph alignment is found wherever it sits in the argument list", () => {
    const cases = [
        ["\\pqc;", "no x marker at all"],
        ["\\pxsm1,qc;", "after a line spacing argument"],
        ["\\pxi-3,l3,qc;", "after two indents"],
        ["\\pxr0.76667,sm1,qc,t34.258;", "between an indent and a tab stop list"],
        ["\\pxqc,t4;", "before a tab stop list"],
        ["\\pxt4,qc;", "and after one"]
    ]
    for (const [code, what] of cases) {
        assert.deepStrictEqual(Parse(`${code}text`), [{align: "c"}, {text: "text"}], what)
    }
})

test("an argument list with no alignment yields none", () => {
    for (const code of ["\\pi-2.65;", "\\pl0;", "\\pt1.8;", "\\pxt683;"]) {
        assert.deepStrictEqual(Parse(`${code}text`), [{text: "text"}], code)
    }
})

test("q* resets the alignment to the default", () => {
    assert.deepStrictEqual(Parse("\\pq*;text"), [{align: "*"}, {text: "text"}],
                           "which TextBox reads as no alignment, the same as \"j\"")
    assert.deepStrictEqual(Parse("\\pi*,l*,r*,q*,t;text"), [{align: "*"}, {text: "text"}],
                           "the sequence BricsCAD writes to reset every argument")
})

test("q with nothing after it does not swallow the terminator", () => {
    assert.deepStrictEqual(Parse("\\pxq;text"), [{text: "text"}])
})

/* Caret notation is an encoding rather than a format code: "^" and a letter stand for the control
 * character 64 below it. Left undecoded, the two characters reach the glyph layer as text.
 */

test("^J is a line break, like \\P", () => {
    assert.deepStrictEqual(Parse("a^Jb"), [{text: "a"}, "paragraph", {text: "b"}])
})

test("^M is the carriage return of a CRLF pair and yields nothing on its own", () => {
    assert.deepStrictEqual(Parse("a^M^Jb"), [{text: "a"}, "paragraph", {text: "b"}],
                           "the pair is one break, not two")
    assert.deepStrictEqual(Parse("a^Mb"), [{text: "a"}, {text: "b"}],
                           "and never becomes a space")
})

test("^I is a tabulator", () => {
    assert.deepStrictEqual(Parse("a^Ib"), [{text: "a"}, "tab", {text: "b"}])
    assert.deepStrictEqual(Parse("^I^Ia"), ["tab", "tab", {text: "a"}],
                           "consecutive tabulators each stand on their own")
})

test("^ is how a literal caret is written", () => {
    assert.deepStrictEqual(Parse("a^ b"), [{text: "a"}, {text: "^"}, {text: "b"}],
                           "the space belongs to the encoding, not to the text")
})

test("an unrecognised caret code keeps both characters", () => {
    assert.deepStrictEqual(Parse("a^Zb"), [{text: "a"}, {text: "^"}, {text: "Zb"}])
    assert.deepStrictEqual(Parse("a^{b}"),
                           [{text: "a"}, {text: "^"}, {scope: [{text: "b"}]}],
                           "the character after it is reprocessed, so a scope still opens")
})

test("a caret inside \\S user data is the stack divider, not a control code", () => {
    assert.deepStrictEqual(Parse("\\SA^ B;"), [{stack: ["A", "^", "B"]}])
    assert.deepStrictEqual(Parse("\\SA^ B;x^Jy"),
                           [{stack: ["A", "^", "B"]}, {text: "x"}, "paragraph", {text: "y"}],
                           "and the code after it is still decoded")
})

test("a trailing lone caret is dropped", () => {
    assert.deepStrictEqual(Parse("a^"), [{text: "a"}])
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
