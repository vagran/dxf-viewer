import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*HONEY,HONEY
0, 0,0, .1875,.10825317, .125,-.25
120, 0,0, .1875,.10825317, .125,-.25
60, 0,0, .1875,.10825317, -.25,.125
`), false)
