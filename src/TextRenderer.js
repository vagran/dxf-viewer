import {DxfScene, Entity} from "./DxfScene"
import {ShapePath} from "three/src/extras/core/ShapePath"
import {ShapeUtils} from "three/src/extras/ShapeUtils"
import {Matrix3, Vector2} from "three"

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
        for (const char of Array.from(text)) {
            if (char.charCodeAt(0) < 0x20) {
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
     * @param size {number}
     * @return {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *Render({text, startPos, endPos, rotation = 0, widthFactor = 1, hAlign = 0, vAlign = 0,
             color, layer = null, size}) {
        const block = new TextBlock(size)
        for (const char of Array.from(text)) {
            const shape = this._GetCharShape(char)
            if (!shape) {
                continue
            }
            block.PushChar(char, shape)
        }
        yield* block.Render(startPos, endPos, rotation, widthFactor, hAlign, vAlign, color, layer)
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
            this.charMap.set(String.fromCharCode(glyph.unicode), glyph)
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
        let path = null
        let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2
        const scale = this.scale
        path = new ShapePath()
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

/** Encapsulates calculations for a text block. */
//XXX multiline text
class TextBlock {
    constructor(size) {
        this.size = size
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
        const x = this.curX + offset * this.size
        let vertices
        if (shape.vertices) {
            vertices = shape.GetVertices({x, y: 0}, this.size)
            const xMin = x + shape.bounds.xMin * this.size
            const xMax = x + shape.bounds.xMax * this.size
            const yMin = shape.bounds.yMin * this.size
            const yMax = shape.bounds.yMax * this.size
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
        this.curX = x + shape.advance * this.size
        this.glyphs.push({shape, vertices})
        this.prevChar = char
        this.prevFont = shape.font
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