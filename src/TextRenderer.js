import {DxfScene, Entity} from "./DxfScene"
import {ShapePath} from "three/src/extras/core/ShapePath"
import {ShapeUtils} from "three/src/extras/ShapeUtils"
import {Matrix3, Vector2} from "three"
import {MTextFormatParser} from "./MTextFormatParser";

/**
 * Helper class for rendering text.
 * Currently it is just basic very simplified implementation for MVP. Further work should include:
 *  * Support DXF text styles and weight.
 *  * Bitmap fonts generation in texture atlas for more optimal rendering.
 */
export class TextRenderer {

    /**
     * @param fontFetchers {?Function[]} List of font fetchers. Fetcher should return promise with
     *  loaded font object (opentype.js). They are invoked only when necessary. Each glyph is being
     *  searched sequentially in each provided font.
     * @param options {?{}} See TextRenderer.DefaultOptions.
     */
    constructor(fontFetchers, options = null) {
        this.fontFetchers = fontFetchers
        this.fonts = []

        this.options = Object.create(DxfScene.DefaultOptions)
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
     * @param text {string}
     * @return {Boolean} True if all characters can be rendered, false if none of the provided fonts
     *  contains glyphs for some of the specified text characters.
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

    /**
     * @param text {string}
     * @param startPos {{x,y}}
     * @param endPos {?{x,y}} TEXT group second alignment point.
     * @param rotation {?number} Rotation attribute, deg.
     * @param widthFactor {?number} Relative X scale factor (group 41)
     * @param hAlign {?number} Horizontal text justification type code (group 72)
     * @param vAlign {?number} Vertical text justification type code (group 73).
     * @param color {number}
     * @param layer {?string}
     * @param fontSize {number}
     * @return {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
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
     * @param {MTextFormatEntity[]} formattedText Parsed formatted text.
     * @param {{x, y}} position Insertion position.
     * @param {Number} fontSize
     * @param {?Number} width Text block width, no wrapping if undefined.
     * @param {?Number} rotation Text block rotation in degrees.
     * @param {?{x, y}} direction Text block orientation defined as direction vector. Takes a
     * precedence over rotation if both provided.
     * @param {number} attachment Attachment point, one of MTextAttachment values.
     * @param {?number} lineSpacing Line spacing ratio relative to default one (5/3 of font size).
     * @param {number} color
     * @param {?string} layer
     * @return {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *RenderMText({formattedText, position, fontSize, width = null, rotation = 0, direction = null,
                 attachment, lineSpacing = 1, color, layer = null}) {
        const box = new TextBox(fontSize, this._GetCharShape.bind(this))
        box.FeedText(formattedText)
        yield* box.Render(position, width, rotation, direction, attachment, lineSpacing, color,
                          layer)
    }

    /** @return {CharShape} Shape for the specified character.
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


TextRenderer.DefaultOptions = {
    /** Number of segments for each curve in a glyph. Currently Three.js does not have more
     * adequate angle-based or length-based tessellation option.
     */
    curveSubdivision: 2,
    /** Character to use when the specified fonts does not contain necessary glyph. Several ones can
     * be specified, the first one available is used.
     */
    fallbackChar: "\uFFFD?"
}

/** @typedef {Object} CharPath
 * @property advance {number}
 * @property path {?ShapePath}
 * @property bounds {xMin: number, xMax: number, yMin: number, yMax: number}
 */

class CharShape {
    /**
     * @param font {Font}
     * @param glyph {CharPath}
     * @param options {{}} Renderer options.
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
                /* Ensure proper vertices winding. */
                if (!ShapeUtils.isClockWise(shapePoints.shape)) {
                    shapePoints.shape = shapePoints.shape.reverse()
                    for (const hole of shapePoints.holes) {
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
     * @param position {{x,y}}
     * @param size {number}
     * @return {Vector2[]}
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
     * @param char {string} Character code point as string.
     * @return {Boolean} True if the font has glyphs for the specified character.
     */
    HasChar(char) {
        return this.charMap.has(char)
    }

    /**
     * @param char {string} Character code point as string.
     * @return {?CharPath} Path is scaled to size 1. Null if no glyphs for the specified characters.
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

            case 'M':
                path.moveTo(cmd.x * scale, cmd.y * scale)
                break

            case 'L':
                path.lineTo(cmd.x * scale, cmd.y * scale)
                break

            case 'Q':
                path.quadraticCurveTo(cmd.x1 * scale, cmd.y1 * scale,
                                      cmd.x * scale, cmd.y * scale)
                break

            case 'C':
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
     * @param c1 {string}
     * @param c2 {string}
     * @return {number}
     */
    GetKerning(c1, c2) {
        const i1 = this.data.charToGlyphIndex(c1)
        if (i1 === 0) {
            return 0
        }
        const i2 = this.data.charToGlyphIndex(c1)
        if (i2 === 0) {
            return 0
        }
        return this.data.getKerningValue(i1, i2) * this.scale
    }
}

/** TEXT group attribute 72 values. */
const HAlign = Object.freeze({
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
    ALIGNED: 3,
    MIDDLE: 4,
    FIT: 5
})

/** TEXT group attribute 73 values. */
const VAlign = Object.freeze({
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

/** Encapsulates layout calculations for a multiline-line text block. */
class TextBox {
    /**
     * @param fontSize
     * @param {Function<CharShape, String>} charShapeProvider
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

        for (const item of FlattenItems(formattedText)) {
            switch(item.type) {

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
                this.paragraphs.push(this.curParagraph)
                break

            case MTextFormatParser.EntityType.NON_BREAKING_SPACE:
                this.curParagraph.FeedChar(" ")
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
        const transform = new Matrix3().translate(-origin.x, -origin.y)
            .rotate(-rotation * Math.PI / 180).translate(position.x, position.y)

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
                    const v = new Vector2(x, y)
                    v.applyMatrix3(transform)
                    if (chunk.block) {
                        yield* chunk.block.Render(v, null, rotation, null,
                                                  HAlign.LEFT, VAlign.BASELINE,
                                                  color, layer)
                    }
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
    }

    /** Feed character for current chunk. Spaces should be fed by FeedSpace() method. If space
     * character is fed into this method, it is interpreted as non-breaking space.
     */
    FeedChar(c) {
        const shape = this.textBox.charShapeProvider(c)
        if (shape === null) {
            return
        }
        if (this.curChunk === null) {
            this._AddChunk()
        }
        this.curChunk.PushChar(c, shape)
    }

    FeedSpace() {
        if (this.curChunk === null || this.curChunk.lastChar !== null) {
            this._AddChunk()
        }
        this.curChunk.PushSpace()
    }

    SetAlignment(alignment) {
        this.alignment = alignment
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
            const chunkWidth = chunk.GetWidth(startChunkIdx === 0 || curChunkIdx !== startChunkIdx)
            if (boxWidth !== null && boxWidth !== 0 && curWidth !== 0 &&
                curWidth + chunkWidth > boxWidth) {

                CommitLine()
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
        this.curChunk = new TextBox.Paragraph.Chunk(this, this.textBox.fontSize, this.curChunk)
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
     * @param {?TextBox.Paragraph.Chunk} prevChunk
     */
    constructor(paragraph, fontSize, prevChunk) {
        this.paragraph = paragraph
        this.fontSize = fontSize
        this.prevChunk = prevChunk
        this.lastChar = null
        this.lastShape = null
        this.leadingSpaces = 0
        this.spaceStartKerning = null
        this.spaceEndKerning = null
        this.block = null
        this.position = null
    }

    PushSpace() {
        if (this.block) {
            throw new Error("Illegal operation")
        }
        this.leadingSpaces++
    }

    /**
     * @param char {string}
     * @param shape {CharShape}
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
            this.block = new TextBlock(this.fontSize)
        }
        this.block.PushChar(char, shape)

        this.lastChar = char
        this.lastShape = shape
    }

    GetSpacingWidth() {
        return (this.leadingSpaces * this.paragraph.textBox.spaceShape.advance +
            this.spaceStartKerning + this.spaceEndKerning) * this.fontSize
    }

    GetWidth(withSpacing) {
        if (this.block === null) {
            return 0
        }
        let width = this.block.GetCurrentPosition()
        if (withSpacing) {
            width += this.GetSpacingWidth()
        }
        return width
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
    constructor(fontSize) {
        this.fontSize = fontSize
        /* Element is {shape: CharShape, vertices: ?{Vector2}[]} */
        this.glyphs = []
        this.bounds = null
        this.curX = 0
        this.prevChar = null
        this.prevFont = null
    }

    /**
     * @param char {string}
     * @param shape {CharShape}
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
        if (shape.vertices) {
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
     * @param startPos {{x,y}} TEXT group first alignment point.
     * @param endPos {?{x,y}} TEXT group second alignment point.
     * @param rotation {?number} Rotation attribute, deg.
     * @param widthFactor {?number} Relative X scale factor (group 41).
     * @param hAlign {?number} Horizontal text justification type code (group 72).
     * @param vAlign {?number} Vertical text justification type code (group 73).
     * @param color {number}
     * @param layer {?string}
     * @return {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
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

        const transform = new Matrix3().translate(-origin.x, -origin.y).scale(scale.x, scale.y)
            .rotate(rotation).translate(insertionPos.x, insertionPos.y)

        for (const glyph of this.glyphs) {
            if (glyph.vertices) {
                for (const v of glyph.vertices) {
                    v.applyMatrix3(transform)
                }
                yield new Entity({
                   type: Entity.Type.TRIANGLES,
                   vertices: glyph.vertices,
                   indices: glyph.shape.indices,
                   layer, color
               })
            }
        }
    }
}