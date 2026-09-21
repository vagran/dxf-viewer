import {Entity} from "./DxfScene.js"
import {ShapePath} from "three/src/extras/core/ShapePath.js"
import {ShapeUtils} from "three/src/extras/ShapeUtils.js"
import {Matrix3, Vector2} from "three"
import {MatrixRotateCW, MatrixScale, MatrixTranslate} from "./math/utils.js"
import {MTextFormatParser} from "./MTextFormatParser.js"
import {DefaultTextOptions} from "./TextRendererOptions.js"

/** Brings the typedef into scope for the type checker. jsdoc ignores the tag and still
 * renders the type by name.
 * @import {MTextFormatEntity} from "./MTextFormatParser.js"
 */

/** Regex for parsing special characters in text entities. */
const SPECIAL_CHARS_RE =
    /(?:%%([dpcou%]))|(?:\\U\+([0-9a-f]{4}))|(?:\\M\+([1-5][0-9a-f]{4}))/gi

/** TextDecoder labels for the code page selector digit of a "\M+" (MIF) escape. Indexed by the
 * digit itself.
 * //XXX Index 4 is Johab (code page 1361), which has no TextDecoder label, so such escapes are
 * left undecoded.
 */
const MIF_CODE_PAGES = [null, "shift_jis", "big5", "euc-kr", null, "gbk"]

/** Decoder per code page selector digit, created on first use. A null entry is a code page this
 * environment cannot decode.
 * @type {Map<number, ?TextDecoder>}
 */
const mifDecoders = new Map()

/**
 * @param {number} codePage Code page selector digit of a "\M+" escape.
 * @returns {?TextDecoder} Null if the code page cannot be decoded here.
 */
function GetMifDecoder(codePage) {
    if (mifDecoders.has(codePage)) {
        return mifDecoders.get(codePage)
    }
    const label = MIF_CODE_PAGES[codePage] ?? null
    let decoder = null
    if (label !== null) {
        try {
            /* Fatal mode so that an invalid byte pair is rejected instead of silently becoming
             * a replacement character.
             */
            decoder = new TextDecoder(label, {fatal: true})
        } catch {
            /* Environment without the legacy encodings compiled in. */
            console.warn(`Code page not supported for MIF encoded text: ${label}`)
        }
    }
    mifDecoders.set(codePage, decoder)
    return decoder
}

/**
 * Decode user data of a "\M+" (MIF) escape. Unlike "\U+", its four hex digits are a character code
 * in the legacy code page selected by the leading digit, not a unicode code point.
 * @param {string} data Five digits following "\M+".
 * @returns {?string} Decoded character, null if it cannot be decoded.
 */
function DecodeMifChar(data) {
    const code = parseInt(data.slice(1), 16)
    /* Single byte values are not code page specific. */
    if (code < 0x80) {
        return String.fromCharCode(code)
    }
    const decoder = GetMifDecoder(parseInt(data.charAt(0)))
    if (decoder === null) {
        return null
    }
    const bytes = code < 0x100 ? [code] : [code >> 8, code & 0xff]
    try {
        return decoder.decode(new Uint8Array(bytes))
    } catch {
        return null
    }
}

/**
 * Parse special characters in text entities and convert them to corresponding unicode
 * characters.
 * https://knowledge.autodesk.com/support/autocad/learn-explore/caas/CloudHelp/cloudhelp/2019/ENU/AutoCAD-Core/files/GUID-518E1A9D-398C-4A8A-AC32-2D85590CDBE1-htm.html
 * @param {string} text Raw string.
 * @returns {string} String with special characters replaced.
 */
export function ParseSpecialChars(text) {
    return text.replaceAll(SPECIAL_CHARS_RE, (match, p1, p2, p3) => {
        if (p1 !== undefined) {
            switch (p1.toLowerCase()) {
            case "d":
                return "\xb0"
            case "p":
                return "\xb1"
            case "c":
                return "\u2205"
            case "o":
                /* Toggles overscore mode on and off, not implemented. */
                return ""
            case "u":
                /* Toggles underscore mode on and off, not implemented. */
                return ""
            case "%":
                return "%"
            }
        } else if (p2 !== undefined) {
            const code = parseInt(p2, 16)
            if (isNaN(code)) {
                return match
            }
            return String.fromCharCode(code)
        } else if (p3 !== undefined) {
            /* Undecodable sequence is left as is, same as reference implementations do. */
            return DecodeMifChar(p3) ?? match
        }
        return match
    })
}

/**
 * Helper class for rendering text.
 * Currently it is just basic very simplified implementation for MVP. Further work should include:
 *  * Support DXF text styles and weight.
 *  * Bitmap fonts generation in texture atlas for more optimal rendering.
 */
export class TextRenderer {

    /**
     * @param {?Function[]} fontFetchers List of font fetchers. Fetcher should return promise with
     *  loaded font object (opentype.js). They are invoked only when necessary. Each glyph is being
     *  searched sequentially in each provided font.
     * @param {?{}} options See TextRenderer.DefaultOptions.
     */
    constructor(fontFetchers, options = null) {
        this.fontFetchers = fontFetchers
        this.fonts = []

        this.options = Object.create(TextRenderer.DefaultOptions)
        if (options) {
            Object.assign(this.options, options)
        }
        /* Indexed by character, value is CharShape. */
        this.shapes = new Map()
        this.stubShapeLoaded = false
        /* Shape to display if no glyph found in the specified fonts. May be null if fallback
         * character can not be rendered as well.
         */
        this.stubShape = null
    }

