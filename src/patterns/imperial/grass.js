import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*GRASS,GRASS
90, 0,0, .70710678,.70710678, .1875,-1.22671356
45, 0,0, 0,1, .1875,-.8125
135, 0,0, 0,1, .1875,-.8125
`), false)
