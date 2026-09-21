/** Parses MTEXT formatted text into more convenient intermediate representation. The MTEXT
 * formatting is not well documented, the only sources I found:
 * https://web.archive.org/web/20250910173415/https://adndevblog.typepad.com/autocad/2017/09/dissecting-mtext-format-codes.html
 * https://ezdxf.readthedocs.io/en/stable/dxfentities/mtext.html#mtext-inline-codes
 */

import colorTable from "./parser/AutoCadColorIndex.js"

const State = Object.freeze({
    TEXT: 0,
    ESCAPE: 1,
    /* Skip currently unsupported format codes till ';' */
    SKIP_FORMAT: 2,
    /* For \pxq* paragraph formatting. Not found documentation yet, so temporal naming for now. */
    PARAGRAPH1: 3,
    PARAGRAPH2: 4,
    PARAGRAPH3: 5,
    /* Parsing \Cxxx color code. */
    COLOR: 6,
    /* Parsing \S stacking code user data. */
    STACK: 7,
    /* Parsing the character after "^" in a caret control code. */
    CARET: 8
})

const EntityType = Object.freeze({
    TEXT: 0,
    SCOPE: 1,
    PARAGRAPH: 2,
    NON_BREAKING_SPACE: 3,
    /** "alignment" property is either "r", "c", "l", "j", "d" for right, center, left, justify
     * (seems to be the same as left), distribute (justify) alignment.
     */
    PARAGRAPH_ALIGNMENT: 4,
    /** \Cxxx color code. "color" property specified (index resolved to actual color value). */
    COLOR: 5,
    /** \S stacking code. "numerator", "denominator" and "divider" properties specified. The
     * divider is "^" for a tolerance-style stack without a divider line, "/" for a horizontal
     * fraction, "#" for a diagonal one.
     */
    STACK: 6,
    /** "^I" tabulator control code. Advances to the next tab stop. */
    TAB: 7
    /* Many others are not yet implemented. */
})

/** Single letter format codes which are not terminated by ";". */
const shortFormats = new Set([
    "L", "l", "O", "o", "K", "k", "P", "X", "~"
])

const longFormats = new Set([
    "f", "F", "p", "Q", "H", "W", "S", "A", "C", "T"
])

const validEscapes = new Set([
    "\\", "{", "}"
])

/** Characters which separate numerator from denominator in a \S stacking code. */
const stackDividers = new Set([
    "^", "/", "#"
])

export class MTextFormatParser {

    constructor() {
        this.entities = []
    }

