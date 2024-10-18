import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*CLAY,CLAY
0, 0,0, 0,.1875
0, 0,.03125, 0,.1875
0, 0,.0625, 0,.1875
0, 0,.125, 0,.1875, .1875,-.125
`), false)
