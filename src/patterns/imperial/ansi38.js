import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ANSI38,ANSI38
45, 0,0, 0,.125
135, 0,0, .25,.125, .3125,-.1875
`), false)
