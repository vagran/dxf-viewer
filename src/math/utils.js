import { Vector2 } from "three"


/** Find intersection points of two segments in a parametric form.
 * @param {Vector2} a1 First segment start point.
 * @param {Vector2} a2 First segment end point.
 * @param {Vector2} b1 Second segment start point.
 * @param {Vector2} b2 Second segment end point.
 * @param {boolean} force Force intersection calculation even if intersection point is out of
 *  segment range.
 * @return {?number[3]} Parameters for the first and second segment in the intersection point
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
 * @return {?Vector2} Intersection point coordinate, null if no intersection.
 */
export function IntersectSegments(a1, a2, b1, b2) {
    const params = IntersectSegmentsParametric(a1, a2, b1, b2)
    if (!params) {
        return null
    }
    return a2.clone().sub(a1).multiplyScalar(params[0]).add(a1)
}
