import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*BOX-OVERLAP
;By John Hyslop,    Tile2Hatch tool © CVH 2020
;Developed in mm as metric QCAD3 pattern
180,5.08,17.78,0,25.4,10.16,-15.24
90,5.08,5.08,25.4,25.4,15.24,-10.16
270,7.62,5.08,25.4,25.4,10.16,-15.24
180,5.08,7.62,0,25.4,10.16,-15.24
0,5.08,20.32,0,25.4,15.24,-10.16
180,20.32,5.08,0,25.4,15.24,-10.16
270,20.32,20.32,25.4,25.4,15.24,-10.16
270,17.78,5.08,25.4,25.4,10.16,-15.24
`))
