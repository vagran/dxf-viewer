import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-B816C,AR-B816C
0, 0,0, 8,8, 15.625,-.375
0, -8,.375, 8,8, 15.625,-.375
90, 0,0, 8,8, -8.375,7.625
90, -.375,0, 8,8, -8.375,7.625
`), false)
