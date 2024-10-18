import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-HBONE,AR-HBONE
45, 0,0, 4,4, 12,-4
135, 2.82842713,2.82842713, 4,-4, 12,-4
`), false)
