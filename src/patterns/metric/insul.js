import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*INSUL,INSUL
0, 0,0, 0,9.525
0, 0,3.175, 0,9.525, 3.175,-3.175
0, 0,6.35, 0,9.525, 3.175,-3.175
`))
