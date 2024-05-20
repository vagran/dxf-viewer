import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*NET,NET
0, 0,0, 0,.125
90, 0,0, 0,.125
`), false)
