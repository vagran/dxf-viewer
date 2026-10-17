import {Matrix3, Vector3} from "three"

/** Object Coordinate System helpers.
 *
 * A planar DXF entity stores its geometry in its own coordinate system, the OCS, whose Z axis is
 * the entity's extrusion direction (group 210) and whose X and Y axes follow from it by the
 * "arbitrary axis algorithm" of the DXF specification. The viewer shows the drawing from the top,
 * so what it needs is the OCS plane projected onto the WCS XY plane - and for an entity lying in
 * the plane z = elevation of its OCS that projection is a 2D affine map, which is what
 * OcsToWcsMatrix() returns.
 */

/** Below this both X and Y of the normalized extrusion direction, the OCS X axis is derived from
 * the WCS Y axis rather than from the WCS Z axis. Fixed by the DXF specification.
 */
const ARBITRARY_AXIS_THRESHOLD = 1 / 64

const WORLD_Y = new Vector3(0, 1, 0)
const WORLD_Z = new Vector3(0, 0, 1)

/**
 * @typedef {Object} OcsAxes
 * @property {Vector3} ax OCS X axis in WCS, unit length.
 * @property {Vector3} ay OCS Y axis in WCS, unit length.
 * @property {Vector3} az OCS Z axis in WCS (the normalized extrusion direction).
 */

/** Compute the OCS axes for an extrusion direction, by the arbitrary axis algorithm.
 *
 * @param {?{x: number, y: number, z: number}} extrusion Extrusion direction (group 210), not
 *  necessarily normalized.
 * @returns {?OcsAxes} Null when the OCS is the WCS, so nothing needs transforming: the direction
 *  is missing, is +Z, or cannot be normalized (zero length or non-finite), in which case it is
 *  taken as the default rather than dropping the entity.
 */
export function OcsBasis(extrusion) {
    if (!extrusion) {
        return null
    }
    const az = new Vector3(extrusion.x ?? 0, extrusion.y ?? 0, extrusion.z ?? 0)
    if (az.x === 0 && az.y === 0 && az.z > 0) {
        return null
    }
    const length = az.length()
    if (length === 0 || !Number.isFinite(length)) {
        return null
    }
    az.divideScalar(length)
    const ax = new Vector3()
    if (Math.abs(az.x) < ARBITRARY_AXIS_THRESHOLD && Math.abs(az.y) < ARBITRARY_AXIS_THRESHOLD) {
        ax.crossVectors(WORLD_Y, az)
    } else {
        ax.crossVectors(WORLD_Z, az)
    }
    ax.normalize()
    const ay = new Vector3().crossVectors(az, ax).normalize()
    return {ax, ay, az}
}

/** Build the transform from OCS plane coordinates to WCS XY, the Z coordinate being dropped.
 *
 * @param {?OcsAxes} basis See OcsBasis().
 * @param {number} elevation OCS Z coordinate of the plane the entity lies in.
 * @returns {?Matrix3} Null if `basis` is null, so no transform is needed.
 */
export function OcsToWcsMatrix(basis, elevation = 0) {
    if (!basis) {
        return null
    }
    const {ax, ay, az} = basis
    return new Matrix3().set(ax.x, ay.x, az.x * elevation,
                             ax.y, ay.y, az.y * elevation,
                             0, 0, 1)
}

/** Convert a WCS point to OCS coordinates.
 *
 * @param {OcsAxes} basis See OcsBasis().
 * @param {{x: number, y: number, z: ?number}} point
 * @returns {{x: number, y: number, z: number}}
 */
export function WcsToOcs(basis, point) {
    const p = new Vector3(point.x, point.y, point.z ?? 0)
    return {x: p.dot(basis.ax), y: p.dot(basis.ay), z: p.dot(basis.az)}
}
