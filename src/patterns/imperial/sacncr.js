import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*SACNCR,SACNCR
45, 0,0, 0,.09375
45, .06629126,0, 0,.09375, 0,-.09375
`), false)
