import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*TRANS,TRANS
0, 0,0, 0,6.35
0, 0,3.175, 0,6.35, 3.175,-3.175
`))