    Parse(text) {
        const n = text.length
        let textStart = 0
        let state = State.TEXT
        let scopeStack = []
        let curEntities = this.entities
        let curPos = 0
        const _this = this

        function EmitText() {
            if (state !== State.TEXT || textStart === curPos) {
                return
            }
            curEntities.push({
                type: EntityType.TEXT,
                content: text.slice(textStart, curPos)
            })
            textStart = curPos
        }

        function EmitEntity(type) {
            curEntities.push({type: type})
        }

        function EmitColor() {
            const s = text.slice(textStart, curPos)
            const colorIndex = parseInt(s)
            if (isNaN(colorIndex)) {
                return
            }
            if (colorIndex < 1 || colorIndex > 255) {
                return
            }
            /* We actually allow whole color table indices for better compatibility. */
            curEntities.push({type: EntityType.COLOR, color: colorTable[colorIndex]})
        }

        /** Consume a \S stacking code user data, which spans from the character after "S" to the
         * terminating ";". Backslash escapes both the divider characters and the terminator, so
         * the whole expression is scanned here rather than by the main state machine.
         *
         * @param {number} start Index of the first character after "S".
         * @returns {number} Index of the terminating ";", or the text length if not terminated.
         */
        function EmitStack(start) {
            let numerator = ""
            let denominator = null
            let divider = null
            let pos = start
            for (; pos < n; pos++) {
                let c = text.charAt(pos)
                if (c === "\\" && pos + 1 < n) {
                    pos++
                    c = text.charAt(pos)
                } else if (c === ";") {
                    break
                } else if (divider === null && stackDividers.has(c)) {
                    divider = c
                    denominator = ""
                    continue
                }
                if (denominator === null) {
                    numerator += c
                } else {
                    denominator += c
                }
            }
            if (divider === null) {
                /* No divider - nothing is stacked, the user data is plain text. */
                if (numerator !== "") {
                    curEntities.push({type: EntityType.TEXT, content: numerator})
                }
                return pos
            }
            if (divider === "^" && denominator.startsWith(" ")) {
                /* Producers put a space after "^" so that the caret is not taken for a control
                 * character. It belongs to the encoding, not to the text.
                 */
                denominator = denominator.slice(1)
            }
            curEntities.push({type: EntityType.STACK, numerator, denominator, divider})
            return pos
        }

        function PushScope() {
            const scope = {
                type: EntityType.SCOPE,
                content: []
            }
            curEntities.push(scope)
            curEntities = scope.content
            scopeStack.push(scope)
        }

        function PopScope() {
            if (scopeStack.length === 0) {
                /* Stack underflow, just ignore now. */
                return
            }
            scopeStack.pop()
            if (scopeStack.length === 0) {
                curEntities = _this.entities
            } else {
                curEntities = scopeStack[scopeStack.length - 1].content
            }
        }

        for (;curPos < n; curPos++) {
            const c = text.charAt(curPos)

            switch (state) {

            case State.TEXT:
                if (c === "{") {
                    EmitText()
                    PushScope()
                    textStart = curPos + 1
                    continue
                }
                if (c === "}") {
                    EmitText()
                    PopScope()
                    textStart = curPos + 1
                    continue
                }
                if (c === "\\") {
                    EmitText()
                    state = State.ESCAPE
                    continue
                }
                if (c === "^") {
                    EmitText()
                    state = State.CARET
                    continue
                }
                continue

            case State.ESCAPE:
                if (shortFormats.has(c)) {
                    switch (c) {
                    case "P":
                        EmitEntity(EntityType.PARAGRAPH)
                        break
                    case "~":
                        EmitEntity(EntityType.NON_BREAKING_SPACE)
                        break
                    }
                    state = State.TEXT
                    textStart = curPos + 1
                    continue
                }
                if (longFormats.has(c)) {
                    switch (c) {
                    case "p":
                        state = State.PARAGRAPH1
                        continue
                    case "C":
                        state = State.COLOR
                        textStart = curPos + 1
                        continue
                    case "S":
                        state = State.STACK
                        continue
                    }
                    state = State.SKIP_FORMAT
                    continue
                }
                /* Include current character into a next text chunk. Backslash is also included if
                 * character is not among allowed ones (that is how Autodesk viewer behaves).
                 */
                if (validEscapes.has(c)) {
                    textStart = curPos
                } else {
                    textStart = curPos - 1
                }
                state = State.TEXT
                continue

            case State.CARET:
                /* Caret notation: "^" and a letter stand for the control character 64 below it.
                 * Unlike the backslash codes this is an *encoding*, not formatting, so the caret
                 * never reaches the text - which is why "^ " is how a producer writes a literal
                 * one, and why the space after "^" in a \S stack is not part of the denominator.
                 */
                switch (c) {
                case "I":
                    EmitEntity(EntityType.TAB)
                    break
                case "J":
                    /* Line feed. */
                    EmitEntity(EntityType.PARAGRAPH)
                    break
                case "M":
                    /* Carriage return, always paired with "^J" - the line break is that one. */
                    break
                case " ":
                    curEntities.push({type: EntityType.TEXT, content: "^"})
                    break
                default:
                    /* Not a code this parser knows. Keep the caret as text and reprocess the
                     * character in TEXT state, so a "{", "}" or "\" following it is not eaten.
                     */
                    //XXX the rest of the caret range is left verbatim rather than decoded to its
                    // control character, which AutoCAD shows as a box
                    curEntities.push({type: EntityType.TEXT, content: "^"})
                    textStart = curPos
                    state = State.TEXT
                    curPos--
                    continue
                }
                state = State.TEXT
                textStart = curPos + 1
                continue

            case State.PARAGRAPH1:
                state = c === "x" ? State.PARAGRAPH2 : State.SKIP_FORMAT
                continue

            case State.PARAGRAPH2:
                state = c === "q" ? State.PARAGRAPH3 : State.SKIP_FORMAT
                continue

            case State.PARAGRAPH3:
                curEntities.push({type: EntityType.PARAGRAPH_ALIGNMENT, alignment: c})
                state = State.SKIP_FORMAT
                continue

            case State.SKIP_FORMAT:
                if (c === ";") {
                    textStart = curPos + 1
                    state = State.TEXT
                }
                continue

            case State.STACK: {
                const end = EmitStack(curPos)
                curPos = end
                textStart = end + 1
                state = State.TEXT
                continue
            }

            case State.COLOR:
                if (c === ";") {
                    EmitColor()
                    textStart = curPos + 1
                    state = State.TEXT
                }
                continue

            default:
                throw new Error("Unhandled state")
            }
        }

        EmitText()
    }

    /** @typedef {object} MTextFormatEntity
     * @property {number} type One of EntityType
     *
     * @returns {MTextFormatEntity[]} List of format chunks. Each chunk is either a text chunk with
     * TEXT type or some format entity. Entity with type SCOPE represents format scope which has
     * nested list of entities in "content" property.
     */
    GetContent() {
        return this.entities
    }

    /** Return only text chunks in a flattened sequence of strings. */
    *GetText() {

        function *TraverseItems(items) {
            for (const item of items) {
                if (item.type === EntityType.TEXT) {
                    yield item.content
                } else if (item.type === EntityType.STACK) {
                    yield item.numerator
                    yield item.denominator
                } else if (item.type === EntityType.SCOPE) {
                    yield *TraverseItems(item.content)
                }
            }
        }

        yield *TraverseItems(this.GetContent())
    }
}

MTextFormatParser.EntityType = EntityType