    /** Fetch necessary fonts to render the provided text. Should be called for each string which
     * will be rendered later.
     * @param {string} text
     * @returns {Boolean} True if all characters can be rendered, false if none of the provided
     *  fonts contains glyphs for some of the specified text characters.
     */
    async FetchFonts(text) {
        if (!this.stubShapeLoaded) {
            this.stubShapeLoaded = true
            for (const char of Array.from(this.options.fallbackChar)) {
                if (await this.FetchFonts(char)) {
                    this.stubShape = this._CreateCharShape(char)
                    break
                }
            }
        }
        let charMissing = false
        for (const char of text) {
            if (char.codePointAt(0) < 0x20) {
                /* Control character. */
                continue
            }
            let found = false
            for (const font of this.fonts) {
                if (font.HasChar(char)) {
                    found = true
                    break
                }
            }
            if (found) {
                continue
            }
            if (!this.fontFetchers) {
                return false
            }
            while (this.fontFetchers.length > 0) {
                const fetcher = this.fontFetchers.shift()
                const font = await this._FetchFont(fetcher)
                this.fonts.push(font)
                if (font.HasChar(char)) {
                    found = true
                    break
                }
            }
            if (!found) {
                charMissing = true
            }
        }
        return !charMissing
    }

    get canRender() {
        return this.fonts !== null && this.fonts.length > 0
    }

    /** Get width in model space units for a single line of text.
     * @param {string} text
     * @param {number} fontSize
     */
    GetLineWidth(text, fontSize) {
        const block = new TextBlock(fontSize)
        for (const char of text) {
            const shape = this._GetCharShape(char)
            if (!shape) {
                continue
            }
            block.PushChar(char, shape)
        }
        return block.GetCurrentPosition()
    }

    /**
     * @param {object} params
     * @param {string} params.text
     * @param {{x: number, y: number}} params.startPos
     * @param {?{x: number, y: number}} params.endPos TEXT group second alignment point.
     * @param {?number} params.rotation Rotation attribute, deg.
     * @param {?number} params.widthFactor Relative X scale factor (group 41)
     * @param {?number} params.hAlign Horizontal text justification type code (group 72)
     * @param {?number} params.vAlign Vertical text justification type code (group 73).
     * @param {number} params.color
     * @param {?string} params.layer
     * @param {number} params.fontSize Font size.
     * @returns {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *Render({text, startPos, endPos, rotation = 0, widthFactor = 1, hAlign = 0, vAlign = 0,
             color, layer = null, fontSize}) {
        const block = new TextBlock(fontSize)
        for (const char of text) {
            const shape = this._GetCharShape(char)
            if (!shape) {
                continue
            }
            block.PushChar(char, shape)
        }
        yield* block.Render(startPos, endPos, rotation, widthFactor, hAlign, vAlign, color, layer)
    }

    /**
     * @param {object} params
     * @param {MTextFormatEntity[]} params.formattedText Parsed formatted text.
     * @param {{x: number, y: number}} params.position Insertion position.
     * @param {?number} params.fontSize If not specified, then it still may be defined by inline
     *  formatting codes, otherwise 1 is used as fall-back value.
     * @param {?Number} params.width Text block width, no wrapping if undefined.
     * @param {?Number} params.rotation Text block rotation in degrees.
     * @param {?{x: number, y: number}} params.direction Text block orientation defined as direction
     *  vector. Takes a precedence over rotation if both provided.
     * @param {number} params.attachment Attachment point, one of MTextAttachment values.
     * @param {?number} params.lineSpacing Line spacing ratio relative to default one (5/3 of font
     *  size).
     * @param {number} params.color
     * @param {?string} params.layer
     * @returns {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *RenderMText({formattedText, position, fontSize, width = null, rotation = 0, direction = null,
                 attachment, lineSpacing = 1, color, layer = null}) {
        if (!fontSize) {
            fontSize = 1
        }
        const box = new TextBox(fontSize, this._GetCharShape.bind(this))
        box.FeedText(formattedText)
        yield* box.Render(position, width, rotation, direction, attachment, lineSpacing, color,
                          layer)
    }

    /** @returns {CharShape} Shape for the specified character.
     * Each shape is indexed triangles mesh for font size 1. They should be further transformed as
     * needed.
     */
    _GetCharShape(char) {
        let shape = this.shapes.get(char)
        if (shape) {
            return shape
        }
        shape = this._CreateCharShape(char)
        this.shapes.set(char, shape)
        return shape
    }

    _CreateCharShape(char) {
        for (const font of this.fonts) {
            const path = font.GetCharPath(char)
            if (path) {
                return new CharShape(font, path, this.options)
            }
        }
        return this.stubShape
    }

    async _FetchFont(fontFetcher) {
        return new Font(await fontFetcher())
    }
}


/** See TextRendererOptions.js for why these live in a separate module. */
TextRenderer.DefaultOptions = DefaultTextOptions

/** @typedef {Object} CharPath
 * @property {number} advance
 * @property {?ShapePath} path
 * @property {{xMin: number, xMax: number, yMin: number, yMax: number}} bounds
 */

class CharShape {
    /**
     * @param {Font} font
     * @param {CharPath} glyph
     * @param {{}} options Renderer options.
     */
    constructor(font, glyph, options) {
        this.font = font
        this.advance = glyph.advance
        this.bounds = glyph.bounds
        if (glyph.path) {
            const shapes = glyph.path.toShapes(false)
            this.vertices = []
            this.indices = []
            for (const shape of shapes) {
                const shapePoints = shape.extractPoints(options.curveSubdivision)
                /* Ensure proper vertices winding.
                 *
                 * The hole loop is unreachable as things stand, and is kept as a guard rather
                 * than removed: toShapes(false) treats a contour as solid only when it is
                 * clockwise, so a shape that has holes is always clockwise and this branch is not
                 * entered. The two paths that do yield a counter-clockwise shape -- a single
                 * subpath, and the "no solid contours" fallback -- both produce no holes at all.
                 * Until that changed, the loop body read an undeclared `h` and would have thrown.
                 */
                if (!ShapeUtils.isClockWise(shapePoints.shape)) {
                    shapePoints.shape = shapePoints.shape.reverse()
                    for (const [h, hole] of shapePoints.holes.entries()) {
                        if (ShapeUtils.isClockWise(hole)) {
                            shapePoints.holes[h] = hole.reverse()
                        }
                    }
                }
                /* This call also removes duplicated end vertices. */
                const indices = ShapeUtils.triangulateShape(shapePoints.shape, shapePoints.holes)

                const _this = this
                const baseIdx = this.vertices.length

                function AddVertices(vertices) {
                    for (const v of vertices) {
                        _this.vertices.push(v)
                    }
                }

                AddVertices(shapePoints.shape)
                for (const hole of shapePoints.holes) {
                    AddVertices(hole)
                }
                for (const tuple of indices) {
                    for (const idx of tuple) {
                        this.indices.push(baseIdx + idx)
                    }
                }
            }

        } else {
            this.vertices = null
        }
    }

