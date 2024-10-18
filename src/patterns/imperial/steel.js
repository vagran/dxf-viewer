import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*STEEL,STEEL
45, 0,0, 0,.125
45, 0,.0625, 0,.125
`), false)
