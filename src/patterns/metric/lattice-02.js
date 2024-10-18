import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*LATTICE-02
;By John Hyslop,    Tile2Hatch tool © CVH 2020
;Developed in mm as metric QCAD3 pattern
180,9.736666582,9.736666582,0,25.4,19.473333164,-5.926666836
270,15.663333418,25.4,25.4,25.4,25.4;,0 Removed 0 IT RENDERS A POINT
180,9.736666582,15.663333418,0,25.4,19.473333164,-5.926666836
270,9.736666582,25.4,25.4,25.4,25.4;,0 Removed 0 IT RENDERS A POINT
`))