    /** Get vertices array transformed to the specified position and with the specified size.
     * @param {{x: number, y: number}} position
     * @param {number} size
     * @returns {Vector2[]}
     */
    GetVertices(position, size) {
        return this.vertices.map(v => v.clone().multiplyScalar(size).add(position))
    }
}

class Font {
    constructor(data) {
        this.data = data
        this.charMap = new Map()
        for (const glyph of Object.values(data.glyphs.glyphs)) {
            if (glyph.unicode === undefined) {
                continue
            }
            this.charMap.set(String.fromCodePoint(glyph.unicode), glyph)
        }
        /* Scale to transform the paths to size 1. */
        //XXX not really clear what is the resulting unit, check, review and comment it later
        // (100px?)
        this.scale = 100 / ((this.data.unitsPerEm || 2048) * 72)
    }

    /**
     * @param {string} char Character code point as string.
     * @returns {Boolean} True if the font has glyphs for the specified character.
     */
    HasChar(char) {
        return this.charMap.has(char)
    }

    /**
     * @param {string} char Character code point as string.
     * @returns {?CharPath} Path is scaled to size 1. Null if no glyphs for the specified
     *  characters.
     */
    GetCharPath(char) {
        const glyph = this.charMap.get(char)
        if (!glyph) {
            return null
        }
        const scale = this.scale
        const path = new ShapePath()
        for (const cmd of glyph.path.commands) {
            switch (cmd.type) {

            case "M":
                path.moveTo(cmd.x * scale, cmd.y * scale)
                break

            case "L":
                path.lineTo(cmd.x * scale, cmd.y * scale)
                break

            case "Q":
                path.quadraticCurveTo(cmd.x1 * scale, cmd.y1 * scale,
                                      cmd.x * scale, cmd.y * scale)
                break

            case "C":
                path.bezierCurveTo(cmd.x1 * scale, cmd.y1 * scale,
                                   cmd.x2 * scale, cmd.y2 * scale,
                                   cmd.x * scale, cmd.y * scale)
                break
            }
        }
        return {advance: glyph.advanceWidth * scale, path,
                bounds: {xMin: glyph.xMin * scale, xMax: glyph.xMax * scale,
                         yMin: glyph.yMin * scale, yMax: glyph.yMax * scale}}
    }

    /**
     * @param {string} c1
     * @param {string} c2
     * @returns {number}
     */
    GetKerning(c1, c2) {
        const i1 = this.data.charToGlyphIndex(c1)
        if (i1 === 0) {
            return 0
        }
        const i2 = this.data.charToGlyphIndex(c2)
        if (i2 === 0) {
            return 0
        }
        return this.data.getKerningValue(i1, i2) * this.scale
    }
}

/** TEXT group attribute 72 values. */
export const HAlign = Object.freeze({
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
    ALIGNED: 3,
    MIDDLE: 4,
    FIT: 5
})

/** TEXT group attribute 73 values. */
export const VAlign = Object.freeze({
    BASELINE: 0,
    BOTTOM: 1,
    MIDDLE: 2,
    TOP: 3
})

/** MTEXT group attribute 71 values. */
const MTextAttachment = Object.freeze({
    TOP_LEFT: 1,
    TOP_CENTER: 2,
    TOP_RIGHT: 3,
    MIDDLE_LEFT: 4,
    MIDDLE_CENTER: 5,
    MIDDLE_RIGHT: 6,
    BOTTOM_LEFT: 7,
    BOTTOM_CENTER: 8,
    BOTTOM_RIGHT: 9
})

/** Spacing of the default MTEXT tab stops, as a factor of the entity's initial character height:
 * they sit at 4, 8, 12, ... times it. A paragraph may name its own stops with the "t" argument of
 * a "\p" code, which suppresses these; that argument is not read yet.
 * See local/ezdxf/docs/source/dxfinternals/entities/mtext.rst.
 */
const DEFAULT_TAB_STOP_INTERVAL = 4

/** Code point ranges of scripts written without spaces between words. A line may be broken
 * between any two adjacent characters of such a script, which is the only way MTEXT with no
 * spaces in it ever wraps. Inclusive pairs, sorted by the lower bound.
 */
const UNSPACED_SCRIPT_RANGES = [
    /* Hangul jamo. */
    [0x1100, 0x11ff],
    /* CJK radicals and punctuation, kana, bopomofo, Hangul compatibility jamo, CJK strokes,
     * enclosed CJK letters, and the unified ideographs together with extension A.
     */
    [0x2e80, 0x9fff],
    /* Yi syllables and radicals. */
    [0xa000, 0xa4cf],
    /* Hangul jamo extended A, Hangul syllables, Hangul jamo extended B. */
    [0xa960, 0xd7fb],
    /* CJK compatibility ideographs. */
    [0xf900, 0xfaff],
    /* CJK compatibility forms and small form variants. */
    [0xfe10, 0xfe6f],
    /* Full-width forms, without the half-width latin and katakana blocks that follow them. */
    [0xff01, 0xff60],
    /* Full-width currency and other signs. */
    [0xffe0, 0xffe6],
    /* CJK unified ideographs extension B and everything after it. */
    [0x20000, 0x3ffff]
]

/** Characters which may not begin a line, so that trailing punctuation is not carried over to the
 * next one.
 */
const NO_BREAK_BEFORE = new Set(
    ",.;:!?%)]}\"'" +
    "\u3001\u3002\uff0c\uff0e\uff1b\uff1a\uff01\uff1f\uff05\uff09\uff3d\uff5d" +
    "\u3009\u300b\u300d\u300f\u3011\u3015\u3017\u3019\u301b\u301f\uff60" +
    "\u30fc\u301c\uff5e\u30fb\u2026\u2025\u3005\u3006\u201d\u2019")

