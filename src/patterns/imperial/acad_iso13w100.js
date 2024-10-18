import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ACAD_ISO13W100,ACAD_ISO13W100
0, 0,0, 0,5, 12,-3,12,-3,.5,-6.5
0, 0,0, 0,5, -33.5,.5,-3
`), false)
