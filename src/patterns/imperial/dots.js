import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*DOTS,DOTS
0, 0,0, .03125,.0625, 0,-.0625
`), false)
