
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'VERTEX';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 10:    // X
            entity.x = curr.value;
            break;
        case 20: // Y
            entity.y = curr.value;
            break;
        case 30: // Z
            entity.z = curr.value;
            break;
        case 40: // start width
            break;
        case 41: // end width
            break;
        case 42: // bulge
            if(curr.value != 0) entity.bulge = curr.value;
            break;
        case 70: // flags
            entity.curveFittingVertex = (curr.value & 1) !== 0;
            entity.curveFitTangent = (curr.value & 2) !== 0;
            entity.splineVertex = (curr.value & 8) !== 0;
            entity.splineControlPoint = (curr.value & 16) !== 0;
            entity.threeDPolylineVertex = (curr.value & 32) !== 0;
            entity.threeDPolylineMesh = (curr.value & 64) !== 0;
            entity.polyfaceMeshVertex = (curr.value & 128) !== 0;
            break;
        case 50: // curve fit tangent direction
            break;
        case 71: // polyface mesh vertex index
            entity.faces = [curr.value];
            break;
        case 72: // polyface mesh vertex index
            entity.faces[1] = curr.value;
            break;
        case 73: // polyface mesh vertex index
            entity.faces[2] = curr.value;
            break;
        case 74: // polyface mesh vertex index
            entity.faces[3] = curr.value;
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }

        curr = scanner.next();
    }
    return entity;
};
