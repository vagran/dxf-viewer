import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANSI33,ANSI33
45, 0,0, 0,.25
45, .1767767,0, 0,.25, .125,-.0625
`), false)
