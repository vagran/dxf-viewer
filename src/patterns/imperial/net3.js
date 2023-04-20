import { Pattern, RegisterPattern } from "../../Pattern"

RegisterPattern(Pattern.ParsePatFile(`
*NET3,NET3
0, 0,0, 0,.125
60, 0,0, 0,.125
120, 0,0, 0,.125
`), false)
