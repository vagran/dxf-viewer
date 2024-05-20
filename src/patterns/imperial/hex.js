import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*HEX,HEX
0, 0,0, 0,.21650635, .125,-.25
120, 0,0, 0,.21650635, .125,-.25
60, .125,0, 0,.21650635, .125,-.25
`), false)
