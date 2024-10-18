import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*TRANS,TRANS
0, 0,0, 0,.25
0, 0,.125, 0,.25, .125,-.125
`), false)
