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
     * @param fonts {?{}[]} List of fonts to use, each one is opentype.js object. Fonts are
     *  used in the specified order, each one is checked until necessary glyph is found.
     * @param options {?{}} See TextRenderer.DefaultOptions.
     */
    constructor(fonts, options = null) {
        this.fonts = fonts?.map(data => new Font(data)) ?? null
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
            if (!shape) {
                continue
            }
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
        for (const font of this.fonts) {
            const path = font.GetCharPath(char)
            if (path) {
                return new CharShape(path, this.options)
            }
        }
        return this.stubShape
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
    }

    /**
     *
     * @param char {number} Character code point.
     * @return {?{advance: number, path: ?ShapePath}} Path is scaled to size 1. Null if no glyphs
     *  for the specified characters.
     */
    GetCharPath(char) {
        const glyph = this.charMap.get(char)
        if (!glyph) {
            return null
        }
        let path = null
        let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2
        //XXX not really clear what is the resulting unit, check, review and comment it later
        // (100px?)
        const scale = 100 / ((this.data.unitsPerEm || 2048) * 72)
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
        return {advance: glyph.advanceWidth * scale, path}
    }
}