import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = "3DFACE"

EntityParser.prototype.parseEntity = function(scanner, curr) {

    var entity = {type: curr.value, vertices: []}
    curr = scanner.next()
    while (curr !== "EOF") {
        if (curr.code === 0) {
            break
        }
        switch (curr.code) {
        case 10: // Corners, in outline order. The fourth repeats the third for a triangle.
        case 11:
        case 12:
        case 13:
            entity.vertices[curr.code - 10] = helpers.parsePoint(scanner)
            break
        case 70: // Invisible edges: bit 1 for the edge from the first corner to the second, etc.
            entity.invisibleEdges = curr.value
            break
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner)
            break
        }
        curr = scanner.next()
    }
    return entity
}
