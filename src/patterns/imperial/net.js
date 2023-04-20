import { Pattern, RegisterPattern } from "../../Pattern"

RegisterPattern(Pattern.ParsePatFile(`
*NET,NET
0, 0,0, 0,.125
90, 0,0, 0,.125
`), false)
