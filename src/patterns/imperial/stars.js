import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*STARS,STARS
0, 0,0, 0,.21650635, .125,-.125
60, 0,0, 0,.21650635, .125,-.125
120, .0625,.10825318, 0,.21650635, .125,-.125
`), false)
