/** Dimension style variables are used either in DIMSTYLE table or in DIMENSION entity style
 * override in XDATA.
 */
const codes = new Map([
    [40, "DIMSCALE"],
    [41, "DIMASZ"],
    [140, "DIMTXT"],
    [144, "DIMLFAC"],
    [178, "DIMCLRT"],
    [271, "DIMDEC"],
    [278 ,"DIMDSEP"],
    [45, "DIMRND"],
    [78, "DIMZIN"],
    [3, "DIMPOST"],
    [176, "DIMCLRD"],
    [177, "DIMCLRE"],
    // ["DIMFXLON"], //XXX not documented
    // ["DIMFXL"], //XXX not documented
    [46, "DIMDLE"],
    [44, "DIMEXE"],
    [42, "DIMEXO"],
    [147, "DIMGAP"],
    [175, "DIMSOXD"],
    [75, "DIMSE1"],
    [76, "DIMSE2"],
    [281, "DIMSD1"],
    [282, "DIMSD2"],
    [173, "DIMSAH"],
    [5, "DIMBLK"],
    [6, "DIMBLK1"],
    [7, "DIMBLK2"],
    [142, "DIMTSZ"]
])

export default codes
