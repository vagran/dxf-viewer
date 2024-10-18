import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*BRSTONE,BRSTONE
0, 0,0, 0,.33
90, .9,0, .33,.5, .33,-.33
90, .8,0, .33,.5, .33,-.33
0, .9,.055, .5,.33, -.9,.1
0, .9,.11, .5,.33, -.9,.1
0, .9,.165, .5,.33, -.9,.1
0, .9,.22, .5,.33, -.9,.1
0, .9,.275, .5,.33, -.9,.1
`), false)
