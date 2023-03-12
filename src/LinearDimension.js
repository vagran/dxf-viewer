import {Vector2} from "three"

/**
 * @property {{color: ?number, start: Vector2, end: Vector2}[]} lines
 * @property {{color: ?number, vertices: Vector2[]}[]} triangles On or more triangles in each item.
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
    AddTriangles(vertices, color = null) {
        this.triangles.push({vertices, color})
    }

    AddText(text, size, angle, color, position) {
        this.texts.push({text, size, angle, color, position})
    }
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

        const text = this._GetText()
        const fontSize = this.styleResolver("DIMTXT") ?? 1
        const textWidth = this.textWidthCalculator(text, fontSize)
        const textColor = this.styleResolver("DIMCLRT")


        if (true) { //XXX check if arrows and text fit into dimension space
            const start = this.d1.clone()
            const dimExt = this.styleResolver("DIMDLE") ?? 0
            if (dimExt != 0) {
                start.add(this.vDim.clone().multiplyScalar(-dimExt))
            }
            const end = this.d2.clone()
            if (dimExt != 0) {
                end.add(this.vDim.clone().multiplyScalar(dimExt))
            }
            result.AddLine(start, end, dimColor)

            //XXX for now just always draw the text above dimension line with fixed gap
            const textAnchor = this.vDim.clone().multiplyScalar(this.d1.distanceTo(this.d2) / 2)
                .add(this.d1).add(this.vDimNorm.clone().multiplyScalar(fontSize * 0.75))
            const angle = this.vDimNorm.angle() * 180 / Math.PI - 90
            result.AddText(text, fontSize, angle, textColor, textAnchor)

        } else {
            //XXX
        }

        /* Extension lines. */
        const extColor = this.styleResolver("DIMCLRE")
        const extOffset = this.styleResolver("DIMEXO") ?? 0
        const extExt = this.styleResolver("DIMEXE") ?? 0

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

        //XXX

        return result
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
        //XXX
        return "42.00mm"
    }
}
