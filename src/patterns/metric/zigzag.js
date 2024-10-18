import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*ZIGZAG,ZIGZAG
0, 0,0, 3.175,3.175, 3.175,-3.175
90, 3.175,0, 3.175,3.175, 3.175,-3.175
`))
