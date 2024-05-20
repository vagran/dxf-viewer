import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*PLAST,PLAST
0, 0,0, 0,.25
0, 0,.03125, 0,.25
0, 0,.0625, 0,.25
`), false)
