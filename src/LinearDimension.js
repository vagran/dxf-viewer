import {Vector2, Matrix3} from "three"
import { ParseSpecialChars } from "./TextRenderer.js"

/**
 * @property {{color: ?number, start: Vector2, end: Vector2}[]} lines
 * @property {{color: ?number, vertices: Vector2[]}[], indices: number[]} triangles On or more
 *  triangles in each item.
 * @property {{text: string, size: number, angle: number, color: number, position: Vector2}[]} texts
 *   Each item position is specified as middle point of the rendered text.
 */
export class DimensionLayout {
    constructor() {
        this.lines = []
        this.triangles = []
        this.texts = []
    }

    AddLine(start, end, color = null) {
        this.lines.push({start, end, color})
    }

    /** Add one or more triangles. */
    AddTriangles(vertices, indices, color = null) {
        this.triangles.push({vertices, indices, color})
    }

    AddText(text, size, angle, color, position) {
        this.texts.push({text, size, angle, color, position})
    }
}

const arrowHeadShape = {
    vertices: [
        new Vector2(0, 0),
        new Vector2(1, -0.25),
        new Vector2(1, 0.25)
    ],
    indices: [0, 1, 2]
}

/** Encapsulates all calculations about linear dimensions layout. */
export class LinearDimension {

    /**
     * @typedef LinearDimensionParams
     * @property {Vector2} p1 First definition point.
     * @property {Vector2} p2 Second definition point.
     * @property {Vector2} anchor Anchor point defines dimension line location.
     * @property {?number} angle Rotation angle for rotated dimension, deg.
     * @property {boolean} isAligned Dimension line is parallel to base line for aligned dimension.
     * @property {?string} text Dimension text pattern.
     * @property {?Vector2} textAnchor Text location (middle point) override.
     * @property {?number} textRotation Rotation angle of the dimension text away from its default
     *  orientation (the direction of the dimension line)
     */

    /**
     * @param {LinearDimensionParams} params
     * @param {Function<any(string)>} styleResolver Provides value for a requested style parameter.
     * @param {Function<number(string, number)>} textWidthCalculator Get text width in model space
     *  units for a given text and font size (height).
     */
    constructor(params, styleResolver, textWidthCalculator) {
        this.params = params
        this.styleResolver = styleResolver
        this.textWidthCalculator = textWidthCalculator
        /* Can be set to indicate some invalid geometric solution.  */
        this.isValid = true
        this._CalculateGeometry()
    }

    IsValid() {
        return this.isValid
    }

    GetTexts() {
        return [this._GetText()]
    }

    /**
     * @return {DimensionLayout}
     */
    GenerateLayout() {
        /* See https://ezdxf.readthedocs.io/en/stable/tables/dimstyle_table_entry.html */
        const result = new DimensionLayout()

        /* Dimension line(s). */
        const dimSize = this.d1.distanceTo(this.d2)
        const dimColor = this.styleResolver("DIMCLRD")
        let dimScale = this.styleResolver("DIMSCALE") ?? 1
        if (dimScale == 0) {
            /* No any auto calculation implemented, since no support for paper space. */
            dimScale = 1
        }

        const text = this._GetText()
        const fontSize = (this.styleResolver("DIMTXT") ?? 1) * dimScale
        const textWidth = this.textWidthCalculator(text, fontSize)
        const textColor = this.styleResolver("DIMCLRT")
        const arrowSize = (this.styleResolver("DIMASZ") ?? 1) * dimScale
        const tickSize = (this.styleResolver("DIMTSZ") ?? 0) * dimScale

        let textAnchor = this.params.textAnchor
        let flipArrows = false

        const start = this.d1.clone()
        const dimExt = (this.styleResolver("DIMDLE") ?? 0) * dimScale
        if (dimExt != 0) {
            start.add(this.vDim.clone().multiplyScalar(-dimExt))
        }
        const end = this.d2.clone()
        if (dimExt != 0) {
            end.add(this.vDim.clone().multiplyScalar(dimExt))
        }
        result.AddLine(start, end, dimColor)

        if (dimSize < arrowSize * 2) {
            flipArrows = true
        }

        if (!textAnchor) {
            //XXX for now just always draw the text above dimension line with fixed gap
            textAnchor = this.vDim.clone().multiplyScalar(this.d1.distanceTo(this.d2) / 2)
                .add(this.d1).add(this.vDimNorm.clone().multiplyScalar(fontSize * 0.75))
        }
        const angle = this.vDimNorm.angle() * 180 / Math.PI - 90 +
            (this.params.textRotation ?? 0)
        result.AddText(text, fontSize, angle, textColor, textAnchor)


        /* Extension lines. */
        const extColor = this.styleResolver("DIMCLRE")
        const extOffset = (this.styleResolver("DIMEXO") ?? 0) * dimScale
        const extExt = (this.styleResolver("DIMEXE") ?? 0) * dimScale

        const DrawExtLine = (basePt, dimPt) => {
            const vExt = dimPt.clone().sub(basePt)
            const dist = vExt.length()
            if (dist == 0) {
                return
            }
            vExt.normalize()
            const start = basePt.clone()
            if (extOffset != 0) {
                start.add(vExt.clone().multiplyScalar(extOffset))
            }
            const end = dimPt.clone()
            if (extExt != 0) {
                end.add(vExt.clone().multiplyScalar(extExt))
            }
            result.AddLine(start, end, extColor)
        }

        if (!(this.styleResolver("DIMSE1") ?? 0)) {
            DrawExtLine(this.params.p1, this.d1)
        }
        if (!(this.styleResolver("DIMSE2") ?? 0)) {
            DrawExtLine(this.params.p2, this.d2)
        }

        /* Draw arrows (or anything defined as dimension shape). Assuming shape is defined
         * horizontally for left side with the origin in the dimension point, scale corresponding to
         * size 1. Calculate appropriate transform for the shape.
         */
        //XXX check suppression by DIMSOXD, DIMSD1, DIMSD2
        for (let i = 0; i < 2; i++) {
            const dimPt = i == 0 ? this.d1 : this.d2
            let flip = i == 1
            if (flipArrows) {
                flip = !flip
            }

            let transform = new Matrix3().identity()
            if (tickSize > 0) {
                transform.scale(tickSize, tickSize)
            } else {
                transform.scale(arrowSize, arrowSize)
                /* Tick is not flipped. */
                if (flip) {
                    transform.scale(-1, 1)
                }
            }

            const angle = -this.vDim.angle()
            transform.rotate(angle)

            transform.translate(dimPt.x, dimPt.y)

            if (tickSize > 0) {
                this._CreateTick(result, transform, dimColor)
            } else {
                this._CreateArrowShape(result, transform, dimColor)
            }
        }

        return result
    }