/** Characters which may not end a line, so that opening punctuation is not left hanging at the end
 * of one.
 */
const NO_BREAK_AFTER = new Set(
    "([{$" +
    "\uff08\uff3b\uff5b\u3008\u300a\u300c\u300e\u3010\u3014\u3016\u3018\u301a" +
    "\u301d\uff5f\u201c\u2018\uffe5\uff04")

/**
 * @param {string} c Single character, possibly a surrogate pair.
 * @returns {boolean} True if the character belongs to a script written without word spacing.
 */
function IsUnspacedScript(c) {
    const cp = c.codePointAt(0)
    for (const [lo, hi] of UNSPACED_SCRIPT_RANGES) {
        if (cp < lo) {
            return false
        }
        if (cp <= hi) {
            return true
        }
    }
    return false
}

/** Check if a line may be broken between two adjacent characters. Only scripts written without
 * word spacing are considered - anywhere else a break opportunity is a space, which the chunk
 * splitting in Paragraph.FeedSpace() already provides. Kinsoku rules keep punctuation which
 * cannot start or end a line on the proper side of the break.
 * @param {string} prev Character preceding the candidate break position.
 * @param {string} cur Character following it.
 * @returns {boolean}
 */
function IsBreakOpportunity(prev, cur) {
    if (!IsUnspacedScript(prev) && !IsUnspacedScript(cur)) {
        return false
    }
    return !NO_BREAK_AFTER.has(prev) && !NO_BREAK_BEFORE.has(cur)
}

/** Encapsulates layout calculations for a multiline-line text block. */
class TextBox {
    /**
     * @param {number} fontSize
     * @param {function(String): CharShape} charShapeProvider
     */
    constructor(fontSize, charShapeProvider) {
        this.fontSize = fontSize
        this.charShapeProvider = charShapeProvider
        this.curParagraph = new TextBox.Paragraph(this)
        this.paragraphs = [this.curParagraph]
        this.spaceShape = charShapeProvider(" ")
    }

    /** Add some formatted text to the box.
     * @param {MTextFormatEntity[]} formattedText Parsed formatted text.
     */
    FeedText(formattedText) {
        /* For now advanced formatting is not implemented so scopes are just flattened. */
        function *FlattenItems(items) {
            for (const item of items) {
                if (item.type === MTextFormatParser.EntityType.SCOPE) {
                    yield *FlattenItems(item.content)
                } else {
                    yield item
                }
            }
        }

        /* Null is default alignment which depends on attachment point. */
        let curAlignment = null
        /* Null for default color which depends on entity color attributes. */
        let curColor = null

        for (const item of FlattenItems(formattedText)) {
            switch (item.type) {

            case MTextFormatParser.EntityType.TEXT:
                for (const c of item.content) {
                    if (c === " ") {
                        this.curParagraph.FeedSpace()
                    } else {
                        this.curParagraph.FeedChar(c)
                    }
                }
                break

            case MTextFormatParser.EntityType.PARAGRAPH:
                this.curParagraph = new TextBox.Paragraph(this)
                this.curParagraph.SetAlignment(curAlignment)
                this.curParagraph.SetColor(curColor)
                this.paragraphs.push(this.curParagraph)
                break

            case MTextFormatParser.EntityType.NON_BREAKING_SPACE:
                this.curParagraph.FeedChar(" ")
                break

            case MTextFormatParser.EntityType.TAB:
                this.curParagraph.FeedTab()
                break

            case MTextFormatParser.EntityType.PARAGRAPH_ALIGNMENT:
                let a = null
                switch (item.alignment) {
                case "l":
                    a = TextBox.Paragraph.Alignment.LEFT
                    break
                case "c":
                    a = TextBox.Paragraph.Alignment.CENTER
                    break
                case "r":
                    a = TextBox.Paragraph.Alignment.RIGHT
                    break
                case "d":
                    a = TextBox.Paragraph.Alignment.JUSTIFY
                    break
                case "j":
                    a = null
                    break
                }
                this.curParagraph.SetAlignment(a)
                curAlignment = a
                break

            case MTextFormatParser.EntityType.COLOR:
                curColor = item.color
                this.curParagraph.SetColor(curColor)
                break

            case MTextFormatParser.EntityType.STACK:
                this.curParagraph.FeedStack(item.numerator, item.denominator, item.divider)
                break
            }
        }
    }

