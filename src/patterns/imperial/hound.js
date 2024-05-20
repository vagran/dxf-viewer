import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*HOUND,HOUND
0, 0,0, .25,.0625, 1,-.5
90, 0,0, -.25,.0625, 1,-.5
`), false)
