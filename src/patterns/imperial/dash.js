import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*DASH,DASH
0, 0,0, .125,.125, .125,-.125
`), false)
