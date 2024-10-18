import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*EARTH,EARTH
0, 0,0, .25,.25, .25,-.25
0, 0,.09375, .25,.25, .25,-.25
0, 0,.1875, .25,.25, .25,-.25
90, .03125,.21875, .25,.25, .25,-.25
90, .125,.21875, .25,.25, .25,-.25
90, .21875,.21875, .25,.25, .25,-.25
`), false)
