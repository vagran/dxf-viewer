import {DxfScene, Entity} from "./DxfScene"
import {ShapePath} from "three/src/extras/core/ShapePath"
import {ShapeUtils} from "three/src/extras/ShapeUtils"

/**
 * Helper class for rendering text.
 * Currently it is just basic very simplified implementation for MVP. Further work should include:
 *  * Support DXF text styles and weight.
 *  * Support text formatting and rotation.
 *  * Direct TTF files processing using opentype.js
 *  * Bitmap fonts generation in texture atlas for more optimal rendering.
 */
export class TextRenderer {

    /**
     * @param fonts {{}[]} List of fonts to use, each one is typeface.js object. Fonts are
     *  used in the specified order, each one is checked until necessary glyph is found.
     * @param options
     */
    constructor(fonts, options = null) {
        this.fonts = fonts
        this.options = Object.create(DxfScene.DefaultOptions)
        if (options) {
            Object.assign(this.options, options)
        }
        /* Indexed by character, value is CharShape. */
        this.shapes = new Map()
        /* Shape to display if no glyph found in the specified fonts. May be null if fallback
         * character can not be rendered as well.
         */
        for (const char of Array.from(this.options.fallbackChar)) {
            this.stubShape = this._CreateCharShape(char) ?? null
            if (this.stubShape) {
                break
            }
        }
    }

    get canRender() {
        return this.fonts !== null && this.fonts.length > 0
    }

    /**
     * @param text {string}
     * @param position {{x,y}}
     * @param color {number}
     * @param layer {?string}
     * @param size {number}
     * @return {Generator<Entity>} Rendering entities. Currently just indexed triangles for each
     *  glyph.
     */
    *Render({text, position, color, layer = null, size}) {
        for (const char of Array.from(text)) {
            const shape = this._GetCharShape(char)
            if (shape.vertices) {
                yield new Entity({
                    type: Entity.Type.TRIANGLES,
                    vertices: shape.GetVertices(position, size),
                    indices: shape.indices,
                    layer, color
                })
            }
            position.x += shape.advance * size
        }
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
        let glyph = null
        let selectedFont = null
        for (const font of this.fonts) {
            glyph = font.glyphs[char]
            if (glyph) {
                selectedFont = font
                break
            }
        }
        if (!glyph) {
            return this.stubShape
        }
        return new CharShape(this._CreateGlyphPath(selectedFont, glyph), this.options)
    }

    /** Cannot reuse this method from Three.js Font class, as this API is not exported. So need to
     * make a copy here.
     * @return {{advance: number, path: ?ShapePath}} Path is scaled to size 1.
     */
    _CreateGlyphPath(font, glyph) {
        let path = null
        let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2
        const scale = 1 / font.resolution
        if (glyph.o) {
            const outline = glyph.o.split(' ')
            path = new ShapePath()
            for (let i = 0, l = outline.length; i < l; ) {
                const action = outline[ i ++ ]
                switch ( action ) {

                case 'm': // moveTo
                    x = outline[i++] * scale
                    y = outline[i++] * scale
                    path.moveTo(x, y)
                    break

                case 'l': // lineTo
                    x = outline[i++] * scale
                    y = outline[i++] * scale
                    path.lineTo(x, y)
                    break

                case 'q': // quadraticCurveTo
                    cpx = outline[i++] * scale
                    cpy = outline[i++] * scale
                    cpx1 = outline[i++] * scale
                    cpy1 = outline[i++] * scale
                    path.quadraticCurveTo(cpx1, cpy1, cpx, cpy)
                    break

                case 'b': // bezierCurveTo
                    cpx = outline[i++] * scale
                    cpy = outline[i++] * scale
                    cpx1 = outline[i++] * scale
                    cpy1 = outline[i++] * scale
                    cpx2 = outline[i++] * scale
                    cpy2 = outline[i++] * scale
                    path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy)
                    break
                }
            }
        }
        return {advance: glyph.ha * scale, path: path}
    }
}

TextRenderer.DefaultOptions = {
    /** Number of segments for each curve in a glyph. Currently Three.js does not have more
     * adequate angle-based tessellation option.
     */
    curveSubdivision: 2,
    /** Character to use when the specified fonts does not contain necessary glyph. Several ones can
     * be specified, the first one available is used. */
    fallbackChar: "\uFFFD?"
}

class CharShape {
    /**
     * @param glyph {{advance: number, path: ?ShapePath}}
     * @param options {{}} Renderer options.
     */
    constructor(glyph, options) {
        this.advance = glyph.advance
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
     * @return {{x,y}[]}
     */
    GetVertices(position, size) {
        return this.vertices.map(v => v.clone().multiplyScalar(size).add(position))
    }
}