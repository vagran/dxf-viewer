import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*BOXJOIN-01,BOXJOIN-01 verbose
;By John Hyslop,    Tile2Hatch tool © CVH 2020
;Developed in inch as imperial QCAD3 pattern
90,0.15000001,0.15,1,1,0.7,-0.3
0,0.15000001,0.85,0,1,0.7,-0.3
270,0.45000001,0.15,1,1,0.3,-0.7
180,0.15000001,0.45,0,1,0.3,-0.7
270,0.55000001,0.15,1,1,0.3,-0.7
180,0.85000001,0.15,0,1,0.7,-0.3
270,0.85000001,0.85,1,1,0.7,-0.3
180,0.15000001,0.55,0,1,0.3,-0.7
`), false)
