import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*LATTICE-02,LATTICE-02 verbose
;By John Hyslop,    Tile2Hatch tool © CVH 2020
;Developed in inch as imperial QCAD3 pattern
180,0.38333333,0.38333333,0,1,0.76666666,-0.23333334
270,0.61666667,1,1,1,1;,0 Removed 0 IT RENDERS A POINT
180,0.38333333,0.61666667,0,1,0.76666666,-0.23333334
270,0.38333333,1,1,1,1,;0 Removed 0 IT RENDERS A POINT
`), false)
