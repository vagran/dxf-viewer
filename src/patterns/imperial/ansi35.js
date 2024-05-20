import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANSI35,ANSI35
45, 0,0, 0,.25
45, .1767767,0, 0,.25, .3125,-.0625,0,-.0625
`), false)
