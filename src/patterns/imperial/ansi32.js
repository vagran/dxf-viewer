import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANSI32,ANSI32
45, 0,0, 0,.375
45, .1767767,0, 0,.375
`), false)
