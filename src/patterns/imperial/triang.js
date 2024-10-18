import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*TRIANG,TRIANG
60, 0,0, .1875,.32475953, .1875,-.1875
120, 0,0, .1875,.32475953, .1875,-.1875
0, -.09375,.16237976, .1875,.32475953, .1875,-.1875
`), false)
