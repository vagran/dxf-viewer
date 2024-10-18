import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*HEX,HEX
0, 0,0, 0,5.49926, 3.175,-6.35
120, 0,0, 0,5.49926, 3.175,-6.35
60, 3.175,0, 0,5.49926, 3.175,-6.35
`))