    *Render(position, width, rotation, direction, attachment, lineSpacing, color, layer) {
        for (const p of this.paragraphs) {
            p.BuildLines(width)
        }
        if (width === null || width === 0) {
            /* Find maximal paragraph width which will define overall box width. */
            width = 0
            for (const p of this.paragraphs) {
                const pWidth = p.GetMaxLineWidth()
                if (pWidth > width) {
                    width = pWidth
                }
            }
        }

        let defaultAlignment = TextBox.Paragraph.Alignment.LEFT
        switch (attachment) {
        case MTextAttachment.TOP_CENTER:
        case MTextAttachment.MIDDLE_CENTER:
        case MTextAttachment.BOTTOM_CENTER:
            defaultAlignment = TextBox.Paragraph.Alignment.CENTER
            break
        case MTextAttachment.TOP_RIGHT:
        case MTextAttachment.MIDDLE_RIGHT:
        case MTextAttachment.BOTTOM_RIGHT:
            defaultAlignment = TextBox.Paragraph.Alignment.RIGHT
            break
        }

        for (const p of this.paragraphs) {
            p.ApplyAlignment(width, defaultAlignment)
        }

        /* Box local coordinates have top-left corner origin, so Y values are negative. The
         * specified attachment should be used to obtain attachment point offset relatively to box
         * CS origin.
         */

        if (direction !== null) {
            /* Direction takes precedence over rotation if specified. */
            rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI
        }

        const lineHeight = lineSpacing * 5 * this.fontSize / 3

        let height = 0
        for (const p of this.paragraphs) {
            if (p.lines === null) {
                /* Paragraph always occupies at least one line. */
                height++
            } else {
                height += p.lines.length
            }
        }
        height *= lineHeight

        let origin = new Vector2()
        switch (attachment) {
        case MTextAttachment.TOP_LEFT:
            break
        case MTextAttachment.TOP_CENTER:
            origin.x = width / 2
            break
        case MTextAttachment.TOP_RIGHT:
            origin.x = width
            break
        case MTextAttachment.MIDDLE_LEFT:
            origin.y = -height / 2
            break
        case MTextAttachment.MIDDLE_CENTER:
            origin.x = width / 2
            origin.y = -height / 2
            break
        case MTextAttachment.MIDDLE_RIGHT:
            origin.x = width
            origin.y = -height / 2
            break
        case MTextAttachment.BOTTOM_LEFT:
            origin.y = -height
            break
        case MTextAttachment.BOTTOM_CENTER:
            origin.x = width / 2
            origin.y = -height
            break
        case MTextAttachment.BOTTOM_RIGHT:
            origin.x = width
            origin.y = -height
            break
        default:
            throw new Error("Unhandled alignment")
        }

        /* Transform for each chunk insertion point. */
        const transform = new Matrix3().makeTranslation(-origin.x, -origin.y)
        MatrixRotateCW(transform, -rotation * Math.PI / 180)
        MatrixTranslate(transform, position.x, position.y)

        let y = -this.fontSize
        for (const p of this.paragraphs) {
            if (p.lines === null) {
                y -= lineHeight
                continue
            }
            for (const line of p.lines) {
                for (let chunkIdx = line.startChunkIdx;
                     chunkIdx < line.startChunkIdx + line.numChunks;
                    chunkIdx++) {

                    const chunk = p.chunks[chunkIdx]
                    let x = chunk.position
                    /* First chunk of continuation line never prepended by whitespace. */
                    if (chunkIdx === 0 || chunkIdx !== line.startChunkIdx) {
                        x += chunk.GetSpacingWidth()
                    }
                    yield* chunk.Render(x, y, transform, rotation, color, layer)
                }
                y -= lineHeight
            }
        }
    }
}

TextBox.Paragraph = class {
    constructor(textBox) {
        this.textBox = textBox
        this.chunks = []
        this.curChunk = null
        this.alignment = null
        this.lines = null
        //XXX for now applied to next chunks until advanced formatting implemented
        this.color = null
    }

    /** Feed character for current chunk. Spaces should be fed by FeedSpace() method. If space
     * character is fed into this method, it is interpreted as non-breaking space.
     */
    FeedChar(c) {
        const shape = this.textBox.charShapeProvider(c)
        if (shape === null) {
            return
        }
        /* A chunk is the unit lines are built from, so a break opportunity inside a run of
         * characters has to start a new one. Scripts written without spaces have no other one.
         */
        if (this.curChunk === null || this.curChunk.stack !== null || this.curChunk.isTab ||
            (this.curChunk.lastChar !== null &&
             IsBreakOpportunity(this.curChunk.lastChar, c))) {

            this._AddChunk()
        }
        this.curChunk.PushChar(c, shape)
    }

    FeedSpace() {
        if (this.curChunk === null || this.curChunk.lastChar !== null ||
            this.curChunk.stack !== null || this.curChunk.isTab) {

            this._AddChunk()
        }
        this.curChunk.PushSpace()
    }

    /** Feed a tabulator (\^I control code). It always occupies a chunk of its own, because its
     * width is not known until the chunk's position in the line is.
     */
    FeedTab() {
        this._AddChunk()
        this.curChunk.PushTab()
    }

    /** Feed stacked text (\S format code). It always occupies a chunk of its own.
     * @param {string} numerator
     * @param {string} denominator
     * @param {string} divider One of "^", "/", "#".
     */
    FeedStack(numerator, denominator, divider) {
        if (this.curChunk === null || this.curChunk.lastChar !== null ||
            this.curChunk.stack !== null || this.curChunk.isTab) {

            this._AddChunk()
        }
        this.curChunk.PushStack(numerator, denominator, divider,
                                this.textBox.charShapeProvider)
    }

    SetAlignment(alignment) {
        this.alignment = alignment
    }

    /** Sets color for next chunks. Actually should do this for spans, but not currently
     * implemented.
     */
    SetColor(color) {
        this.color = color
    }

    /** Group chunks into lines.
     *
     * @param {?number} boxWidth Box width. Do not wrap lines if null (one line is created).
     */
    BuildLines(boxWidth) {
        if (this.curChunk === null) {
            return
        }
        this.lines = []
        let startChunkIdx = 0
        let curChunkIdx = 0
        let curWidth = 0

        const CommitLine = () => {
            this.lines.push(new TextBox.Paragraph.Line(this,
                                                       startChunkIdx,
                                                       curChunkIdx - startChunkIdx,
                                                       curWidth))
            startChunkIdx = curChunkIdx
            curWidth = 0
        }

        for (; curChunkIdx < this.chunks.length; curChunkIdx++) {
            const chunk = this.chunks[curChunkIdx]
            let chunkWidth = chunk.GetWidth(curWidth,
                                            startChunkIdx === 0 || curChunkIdx !== startChunkIdx)
            /* A tabulator is whitespace, so a line never breaks on one - the word after it
             * breaks instead. Its width was also measured from the position it holds now, and a
             * commit here would move it to the start of the line and leave that width stale.
             */
            if (boxWidth !== null && boxWidth !== 0 && !chunk.isTab) {
                if (curWidth + chunkWidth > boxWidth) {
                    if (curChunkIdx == 0 && chunk.leadingSpaces > 0) {
                        /* Special handling for initial leading spaces. In case the first word with
                         * spaces exceeds box width, empty line should be inserted for spaces, and
                         * the word is placed on the next line. This behavior is described in ezdxf
                         * (https://ezdxf.readthedocs.io/en/stable/dxfinternals/rendering_of_dxf_content.html#mtext)
                         * and reported by users as actual AutoCAD behavior.
                         */
                        this.lines.push(
                            new TextBox.Paragraph.Line(this, startChunkIdx, startChunkIdx, 0))
                        /* Trim leading spaces in next line with the word. */
                        chunk.leadingSpaces = 0
                        chunkWidth = chunk.GetWidth(curWidth, false)
                    }
                    if (curWidth !== 0) {
                        CommitLine()
                        /* The chunk now starts a line, and a line-leading chunk is rendered at
                         * its position with no spacing in front of it. Its width was measured
                         * with that spacing, so measure it again or the rest of the line is
                         * shifted right by the spaces, and the line width used to align it is
                         * overstated by the same amount.
                         */
                        chunkWidth = chunk.GetWidth(curWidth, false)
                    }
                }
            }
            chunk.position = curWidth
            curWidth += chunkWidth
        }
        if (startChunkIdx !== curChunkIdx && curWidth !== 0) {
            CommitLine()
        }
    }

    GetMaxLineWidth() {
        if (this.lines === null) {
            return 0
        }
        let maxWidth = 0
        for (const line of this.lines) {
            if (line.width > maxWidth) {
                maxWidth = line.width
            }
        }
        return maxWidth
    }

    ApplyAlignment(boxWidth, defaultAlignment) {
        if (this.lines) {
            for (const line of this.lines) {
                line.ApplyAlignment(boxWidth, defaultAlignment)
            }
        }
    }

    _AddChunk() {
        this.curChunk = new TextBox.Paragraph.Chunk(this, this.textBox.fontSize, this.color,
                                                    this.curChunk)
        this.chunks.push(this.curChunk)
    }
}

