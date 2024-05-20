import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-B88,AR-B88
0, 0,0, 0,8
90, 0,0, 8,4, 8,-8
`), false)
