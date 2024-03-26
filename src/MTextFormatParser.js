/** Parses MTEXT formatted text into more convenient intermediate representation. The MTEXT
 * formatting is not well documented, the only source I found:
 * https://adndevblog.typepad.com/autocad/2017/09/dissecting-mtext-format-codes.html
 */

const EntityType = Object.freeze({
    TEXT: 0,
    SCOPE: 1,
    PARAGRAPH: 2,
    NON_BREAKING_SPACE: 3,
    /** "alignment" property is either "r", "c", "l", "j", "d" for right, center, left, justify
     * (seems to be the same as left), distribute (justify) alignment.
     */
    PARAGRAPH_ALIGNMENT: 4,
    PARAGRAPH_LINE_SPACING: 5,
    TAB: 6,

    /* Many others are not yet implemented. */
})

/** Single letter format codes which are not terminated by ";". */
const shortFormats = new Set([
    "L", "l", "O", "o", "K", "k", "P", "J", "X", "~"
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
        let textStart = 0
        let cursor = 0

        function ParseScope(curEntities) {
            while (cursor < text.length) {
                const c = text.charAt(cursor)

                switch (c) {
                    case "{":
                        EndText(curEntities)
                        const scope = { type: EntityType.SCOPE, content: [] }
                        curEntities.push(scope)
                        cursor++

                        // When entering a new scope, we need to reset the text start to not include the opening
                        // curly brace
                        BeginText()
                        ParseScope(scope.content)
                        BeginText()
                        break
                    case "}":
                        EndText(curEntities)
                        cursor++
                        return
                    case "\\":
                        EndText(curEntities)
                        cursor++
                        ParseEscape(curEntities)
                        BeginText()
                        break
                    case "^":
                        EndText(curEntities);
                        cursor++;
                        ParseCaret(curEntities);
                        BeginText();
                        break;
                    default:
                        cursor++
                }
            }

            // Commit any remaining text
            EndText(curEntities)
        }

        function ParseEscape(curEntities) {
            const c = text.charAt(cursor)
            if (shortFormats.has(c)) {
                switch (c) {
                    case "P":
                        curEntities.push({ type: EntityType.PARAGRAPH })
                        break
                    case "~":
                        curEntities.push({ type: EntityType.NON_BREAKING_SPACE })
                        break
                }

                cursor++
            } else if (longFormats.has(c)) {
                switch (c) {
                    case "p":
                        cursor++
                        ParseParagraphProperties(curEntities)
                        break
                    default:
                        SkipUntilAfter((c) => c === ";")
                }
            } else if (validEscapes.has(c)) {
                curEntities.push({ type: EntityType.TEXT, content: c })
                cursor++
            } else {
                // Include backslash and the character for invalid escapes
                curEntities.push({ type: EntityType.TEXT, content: text.slice(cursor - 1, cursor + 1) })
                cursor++
            }
        }

        function ParseCaret(curEntities) {
            const c = text.charAt(cursor)
            switch (c) {
                case "I":
                    curEntities.push({ type: EntityType.TAB })
                    break
                case "J":
                    curEntities.push({ type: EntityType.PARAGRAPH })
                    break
                case "M": // CR - ignored
                default: // XXX Render as empty square
                    break
            }
            cursor++
        }

        function ParseParagraphProperties(curEntities) {
            while (cursor < text.length) {
                const c = text.charAt(cursor)
                switch (c) {
                    case "q": // Alignment
                        curEntities.push({
                            type: EntityType.PARAGRAPH_ALIGNMENT,
                            alignment: text.charAt(cursor + 1)
                        })
                        cursor += 2
                        break
                    case "s": // Line spacing
                        const lineSpacingType = text.charAt(cursor + 1)

                        cursor += 2
                        curEntities.push({
                            type: EntityType.PARAGRAPH_LINE_SPACING,
                            lineSpacingType,
                            lineSpacingFactor: ParseFloat()
                        })
                        break
                    case ";": // End of format
                        cursor++
                        return
                    default:
                        cursor++
                }
            }
        }

        function ParseFloat(defaultValue = 1.0) {
            function isNumberChar(c) {
                return ("0" <= c && c <= "9") || c === "."
            }

            const numStart = cursor
            SkipWhile((c) => isNumberChar(c))

            const number = parseFloat(text.substring(numStart, cursor));
            if (isNaN(number)) return defaultValue
            return number
        }

        function BeginText() {
            textStart = cursor
        }

        function EndText(curEntities) {
            if (textStart < cursor) {
                curEntities.push({ type: EntityType.TEXT, content: text.slice(textStart, cursor) })
            }
        }

        function SkipWhile(predicate) {
            let currentChar;
            while (cursor < text.length && predicate(currentChar = text.charAt(cursor))) {
                cursor++
            }
        }

        function SkipUntilAfter(predicate) {
            SkipWhile((c) => !predicate(c))
            cursor++
        }

        ParseScope(this.entities)
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
    * GetText() {

        function* TraverseItems(items) {
            for (const item of items) {
                if (item.type === EntityType.TEXT) {
                    yield item.content
                } else if (item.type === EntityType.SCOPE) {
                    yield* TraverseItems(item.content)
                }
            }
        }

        yield* TraverseItems(this.GetContent())
    }
}

MTextFormatParser.EntityType = EntityType