TextBox.Paragraph.Alignment = Object.freeze({
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
    JUSTIFY: 3
})

TextBox.Paragraph.Chunk = class {
    /**
     * @param {TextBox.Paragraph} paragraph
     * @param {number} fontSize
     * @param {number|null} color
     * @param {?TextBox.Paragraph.Chunk} prevChunk
     */
    constructor(paragraph, fontSize, color, prevChunk) {
        this.paragraph = paragraph
        this.fontSize = fontSize
        this.color = color
        this.prevChunk = prevChunk
        this.lastChar = null
        this.lastShape = null
        this.leadingSpaces = 0
        this.spaceStartKerning = null
        this.spaceEndKerning = null
        this.block = null
        this.stack = null
        this.position = null
        this.isTab = false
    }

    PushSpace() {
        if (this.block || this.stack || this.isTab) {
            throw new Error("Illegal operation")
        }
        this.leadingSpaces++
    }

    /** Make this chunk a tabulator. It holds no glyphs; its width is the distance from wherever
     * it lands to the next tab stop, so it is resolved in GetWidth() rather than here.
     */
    PushTab() {
        if (this.block || this.stack || this.leadingSpaces) {
            throw new Error("Illegal operation")
        }
        this.isTab = true
    }

    /**
     * @param {string} char
     * @param {CharShape} shape
     */
    PushChar(char, shape) {
        if (this.spaceStartKerning === null) {
            if (this.leadingSpaces === 0) {
                this.spaceStartKerning = 0
                this.spaceEndKerning = 0
            } else {
                if (this.prevChunk && this.prevChunk.lastShape &&
                    this.prevChunk.fontSize === this.fontSize &&
                    this.prevChunk.lastShape.font === this.paragraph.textBox.spaceShape.font) {

                    this.spaceStartKerning =
                        this.prevChunk.lastShape.font.GetKerning(this.prevChunk.lastChar, " ")
                } else {
                    this.spaceStartKerning = 0
                }
                if (shape.font === this.paragraph.textBox.spaceShape.font) {
                    this.spaceEndKerning = shape.font.GetKerning(" ", char)
                } else {
                    this.spaceEndKerning = 0
                }
            }
        }

        if (this.block === null) {
            this.block = new TextBlock(this.fontSize, this.color)
        }
        this.block.PushChar(char, shape)

        this.lastChar = char
        this.lastShape = shape
    }

    /** Fill the chunk with stacked text (\S format code).
     * @param {string} numerator
     * @param {string} denominator
     * @param {string} divider One of "^", "/", "#".
     * @param {function(string): ?CharShape} charShapeProvider
     */
    PushStack(numerator, denominator, divider, charShapeProvider) {
        if (this.spaceStartKerning === null) {
            /* Kerning against a stack is not defined, so leading spaces keep their bare width. */
            this.spaceStartKerning = 0
            this.spaceEndKerning = 0
        }
        this.stack = new TextStack(this.fontSize, this.color, divider)
        this.stack.Fill(numerator, denominator, charShapeProvider)
    }

    GetSpacingWidth() {
        return (this.leadingSpaces * this.paragraph.textBox.spaceShape.advance +
            this.spaceStartKerning + this.spaceEndKerning) * this.fontSize
    }

    /** @param {number} xPos Where the chunk starts within its line. Only a tabulator's width
     *  depends on it.
     * @param {boolean} withSpacing Whether to include the leading spaces.
     * @returns {number} Chunk width.
     */
    GetWidth(xPos, withSpacing) {
        if (this.isTab) {
            const step = DEFAULT_TAB_STOP_INTERVAL * this.paragraph.textBox.fontSize
            if (!(step > 0)) {
                return 0
            }
            return (Math.floor(xPos / step) + 1) * step - xPos
        }
        let width
        if (this.stack !== null) {
            width = this.stack.GetWidth()
        } else if (this.block !== null) {
            width = this.block.GetCurrentPosition()
        } else {
            return 0
        }
        if (withSpacing) {
            width += this.GetSpacingWidth()
        }
        return width
    }

    /** @param {number} x Chunk position in the text box.
     * @param {number} y Text line baseline in the text box.
     * @param {Matrix3} transform Text box transform.
     * @param {?number} rotation Text box rotation, deg.
     * @param {number} color
     * @param {?string} layer
     * @returns {Generator<Entity>} Rendering entities.
     */
    *Render(x, y, transform, rotation, color, layer) {
        if (this.stack !== null) {
            yield* this.stack.Render(x, y, transform, rotation, color, layer)
            return
        }
        if (this.block === null) {
            return
        }
        const v = new Vector2(x, y)
        v.applyMatrix3(transform)
        yield* this.block.RenderAtPenOrigin(v, rotation, color, layer)
    }
}

