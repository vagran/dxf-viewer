import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*DOLMIT,DOLMIT
0, 0,0, 0,.25
45, 0,0, 0,.70710678, .35355339,-.70710768
`), false)
