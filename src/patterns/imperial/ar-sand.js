import { Pattern, RegisterPattern } from "../../Pattern.js"

RegisterPattern(Pattern.ParsePatFile(`
*AR-SAND,AR-SAND
37.5, 0,0, 1.123,1.567, 0,-1.52,0,-1.7,0,-1.625
7.5, 0,0, 2.123,2.567, 0,-.82,0,-1.37,0,-.525
-32.5, -1.23,0, 2.6234,1.678, 0,-.5,0,-1.8,0,-2.35
-42.5, -1.23,0, 1.6234,2.678, 0,-.25,0,-1.18,0,-1.35
`), false)
