
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'LEADER';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value, vertices: [] };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 3: // dimension style name
            entity.styleName = curr.value;
            break;
        case 40: // text annotation height
            entity.textHeight = curr.value;
            break;
        case 41: // text annotation width
            entity.textWidth = curr.value;
            break;
        case 71: // arrowhead flag (0=disabled, 1=enabled)
            entity.arrowheadFlag = curr.value;
            break;
        case 72: // path type (0=straight, 1=spline)
            entity.pathType = curr.value;
            break;
        case 73: // creation flag
            entity.creationFlag = curr.value;
            break;
        case 74: // hookline direction flag
            entity.hooklineDirection = curr.value;
            break;
        case 75: // hookline flag
            entity.hooklineFlag = curr.value;
            break;
        case 76: // number of vertices
            entity.vertexCount = curr.value;
            break;
        case 10: // vertex (repeating)
            entity.vertices.push(helpers.parsePoint(scanner));
            break;
        case 210:
            entity.extrusionDirection = helpers.parsePoint(scanner);
            break;
        case 100:
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }

        curr = scanner.next();
    }
    return entity;
};
