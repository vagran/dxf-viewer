import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*INSUL,INSUL
0, 0,0, 0,.375
0, 0,.125, 0,.375, .125,-.125
0, 0,.25, 0,.375, .125,-.125
`), false)
