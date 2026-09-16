/** Default values for the text rendering options.
 *
 * These sit in their own leaf module, rather than next to `TextRenderer`, so that both sides of a
 * circular import can reach them at any time. `TextRenderer` imports `DxfScene` for `Entity`, so
 * `DxfScene.DefaultOptions` cannot read `TextRenderer.DefaultOptions` while its own module body
 * evaluates: that throws whenever the module graph is entered anywhere other than `DxfScene.js` —
 * which is exactly what a consumer importing `TextRenderer.js` or `LinearDimension.js` directly
 * does. A module that imports nothing is safe to read from either side.
 *
 * `TextRenderer.DefaultOptions` still refers to this same object, so nothing observable moved.
 */
export const DefaultTextOptions = {
    /** Number of segments for each curve in a glyph. Currently Three.js does not have more
     * adequate angle-based or length-based tessellation option.
     */
    curveSubdivision: 2,
    /** Character to use when the specified fonts does not contain necessary glyph. Several ones can
     * be specified, the first one available is used.
     */
    fallbackChar: "�?"
}
