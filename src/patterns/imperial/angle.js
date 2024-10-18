import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANGLE,ANGLE
0, 0,0, 0,.275, .2,-.075
90, 0,0, 0,.275, .2,-.075
`), false)
