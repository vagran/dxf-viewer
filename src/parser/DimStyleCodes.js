/** Dimension style variables are used either in DIMSTYLE table or in DIMENSION entity style
 * override in XDATA.
 */
const codes = new Map([
    [140, "DIMTXT"],
    [142, "DIMTSZ"],
    [144, "DIMLFAC"],
    [147, "DIMGAP"],
    [173, "DIMSAH"],
    [175, "DIMSOXD"],
    [176, "DIMCLRD"],
    [177, "DIMCLRE"],
    [178, "DIMCLRT"],
    [271, "DIMDEC"],
    [278, "DIMDSEP"],
    [281, "DIMSD1"],
    [282, "DIMSD2"],
    [3, "DIMPOST"],
    [40, "DIMSCALE"],
    [41, "DIMASZ"],
    [42, "DIMEXO"],
    [44, "DIMEXE"],
    [45, "DIMRND"],
    [46, "DIMDLE"],
    [5, "DIMBLK"],
    [6, "DIMBLK1"],
    [7, "DIMBLK2"],
    [75, "DIMSE1"],
    [76, "DIMSE2"],
    [78, "DIMZIN"],
    /* The arrowhead block variables above name their block directly, which the specification marks
     * obsolete; since R2000 the same three variables carry the handle of the referenced BLOCK
     * instead, and a file written for R2000 or later has only these. The handles are turned back
     * into names by resolveDimStyleBlocks() once the whole file is read, because the BLOCKS section
     * may follow the TABLES section.
     */
    [342, "DIMBLK_handle"],
    [343, "DIMBLK1_handle"],
    [344, "DIMBLK2_handle"]
])

export default codes
