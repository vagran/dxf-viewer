import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-B816,AR-B816
0, 0,0, 0,8
90, 0,0, 8,8, 8,-8
`), false)
