import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-RROOF,AR-RROOF
0, 0,0, 2.2,1, 15,-2,5,-1
0, 1.33,.5, -1,1.33, 3,-.33,6,-.75
0, .5,.85, 5.2,.67, 8,-1.4,4,-1
`), false)
