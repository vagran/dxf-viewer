import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ZIGZAG,ZIGZAG
0, 0,0, .125,.125, .125,-.125
90, .125,0, .125,.125, .125,-.125
`), false)
