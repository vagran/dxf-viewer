import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANSI34,ANSI34
45, 0,0, 0,.75
45, .1767767,0, 0,.75
45, .35355339,0, 0,.75
45, .53033009,0, 0,.75
`), false)
