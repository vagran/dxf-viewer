import { Vector2 } from "three"

export class Matrix2 {
  /**
   * 
   * @param {number} a00 
   * @param {number} a01 
   * @param {number} a10 
   * @param {number} a11 
   */
  constructor(a00, a01, a10, a11) {
    this.a00 = a00
    this.a01 = a01
    this.a10 = a10
    this.a11 = a11
  }

  /**
   * Multiply Vector2 to this matrix as Av
   * @param {Vector2} v 
   * @returns {Vector2} transformed v
   */
  multiply(v) {
    return new Vector2(
      this.a00 * v.x + this.a01 * v.y,
      this.a10 * v.x + this.a11 * v.y,
    )
  }

  /**
   * Return determinant of this matrix
   * @returns {number}
   */
  det() {
    return this.a00 * this.a11 - this.a01 * this.a10
  }

  /**
   * Return inverse of this matrix. If inverse is not exists i.e.
   * this.det() === 0, return `undefined`.
   * @param {number | undefined} - in case of pre computed determinant, you may pass it to parameter
   * @returns {Matrix2 | undefined} inverse of this matrix
   */
  inverse(determinant = det()) {
    if (determinant === 0) return undefined

    return new Matrix2(
      this.a11 / determinant, -this.a01 / determinant,
      -this.a10 / determinant, this.a00 / determinant,
    )
  }
}