    _CreateArrowShape(layout, transform, color) {
        const vertices = []
        for (const v of arrowHeadShape.vertices) {
            vertices.push(v.clone().applyMatrix3(transform))
        }
        layout.AddTriangles(vertices, arrowHeadShape.indices, color)
    }

    _CreateTick(layout, transform, color) {
        layout.AddLine(new Vector2(0.5, 0.5).applyMatrix3(transform),
                       new Vector2(-0.5, -0.5).applyMatrix3(transform),
                       color)
    }

    /** Calculate and set basic geometric parameters (some points and vectors which define the
     * dimension layout).
     */
    _CalculateGeometry() {
        /* Base vector. */
        this.vBase = this.params.p2.clone().sub(this.params.p1).normalize()

        /* Dimension vector. */
        if (this.params.isAligned) {
            this.vDim = this.vBase
        } else {
            /* Angle is defined as angle between X axis and dimension line (CCW is positive). */
            const angle = (this.params.angle ?? 0) * Math.PI / 180
            this.vDim = new Vector2(Math.cos(angle), Math.sin(angle))
        }

        /* Dimension points. Calculate them by projecting base points to dimension line. */
        this.d1 = this.vDim.clone().multiplyScalar(
            /* Projected signed length. */
            this.params.p1.clone().sub(this.params.anchor).dot(this.vDim))
            .add(this.params.anchor)
        this.d2 = this.vDim.clone().multiplyScalar(
            /* Projected signed length. */
            this.params.p2.clone().sub(this.params.anchor).dot(this.vDim))
            .add(this.params.anchor)

        if (this.d1.distanceTo(this.d2) == 0) {
            this.isValid = false
        }

        /* Ensure dimension vector still points from d1 to d2 after rotation. */
        this.vDim.copy(this.d2).sub(this.d1).normalize()

        /* Dimension normal vector is perpendicular to dimension line and is either above or on its
         * left side.
         * 90deg rotated vector is either [y; -x] or [-y; x]. Select most suitable from them
         * (y > x).
         */
        if (this.vDim.y < -this.vDim.x) {
            this.vDimNorm = new Vector2(this.vDim.y, -this.vDim.x)
        } else {
            this.vDimNorm = new Vector2(-this.vDim.y, this.vDim.x)
        }
    }

    _GetText() {
        if (this.params.text == " ") {
            /* Space indicates empty text. */
            return ""
        }
        if ((this.params.text ?? "") != "" && this.params.text.indexOf("<>") == -1) {
            /* No value placeholder, just return the text. */
            return ParseSpecialChars(this.params.text)
        }

        let measurement = this.d2.distanceTo(this.d1)
        measurement *= this.styleResolver("DIMLFAC") ?? 1

        const rnd = this.styleResolver("DIMRND") ?? 0
        if (rnd > 0) {
            const n = Math.round(measurement / rnd)
            measurement = rnd * n
        }

        const zeroSupp = this.styleResolver("DIMZIN") ?? 0
        const leadZeroSupp = (zeroSupp & 4) != 0
        const trailingZeroSupp = (zeroSupp & 8) != 0

        let measText = measurement.toFixed(this.styleResolver("DIMDEC") ?? 2)

        if (trailingZeroSupp) {
            measText = measText.replace(/.0+$/, "")
        }

        if (leadZeroSupp) {
            measText = measText.replace(/^0+/, "")
        }

        if (measText.startsWith(".")) {
            measText = "0" + measText
        } else if (measText == "") {
            measText = "0"
        }
        if (measText.endsWith(".")) {
            measText = measText.substring(0, measText.length - 1)
        }

        let decSep = this.styleResolver("DIMDSEP") ?? "."
        if (!isNaN(decSep)) {
            decSep = String.fromCharCode(decSep)
        }
        if (decSep != ".") {
            measText = measText.replace(".", decSep)
        }

        const suffix = this.styleResolver("DIMPOST") ?? ""
        if (suffix != "") {
            if (suffix.indexOf("<>") != -1) {
                measText = suffix.replaceAll("<>", measText)
            } else {
                measText += suffix
            }
        }

        if ((this.params.text ?? "") != "") {
            measText = this.params.text.replaceAll("<>", measText)
        }

        return ParseSpecialChars(measText)
    }
}