TextBox.Paragraph.Line = class {
    constructor(paragraph, startChunkIdx, numChunks, width) {
        this.paragraph = paragraph
        this.startChunkIdx = startChunkIdx
        this.numChunks = numChunks
        this.width = width
    }

    ApplyAlignment(boxWidth, defaultAlignment) {
        let alignment = this.paragraph.alignment ?? defaultAlignment
        switch (alignment) {
        case TextBox.Paragraph.Alignment.LEFT:
            break
        case TextBox.Paragraph.Alignment.CENTER: {
            const offset = (boxWidth - this.width) / 2
            this.ForEachChunk(chunk => chunk.position += offset)
            break
        }
        case TextBox.Paragraph.Alignment.RIGHT: {
            const offset = boxWidth - this.width
            this.ForEachChunk(chunk => chunk.position += offset)
            break
        }
        case TextBox.Paragraph.Alignment.JUSTIFY: {
            const space = boxWidth - this.width
            if (space <= 0 || this.numChunks === 1) {
                break
            }
            const step = space / (this.numChunks - 1)
            let offset = 0
            this.ForEachChunk(chunk => {
                chunk.position += offset
                offset += step
            })
            break
        }
        default:
            throw new Error("Unhandled alignment: " + this.paragraph.alignment)
        }
    }

    ForEachChunk(handler) {
        for (let i = 0; i < this.numChunks; i++) {
            handler(this.paragraph.chunks[this.startChunkIdx + i])
        }
    }
}

/** Encapsulates calculations for a single-line text block. */
class TextBlock {
    constructor(fontSize, color) {
        this.fontSize = fontSize
        this.color = color
        /* Element is {shape: CharShape, vertices: ?{Vector2}[]} */
        this.glyphs = []
        this.bounds = null
        this.curX = 0
        this.prevChar = null
        this.prevFont = null
    }

    /**
     * @param {string} char
     * @param {CharShape} shape
     */
    PushChar(char, shape) {
        /* Initially store with just font size and characters position applied. Origin is the first
         * character base point.
         */
        let offset
        if (this.prevChar !== null && this.prevFont === shape.font) {
            offset = this.prevFont.GetKerning(this.prevChar, char)
        } else {
            offset = 0
        }
        const x = this.curX + offset * this.fontSize
        let vertices
        if (shape.vertices && shape.vertices.length > 0) {
            vertices = shape.GetVertices({x, y: 0}, this.fontSize)
            const xMin = x + shape.bounds.xMin * this.fontSize
            const xMax = x + shape.bounds.xMax * this.fontSize
            const yMin = shape.bounds.yMin * this.fontSize
            const yMax = shape.bounds.yMax * this.fontSize
            /* Leading/trailing spaces not accounted intentionally now. */
            if (this.bounds === null) {
                this.bounds = {xMin, xMax, yMin, yMax}
            } else {
                if (xMin < this.bounds.xMin) {
                    this.bounds.xMin = xMin
                }
                if (yMin < this.bounds.yMin) {
                    this.bounds.yMin = yMin
                }
                if (xMax > this.bounds.xMax) {
                    this.bounds.xMax = xMax
                }
                if (yMax > this.bounds.yMax) {
                    this.bounds.yMax = yMax
                }
            }
        } else {
            vertices = null
        }
        this.curX = x + shape.advance * this.fontSize
        this.glyphs.push({shape, vertices})
        this.prevChar = char
        this.prevFont = shape.font
    }

    GetCurrentPosition() {
        return this.curX
    }

    /**
     * @param {{x: number, y: number}} startPos TEXT group first alignment point.
     * @param {?{x: number, y: number}} endPos TEXT group second alignment point.
     * @param {?number} rotation Rotation attribute, deg.
     * @param {?number} widthFactor Relative X scale factor (group 41).
     * @param {?number} hAlign Horizontal text justification type code (group 72).
     * @param {?number} vAlign Vertical text justification type code (group 73).
     * @param {number} color
     * @param {?string} layer
     * @returns {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *Render(startPos, endPos, rotation, widthFactor, hAlign, vAlign, color, layer) {

        if (this.bounds === null) {
            return
        }

        endPos = endPos ?? startPos
        if (rotation) {
            rotation *= -Math.PI / 180
        } else {
            rotation = 0
        }
        widthFactor = widthFactor ?? 1
        hAlign = hAlign ?? HAlign.LEFT
        vAlign = vAlign ?? VAlign.BASELINE

        let origin = new Vector2()
        let scale = new Vector2(widthFactor, 1)
        let insertionPos =
            (hAlign === HAlign.LEFT && vAlign === VAlign.BASELINE) ||
            hAlign === HAlign.FIT || hAlign === HAlign.ALIGNED ?
            new Vector2(startPos.x, startPos.y) : new Vector2(endPos.x, endPos.y)

        const GetFitScale = () => {
            const width = endPos.x - startPos.x
            if (width < Number.MIN_VALUE * 2) {
                return widthFactor
            }
            return width / (this.bounds.xMax - this.bounds.xMin)
        }

        const GetFitRotation = () => {
            return -Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x)
        }

        switch (hAlign) {
        case HAlign.LEFT:
            origin.x = this.bounds.xMin
            break
        case HAlign.CENTER:
            origin.x = (this.bounds.xMax - this.bounds.xMin) / 2
            break
        case HAlign.RIGHT:
            origin.x = this.bounds.xMax
            break
        case HAlign.MIDDLE:
            origin.x = (this.bounds.xMax - this.bounds.xMin) / 2
            origin.y = (this.bounds.yMax - this.bounds.yMin) / 2
            break
        case HAlign.ALIGNED: {
            const f = GetFitScale()
            scale.x = f
            scale.y = f
            rotation = GetFitRotation()
            break
        }
        case HAlign.FIT:
            scale.x = GetFitScale()
            rotation = GetFitRotation()
            break
        default:
            console.warn("Unrecognized hAlign value: " + hAlign)
        }

        switch (vAlign) {
        case VAlign.BASELINE:
            break
        case VAlign.BOTTOM:
            origin.y = this.bounds.yMin
            break
        case VAlign.MIDDLE:
            origin.y = (this.bounds.yMax - this.bounds.yMin) / 2
            break
        case VAlign.TOP:
            origin.y = this.bounds.yMax
            break
        default:
            console.warn("Unrecognized vAlign value: " + vAlign)
        }

        const transform = new Matrix3().makeTranslation(-origin.x, -origin.y)
        MatrixScale(transform, scale.x, scale.y)
        MatrixRotateCW(transform, rotation)
        MatrixTranslate(transform, insertionPos.x, insertionPos.y)

        yield* this._RenderGlyphs(transform, color, layer)
    }

    /** Render the block with its pen origin - the start of the baseline, ahead of the first
     * glyph's left side bearing - placed at the specified position. Text box chunks are laid out
     * by accumulated pen advances, so anchoring one to its ink box instead would shift it left by
     * its own first glyph's bearing.
     * @param {Vector2} position Pen origin position.
     * @param {?number} rotation Rotation, deg.
     * @param {number} color
     * @param {?string} layer
     * @returns {Generator<Entity>} Rendering entities.
     */
    *RenderAtPenOrigin(position, rotation, color, layer) {
        if (this.bounds === null) {
            return
        }
        const transform = new Matrix3()
        MatrixRotateCW(transform, rotation ? -rotation * Math.PI / 180 : 0)
        MatrixTranslate(transform, position.x, position.y)
        yield* this._RenderGlyphs(transform, color, layer)
    }

