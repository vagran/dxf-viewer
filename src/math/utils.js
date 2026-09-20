import {Matrix3, Vector2} from "three"


/** Find intersection points of two segments in a parametric form.
 * @param {Vector2} a1 First segment start point.
 * @param {Vector2} a2 First segment end point.
 * @param {Vector2} b1 Second segment start point.
 * @param {Vector2} b2 Second segment end point.
 * @param {boolean} force Force intersection calculation even if intersection point is out of
 *  segment range.
 * @returns {?Array<number>} Parameters for the first and second segment in the intersection point
 *  (parameter value 0 corresponds to a start point, 1 - to an end point). Third number is segments
 *  direction vectors pseudo-cross-product. Null if there is no intersection.
 */
export function IntersectSegmentsParametric(a1, a2, b1, b2, force = false) {
    const a = a2.clone().sub(a1)
    const b = b2.clone().sub(b1)

    if (a.lengthSq() == 0 || b.lengthSq() == 0) {
        return null
    }

    const S = a.cross(b)
    if (Math.abs(S) <= Number.EPSILON) {
        /* Consider parallel. */
        return null
    }

    const c = b1.clone().sub(a1)

    const t = c.cross(b) / S
    if (!force && (t < 0 || t > 1)) {
        /* Intersection point is out the first segment endpoints. */
        return null
    }

    const u = c.cross(a) / S
    if (!force && (u < 0 || u > 1)) {
        /* Intersection point is out the second segment endpoints. */
        return null
    }

    return [t, u, S]
}

/**  Find intersection points of two segments.
 * @param {Vector2} a1 First segment start point.
 * @param {Vector2} a2 First segment end point.
 * @param {Vector2} b1 Second segment start point.
 * @param {Vector2} b2 Second segment end point.
 * @returns {?Vector2} Intersection point coordinate, null if no intersection.
 */
export function IntersectSegments(a1, a2, b1, b2) {
    const params = IntersectSegmentsParametric(a1, a2, b1, b2)
    if (!params) {
        return null
    }
    return a2.clone().sub(a1).multiplyScalar(params[0]).add(a1)
}


/* Scratch matrix for the composition helpers below, reused to avoid allocating on every call.
 * Safe to share: premultiply() reads it fully before writing its target, and no helper hands it
 * out or retains it.
 */
const _m = new Matrix3()

/** Compose a translation onto a matrix, in place.
 * @param {Matrix3} m Matrix to transform.
 * @param {number} tx
 * @param {number} ty
 * @returns {Matrix3} The same matrix, for chaining.
 */
export function MatrixTranslate(m, tx, ty) {
    return m.premultiply(_m.makeTranslation(tx, ty))
}

/** Compose a scaling onto a matrix, in place.
 * @param {Matrix3} m Matrix to transform.
 * @param {number} sx
 * @param {number} sy
 * @returns {Matrix3} The same matrix, for chaining.
 */
export function MatrixScale(m, sx, sy) {
    return m.premultiply(_m.makeScale(sx, sy))
}

/** Compose a clockwise rotation onto a matrix, in place. Note the direction: Matrix3.makeRotation()
 * is counter-clockwise, so the angle is negated here. Callers throughout this project pass angles
 * in the clockwise convention.
 * @param {Matrix3} m Matrix to transform.
 * @param {number} theta Rotation angle in radians, clockwise from +X direction.
 * @returns {Matrix3} The same matrix, for chaining.
 */
export function MatrixRotateCW(m, theta) {
    return m.premultiply(_m.makeRotation(-theta))
}
