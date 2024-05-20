import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*GRATE,GRATE
0, 0,0, 0,.03125
90, 0,0, 0,.125
`), false)