    /**
     * @param {Matrix3} transform Applied to each glyph vertex.
     * @param {number} color
     * @param {?string} layer
     * @returns {Generator<Entity>} Rendering entities.
     */
    *_RenderGlyphs(transform, color, layer) {
        for (const glyph of this.glyphs) {
            if (glyph.vertices) {
                for (const v of glyph.vertices) {
                    v.applyMatrix3(transform)
                }
                yield new Entity({
                   type: Entity.Type.TRIANGLES,
                   vertices: glyph.vertices,
                   indices: glyph.shape.indices,
                   layer, color: this.color ?? color
                })
            }
        }
    }
}

/** Encapsulates layout calculations for stacked text (\S format code) - a pair of text pieces
 * drawn one above the other, optionally separated by a divider line.
 */
class TextStack {
    /**
     * @param {number} fontSize Font size of the surrounding text.
     * @param {?number} color
     * @param {string} divider One of "^" (no divider line), "/" (horizontal divider line) or "#"
     *  (slanted divider line).
     */
    constructor(fontSize, color, divider) {
        this.fontSize = fontSize
        this.color = color
        this.divider = divider
        //XXX The stack height the drawing carries, and any \H scope around the code, are both
        // ignored, so the pieces are always drawn at the AutoCAD default fraction of the
        // surrounding text height.
        this.partSize = fontSize * TextStack.SIZE_RATIO
        this.top = new TextBlock(this.partSize, color)
        this.bottom = new TextBlock(this.partSize, color)
    }

    /**
     * @param {string} numerator
     * @param {string} denominator
     * @param {function(string): ?CharShape} charShapeProvider
     */
    Fill(numerator, denominator, charShapeProvider) {
        for (const [text, block] of [[numerator, this.top], [denominator, this.bottom]]) {
            for (const c of text) {
                const shape = charShapeProvider(c)
                if (shape !== null) {
                    block.PushChar(c, shape)
                }
            }
        }
    }

    /** @returns {number} Width occupied by the stack. */
    GetWidth() {
        const top = this.top.GetCurrentPosition()
        const bottom = this.bottom.GetCurrentPosition()
        if (this.divider === "#") {
            /* Diagonal stack places the pieces side by side. */
            return top + bottom
        }
        return Math.max(top, bottom)
    }

    /** @param {number} x Chunk position in the text box.
     * @param {number} y Baseline of the surrounding text in the text box.
     * @param {Matrix3} transform Text box transform.
     * @param {?number} rotation Text box rotation, deg.
     * @param {number} color
     * @param {?string} layer
     * @returns {Generator<Entity>} Rendering entities.
     */
    *Render(x, y, transform, rotation, color, layer) {
        const size = this.partSize
        const width = this.GetWidth()
        const topWidth = this.top.GetCurrentPosition()
        const bottomWidth = this.bottom.GetCurrentPosition()
        /* Baseline to baseline, leaving the same gap between the pieces ezdxf does. The pair
         * spans from the bottom baseline to the top of the upper piece, and is centered on the
         * middle of the surrounding text, so that a divider line runs where a horizontal fraction
         * bar is expected.
         */
        const separation = size * (2 * TextStack.HEIGHT_SCALE - 1)
        const middle = y + this.fontSize / 2
        const bottomY = middle - (separation + size) / 2
        const topY = bottomY + separation
        let topX, bottomX
        if (this.divider === "#") {
            topX = x
            bottomX = x + topWidth
        } else {
            topX = x + (width - topWidth) / 2
            bottomX = x + (width - bottomWidth) / 2
        }

        const Place = (px, py) => new Vector2(px, py).applyMatrix3(transform)

        yield* this.top.RenderAtPenOrigin(Place(topX, topY), rotation, color, layer)
        yield* this.bottom.RenderAtPenOrigin(Place(bottomX, bottomY), rotation, color, layer)

        if (this.divider === "^") {
            return
        }
        let vertices
        if (this.divider === "/") {
            vertices = [Place(x, middle), Place(x + width, middle)]
        } else {
            /* The slanted line crosses the junction of the two pieces, spanning the full stack
             * height.
             */
            const slant = size / 2
            vertices = [Place(x + topWidth - slant, bottomY),
                        Place(x + topWidth + slant, topY + size)]
        }
        yield new Entity({
            type: Entity.Type.LINE_SEGMENTS,
            vertices,
            layer,
            color: this.color ?? color
        })
    }
}

/** Size of each stacked piece relative to the surrounding text height. Matches the AutoCAD
 * default stack height.
 */
TextStack.SIZE_RATIO = 0.7

/** Height of the pair relative to the two pieces together, so the part above 1 is the gap between
 * them. The value ezdxf lays fractions out with.
 */
TextStack.HEIGHT_SCALE = 1.2
