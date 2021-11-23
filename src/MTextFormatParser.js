/** Parses MTEXT formatted text into more convenient intermediate representation. The MTEXT
 * formatting is not well documented, the only source I found:
 * https://adndevblog.typepad.com/autocad/2017/09/dissecting-mtext-format-codes.html
 */

const State = Object.freeze({
    TEXT: 0,
    ESCAPE: 1,
    /* Skip currently unsupported format codes till ';' */
    SKIP_FORMAT: 2,
    /* For \pxq* paragraph formatting. Not found documentation yet, so temporal naming for now. */
    PARAGRAPH1: 3,
    PARAGRAPH2: 4,
    PARAGRAPH3: 5
})

const EntityType = Object.freeze({
    TEXT: 0,
    SCOPE: 1,
    PARAGRAPH: 2,
    NON_BREAKING_SPACE: 3,
    /** "alignment" property is either "r", "c", "l", "j", "d" for right, center, left, justify
     * (seems to be the same as left), distribute (justify) alignment.
     */
    PARAGRAPH_ALIGNMENT: 4

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

        for ( ;curPos < n; curPos++) {
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

            default:
                throw new Error("Unhandled state")
            }
        }

        EmitText()
    }

    /** @typedef MTextFormatEntity
     * @property type One of EntityType
     *
     * @return {MTextFormatEntity[]} List of format chunks. Each chunk is either a text chunk with
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
                } else if (item.type === EntityType.SCOPE) {
                    yield *TraverseItems(item.content)
                }
            }
        }

        yield *TraverseItems(this.GetContent())
    }
}

MTextFormatParser.EntityType = EntityType