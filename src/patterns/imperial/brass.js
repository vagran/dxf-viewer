import { Pattern, RegisterPattern } from "../../Pattern"

RegisterPattern(Pattern.ParsePatFile(`
*BRASS,BRASS
0, 0,0, 0,.25
0, 0,.125, 0,.25, .125,-.0625
`), false)
