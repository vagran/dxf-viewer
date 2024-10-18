import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*CORK,CORK
0, 0,0, 0,.125
135, .0625,-.0625, 0,.35355339, .1767767,-.1767767
135, .09375,-.0625, 0,.35355339, .1767767,-.1767767
135, .125,-.0625, 0,.35355339, .1767767,-.1767767
`), false)
