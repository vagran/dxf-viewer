import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*JIS_STN_1E,JIS_STN_1E
45, 0,0, 0,1
45, .705,0, 0,1, 1,-.5
`))
